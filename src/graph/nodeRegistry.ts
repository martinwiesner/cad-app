// src/graph/nodeRegistry.ts
// Single source of truth fuer alle Node-Typen.

import type { NodeSpec } from './graphTypes';
export type { NodeParamSchema } from './graphTypes';

export const NODE_SPECS: Record<string, NodeSpec> = {
  // ===== Parameter =========================================================
  number: {
    type: 'number',
    category: 'parameter',
    label: 'Number',
    inputs: [],
    outputs: [{ id: 'out', label: 'value', dataType: 'number' }],
    params: [
      { key: 'value', label: 'Wert', kind: 'number', default: 0, step: 0.1 },
    ],
  },
  slider: {
    type: 'slider',
    category: 'parameter',
    label: 'Slider',
    inputs: [],
    outputs: [{ id: 'out', label: 'value', dataType: 'number' }],
    params: [
      { key: 'value', label: 'Wert', kind: 'slider', default: 50, min: 0, max: 100, step: 1, unit: 'mm' },
      { key: 'min', label: 'Min', kind: 'number', default: 0 },
      { key: 'max', label: 'Max', kind: 'number', default: 100 },
      { key: 'step', label: 'Step', kind: 'number', default: 1 },
      { key: 'label', label: 'Label', kind: 'string', default: '' },
    ],
  },

  // ===== Primitive =========================================================
  box: {
    type: 'box',
    category: 'primitive',
    label: 'Box',
    inputs: [
      { id: 'width', label: 'width', dataType: 'number', default: 50 },
      { id: 'depth', label: 'depth', dataType: 'number', default: 50 },
      { id: 'height', label: 'height', dataType: 'number', default: 20 },
      { id: 'x', label: 'x', dataType: 'number', default: 0 },
      { id: 'y', label: 'y', dataType: 'number', default: 0 },
      { id: 'z', label: 'z', dataType: 'number', default: 0 },
    ],
    outputs: [{ id: 'shape', label: 'shape', dataType: 'shape' }],
    params: [
      { key: 'width', label: 'Breite', kind: 'number', default: 50, min: 1, step: 1, unit: 'mm' },
      { key: 'depth', label: 'Tiefe', kind: 'number', default: 50, min: 1, step: 1, unit: 'mm' },
      { key: 'height', label: 'Höhe', kind: 'number', default: 20, min: 1, step: 1, unit: 'mm' },
      { key: 'x', label: 'X', kind: 'number', default: 0, step: 1, unit: 'mm' },
      { key: 'y', label: 'Y', kind: 'number', default: 0, step: 1, unit: 'mm' },
      { key: 'z', label: 'Z', kind: 'number', default: 0, step: 1, unit: 'mm' },
    ],
  },
  cylinder: {
    type: 'cylinder',
    category: 'primitive',
    label: 'Cylinder',
    inputs: [
      { id: 'radius', label: 'radius', dataType: 'number', default: 10 },
      { id: 'height', label: 'height', dataType: 'number', default: 30 },
      { id: 'x', label: 'x', dataType: 'number', default: 0 },
      { id: 'y', label: 'y', dataType: 'number', default: 0 },
      { id: 'z', label: 'z', dataType: 'number', default: 0 },
    ],
    outputs: [{ id: 'shape', label: 'shape', dataType: 'shape' }],
    params: [
      { key: 'radius', label: 'Radius', kind: 'number', default: 10, min: 0.1, step: 0.5, unit: 'mm' },
      { key: 'height', label: 'Höhe', kind: 'number', default: 30, min: 0.1, step: 1, unit: 'mm' },
      { key: 'x', label: 'X', kind: 'number', default: 0, step: 1, unit: 'mm' },
      { key: 'y', label: 'Y', kind: 'number', default: 0, step: 1, unit: 'mm' },
      { key: 'z', label: 'Z', kind: 'number', default: 0, step: 1, unit: 'mm' },
      { key: 'axis', label: 'Achse', kind: 'select', default: 'z',
        options: [{ value: 'x', label: 'X' }, { value: 'y', label: 'Y' }, { value: 'z', label: 'Z' }] },
    ],
  },
  sphere: {
    type: 'sphere',
    category: 'primitive',
    label: 'Sphere',
    inputs: [
      { id: 'radius', label: 'radius', dataType: 'number', default: 15 },
      { id: 'x', label: 'x', dataType: 'number', default: 0 },
      { id: 'y', label: 'y', dataType: 'number', default: 0 },
      { id: 'z', label: 'z', dataType: 'number', default: 0 },
    ],
    outputs: [{ id: 'shape', label: 'shape', dataType: 'shape' }],
    params: [
      { key: 'radius', label: 'Radius', kind: 'number', default: 15, min: 0.1, step: 0.5, unit: 'mm' },
      { key: 'x', label: 'X', kind: 'number', default: 0, step: 1, unit: 'mm' },
      { key: 'y', label: 'Y', kind: 'number', default: 0, step: 1, unit: 'mm' },
      { key: 'z', label: 'Z', kind: 'number', default: 0, step: 1, unit: 'mm' },
    ],
  },
  cone: {
    type: 'cone',
    category: 'primitive',
    label: 'Cone',
    inputs: [
      { id: 'radius1', label: 'r unten', dataType: 'number', default: 15 },
      { id: 'radius2', label: 'r oben', dataType: 'number', default: 0 },
      { id: 'height', label: 'height', dataType: 'number', default: 30 },
      { id: 'x', label: 'x', dataType: 'number', default: 0 },
      { id: 'y', label: 'y', dataType: 'number', default: 0 },
      { id: 'z', label: 'z', dataType: 'number', default: 0 },
    ],
    outputs: [{ id: 'shape', label: 'shape', dataType: 'shape' }],
    params: [
      { key: 'radius1', label: 'Radius unten', kind: 'number', default: 15, min: 0, step: 0.5, unit: 'mm' },
      { key: 'radius2', label: 'Radius oben',  kind: 'number', default: 0,  min: 0, step: 0.5, unit: 'mm' },
      { key: 'height',  label: 'Höhe', kind: 'number', default: 30, min: 0.1, step: 1, unit: 'mm' },
      { key: 'x', label: 'X', kind: 'number', default: 0, step: 1, unit: 'mm' },
      { key: 'y', label: 'Y', kind: 'number', default: 0, step: 1, unit: 'mm' },
      { key: 'z', label: 'Z', kind: 'number', default: 0, step: 1, unit: 'mm' },
      { key: 'axis', label: 'Achse', kind: 'select', default: 'z',
        options: [{ value: 'x', label: 'X' }, { value: 'y', label: 'Y' }, { value: 'z', label: 'Z' }] },
    ],
  },
  plate: {
    type: 'plate',
    category: 'primitive',
    label: 'Plate (Möbel)',
    inputs: [
      { id: 'length', label: 'Länge', dataType: 'number', default: 600 },
      { id: 'width', label: 'Breite', dataType: 'number', default: 400 },
      { id: 'thickness', label: 'Stärke', dataType: 'number', default: 19 },
      { id: 'x', label: 'x', dataType: 'number', default: 0 },
      { id: 'y', label: 'y', dataType: 'number', default: 0 },
      { id: 'z', label: 'z', dataType: 'number', default: 0 },
    ],
    outputs: [{ id: 'shape', label: 'shape', dataType: 'shape' }],
    params: [
      { key: 'length', label: 'Länge', kind: 'number', default: 600, min: 1, step: 10, unit: 'mm' },
      { key: 'width', label: 'Breite', kind: 'number', default: 400, min: 1, step: 10, unit: 'mm' },
      { key: 'thickness', label: 'Stärke', kind: 'number', default: 19, min: 0.5, step: 0.5, unit: 'mm' },
      { key: 'x', label: 'X', kind: 'number', default: 0, step: 10, unit: 'mm' },
      { key: 'y', label: 'Y', kind: 'number', default: 0, step: 10, unit: 'mm' },
      { key: 'z', label: 'Z', kind: 'number', default: 0, step: 10, unit: 'mm' },
    ],
  },
  extrudePolygon: {
    type: 'extrudePolygon',
    category: 'primitive',
    label: 'Polygon-Extrusion',
    inputs: [
      { id: 'height', label: 'height', dataType: 'number', default: 20 },
    ],
    outputs: [{ id: 'shape', label: 'shape', dataType: 'shape' }],
    params: [
      // Punkte werden als JSON-String editiert - geht in einem dedizierten Editor erst
      // im Properties-Panel. Default: ein Rechteck.
      { key: 'pointsJson', label: 'Punkte (JSON-Array)', kind: 'string',
        default: '[0,0, 50,0, 50,30, 25,45, 0,30]' },
      { key: 'height', label: 'Extrusionshöhe', kind: 'number', default: 20, min: 0.1, step: 1, unit: 'mm' },
      { key: 'baseZ', label: 'Basis-Z', kind: 'number', default: 0, step: 1, unit: 'mm' },
      { key: 'direction', label: 'Richtung', kind: 'select', default: 'z',
        options: [{ value: 'x', label: 'X' }, { value: 'y', label: 'Y' }, { value: 'z', label: 'Z' }] },
    ],
  },
  sketch: {
    type: 'sketch',
    category: 'primitive',
    label: 'Skizze + Extrusion',
    inputs: [
      { id: 'height', label: 'height', dataType: 'number', default: 20 },
    ],
    outputs: [{ id: 'shape', label: 'shape', dataType: 'shape' }],
    params: [
      { key: 'sketchJson', label: 'Skizze', kind: 'sketch', default: '' },
      { key: 'height', label: 'Extrusionshöhe', kind: 'number', default: 20, min: 0.1, step: 1, unit: 'mm' },
      { key: 'baseZ', label: 'Basis-Z', kind: 'number', default: 0, step: 1, unit: 'mm' },
      { key: 'direction', label: 'Richtung', kind: 'select', default: 'z',
        options: [{ value: 'x', label: 'X' }, { value: 'y', label: 'Y' }, { value: 'z', label: 'Z' }] },
    ],
  },
  importedStep: {
    type: 'importedStep',
    category: 'primitive',
    label: 'STEP Import',
    inputs: [],
    outputs: [{ id: 'shape', label: 'shape', dataType: 'shape' }],
    params: [
      { key: 'assetId', label: 'Asset ID', kind: 'string', default: '' },
      { key: 'filename', label: 'Dateiname', kind: 'string', default: '' },
    ],
  },
  importedStl: {
    type: 'importedStl',
    category: 'primitive',
    label: 'STL Import',
    inputs: [],
    outputs: [{ id: 'shape', label: 'shape', dataType: 'shape' }],
    params: [
      { key: 'assetId', label: 'Asset ID', kind: 'string', default: '' },
      { key: 'filename', label: 'Dateiname', kind: 'string', default: '' },
    ],
  },

  // ===== Operation =========================================================
  difference: {
    type: 'difference',
    category: 'operation',
    label: 'Difference (Abziehen)',
    inputs: [
      { id: 'base', label: 'base', dataType: 'shape' },
      { id: 'tool', label: 'tool', dataType: 'shape' },
    ],
    outputs: [{ id: 'shape', label: 'shape', dataType: 'shape' }],
    params: [],
  },
  union: {
    type: 'union',
    category: 'operation',
    label: 'Union (Vereinigen)',
    inputs: [
      { id: 'a', label: 'a', dataType: 'shape' },
      { id: 'b', label: 'b', dataType: 'shape' },
    ],
    outputs: [{ id: 'shape', label: 'shape', dataType: 'shape' }],
    params: [],
  },
  intersection: {
    type: 'intersection',
    category: 'operation',
    label: 'Intersection (Schnittmenge)',
    inputs: [
      { id: 'a', label: 'a', dataType: 'shape' },
      { id: 'b', label: 'b', dataType: 'shape' },
    ],
    outputs: [{ id: 'shape', label: 'shape', dataType: 'shape' }],
    params: [],
  },

  // ===== Feature ===========================================================
  fillet: {
    type: 'fillet',
    category: 'feature',
    label: 'Fillet (alle Kanten)',
    inputs: [
      { id: 'shape', label: 'shape', dataType: 'shape' },
      { id: 'radius', label: 'radius', dataType: 'number', default: 1 },
    ],
    outputs: [{ id: 'shape', label: 'shape', dataType: 'shape' }],
    params: [
      { key: 'radius', label: 'Radius', kind: 'number', default: 1, min: 0.01, step: 0.1, unit: 'mm' },
    ],
  },
  chamfer: {
    type: 'chamfer',
    category: 'feature',
    label: 'Chamfer (alle Kanten)',
    inputs: [
      { id: 'shape', label: 'shape', dataType: 'shape' },
      { id: 'distance', label: 'distance', dataType: 'number', default: 1 },
    ],
    outputs: [{ id: 'shape', label: 'shape', dataType: 'shape' }],
    params: [
      { key: 'distance', label: 'Abstand', kind: 'number', default: 1, min: 0.01, step: 0.1, unit: 'mm' },
    ],
  },
  filletEdges: {
    type: 'filletEdges',
    category: 'feature',
    label: 'Fillet (Auswahl)',
    inputs: [
      { id: 'shape', label: 'shape', dataType: 'shape' },
      { id: 'radius', label: 'radius', dataType: 'number', default: 1 },
    ],
    outputs: [{ id: 'shape', label: 'shape', dataType: 'shape' }],
    params: [
      { key: 'radius', label: 'Radius', kind: 'number', default: 1, min: 0.01, step: 0.1, unit: 'mm' },
      // edgeIds wird ueber das Properties-Panel + Viewer-Pick gepflegt
      { key: 'edgeIds', label: 'Edge IDs', kind: 'edgeList', default: [] },
    ],
  },
  chamferEdges: {
    type: 'chamferEdges',
    category: 'feature',
    label: 'Chamfer (Auswahl)',
    inputs: [
      { id: 'shape', label: 'shape', dataType: 'shape' },
      { id: 'distance', label: 'distance', dataType: 'number', default: 1 },
    ],
    outputs: [{ id: 'shape', label: 'shape', dataType: 'shape' }],
    params: [
      { key: 'distance', label: 'Abstand', kind: 'number', default: 1, min: 0.01, step: 0.1, unit: 'mm' },
      { key: 'edgeIds', label: 'Edge IDs', kind: 'edgeList', default: [] },
    ],
  },
  hole: {
    type: 'hole',
    category: 'feature',
    label: 'Hole (Bohrung)',
    inputs: [
      { id: 'base', label: 'base', dataType: 'shape' },
      { id: 'radius', label: 'radius', dataType: 'number', default: 4 },
      { id: 'x', label: 'x', dataType: 'number', default: 0 },
      { id: 'y', label: 'y', dataType: 'number', default: 0 },
      { id: 'z', label: 'z', dataType: 'number', default: 0 },
    ],
    outputs: [{ id: 'shape', label: 'shape', dataType: 'shape' }],
    params: [
      { key: 'radius', label: 'Radius', kind: 'number', default: 4, min: 0.1, step: 0.5, unit: 'mm' },
      { key: 'depth', label: 'Tiefe', kind: 'number', default: 20, min: 0.1, step: 1, unit: 'mm' },
      { key: 'x', label: 'X', kind: 'number', default: 0, step: 1, unit: 'mm' },
      { key: 'y', label: 'Y', kind: 'number', default: 0, step: 1, unit: 'mm' },
      { key: 'z', label: 'Z', kind: 'number', default: 0, step: 1, unit: 'mm' },
      { key: 'through', label: 'Durchgangsbohrung', kind: 'boolean', default: true },
      { key: 'axis', label: 'Achse', kind: 'select', default: 'z',
        options: [{ value: 'x', label: 'X' }, { value: 'y', label: 'Y' }, { value: 'z', label: 'Z' }] },
    ],
  },
  holePattern: {
    type: 'holePattern',
    category: 'feature',
    label: 'Bohrbild',
    inputs: [
      { id: 'base', label: 'base', dataType: 'shape' },
    ],
    outputs: [{ id: 'shape', label: 'shape', dataType: 'shape' }],
    params: [
      { key: 'diameter', label: 'Bohr-Ø', kind: 'number', default: 5, min: 0.1, step: 0.5, unit: 'mm' },
      { key: 'depth', label: 'Tiefe', kind: 'number', default: 15, min: 0.1, step: 1, unit: 'mm' },
      { key: 'through', label: 'Durchgang', kind: 'boolean', default: false },
      { key: 'countX', label: 'Anzahl X', kind: 'number', default: 3, min: 1, step: 1 },
      { key: 'countY', label: 'Anzahl Y', kind: 'number', default: 2, min: 1, step: 1 },
      { key: 'spacingX', label: 'Abstand X', kind: 'number', default: 32, min: 1, step: 1, unit: 'mm' },
      { key: 'spacingY', label: 'Abstand Y', kind: 'number', default: 32, min: 1, step: 1, unit: 'mm' },
      { key: 'originX', label: 'Origin X', kind: 'number', default: 20, step: 1, unit: 'mm' },
      { key: 'originY', label: 'Origin Y', kind: 'number', default: 20, step: 1, unit: 'mm' },
      { key: 'originZ', label: 'Origin Z', kind: 'number', default: 0, step: 1, unit: 'mm' },
      { key: 'axis', label: 'Achse', kind: 'select', default: 'z',
        options: [{ value: 'x', label: 'X' }, { value: 'y', label: 'Y' }, { value: 'z', label: 'Z' }] },
    ],
  },

  // ===== Transform =========================================================
  mirror: {
    type: 'mirror',
    category: 'transform',
    label: 'Mirror (Spiegeln)',
    inputs: [
      { id: 'shape', label: 'shape', dataType: 'shape' },
    ],
    outputs: [{ id: 'shape', label: 'shape', dataType: 'shape' }],
    params: [
      { key: 'plane', label: 'Ebene', kind: 'select', default: 'XZ',
        options: [
          { value: 'XY', label: 'XY (um Z spiegeln)' },
          { value: 'XZ', label: 'XZ (um Y spiegeln)' },
          { value: 'YZ', label: 'YZ (um X spiegeln)' },
        ] },
      { key: 'originX', label: 'Ebene X', kind: 'number', default: 0, step: 1, unit: 'mm' },
      { key: 'originY', label: 'Ebene Y', kind: 'number', default: 0, step: 1, unit: 'mm' },
      { key: 'originZ', label: 'Ebene Z', kind: 'number', default: 0, step: 1, unit: 'mm' },
      { key: 'keepOriginal', label: 'Original behalten (Union)', kind: 'boolean', default: false },
    ],
  },
  linearArray: {
    type: 'linearArray',
    category: 'transform',
    label: 'Linear Array',
    inputs: [
      { id: 'shape', label: 'shape', dataType: 'shape' },
      { id: 'count', label: 'Anzahl', dataType: 'number', default: 3 },
      { id: 'dx', label: 'ΔX', dataType: 'number', default: 0 },
      { id: 'dy', label: 'ΔY', dataType: 'number', default: 0 },
      { id: 'dz', label: 'ΔZ', dataType: 'number', default: 0 },
    ],
    outputs: [{ id: 'shape', label: 'shape', dataType: 'shape' }],
    params: [
      { key: 'count', label: 'Anzahl', kind: 'number', default: 3, min: 1, step: 1 },
      { key: 'dx', label: 'ΔX pro Schritt', kind: 'number', default: 60, step: 1, unit: 'mm' },
      { key: 'dy', label: 'ΔY pro Schritt', kind: 'number', default: 0, step: 1, unit: 'mm' },
      { key: 'dz', label: 'ΔZ pro Schritt', kind: 'number', default: 0, step: 1, unit: 'mm' },
    ],
  },
  translate: {
    type: 'translate',
    category: 'transform',
    label: 'Translate',
    inputs: [
      { id: 'shape', label: 'shape', dataType: 'shape' },
      { id: 'dx', label: 'dx', dataType: 'number', default: 0 },
      { id: 'dy', label: 'dy', dataType: 'number', default: 0 },
      { id: 'dz', label: 'dz', dataType: 'number', default: 0 },
    ],
    outputs: [{ id: 'shape', label: 'shape', dataType: 'shape' }],
    params: [
      { key: 'dx', label: 'ΔX', kind: 'number', default: 0, step: 1, unit: 'mm' },
      { key: 'dy', label: 'ΔY', kind: 'number', default: 0, step: 1, unit: 'mm' },
      { key: 'dz', label: 'ΔZ', kind: 'number', default: 0, step: 1, unit: 'mm' },
    ],
  },
  rotate: {
    type: 'rotate',
    category: 'transform',
    label: 'Rotate',
    inputs: [
      { id: 'shape', label: 'shape', dataType: 'shape' },
      { id: 'angle', label: 'angle', dataType: 'number', default: 0 },
    ],
    outputs: [{ id: 'shape', label: 'shape', dataType: 'shape' }],
    params: [
      { key: 'axis', label: 'Achse', kind: 'select', default: 'z',
        options: [{ value: 'x', label: 'X' }, { value: 'y', label: 'Y' }, { value: 'z', label: 'Z' }] },
      { key: 'angle', label: 'Winkel', kind: 'number', default: 0, step: 1, unit: 'deg' },
      { key: 'px', label: 'Pivot X', kind: 'number', default: 0, step: 1, unit: 'mm' },
      { key: 'py', label: 'Pivot Y', kind: 'number', default: 0, step: 1, unit: 'mm' },
      { key: 'pz', label: 'Pivot Z', kind: 'number', default: 0, step: 1, unit: 'mm' },
    ],
  },
  scale: {
    type: 'scale',
    category: 'transform',
    label: 'Scale',
    inputs: [
      { id: 'shape', label: 'shape', dataType: 'shape' },
      { id: 'factor', label: 'factor', dataType: 'number', default: 1 },
    ],
    outputs: [{ id: 'shape', label: 'shape', dataType: 'shape' }],
    params: [
      { key: 'factor', label: 'Faktor', kind: 'number', default: 1, min: 0.01, step: 0.1 },
      { key: 'px', label: 'Pivot X', kind: 'number', default: 0, step: 1, unit: 'mm' },
      { key: 'py', label: 'Pivot Y', kind: 'number', default: 0, step: 1, unit: 'mm' },
      { key: 'pz', label: 'Pivot Z', kind: 'number', default: 0, step: 1, unit: 'mm' },
    ],
  },

  // ===== IO ================================================================
  preview: {
    type: 'preview',
    category: 'io',
    label: 'Preview',
    inputs: [{ id: 'shape', label: 'shape', dataType: 'shape' }],
    outputs: [],
    params: [
      { key: 'color', label: 'Farbe', kind: 'color', default: '#b8c4d0' },
      { key: 'quality', label: 'Qualität', kind: 'select', default: 'normal',
        options: [
          { value: 'draft', label: 'Entwurf (schnell)' },
          { value: 'normal', label: 'Normal' },
          { value: 'high', label: 'Hoch (langsam)' },
        ] },
    ],
  },

  // ===== Render ============================================================
  material: {
    type: 'material',
    category: 'render',
    label: 'Material',
    inputs: [{ id: 'shape', label: 'shape', dataType: 'shape' }],
    outputs: [{ id: 'shape', label: 'shape', dataType: 'shape' }],
    params: [
      { key: 'preset', label: 'Material', kind: 'select', default: 'wood-oak',
        options: [
          { value: 'custom', label: '— Custom —' },
          { value: 'wood-oak', label: 'Eiche' },
          { value: 'wood-walnut', label: 'Nussbaum' },
          { value: 'wood-birch', label: 'Birke' },
          { value: 'steel', label: 'Stahl' },
          { value: 'aluminum', label: 'Aluminium' },
          { value: 'brass', label: 'Messing' },
          { value: 'plastic-white', label: 'Kunststoff weiß' },
          { value: 'plastic-black', label: 'Kunststoff schwarz' },
          { value: 'glass', label: 'Glas' },
        ] },
      { key: 'color', label: 'Farbe', kind: 'color', default: '#b8956a' },
      { key: 'overrideColor', label: 'Farbe überschreiben', kind: 'boolean', default: false },
      { key: 'metalness', label: 'Metallisch (0-1)', kind: 'number', default: 0.0, min: 0, max: 1, step: 0.05 },
      { key: 'roughness', label: 'Rauheit (0-1)', kind: 'number', default: 0.7, min: 0, max: 1, step: 0.05 },
      { key: 'opacity',   label: 'Deckkraft (0-1)', kind: 'number', default: 1.0, min: 0, max: 1, step: 0.05 },
    ],
  },
};

export function getNodeSpec(type: string): NodeSpec | undefined {
  return NODE_SPECS[type];
}

export function listNodeTypes(): NodeSpec[] {
  return Object.values(NODE_SPECS);
}

export const CATEGORY_COLORS: Record<NodeSpec['category'], string> = {
  parameter: '#3b7fbf',
  primitive: '#1f8a3a',
  operation: '#8a4ad6',
  feature: '#d68a1f',
  transform: '#5a6470',
  render: '#c2185b',
  io: '#b3261e',
};

export const SOCKET_COLORS: Record<string, string> = {
  number: '#3b7fbf',
  shape: '#1f8a3a',
  vector3: '#d68a1f',
  boolean: '#8a4ad6',
  string: '#5a6470',
};
