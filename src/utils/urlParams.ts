// src/utils/urlParams.ts
// Liest URL-Parameter beim Start und baut daraus einen vorausgefüllten Graphen.
// Unterstützte Parameter:
//   material=Stahl   – Name des Materials (string)
//   width=1200       – Breite in mm
//   height=600       – Höhe/Länge in mm
//   thickness=10     – Stärke in mm
//   density=7.85     – Dichte (nur informativ, kein CAD-Effekt)
//   mode=configurator – direkt in Konfigurator-Modus öffnen

import type { GraphDocument } from '../graph/graphTypes';

export interface MaterialUrlParams {
  material?: string;
  width?: number;
  height?: number;
  thickness?: number;
  density?: string;
  mode?: 'editor' | 'configurator';
}

export function parseUrlParams(): MaterialUrlParams | null {
  const sp = new URLSearchParams(window.location.search);
  const material   = sp.get('material')   ?? undefined;
  const width      = sp.has('width')      ? parseFloat(sp.get('width')!)     : undefined;
  const height     = sp.has('height')     ? parseFloat(sp.get('height')!)    : undefined;
  const thickness  = sp.has('thickness')  ? parseFloat(sp.get('thickness')!) : undefined;
  const density    = sp.get('density')    ?? undefined;
  const mode       = (sp.get('mode') as MaterialUrlParams['mode']) ?? undefined;

  if (!material && width == null && height == null && thickness == null) return null;
  return { material, width, height, thickness, density, mode };
}

export function buildGraphFromMaterialParams(p: MaterialUrlParams): GraphDocument {
  const w  = p.width     ?? 100;
  const d  = p.height    ?? 200;  // depth = zweite horizontale Dimension
  const t  = p.thickness ?? 10;   // height = Stärke (dünne Dimension)
  const name = p.material ?? 'Material';

  const maxW = Math.max(w * 3, 1000);
  const maxD = Math.max(d * 3, 1000);
  const maxT = Math.max(t * 5, 100);

  return {
    version: 1,
    units: 'mm',
    meta: { name, createdAt: new Date().toISOString() },
    nodes: [
      {
        id: 'mat-box',
        type: 'box',
        position: { x: 80, y: 120 },
        params: { width: w, depth: d, height: t, x: 0, y: 0, z: 0 },
      },
      {
        id: 'mat-prv',
        type: 'preview',
        position: { x: 340, y: 120 },
        params: { color: '#b8c4d0', quality: 'normal' },
      },
    ],
    edges: [
      { id: 'mat-e1', source: 'mat-box', sourceHandle: 'shape', target: 'mat-prv', targetHandle: 'shape' },
    ],
    publishedParams: [
      { id: 'pp-w', nodeId: 'mat-box', paramKey: 'width', label: 'Breite',  unit: 'mm', min: 1, max: maxW, step: 1,   order: 0 },
      { id: 'pp-d', nodeId: 'mat-box', paramKey: 'depth', label: 'Höhe',    unit: 'mm', min: 1, max: maxD, step: 1,   order: 1 },
      { id: 'pp-t', nodeId: 'mat-box', paramKey: 'height', label: 'Stärke', unit: 'mm', min: 1, max: maxT, step: 0.5, order: 2 },
    ],
    publishedNodes: ['mat-prv'],
  };
}
