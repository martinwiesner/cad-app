// src/cad/edgeExtraction.ts
// Extrahiert alle Kanten eines Shapes als Polylinien + stabile IDs.
//
// STABILE EDGE-IDs
// ----------------
// Wir berechnen die ID aus geometrischen Eigenschaften, NICHT aus der Position
// im TopExp_Explorer-Output (die ist nicht stabil bei Topologieaenderungen).
//
// ID-Formel (auf 0.001 mm gerundet):
//   sha1( endpoint_lo_xyz | endpoint_hi_xyz | midpoint_xyz | length_rounded )
//
// "lo/hi" werden lexikographisch sortiert, damit Kanten-Endpunkte unabhaengig
// von Orientierung sind. Mittelpunkt + Laenge dienen als Unterscheidung
// fuer Kurven (zwei Kreisboegen mit gleichen Endpunkten haben unterschiedliche
// Mittelpunkte/Laengen).
//
// GRENZEN:
// - Wenn ein Slider die Box-Breite verdoppelt, aendert sich Endpunkt-XYZ
//   -> ID aendert sich -> Auswahl geht verloren. Das ist gewollt: die Kante
//   ist physisch eine andere geworden.
// - Wenn ein Boolean eine Kante zerteilt, entstehen mehrere neue Kanten mit
//   neuen IDs. Auch hier verlieren wir die Auswahl - korrektes Verhalten.
//
// FUER STABILE AUSWAHL UEBER PARAMETERAENDERUNGEN HINWEG:
// Spaeter koennen wir die ID mit relativen Eigenschaften (z.B. "horizontal,
// untere Ebene, parallel zu X") erweitern. Fuer den MVP reicht der geometrische
// Hash - Konfigurator-Workflows aendern Parameter selten so stark, dass die
// Endpunkte komplett wandern.

import type { EdgeData, EdgesPayload } from './types';

export function extractEdges(oc: any, shape: any): EdgesPayload {
  const edges: EdgeData[] = [];
  const seen = new Set<string>();
  let localIndex = 0;

  // Wir triangulieren NICHT extra - die Edges holen wir ueber BRep_Tool.Polygon3D
  // (haben die meisten Kanten in OCCT von Haus aus), oder ueber Curve-Diskretisierung.
  const exp = new oc.TopExp_Explorer_2(
    shape,
    oc.TopAbs_ShapeEnum.TopAbs_EDGE,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
  );

  try {
    while (exp.More()) {
      const edge = oc.TopoDS.Edge_1(exp.Current());
      const data = extractOneEdge(oc, edge, localIndex);
      if (data && !seen.has(data.edgeId)) {
        // Duplikat-Filter: Shared Edges zwischen Faces tauchen sonst doppelt auf
        seen.add(data.edgeId);
        edges.push(data);
        localIndex++;
      }
      exp.Next();
    }
  } finally {
    try { exp.delete(); } catch { /* ignore */ }
  }

  return { edges };
}

function extractOneEdge(oc: any, edge: any, localIndex: number): EdgeData | null {
  // Polylinien-Punkte holen. Erst probieren wir die diskrete Polyline,
  // sonst sampeln wir die parametrische Kurve.
  let pts = tryDiscretePolyline(oc, edge);
  if (!pts || pts.length === 0) {
    pts = sampleCurve(oc, edge, 16);
  }
  if (!pts || pts.length < 2) return null;

  // Endpunkte + Mittelpunkt
  const first: [number, number, number] = [pts[0], pts[1], pts[2]];
  const lastI = pts.length - 3;
  const last: [number, number, number] = [pts[lastI], pts[lastI + 1], pts[lastI + 2]];

  // Laenge berechnen
  let length = 0;
  for (let i = 0; i < pts.length - 3; i += 3) {
    const dx = pts[i + 3] - pts[i];
    const dy = pts[i + 4] - pts[i + 1];
    const dz = pts[i + 5] - pts[i + 2];
    length += Math.hypot(dx, dy, dz);
  }

  // Mittelpunkt
  const midI = (Math.floor(pts.length / 6)) * 3;
  const mid: [number, number, number] = [pts[midI], pts[midI + 1], pts[midI + 2]];

  // ID hashen
  const edgeId = makeEdgeId(first, last, mid, length);

  // Curve-Typ erkennen
  const curveType = guessCurveType(oc, edge);

  return {
    edgeId,
    localIndex,
    positions: new Float32Array(pts),
    length,
    curveType,
  };
}

// ---------------------------------------------------------------------------
//   Polyline-Extraction
// ---------------------------------------------------------------------------

function tryDiscretePolyline(oc: any, edge: any): number[] | null {
  // BRep_Tool.Polygon3D gibt eine bereits diskretisierte Polylinie zurueck,
  // wenn fuer diese Edge schon ein Mesh existiert.
  try {
    const loc = new oc.TopLoc_Location_1();
    let poly3d: any = null;
    try {
      poly3d = oc.BRep_Tool.Polygon3D(edge, loc);
    } catch { /* keine Polygon3D-API in dieser Version */ }

    if (poly3d && !isNull(poly3d)) {
      const target = unwrap(poly3d);
      if (typeof target.NbNodes === 'function' && typeof target.Nodes === 'function') {
        // Variante A: TColgp_Array1OfPnt via Nodes()
        const arr = target.Nodes();
        const n = arr.Length?.() ?? target.NbNodes();
        const trsf = loc.Transformation();
        const out: number[] = [];
        for (let i = 1; i <= n; i++) {
          const p = arr.Value(i);
          const [x, y, z] = [p.X(), p.Y(), p.Z()];
          const [tx, ty, tz] = applyTrsf(trsf, x, y, z);
          out.push(tx, ty, tz);
        }
        try { loc.delete(); } catch { /* */ }
        return out;
      }
    }
    try { loc.delete(); } catch { /* */ }
  } catch { /* faellt durch */ }
  return null;
}

function sampleCurve(oc: any, edge: any, samples: number): number[] | null {
  // BRepAdaptor_Curve liefert eine parametrisierte Kurve fuer die Edge.
  // API-NAME PRÜFEN: BRepAdaptor_Curve_2(edge)
  let adaptor: any = null;
  try {
    try {
      adaptor = new oc.BRepAdaptor_Curve_2(edge);
    } catch {
      adaptor = new oc.BRepAdaptor_Curve_1(edge);
    }
  } catch {
    return null;
  }

  try {
    const u0 = adaptor.FirstParameter();
    const u1 = adaptor.LastParameter();
    const out: number[] = [];
    for (let i = 0; i <= samples; i++) {
      const u = u0 + (u1 - u0) * (i / samples);
      const p = adaptor.Value(u);
      out.push(p.X(), p.Y(), p.Z());
      try { p.delete?.(); } catch { /* */ }
    }
    return out;
  } catch {
    return null;
  } finally {
    try { adaptor?.delete(); } catch { /* */ }
  }
}

function guessCurveType(oc: any, edge: any): EdgeData['curveType'] {
  try {
    let adaptor: any = null;
    try { adaptor = new oc.BRepAdaptor_Curve_2(edge); }
    catch { adaptor = new oc.BRepAdaptor_Curve_1(edge); }
    try {
      const t = adaptor.GetType();
      // OCCT GeomAbs_CurveType: 0=Line, 1=Circle, 2=Ellipse, 3=Hyperbola, 4=Parabola, 5=BezierCurve, 6=BSplineCurve, 7=OffsetCurve, 8=OtherCurve
      switch (t) {
        case 0: return 'line';
        case 1: return 'circle';
        case 2: case 3: case 4: case 5: case 6: return 'curve';
        default: return 'unknown';
      }
    } finally {
      try { adaptor.delete(); } catch { /* */ }
    }
  } catch {
    return 'unknown';
  }
}

// ---------------------------------------------------------------------------
//   Helpers
// ---------------------------------------------------------------------------

function isNull(o: any): boolean {
  try { return o.IsNull?.() === true; } catch { return false; }
}

function unwrap(o: any): any {
  if (typeof o.get === 'function') {
    try {
      const inner = o.get();
      if (inner) return inner;
    } catch { /* ignore */ }
  }
  return o;
}

function applyTrsf(trsf: any, x: number, y: number, z: number): [number, number, number] {
  try {
    const m11 = trsf.Value(1, 1), m12 = trsf.Value(1, 2), m13 = trsf.Value(1, 3), t1 = trsf.Value(1, 4);
    const m21 = trsf.Value(2, 1), m22 = trsf.Value(2, 2), m23 = trsf.Value(2, 3), t2 = trsf.Value(2, 4);
    const m31 = trsf.Value(3, 1), m32 = trsf.Value(3, 2), m33 = trsf.Value(3, 3), t3 = trsf.Value(3, 4);
    return [
      m11 * x + m12 * y + m13 * z + t1,
      m21 * x + m22 * y + m23 * z + t2,
      m31 * x + m32 * y + m33 * z + t3,
    ];
  } catch {
    return [x, y, z];
  }
}

// ---------------------------------------------------------------------------
//   Edge-ID generation (auch von filletEdges.ts genutzt)
// ---------------------------------------------------------------------------

export function makeEdgeId(
  a: [number, number, number],
  b: [number, number, number],
  mid: [number, number, number],
  length: number,
): string {
  // Endpunkte lexikographisch sortieren - macht ID richtungsunabhaengig
  const lo = lex(a, b) ? a : b;
  const hi = lex(a, b) ? b : a;
  // Auf 0.001 mm runden
  const r = (n: number) => Math.round(n * 1000) / 1000;
  const tokens = [
    r(lo[0]), r(lo[1]), r(lo[2]),
    r(hi[0]), r(hi[1]), r(hi[2]),
    r(mid[0]), r(mid[1]), r(mid[2]),
    r(length),
  ].join('|');
  return fnv1aHex(tokens);
}

/**
 * Berechnet die edgeId fuer eine einzelne TopoDS_Edge.
 * Wird von filletSelectedEdges/chamferSelectedEdges genutzt, damit
 * die ID-Berechnung garantiert identisch ist.
 */
export function computeEdgeId(oc: any, edge: any): string | null {
  let adaptor: any = null;
  try {
    try { adaptor = new oc.BRepAdaptor_Curve_2(edge); }
    catch { adaptor = new oc.BRepAdaptor_Curve_1(edge); }
    const u0 = adaptor.FirstParameter();
    const u1 = adaptor.LastParameter();
    const pts: number[] = [];
    const N = 16;
    for (let i = 0; i <= N; i++) {
      const u = u0 + (u1 - u0) * (i / N);
      const p = adaptor.Value(u);
      pts.push(p.X(), p.Y(), p.Z());
      try { p.delete?.(); } catch { /* */ }
    }
    if (pts.length < 6) return null;

    const first: [number, number, number] = [pts[0], pts[1], pts[2]];
    const lastI = pts.length - 3;
    const last: [number, number, number] = [pts[lastI], pts[lastI + 1], pts[lastI + 2]];
    let length = 0;
    for (let i = 0; i < pts.length - 3; i += 3) {
      length += Math.hypot(pts[i + 3] - pts[i], pts[i + 4] - pts[i + 1], pts[i + 5] - pts[i + 2]);
    }
    const midI = (Math.floor(pts.length / 6)) * 3;
    const mid: [number, number, number] = [pts[midI], pts[midI + 1], pts[midI + 2]];
    return makeEdgeId(first, last, mid, length);
  } catch {
    return null;
  } finally {
    try { adaptor?.delete(); } catch { /* */ }
  }
}

/** Gibt true zurueck wenn a < b in lexikographischer Reihenfolge (gerundet). */
function lex(a: [number, number, number], b: [number, number, number]): boolean {
  const r = (n: number) => Math.round(n * 1000);
  const ax = r(a[0]), bx = r(b[0]);
  if (ax !== bx) return ax < bx;
  const ay = r(a[1]), by = r(b[1]);
  if (ay !== by) return ay < by;
  return r(a[2]) < r(b[2]);
}

function fnv1aHex(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // Zwei mal hashen fuer 64-bit-aehnliche Identitaet
  let h2 = h ^ 0x9e3779b9;
  for (let i = str.length - 1; i >= 0; i--) {
    h2 ^= str.charCodeAt(i);
    h2 = Math.imul(h2, 0x01000193);
  }
  const toHex = (n: number) => (n >>> 0).toString(16).padStart(8, '0');
  return `e_${toHex(h)}${toHex(h2)}`;
}
