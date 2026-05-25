// src/utils/svgImport.ts
//
// Parst eine SVG-Datei und liefert 2D-Konturen als flache Punktearrays.
//
// Strategie: Die SVG wird als String in einen versteckten DOM-Container eingefügt.
// Der Browser übernimmt damit das komplette Parsing inkl. Transforms, Bezier-Kurven
// und Bögen. Wir sampeln dann jeden Pfad über getTotalLength() / getPointAtLength().
//
// Koordinaten-System:
//   - SVG: Y zeigt nach unten, Ursprung oben-links
//   - CAD:  Y zeigt nach oben
//   → Y wird gespiegelt. Alle Konturen werden gemeinsam um die globale Gesamt-BBox-Mitte
//     verschoben, sodass ihre Relativpositionen erhalten bleiben.
//
// Einheiten:
//   - Liest width/height-Attribute inkl. Einheit (mm, cm, px, pt, in).
//   - Normiert auf mm; ohne erkennbare Einheit gilt 1 SVG-Unit = 1 mm.

export interface SvgContour {
  /** Pfad-ID oder generierter Name */
  id: string;
  /** Flaches 2D-Punktearray [x0,y0, x1,y1, …] in mm, Y nach oben, zentriert */
  points: number[];
  /** Bounding-Box in mm */
  bbox: { x: number; y: number; w: number; h: number };
}

export interface SvgImportResult {
  contours: SvgContour[];
  /** Gesamte Bounding-Box aller Konturen in mm */
  totalBbox: { w: number; h: number };
  /** Verwendet Einheit / Skalierungsfaktor */
  scaleMmPerUnit: number;
}

// Punkte je mm Pfadlänge (höher = feinere Kurven, langsamer)
const SAMPLES_PER_MM = 0.8;
// Minimale Punkte pro Pfad
const MIN_SAMPLES = 8;

export function parseSvg(svgText: string): SvgImportResult {
  // SVG in versteckten Container laden
  const container = document.createElement('div');
  container.style.cssText =
    'position:fixed;left:-9999px;top:-9999px;width:2000px;height:2000px;opacity:0;pointer-events:none';
  document.body.appendChild(container);

  try {
    container.innerHTML = svgText;

    const svgEl = container.querySelector('svg') as SVGSVGElement | null;
    if (!svgEl) throw new Error('Kein <svg>-Element in der Datei gefunden.');

    const scale = detectScale(svgEl);
    const contours = extractContours(svgEl, scale);

    if (contours.length === 0) {
      throw new Error(
        'Keine Konturen gefunden. Die SVG enthält keine <path>-, <rect>-, <circle>- oder <polygon>-Elemente.',
      );
    }

    // Gesamt-BBox
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const c of contours) {
      minX = Math.min(minX, c.bbox.x);
      minY = Math.min(minY, c.bbox.y);
      maxX = Math.max(maxX, c.bbox.x + c.bbox.w);
      maxY = Math.max(maxY, c.bbox.y + c.bbox.h);
    }

    // Alle Konturen relativ zur globalen Mitte verschieben — Relativpositionen bleiben erhalten
    const gCx = (minX + maxX) / 2;
    const gCy = (minY + maxY) / 2;
    for (const c of contours) {
      for (let i = 0; i < c.points.length; i += 2) {
        c.points[i]     = parseFloat((c.points[i]     - gCx).toFixed(4));
        c.points[i + 1] = parseFloat((c.points[i + 1] - gCy).toFixed(4));
      }
      c.bbox.x -= gCx;
      c.bbox.y -= gCy;
    }

    return {
      contours,
      totalBbox: { w: maxX - minX, h: maxY - minY },
      scaleMmPerUnit: scale,
    };
  } finally {
    document.body.removeChild(container);
  }
}

// ===========================================================================
// Skalierungs-Erkennung
// ===========================================================================

const UNIT_TO_MM: Record<string, number> = {
  mm: 1,
  cm: 10,
  in: 25.4,
  pt: 25.4 / 72,
  px: 25.4 / 96, // CSS 96 dpi
  '': 1,         // kein Suffix → 1 Unit = 1 mm
};

function detectScale(svgEl: SVGSVGElement): number {
  // width-Attribut lesen, z.B. "100mm", "210mm", "800px", "800"
  const widthAttr = svgEl.getAttribute('width') ?? '';
  const m = widthAttr.match(/^([0-9.]+)\s*(mm|cm|in|pt|px)?$/i);
  if (m) {
    const value = parseFloat(m[1]);
    const unit = (m[2] ?? '').toLowerCase();
    const mmPerUnit = UNIT_TO_MM[unit] ?? 1;
    const widthMm = value * mmPerUnit;
    // ViewBox-Breite
    const vb = svgEl.viewBox?.baseVal;
    if (vb && vb.width > 0) {
      return widthMm / vb.width;
    }
    // Ohne ViewBox: Einheit direkt
    return mmPerUnit;
  }
  // Kein nutzbares width-Attribut — 1:1
  return 1;
}

// ===========================================================================
// Konturen extrahieren
// ===========================================================================

function extractContours(svgEl: SVGSVGElement, scale: number): SvgContour[] {
  const contours: SvgContour[] = [];

  // Alle "zeichnenden" Elemente sammeln, auch aus <g>-Gruppen
  const elements = svgEl.querySelectorAll('path, rect, circle, ellipse, polygon, polyline');
  let idx = 0;

  for (const el of elements) {
    // Unsichtbare Elemente überspringen (display:none / visibility:hidden)
    const cs = window.getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;

    const pathEl = toPathElement(el, svgEl);
    if (!pathEl) continue;

    const totalLength = pathEl.getTotalLength();
    if (totalLength < 0.5) continue; // Degeneriert

    const numSamples = Math.max(MIN_SAMPLES, Math.round(totalLength * scale * SAMPLES_PER_MM));
    const rawPts: Array<[number, number]> = [];

    for (let i = 0; i <= numSamples; i++) {
      const t = (i / numSamples) * totalLength;
      const pt = pathEl.getPointAtLength(t);
      rawPts.push([pt.x * scale, -pt.y * scale]); // Y umkehren
    }

    // Letzten Punkt entfernen wenn fast identisch mit erstem (geschlossener Pfad)
    if (rawPts.length > 2) {
      const [fx, fy] = rawPts[0];
      const [lx, ly] = rawPts[rawPts.length - 1];
      if (Math.hypot(lx - fx, ly - fy) < 0.05) rawPts.pop();
    }

    if (rawPts.length < 3) continue;

    // Bounding-Box
    let bMinX = Infinity, bMinY = Infinity, bMaxX = -Infinity, bMaxY = -Infinity;
    for (const [x, y] of rawPts) {
      if (x < bMinX) bMinX = x;
      if (y < bMinY) bMinY = y;
      if (x > bMaxX) bMaxX = x;
      if (y > bMaxY) bMaxY = y;
    }

    // Rohe Koordinaten (Y umgekehrt, skaliert) — Zentrierung erfolgt global in parseSvg
    const points: number[] = [];
    for (const [x, y] of rawPts) {
      points.push(x, y);
    }

    const id =
      el.getAttribute('id') ||
      el.getAttribute('inkscape:label') ||
      `contour_${idx}`;

    contours.push({
      id,
      points,
      bbox: {
        x: bMinX,
        y: bMinY,
        w: bMaxX - bMinX,
        h: bMaxY - bMinY,
      },
    });
    idx++;
  }

  return contours;
}

// ===========================================================================
// Hilfs-Elemente → <path> (für getTotalLength)
// ===========================================================================

function toPathElement(
  el: Element,
  svgEl: SVGSVGElement,
): SVGPathElement | null {
  const tag = el.tagName.toLowerCase();

  if (tag === 'path') return el as SVGPathElement;

  // Für rect/circle/etc. bauen wir ein temporäres <path>-Element mit
  // äquivalentem `d`-Attribut. Das Element muss im selben SVG-DOM hängen,
  // damit Transforms korrekt angewendet werden.
  const d = shapeToPathD(el);
  if (!d) return null;

  const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path') as SVGPathElement;
  pathEl.setAttribute('d', d);
  // Transforms vom Original-Element übertragen
  const transform = el.getAttribute('transform');
  if (transform) pathEl.setAttribute('transform', transform);
  svgEl.appendChild(pathEl);

  // Sofort messen, dann wieder entfernen
  try {
    return pathEl;
  } finally {
    // Wir entfernen NACH Messung – der Aufrufer muss darauf achten,
    // dass er pathEl nicht nach dem SVG-Remove nutzt.
    // Das Entfernen übernimmt der Container-Cleanup am Ende von parseSvg.
    // (Kleine Ineffizienz: Elemente bleiben im DOM bis zum Container-Remove.)
  }
}

function shapeToPathD(el: Element): string | null {
  const tag = el.tagName.toLowerCase();

  if (tag === 'rect') {
    const x = nAttr(el, 'x'), y = nAttr(el, 'y');
    const w = nAttr(el, 'width'), h = nAttr(el, 'height');
    const rx = nAttr(el, 'rx'), ry = nAttr(el, 'ry') || rx;
    if (w <= 0 || h <= 0) return null;
    if (rx > 0) {
      // Gerundetes Rechteck
      return `M${x + rx},${y} H${x + w - rx} Q${x + w},${y} ${x + w},${y + ry}` +
        ` V${y + h - ry} Q${x + w},${y + h} ${x + w - rx},${y + h}` +
        ` H${x + rx} Q${x},${y + h} ${x},${y + h - ry}` +
        ` V${y + ry} Q${x},${y} ${x + rx},${y} Z`;
    }
    return `M${x},${y} H${x + w} V${y + h} H${x} Z`;
  }

  if (tag === 'circle') {
    const cx = nAttr(el, 'cx'), cy = nAttr(el, 'cy'), r = nAttr(el, 'r');
    if (r <= 0) return null;
    return `M${cx - r},${cy} A${r},${r} 0 1 0 ${cx + r},${cy} A${r},${r} 0 1 0 ${cx - r},${cy} Z`;
  }

  if (tag === 'ellipse') {
    const cx = nAttr(el, 'cx'), cy = nAttr(el, 'cy');
    const rx = nAttr(el, 'rx'), ry = nAttr(el, 'ry');
    if (rx <= 0 || ry <= 0) return null;
    return `M${cx - rx},${cy} A${rx},${ry} 0 1 0 ${cx + rx},${cy} A${rx},${ry} 0 1 0 ${cx - rx},${cy} Z`;
  }

  if (tag === 'polygon') {
    const pts = el.getAttribute('points') ?? '';
    if (!pts.trim()) return null;
    return 'M' + pts.trim().replace(/\s+/g, ' ') + ' Z';
  }

  if (tag === 'polyline') {
    const pts = el.getAttribute('points') ?? '';
    if (!pts.trim()) return null;
    return 'M' + pts.trim().replace(/\s+/g, ' ');
  }

  return null;
}

function nAttr(el: Element, name: string): number {
  return parseFloat(el.getAttribute(name) ?? '0') || 0;
}
