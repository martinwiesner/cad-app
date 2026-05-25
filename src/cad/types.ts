// src/cad/types.ts
// Geteilte Typen zwischen Main + Worker.

export type ShapeHandle = string & { readonly __brand: 'ShapeHandle' };

export interface BoxParams {
  width: number; depth: number; height: number;
  x?: number; y?: number; z?: number;
}

export interface CylinderParams {
  radius: number; height: number;
  x?: number; y?: number; z?: number;
  axis?: 'x' | 'y' | 'z';
}

export interface SphereParams {
  radius: number;
  x?: number; y?: number; z?: number;
}

export interface ConeParams {
  radius1: number;
  radius2: number;
  height: number;
  x?: number; y?: number; z?: number;
  axis?: 'x' | 'y' | 'z';
}

export interface ExtrudePolygonParams {
  /** Flaches Array von 2D-Koordinaten: [x0,y0, x1,y1, ...] */
  points: number[];
  height: number;
  baseZ?: number;
  direction?: 'x' | 'y' | 'z';
}

export interface HolePatternParams {
  diameter: number;
  depth: number;
  through?: boolean;
  countX: number;
  countY: number;
  spacingX: number;
  spacingY: number;
  originX: number;
  originY: number;
  originZ: number;
  axis?: 'x' | 'y' | 'z';
}

export interface MeshOptions {
  linearDeflection?: number;
  angularDeflection?: number;
}

export interface FaceGroup { faceId: number; start: number; count: number; }

export interface MeshArrays {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  faceGroups: FaceGroup[];
}

/** Eine Kante als Polylinie im 3D-Raum, mit stabilem geometrischem Hash. */
export interface EdgeData {
  /** Stabile geometrische Edge-ID (sha-1 der gerundeten Endpunkte + Mittelpunkt). */
  edgeId: string;
  /** Lokaler Index (0..n-1) im aktuellen Shape - NICHT stabil ueber Recomputes. */
  localIndex: number;
  /** Polylinien-Punkte: x,y,z,x,y,z,... */
  positions: Float32Array;
  /** Approximierte Laenge in mm. */
  length: number;
  /** Geometrie-Typ falls erkennbar: 'line' | 'circle' | 'curve' | 'unknown' */
  curveType?: 'line' | 'circle' | 'curve' | 'unknown';
}

export interface EdgesPayload {
  edges: EdgeData[];
}

export interface ShapeMeta {
  handle: ShapeHandle;
  bbox: { min: [number, number, number]; max: [number, number, number] };
  facesCount: number;
  edgesCount: number;
}

export type CadErrorCode =
  | 'kernel_not_ready'
  | 'invalid_input'
  | 'boolean_failed'
  | 'fillet_too_large'
  | 'chamfer_failed'
  | 'step_parse_failed'
  | 'empty_shape'
  | 'triangulation_failed'
  | 'unknown_shape_handle'
  | 'unknown';

export interface CadErrorPayload {
  code: CadErrorCode;
  message: string;
  details?: string;
}

export class CadError extends Error {
  code: CadErrorCode;
  details?: string;
  constructor(payload: CadErrorPayload) {
    super(payload.message);
    this.name = 'CadError';
    this.code = payload.code;
    this.details = payload.details;
  }
  toJSON(): CadErrorPayload {
    return { code: this.code, message: this.message, details: this.details };
  }
}

export interface HoleParams {
  radius: number;
  depth: number;
  x: number; y: number; z: number;
  axis?: 'x' | 'y' | 'z';
  through?: boolean;
}

export interface TranslateParams {
  dx: number; dy: number; dz: number;
}

export interface RotateParams {
  axis: 'x' | 'y' | 'z';
  angleDeg: number;
  px?: number; py?: number; pz?: number;
}

export interface ScaleParams {
  factor: number;
  px?: number; py?: number; pz?: number;
}

export interface MirrorParams {
  /** Spiegelebene */
  plane: 'XY' | 'XZ' | 'YZ';
  /** Ursprung der Spiegelebene (Default: 0,0,0) */
  originX?: number; originY?: number; originZ?: number;
  /** Original + Spiegel vereinigen */
  keepOriginal?: boolean;
}

export interface LinearArrayParams {
  /** Anzahl der Kopien inkl. Original */
  count: number;
  /** Versatz pro Schritt */
  dx: number; dy: number; dz: number;
}

export interface SketchExtrudeParams {
  /** Serialized SketchData JSON string */
  sketchJson: string;
  height: number;
  baseZ?: number;
  direction?: 'x' | 'y' | 'z';
}

export interface ICadKernel {
  init(): Promise<void>;
  isReady(): Promise<boolean>;

  createBox(p: BoxParams): Promise<ShapeHandle>;
  createCylinder(p: CylinderParams): Promise<ShapeHandle>;
  createSphere(p: SphereParams): Promise<ShapeHandle>;
  createCone(p: ConeParams): Promise<ShapeHandle>;
  extrudePolygon(p: ExtrudePolygonParams): Promise<ShapeHandle>;
  holePattern(base: ShapeHandle, p: HolePatternParams): Promise<ShapeHandle>;

  booleanDifference(base: ShapeHandle, tool: ShapeHandle): Promise<ShapeHandle>;
  booleanUnion(a: ShapeHandle, b: ShapeHandle): Promise<ShapeHandle>;
  booleanIntersection(a: ShapeHandle, b: ShapeHandle): Promise<ShapeHandle>;

  filletAll(shape: ShapeHandle, radius: number): Promise<ShapeHandle>;
  chamferAll(shape: ShapeHandle, distance: number): Promise<ShapeHandle>;
  hole(base: ShapeHandle, p: HoleParams): Promise<ShapeHandle>;

  translate(shape: ShapeHandle, p: TranslateParams): Promise<ShapeHandle>;
  rotate(shape: ShapeHandle, p: RotateParams): Promise<ShapeHandle>;
  scale(shape: ShapeHandle, p: ScaleParams): Promise<ShapeHandle>;
  mirror(shape: ShapeHandle, p: MirrorParams): Promise<ShapeHandle>;
  linearArray(shape: ShapeHandle, p: LinearArrayParams): Promise<ShapeHandle>;
  sketchExtrude(p: SketchExtrudeParams): Promise<ShapeHandle>;

  // Selective Features - nur bestimmte Kanten
  filletEdges(shape: ShapeHandle, edgeIds: string[], radius: number): Promise<ShapeHandle>;
  chamferEdges(shape: ShapeHandle, edgeIds: string[], distance: number): Promise<ShapeHandle>;

  importStep(bytes: Uint8Array): Promise<ShapeHandle>;
  exportStl(shape: ShapeHandle, opt?: MeshOptions): Promise<Uint8Array>;
  exportGlb(shape: ShapeHandle, opt?: MeshOptions): Promise<Uint8Array>;
  exportStep(shape: ShapeHandle): Promise<Uint8Array>;

  triangulate(handle: ShapeHandle, opt?: MeshOptions): Promise<MeshArrays>;
  /** Kantengeometrie + stabile Edge-IDs des Shapes. */
  extractEdges(handle: ShapeHandle): Promise<EdgesPayload>;
  getMeta(handle: ShapeHandle): Promise<ShapeMeta>;

  releaseShape(handle: ShapeHandle): Promise<void>;
  releaseAll(): Promise<void>;

  inspectApi(prefixes: string[]): Promise<Record<string, string[]>>;
}
