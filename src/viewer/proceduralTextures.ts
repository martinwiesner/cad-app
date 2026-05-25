// src/viewer/proceduralTextures.ts
// Erzeugt prozedurale Texturen (Holzmaserung, gebuerstetes Metall, Noise)
// als Three.js CanvasTextures - ohne externe Bilddateien.
//
// Performance: Texturen werden gecacht. Erzeugung passiert nur einmal pro
// preset+texture-Kombi.

import * as THREE from 'three';

const cache = new Map<string, THREE.Texture>();

export function getProceduralTexture(
  kind: 'wood-grain' | 'brushed-metal' | 'noise',
  baseColorHex: string,
  variant: 'oak' | 'walnut' | 'birch' | 'metal' = 'oak',
): THREE.Texture {
  const cacheKey = `${kind}_${baseColorHex}_${variant}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const tex = createTexture(kind, baseColorHex, variant);
  cache.set(cacheKey, tex);
  return tex;
}

function createTexture(kind: string, baseColorHex: string, variant: string): THREE.Texture {
  const SIZE = 512;
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d')!;

  if (kind === 'wood-grain') {
    drawWoodGrain(ctx, SIZE, baseColorHex, variant);
  } else if (kind === 'brushed-metal') {
    drawBrushedMetal(ctx, SIZE, baseColorHex);
  } else if (kind === 'noise') {
    drawNoise(ctx, SIZE, baseColorHex);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

// ---------------------------------------------------------------------------
//   Wood Grain
// ---------------------------------------------------------------------------

function drawWoodGrain(ctx: CanvasRenderingContext2D, size: number, baseHex: string, variant: string): void {
  // Grundfarbe als Hintergrund
  ctx.fillStyle = baseHex;
  ctx.fillRect(0, 0, size, size);

  const base = hexToRgb(baseHex);

  // Maserungs-Parameter pro Holzart
  const config = {
    oak:    { lineCount: 60, lineThickness: 1.4, contrast: 0.18, knotChance: 0.012, knotMaxR: 12 },
    walnut: { lineCount: 80, lineThickness: 1.2, contrast: 0.22, knotChance: 0.015, knotMaxR: 10 },
    birch:  { lineCount: 45, lineThickness: 1.0, contrast: 0.10, knotChance: 0.005, knotMaxR: 6  },
  }[variant] ?? { lineCount: 60, lineThickness: 1.2, contrast: 0.18, knotChance: 0.01, knotMaxR: 10 };

  // Horizontale Maserungslinien mit leichten Welligkeiten
  for (let i = 0; i < config.lineCount; i++) {
    const baseY = (i / config.lineCount) * size + (Math.random() - 0.5) * 4;
    // Faktor zwischen -1 (dunkel) und +1 (hell)
    const tint = (Math.random() * 2 - 1) * config.contrast;
    const lineColor = adjustBrightness(base, tint);
    ctx.strokeStyle = `rgba(${lineColor.r},${lineColor.g},${lineColor.b},0.55)`;
    ctx.lineWidth = config.lineThickness + Math.random() * 0.8;

    ctx.beginPath();
    let x = 0;
    let y = baseY;
    ctx.moveTo(x, y);
    while (x < size) {
      x += 6 + Math.random() * 6;
      y = baseY + Math.sin((x / size) * Math.PI * 6 + i) * 1.2 + (Math.random() - 0.5) * 0.8;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // Astknoten als dunkle Ovale
  const knotCount = Math.floor(size * size * config.knotChance / 1000);
  for (let i = 0; i < knotCount; i++) {
    const cx = Math.random() * size;
    const cy = Math.random() * size;
    const r = 3 + Math.random() * config.knotMaxR;
    // Mehrere konzentrische Ringe fuer realistischeren Knoten
    for (let ring = 0; ring < 4; ring++) {
      const ringR = r * (1 - ring * 0.22);
      const darker = adjustBrightness(base, -0.35 + ring * 0.04);
      ctx.fillStyle = `rgba(${darker.r},${darker.g},${darker.b},${0.5 - ring * 0.08})`;
      ctx.beginPath();
      ctx.ellipse(cx, cy, ringR * 1.4, ringR * 0.85, Math.random() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Leichter Noise-Overlay fuer Tiefe
  addNoiseOverlay(ctx, size, 0.04);
}

// ---------------------------------------------------------------------------
//   Brushed Metal
// ---------------------------------------------------------------------------

function drawBrushedMetal(ctx: CanvasRenderingContext2D, size: number, baseHex: string): void {
  const base = hexToRgb(baseHex);
  ctx.fillStyle = baseHex;
  ctx.fillRect(0, 0, size, size);

  // Horizontale Buerstspuren
  const strokeCount = 800;
  for (let i = 0; i < strokeCount; i++) {
    const y = Math.random() * size;
    const xStart = Math.random() * size;
    const xEnd = xStart + 20 + Math.random() * 200;
    const tint = (Math.random() * 2 - 1) * 0.18;
    const c = adjustBrightness(base, tint);
    ctx.strokeStyle = `rgba(${c.r},${c.g},${c.b},${0.15 + Math.random() * 0.4})`;
    ctx.lineWidth = 0.5 + Math.random() * 0.8;
    ctx.beginPath();
    ctx.moveTo(xStart, y);
    ctx.lineTo(xEnd, y);
    ctx.stroke();
  }

  addNoiseOverlay(ctx, size, 0.025);
}

// ---------------------------------------------------------------------------
//   Generic Noise
// ---------------------------------------------------------------------------

function drawNoise(ctx: CanvasRenderingContext2D, size: number, baseHex: string): void {
  const base = hexToRgb(baseHex);
  ctx.fillStyle = baseHex;
  ctx.fillRect(0, 0, size, size);
  addNoiseOverlay(ctx, size, 0.1);
}

function addNoiseOverlay(ctx: CanvasRenderingContext2D, size: number, intensity: number): void {
  const img = ctx.getImageData(0, 0, size, size);
  const data = img.data;
  for (let i = 0; i < data.length; i += 4) {
    const n = (Math.random() - 0.5) * 255 * intensity;
    data[i]     = clamp255(data[i] + n);
    data[i + 1] = clamp255(data[i + 1] + n);
    data[i + 2] = clamp255(data[i + 2] + n);
  }
  ctx.putImageData(img, 0, 0);
}

// ---------------------------------------------------------------------------
//   Helpers
// ---------------------------------------------------------------------------

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.substring(0, 2), 16),
    g: parseInt(h.substring(2, 4), 16),
    b: parseInt(h.substring(4, 6), 16),
  };
}

function adjustBrightness(c: { r: number; g: number; b: number }, factor: number): { r: number; g: number; b: number } {
  // factor in [-1, 1]: -1 = schwarz, +1 = weiss
  if (factor >= 0) {
    return {
      r: Math.min(255, c.r + (255 - c.r) * factor),
      g: Math.min(255, c.g + (255 - c.g) * factor),
      b: Math.min(255, c.b + (255 - c.b) * factor),
    };
  }
  return {
    r: Math.max(0, c.r * (1 + factor)),
    g: Math.max(0, c.g * (1 + factor)),
    b: Math.max(0, c.b * (1 + factor)),
  };
}

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

/** Texturen aus dem Cache freigeben. Bei Hot-Reloads im Dev-Modus nuetzlich. */
export function clearTextureCache(): void {
  for (const t of cache.values()) {
    try { t.dispose(); } catch { /* */ }
  }
  cache.clear();
}
