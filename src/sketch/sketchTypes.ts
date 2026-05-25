// src/sketch/sketchTypes.ts

export type PointId = string;
export type EntityId = string;
export type ConstraintId = string;

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

export interface SketchPoint {
  id: PointId;
  x: number;
  y: number;
}

/** Line segment from p1 to p2. */
export interface SketchLine {
  id: EntityId;
  type: 'line';
  p1: PointId;
  p2: PointId;
}

/** Arc going counter-clockwise from p1 to p2 around center. */
export interface SketchArc {
  id: EntityId;
  type: 'arc';
  center: PointId;
  p1: PointId; // start
  p2: PointId; // end
}

/** Full circle. Radius = distance(center, rim). */
export interface SketchCircle {
  id: EntityId;
  type: 'circle';
  center: PointId;
  rim: PointId;
}

/**
 * Cubic Bézier segment from p1 to p2.
 * cp1 = out-handle from p1 (= p1 ID for corner node).
 * cp2 = in-handle to p2  (= p2 ID for corner node).
 */
export interface SketchBezier {
  id: EntityId;
  type: 'bezier';
  p1: PointId;
  cp1: PointId;
  cp2: PointId;
  p2: PointId;
}

export type SketchEntity = SketchLine | SketchArc | SketchCircle | SketchBezier;

// ---------------------------------------------------------------------------
// Constraints
// ---------------------------------------------------------------------------

export type SketchConstraint =
  | { id: ConstraintId; type: 'coincident'; p1: PointId; p2: PointId }
  | { id: ConstraintId; type: 'fixed'; point: PointId; x: number; y: number }
  | { id: ConstraintId; type: 'horizontal'; entity: EntityId }
  | { id: ConstraintId; type: 'vertical'; entity: EntityId }
  | { id: ConstraintId; type: 'parallel'; e1: EntityId; e2: EntityId }
  | { id: ConstraintId; type: 'perpendicular'; e1: EntityId; e2: EntityId }
  | { id: ConstraintId; type: 'equal'; e1: EntityId; e2: EntityId }
  | { id: ConstraintId; type: 'tangent'; e1: EntityId; e2: EntityId }
  | { id: ConstraintId; type: 'concentric'; e1: EntityId; e2: EntityId }
  | { id: ConstraintId; type: 'length'; entity: EntityId; value: number }
  | { id: ConstraintId; type: 'angle'; e1: EntityId; e2: EntityId; value: number }
  | { id: ConstraintId; type: 'radius'; entity: EntityId; value: number }
  | { id: ConstraintId; type: 'distance'; p1: PointId; p2: PointId; value: number }
  | { id: ConstraintId; type: 'midpoint'; point: PointId; entity: EntityId }
  | { id: ConstraintId; type: 'symmetric'; p1: PointId; p2: PointId; axis: EntityId };

// ---------------------------------------------------------------------------
// SketchData — the full sketch document
// ---------------------------------------------------------------------------

export interface SketchData {
  points: Record<PointId, SketchPoint>;
  entities: Record<EntityId, SketchEntity>;
  constraints: Record<ConstraintId, SketchConstraint>;
}

export function emptySketch(): SketchData {
  return { points: {}, entities: {}, constraints: {} };
}

// ---------------------------------------------------------------------------
// ID generator
// ---------------------------------------------------------------------------

let _seq = 0;
export function newId(prefix: string): string {
  return `${prefix}${++_seq}_${Math.random().toString(36).slice(2, 6)}`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** All PointIds referenced by an entity (deduplicated). */
export function entityPointIds(e: SketchEntity): PointId[] {
  switch (e.type) {
    case 'line':   return [e.p1, e.p2];
    case 'arc':    return [e.center, e.p1, e.p2];
    case 'circle': return [e.center, e.rim];
    case 'bezier': return [...new Set([e.p1, e.cp1, e.cp2, e.p2])];
  }
}

/** Entities that share a given point. */
export function entitiesAtPoint(
  pid: PointId,
  entities: Record<EntityId, SketchEntity>,
): SketchEntity[] {
  return Object.values(entities).filter((e) => entityPointIds(e).includes(pid));
}

/** Get both line endpoint PointIds (throws if not a line). */
export function linePoints(
  eid: EntityId,
  entities: Record<EntityId, SketchEntity>,
): [PointId, PointId] {
  const e = entities[eid];
  if (!e || e.type !== 'line') throw new Error(`${eid} is not a line`);
  return [e.p1, e.p2];
}

/** Radius of an arc or circle (distance center→rim/p1). */
export function entityRadius(
  e: SketchEntity,
  pts: Record<PointId, SketchPoint>,
): number {
  if (e.type === 'circle') {
    const c = pts[e.center], r = pts[e.rim];
    return Math.hypot(r.x - c.x, r.y - c.y);
  }
  if (e.type === 'arc') {
    const c = pts[e.center], p = pts[e.p1];
    return Math.hypot(p.x - c.x, p.y - c.y);
  }
  throw new Error('entityRadius called on line');
}
