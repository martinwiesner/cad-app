// src/sketch/sketchSolver.ts
//
// Parametric constraint solver for 2D sketches.
//
// Algorithm: Gauss-Newton with Levenberg-Marquardt damping + numerical Jacobian.
// Variables: flattened [x0,y0, x1,y1, ...] for all free (non-fixed) points.
// Each constraint type contributes one or more scalar error equations.
// Iterates until converged (SSE < TOL) or max iterations reached.

import type {
  SketchData,
  SketchConstraint,
  SketchEntity,
  PointId,
  EntityId,
} from './sketchTypes';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface SolveResult {
  sketch: SketchData;
  converged: boolean;
  /** Remaining degrees of freedom (positive = under-constrained). */
  dof: number;
}

const MAX_ITER = 120;
const TOL = 1e-9;
const EPS = 1e-7; // finite-difference step

export function solveSketch(sketch: SketchData): SolveResult {
  const pts = Object.values(sketch.points);
  if (pts.length === 0) return { sketch, converged: true, dof: 0 };

  const constraints = Object.values(sketch.constraints);

  // Collect fixed point IDs from fixed constraints
  const fixedIds = new Set<PointId>();
  for (const c of constraints) {
    if (c.type === 'fixed') fixedIds.add(c.point);
  }

  // Build variable index for free points only
  const freePoints = pts.filter((p) => !fixedIds.has(p.id));
  const n = freePoints.length * 2;
  if (n === 0) return { sketch, converged: true, dof: 0 };

  const varIdx = new Map<PointId, number>();
  freePoints.forEach((p, i) => varIdx.set(p.id, i));

  // Initial params
  const params = new Float64Array(n);
  freePoints.forEach((p, i) => {
    params[2 * i] = p.x;
    params[2 * i + 1] = p.y;
  });

  // Fixed positions come from the CONSTRAINT target, not current point position.
  // This means dragging a fixed point cannot override the constraint.
  const fixedPos = new Map<PointId, { x: number; y: number }>();
  for (const c of constraints) {
    if (c.type === 'fixed') fixedPos.set(c.point, { x: c.x, y: c.y });
  }

  // Count total constraint equations for DOF
  let eqCount = 0;
  for (const c of constraints) {
    eqCount += constraintEqCount(c, sketch);
  }
  const dof = n - eqCount;

  // -------------------------------------------------------------------------
  // LM solver
  // -------------------------------------------------------------------------
  let lambda = 1e-3;

  for (let iter = 0; iter < MAX_ITER; iter++) {
    const F = evalAll(constraints, sketch, params, varIdx, fixedPos);
    const sse = dotSelf(F);
    if (sse < TOL) break;

    const m = F.length;
    if (m === 0) break;

    // Numerical Jacobian J[m×n]
    const J: Float64Array[] = Array.from({ length: m }, () => new Float64Array(n));
    for (let j = 0; j < n; j++) {
      params[j] += EPS;
      const Fplus = evalAll(constraints, sketch, params, varIdx, fixedPos);
      params[j] -= EPS;
      for (let i = 0; i < m; i++) {
        J[i][j] = (Fplus[i] - F[i]) / EPS;
      }
    }

    // JTJ + λI and JTF
    const JTJ = buildJTJ(J, m, n, lambda);
    const JTF = buildJTF(J, F, m, n);

    const delta = solveLinear(JTJ, JTF, n);
    if (!delta) { lambda *= 4; continue; }

    // Tentative step
    const trial = new Float64Array(n);
    for (let i = 0; i < n; i++) trial[i] = params[i] - delta[i];
    const Ftrial = evalAll(constraints, sketch, trial, varIdx, fixedPos);
    const sseTrial = dotSelf(Ftrial);

    if (sseTrial < sse) {
      params.set(trial);
      lambda = Math.max(lambda * 0.5, 1e-10);
    } else {
      lambda = Math.min(lambda * 4, 1e8);
    }
  }

  const Ffinal = evalAll(constraints, sketch, params, varIdx, fixedPos);
  const converged = dotSelf(Ffinal) < 1e-6;

  // Write solved positions back
  const newPoints = { ...sketch.points };
  // Restore fixed points to their constraint target (undo any drag displacement)
  for (const c of constraints) {
    if (c.type === 'fixed') {
      const p = sketch.points[c.point];
      if (p) newPoints[c.point] = { ...p, x: c.x, y: c.y };
    }
  }
  freePoints.forEach((p, i) => {
    newPoints[p.id] = { ...p, x: params[2 * i], y: params[2 * i + 1] };
  });

  return {
    sketch: { ...sketch, points: newPoints },
    converged,
    dof,
  };
}

// ---------------------------------------------------------------------------
// Constraint equation count
// ---------------------------------------------------------------------------

function constraintEqCount(c: SketchConstraint, _sketch: SketchData): number {
  switch (c.type) {
    case 'coincident': return 2;
    case 'fixed':      return 2;
    case 'horizontal': return 1;
    case 'vertical':   return 1;
    case 'parallel':   return 1;
    case 'perpendicular': return 1;
    case 'equal':      return 1;
    case 'tangent':    return 1;
    case 'concentric': return 2;
    case 'length':     return 1;
    case 'angle':      return 1;
    case 'radius':     return 1;
    case 'distance':   return 1;
    case 'midpoint':   return 2;
    case 'symmetric':  return 3;
  }
}

// ---------------------------------------------------------------------------
// Evaluate all constraints → flat error vector
// ---------------------------------------------------------------------------

function evalAll(
  constraints: SketchConstraint[],
  sketch: SketchData,
  params: Float64Array,
  varIdx: Map<PointId, number>,
  fixedPos: Map<PointId, { x: number; y: number }>,
): Float64Array {
  const errs: number[] = [];
  const getP = (id: PointId) => getPoint(id, params, varIdx, fixedPos);

  for (const c of constraints) {
    evalConstraint(c, sketch, getP, errs);
  }
  return new Float64Array(errs);
}

function getPoint(
  id: PointId,
  params: Float64Array,
  varIdx: Map<PointId, number>,
  fixedPos: Map<PointId, { x: number; y: number }>,
): { x: number; y: number } {
  const fixed = fixedPos.get(id);
  if (fixed) return fixed;
  const idx = varIdx.get(id);
  if (idx === undefined) return { x: 0, y: 0 };
  return { x: params[2 * idx], y: params[2 * idx + 1] };
}

function evalConstraint(
  c: SketchConstraint,
  sketch: SketchData,
  gp: (id: PointId) => { x: number; y: number },
  out: number[],
): void {
  const entities = sketch.entities;

  switch (c.type) {
    case 'coincident': {
      const p1 = gp(c.p1), p2 = gp(c.p2);
      out.push(p1.x - p2.x, p1.y - p2.y);
      break;
    }

    case 'fixed': {
      const p = gp(c.point);
      out.push(p.x - c.x, p.y - c.y);
      break;
    }

    case 'horizontal': {
      const e = entities[c.entity];
      if (!e || e.type !== 'line') break;
      const p1 = gp(e.p1), p2 = gp(e.p2);
      out.push(p1.y - p2.y);
      break;
    }

    case 'vertical': {
      const e = entities[c.entity];
      if (!e || e.type !== 'line') break;
      const p1 = gp(e.p1), p2 = gp(e.p2);
      out.push(p1.x - p2.x);
      break;
    }

    case 'parallel': {
      const e1 = lineDir(c.e1, entities, gp);
      const e2 = lineDir(c.e2, entities, gp);
      if (!e1 || !e2) break;
      // cross product of directions = 0
      out.push(e1.dx * e2.dy - e1.dy * e2.dx);
      break;
    }

    case 'perpendicular': {
      const e1 = lineDir(c.e1, entities, gp);
      const e2 = lineDir(c.e2, entities, gp);
      if (!e1 || !e2) break;
      // dot product = 0
      out.push(e1.dx * e2.dx + e1.dy * e2.dy);
      break;
    }

    case 'equal': {
      const s1 = entitySize(c.e1, entities, gp);
      const s2 = entitySize(c.e2, entities, gp);
      if (s1 === null || s2 === null) break;
      out.push(s1 - s2);
      break;
    }

    case 'tangent': {
      const e1 = entities[c.e1], e2 = entities[c.e2];
      if (!e1 || !e2) break;

      // Endpoint tangency (G1 continuity): two entities sharing an anchor
      const shared = findSharedEndpoint(e1, e2, Object.values(sketch.constraints));
      if (shared !== null) {
        const t1 = entityTangentAt(e1, shared, gp);
        const t2 = entityTangentAt(e2, shared, gp);
        if (t1 && t2) out.push(t1.dx * t2.dy - t1.dy * t2.dx);
        break;
      }

      // Geometric tangency: line tangent to circle / circle–circle
      if (e1.type === 'line' && (e2.type === 'arc' || e2.type === 'circle')) {
        out.push(lineTangentCircle(e1, e2, entities, gp));
      } else if (e2.type === 'line' && (e1.type === 'arc' || e1.type === 'circle')) {
        out.push(lineTangentCircle(e2, e1, entities, gp));
      } else if (
        (e1.type === 'arc' || e1.type === 'circle') &&
        (e2.type === 'arc' || e2.type === 'circle')
      ) {
        const c1 = gp(e1.center), r1 = circleRadius(e1, entities, gp);
        const c2 = gp(e2.center), r2 = circleRadius(e2, entities, gp);
        const dist2 = sq(c1.x - c2.x) + sq(c1.y - c2.y);
        const sumR = r1 + r2;
        out.push(dist2 - sumR * sumR);
      }
      break;
    }

    case 'concentric': {
      const e1 = entities[c.e1], e2 = entities[c.e2];
      if (!e1 || !e2) break;
      if (!('center' in e1) || !('center' in e2)) break;
      const c1 = gp((e1 as { center: PointId }).center);
      const c2 = gp((e2 as { center: PointId }).center);
      out.push(c1.x - c2.x, c1.y - c2.y);
      break;
    }

    case 'length': {
      const e = entities[c.entity];
      if (!e || e.type !== 'line') break;
      const p1 = gp(e.p1), p2 = gp(e.p2);
      const len2 = sq(p2.x - p1.x) + sq(p2.y - p1.y);
      out.push(len2 - sq(c.value));
      break;
    }

    case 'angle': {
      const d1 = lineDir(c.e1, entities, gp);
      const d2 = lineDir(c.e2, entities, gp);
      if (!d1 || !d2) break;
      const theta = (c.value * Math.PI) / 180;
      // cross(d1,d2) * cos(theta) - dot(d1,d2) * sin(theta) = 0
      // equals |d1||d2| * sin(angle - theta) = 0
      const cross = d1.dx * d2.dy - d1.dy * d2.dx;
      const dot   = d1.dx * d2.dx + d1.dy * d2.dy;
      out.push(cross * Math.cos(theta) - dot * Math.sin(theta));
      break;
    }

    case 'radius': {
      const e = entities[c.entity];
      if (!e || e.type === 'line') break;
      const r = circleRadius(e, entities, gp);
      out.push(r * r - sq(c.value));
      break;
    }

    case 'distance': {
      const p1 = gp(c.p1), p2 = gp(c.p2);
      const dist2 = sq(p2.x - p1.x) + sq(p2.y - p1.y);
      out.push(dist2 - sq(c.value));
      break;
    }

    case 'midpoint': {
      const e = entities[c.entity];
      if (!e || e.type !== 'line') break;
      const p  = gp(c.point);
      const p1 = gp(e.p1), p2 = gp(e.p2);
      out.push(p.x - (p1.x + p2.x) * 0.5);
      out.push(p.y - (p1.y + p2.y) * 0.5);
      break;
    }

    case 'symmetric': {
      const axis = lineDir(c.axis, entities, gp);
      if (!axis) break;
      const p1 = gp(c.p1), p2 = gp(c.p2);
      const ax = entities[c.axis];
      if (!ax || ax.type !== 'line') break;
      const a = gp(ax.p1);
      // Midpoint of p1,p2 lies on the axis line
      const mx = (p1.x + p2.x) * 0.5, my = (p1.y + p2.y) * 0.5;
      const cross = (mx - a.x) * axis.dy - (my - a.y) * axis.dx;
      // p1-p2 perpendicular to axis
      const dot = (p2.x - p1.x) * axis.dx + (p2.y - p1.y) * axis.dy;
      // Equal distance from axis
      const d1 = distToLine(p1, a, axis);
      const d2 = distToLine(p2, a, axis);
      out.push(cross, dot, d1 - d2);
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sq(x: number) { return x * x; }

function dotSelf(v: Float64Array): number {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  return s;
}

function lineDir(
  eid: EntityId,
  entities: Record<EntityId, SketchEntity>,
  gp: (id: PointId) => { x: number; y: number },
): { dx: number; dy: number } | null {
  const e = entities[eid];
  if (!e || e.type !== 'line') return null;
  const p1 = gp(e.p1), p2 = gp(e.p2);
  return { dx: p2.x - p1.x, dy: p2.y - p1.y };
}

function circleRadius(
  e: SketchEntity,
  _entities: Record<EntityId, SketchEntity>,
  gp: (id: PointId) => { x: number; y: number },
): number {
  if (e.type === 'circle') {
    const c = gp(e.center), r = gp(e.rim);
    return Math.hypot(r.x - c.x, r.y - c.y);
  }
  if (e.type === 'arc') {
    const c = gp(e.center), p = gp(e.p1);
    return Math.hypot(p.x - c.x, p.y - c.y);
  }
  return 0;
}

/** Squared size: length² for lines, radius² for circles/arcs. */
function entitySize(
  eid: EntityId,
  entities: Record<EntityId, SketchEntity>,
  gp: (id: PointId) => { x: number; y: number },
): number | null {
  const e = entities[eid];
  if (!e) return null;
  if (e.type === 'line') {
    const p1 = gp(e.p1), p2 = gp(e.p2);
    return Math.hypot(p2.x - p1.x, p2.y - p1.y);
  }
  return circleRadius(e, entities, gp);
}

// ---------------------------------------------------------------------------
// Endpoint tangency helpers (G1 continuity)
// ---------------------------------------------------------------------------

function entityEndpoints(e: SketchEntity): PointId[] {
  switch (e.type) {
    case 'line':   return [e.p1, e.p2];
    case 'arc':    return [e.p1, e.p2];
    case 'bezier': return [e.p1, e.p2];
    case 'circle': return [];
  }
}

function findSharedEndpoint(
  e1: SketchEntity,
  e2: SketchEntity,
  constraints: SketchConstraint[],
): PointId | null {
  const eps1 = entityEndpoints(e1);
  const eps2 = entityEndpoints(e2);
  for (const p of eps1) if (eps2.includes(p)) return p;
  for (const c of constraints) {
    if (c.type !== 'coincident') continue;
    for (const pa of eps1) for (const pb of eps2) {
      if ((c.p1 === pa && c.p2 === pb) || (c.p1 === pb && c.p2 === pa)) return pa;
    }
  }
  return null;
}

/** Tangent direction pointing *away* from pid along the entity. */
function entityTangentAt(
  e: SketchEntity,
  pid: PointId,
  gp: (id: PointId) => { x: number; y: number },
): { dx: number; dy: number } | null {
  if (e.type === 'line') {
    const p1 = gp(e.p1), p2 = gp(e.p2);
    if (pid === e.p1) return { dx: p2.x - p1.x, dy: p2.y - p1.y };
    if (pid === e.p2) return { dx: p1.x - p2.x, dy: p1.y - p2.y };
  }
  if (e.type === 'arc') {
    const c = gp(e.center), p = gp(pid);
    const rx = p.x - c.x, ry = p.y - c.y;
    if (pid === e.p1) return { dx: -ry, dy: rx };   // CCW tangent leaving p1
    if (pid === e.p2) return { dx: ry, dy: -rx };    // leaving p2 (away from arc)
  }
  if (e.type === 'bezier') {
    const p1 = gp(e.p1), cp1 = gp(e.cp1), cp2 = gp(e.cp2), p2 = gp(e.p2);
    if (pid === e.p1) {
      const dx = cp1.x - p1.x, dy = cp1.y - p1.y;
      return Math.hypot(dx, dy) > 1e-8 ? { dx, dy } : { dx: p2.x - p1.x, dy: p2.y - p1.y };
    }
    if (pid === e.p2) {
      const dx = p2.x - cp2.x, dy = p2.y - cp2.y;
      return Math.hypot(dx, dy) > 1e-8 ? { dx, dy } : { dx: p2.x - p1.x, dy: p2.y - p1.y };
    }
  }
  return null;
}

/** Error for "line tangent to circle": dist(center, line)² - radius² = 0. */
function lineTangentCircle(
  line: SketchEntity & { type: 'line' },
  circle: SketchEntity & ({ type: 'arc' } | { type: 'circle' }),
  entities: Record<EntityId, SketchEntity>,
  gp: (id: PointId) => { x: number; y: number },
): number {
  const a = gp(line.p1), b = gp(line.p2);
  const c = gp(circle.center);
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-20) return 0;
  // cross = (b-a) × (c-a)
  const cross = dx * (c.y - a.y) - dy * (c.x - a.x);
  const dist2 = (cross * cross) / len2;
  const r = circleRadius(circle, entities, gp);
  return dist2 - r * r;
}

function distToLine(
  p: { x: number; y: number },
  a: { x: number; y: number },
  dir: { dx: number; dy: number },
): number {
  const len = Math.hypot(dir.dx, dir.dy);
  if (len < 1e-10) return 0;
  return ((p.x - a.x) * dir.dy - (p.y - a.y) * dir.dx) / len;
}

// ---------------------------------------------------------------------------
// Linear algebra helpers
// ---------------------------------------------------------------------------

function buildJTJ(J: Float64Array[], m: number, n: number, lambda: number): Float64Array[] {
  const JTJ: Float64Array[] = Array.from({ length: n }, () => new Float64Array(n));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      let s = 0;
      for (let k = 0; k < m; k++) s += J[k][i] * J[k][j];
      JTJ[i][j] = s;
    }
    JTJ[i][i] += lambda;
  }
  return JTJ;
}

function buildJTF(J: Float64Array[], F: Float64Array, m: number, n: number): Float64Array {
  const JTF = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = 0; k < m; k++) s += J[k][i] * F[k];
    JTF[i] = s;
  }
  return JTF;
}

/** Gaussian elimination with partial pivoting. Returns null if singular. */
function solveLinear(A: Float64Array[], b: Float64Array, n: number): Float64Array | null {
  // Build augmented matrix
  const M: Float64Array[] = Array.from({ length: n }, (_, i) => {
    const row = new Float64Array(n + 1);
    row.set(A[i]);
    row[n] = b[i];
    return row;
  });

  for (let col = 0; col < n; col++) {
    // Partial pivot
    let maxRow = col, maxVal = Math.abs(M[col][col]);
    for (let row = col + 1; row < n; row++) {
      const v = Math.abs(M[row][col]);
      if (v > maxVal) { maxVal = v; maxRow = row; }
    }
    if (maxRow !== col) { const tmp = M[col]; M[col] = M[maxRow]; M[maxRow] = tmp; }
    if (Math.abs(M[col][col]) < 1e-12) continue; // near-singular column

    for (let row = col + 1; row < n; row++) {
      const factor = M[row][col] / M[col][col];
      if (Math.abs(factor) < 1e-15) continue;
      for (let j = col; j <= n; j++) M[row][j] -= factor * M[col][j];
    }
  }

  // Back substitution
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    if (Math.abs(M[i][i]) < 1e-12) continue;
    let s = M[i][n];
    for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j];
    x[i] = s / M[i][i];
  }
  return x;
}
