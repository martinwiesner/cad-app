// src/graph/examples.ts
import type { GraphDocument } from './graphTypes';

/** Box + Bohrung + Fase - das MVP-Beispiel aus dem Konzept. */
export const exampleBoxWithHole: GraphDocument = {
  version: 1,
  units: 'mm',
  nodes: [
    { id: 'w',   type: 'slider', position: { x: 40,  y: 40 },   params: { value: 80, min: 20, max: 200, step: 1, label: 'Breite' } },
    { id: 'd',   type: 'slider', position: { x: 40,  y: 160 },  params: { value: 50, min: 20, max: 200, step: 1, label: 'Tiefe' } },
    { id: 'h',   type: 'slider', position: { x: 40,  y: 280 },  params: { value: 20, min: 5,  max: 100, step: 1, label: 'Höhe' } },
    { id: 'r',   type: 'slider', position: { x: 40,  y: 400 },  params: { value: 6,  min: 1,  max: 25,  step: 0.5, label: 'Bohr-R' } },
    { id: 'cr',  type: 'slider', position: { x: 40,  y: 520 },  params: { value: 1,  min: 0.1, max: 5, step: 0.1, label: 'Fase' } },

    { id: 'box', type: 'box',      position: { x: 360, y: 90 },  params: { width: 80, depth: 50, height: 20, x: 0, y: 0, z: 0 } },
    { id: 'hole',type: 'hole',     position: { x: 640, y: 200 }, params: { radius: 6, depth: 30, x: 25, y: 25, z: 0, through: true, axis: 'z' } },
    { id: 'cha', type: 'chamfer',  position: { x: 920, y: 250 }, params: { distance: 1 } },
    { id: 'prv', type: 'preview',  position: { x: 1180, y: 250 }, params: { color: '#b8c4d0', quality: 'normal' } },
  ],
  edges: [
    { id: 'e1', source: 'w',   sourceHandle: 'out',   target: 'box', targetHandle: 'width' },
    { id: 'e2', source: 'd',   sourceHandle: 'out',   target: 'box', targetHandle: 'depth' },
    { id: 'e3', source: 'h',   sourceHandle: 'out',   target: 'box', targetHandle: 'height' },
    { id: 'e4', source: 'box', sourceHandle: 'shape', target: 'hole', targetHandle: 'base' },
    { id: 'e5', source: 'r',   sourceHandle: 'out',   target: 'hole', targetHandle: 'radius' },
    { id: 'e6', source: 'hole',sourceHandle: 'shape', target: 'cha', targetHandle: 'shape' },
    { id: 'e7', source: 'cr',  sourceHandle: 'out',   target: 'cha', targetHandle: 'distance' },
    { id: 'e8', source: 'cha', sourceHandle: 'shape', target: 'prv', targetHandle: 'shape' },
  ],
};

/** Minimaler Test: nur eine Box anzeigen. */
export const exampleSimpleBox: GraphDocument = {
  version: 1,
  units: 'mm',
  nodes: [
    { id: 'box', type: 'box', position: { x: 80, y: 80 }, params: { width: 60, depth: 40, height: 20, x: 0, y: 0, z: 0 } },
    { id: 'prv', type: 'preview', position: { x: 400, y: 80 }, params: { color: '#cfd6dc', quality: 'normal' } },
  ],
  edges: [
    { id: 'e1', source: 'box', sourceHandle: 'shape', target: 'prv', targetHandle: 'shape' },
  ],
};

/** Zwei Boxen vereinigt - Union-Test. */
export const exampleUnion: GraphDocument = {
  version: 1,
  units: 'mm',
  nodes: [
    { id: 'b1', type: 'box', position: { x: 80, y: 80 },  params: { width: 60, depth: 40, height: 20, x: 0, y: 0, z: 0 } },
    { id: 'b2', type: 'box', position: { x: 80, y: 240 }, params: { width: 30, depth: 30, height: 40, x: 15, y: 5, z: 0 } },
    { id: 'u',  type: 'union', position: { x: 360, y: 160 }, params: {} },
    { id: 'prv',type: 'preview', position: { x: 620, y: 160 }, params: { color: '#cfd6dc', quality: 'normal' } },
  ],
  edges: [
    { id: 'e1', source: 'b1', sourceHandle: 'shape', target: 'u', targetHandle: 'a' },
    { id: 'e2', source: 'b2', sourceHandle: 'shape', target: 'u', targetHandle: 'b' },
    { id: 'e3', source: 'u',  sourceHandle: 'shape', target: 'prv', targetHandle: 'shape' },
  ],
};

/** Box + selektive Fillets - Demo fuer Edge-Picking. */
export const exampleSelectiveFillet: GraphDocument = {
  version: 1,
  units: 'mm',
  nodes: [
    { id: 'r',    type: 'slider', position: { x: 40, y: 40 },  params: { value: 3, min: 0.5, max: 12, step: 0.5, label: 'Fillet-R' } },
    { id: 'box',  type: 'box', position: { x: 320, y: 40 }, params: { width: 80, depth: 60, height: 30, x: 0, y: 0, z: 0 } },
    { id: 'fil',  type: 'filletEdges', position: { x: 620, y: 80 }, params: { radius: 3, edgeIds: [] } },
    { id: 'prv',  type: 'preview', position: { x: 920, y: 80 }, params: { color: '#b8c4d0', quality: 'normal' } },
  ],
  edges: [
    { id: 'e1', source: 'box', sourceHandle: 'shape', target: 'fil', targetHandle: 'shape' },
    { id: 'e2', source: 'r',   sourceHandle: 'out',   target: 'fil', targetHandle: 'radius' },
    { id: 'e3', source: 'fil', sourceHandle: 'shape', target: 'prv', targetHandle: 'shape' },
  ],
};

/** Moebel-Regalbrett: Platte mit zwei Reihen Reihenlochbohrungen im 32mm-System. */
export const exampleShelfBoard: GraphDocument = {
  version: 1,
  units: 'mm',
  nodes: [
    { id: 'len',  type: 'slider', position: { x: 40, y: 40 },
      params: { value: 800, min: 200, max: 2000, step: 10, label: 'Länge' } },
    { id: 'wid',  type: 'slider', position: { x: 40, y: 140 },
      params: { value: 300, min: 100, max: 600, step: 10, label: 'Tiefe' } },
    { id: 'thk',  type: 'slider', position: { x: 40, y: 240 },
      params: { value: 19, min: 12, max: 38, step: 1, label: 'Stärke' } },
    { id: 'plate', type: 'plate', position: { x: 340, y: 80 },
      params: { x: 0, y: 0, z: 0 } },
    { id: 'pat',  type: 'holePattern', position: { x: 640, y: 80 },
      params: {
        diameter: 5, depth: 12, through: false,
        countX: 1, countY: 16, spacingX: 32, spacingY: 32,
        originX: 37, originY: 64, originZ: 19,
        axis: 'z',
      } },
    { id: 'prv',  type: 'preview', position: { x: 940, y: 80 },
      params: { color: '#c8b888', quality: 'normal' } },
  ],
  edges: [
    { id: 'e1', source: 'len', sourceHandle: 'out', target: 'plate', targetHandle: 'length' },
    { id: 'e2', source: 'wid', sourceHandle: 'out', target: 'plate', targetHandle: 'width' },
    { id: 'e3', source: 'thk', sourceHandle: 'out', target: 'plate', targetHandle: 'thickness' },
    { id: 'e4', source: 'plate', sourceHandle: 'shape', target: 'pat', targetHandle: 'base' },
    { id: 'e5', source: 'pat', sourceHandle: 'shape', target: 'prv', targetHandle: 'shape' },
  ],
};

/** Polygon-Extrusion Demo: ein Fuenfeck (Haus-Form) als Solid. */
export const exampleHousePolygon: GraphDocument = {
  version: 1,
  units: 'mm',
  nodes: [
    { id: 'ext',  type: 'extrudePolygon', position: { x: 200, y: 80 },
      params: {
        pointsJson: '[0,0, 60,0, 60,40, 30,60, 0,40]',
        height: 25, baseZ: 0, direction: 'z',
      } },
    { id: 'prv',  type: 'preview', position: { x: 600, y: 80 },
      params: { color: '#c89a88', quality: 'normal' } },
  ],
  edges: [
    { id: 'e1', source: 'ext', sourceHandle: 'shape', target: 'prv', targetHandle: 'shape' },
  ],
};

/** Intersection-Demo: Box ∩ Kugel = abgerundeter Quader. */
export const exampleIntersection: GraphDocument = {
  version: 1,
  units: 'mm',
  nodes: [
    { id: 'box',  type: 'box', position: { x: 60, y: 60 },
      params: { width: 60, depth: 60, height: 60, x: -30, y: -30, z: -30 } },
    { id: 'sph',  type: 'sphere', position: { x: 60, y: 240 },
      params: { radius: 38, x: 0, y: 0, z: 0 } },
    { id: 'isct', type: 'intersection', position: { x: 380, y: 150 }, params: {} },
    { id: 'prv',  type: 'preview', position: { x: 680, y: 150 },
      params: { color: '#b8d4e6', quality: 'normal' } },
  ],
  edges: [
    { id: 'e1', source: 'box', sourceHandle: 'shape', target: 'isct', targetHandle: 'a' },
    { id: 'e2', source: 'sph', sourceHandle: 'shape', target: 'isct', targetHandle: 'b' },
    { id: 'e3', source: 'isct', sourceHandle: 'shape', target: 'prv', targetHandle: 'shape' },
  ],
};

/** Holz-Regalbrett mit Eichen-Material. */
export const exampleWoodPlate: GraphDocument = {
  version: 1,
  units: 'mm',
  nodes: [
    { id: 'plate', type: 'plate', position: { x: 60, y: 100 },
      params: { length: 800, width: 300, thickness: 25, x: 0, y: 0, z: 0 } },
    { id: 'mat',   type: 'material', position: { x: 400, y: 100 },
      params: { preset: 'wood-oak', color: '#b8956a', overrideColor: false,
                metalness: 0, roughness: 0.78, opacity: 1.0 } },
    { id: 'prv',   type: 'preview', position: { x: 720, y: 100 },
      params: { color: '#b8c4d0', quality: 'normal' } },
  ],
  edges: [
    { id: 'e1', source: 'plate', sourceHandle: 'shape', target: 'mat', targetHandle: 'shape' },
    { id: 'e2', source: 'mat',   sourceHandle: 'shape', target: 'prv', targetHandle: 'shape' },
  ],
};

/** Demo: 3 nebeneinander stehende Koerper mit verschiedenen Materialien. */
export const exampleMultiPreview: GraphDocument = {
  version: 1,
  units: 'mm',
  nodes: [
    // Linke Box - Eiche
    { id: 'b1',  type: 'box', position: { x: 60, y: 60 },
      params: { width: 60, depth: 60, height: 30, x: -120, y: -30, z: 0 } },
    { id: 'm1',  type: 'material', position: { x: 320, y: 60 },
      params: { preset: 'wood-oak', color: '#b8956a', overrideColor: false,
                metalness: 0, roughness: 0.78, opacity: 1.0 } },
    { id: 'p1',  type: 'preview', position: { x: 600, y: 60 },
      params: { color: '#b8c4d0', quality: 'normal' } },

    // Mittlere Kugel - Stahl
    { id: 's2',  type: 'sphere', position: { x: 60, y: 240 },
      params: { radius: 25, x: 0, y: 0, z: 0 } },
    { id: 'm2',  type: 'material', position: { x: 320, y: 240 },
      params: { preset: 'steel', color: '#9aa3ad', overrideColor: false,
                metalness: 0.92, roughness: 0.42, opacity: 1.0 } },
    { id: 'p2',  type: 'preview', position: { x: 600, y: 240 },
      params: { color: '#b8c4d0', quality: 'normal' } },

    // Rechter Cone - Messing
    { id: 'c3',  type: 'cone', position: { x: 60, y: 420 },
      params: { radius1: 22, radius2: 6, height: 50, x: 120, y: -30, z: 0, axis: 'z' } },
    { id: 'm3',  type: 'material', position: { x: 320, y: 420 },
      params: { preset: 'brass', color: '#c2a06a', overrideColor: false,
                metalness: 0.95, roughness: 0.35, opacity: 1.0 } },
    { id: 'p3',  type: 'preview', position: { x: 600, y: 420 },
      params: { color: '#b8c4d0', quality: 'normal' } },
  ],
  edges: [
    { id: 'e1', source: 'b1', sourceHandle: 'shape', target: 'm1', targetHandle: 'shape' },
    { id: 'e2', source: 'm1', sourceHandle: 'shape', target: 'p1', targetHandle: 'shape' },
    { id: 'e3', source: 's2', sourceHandle: 'shape', target: 'm2', targetHandle: 'shape' },
    { id: 'e4', source: 'm2', sourceHandle: 'shape', target: 'p2', targetHandle: 'shape' },
    { id: 'e5', source: 'c3', sourceHandle: 'shape', target: 'm3', targetHandle: 'shape' },
    { id: 'e6', source: 'm3', sourceHandle: 'shape', target: 'p3', targetHandle: 'shape' },
  ],
};
