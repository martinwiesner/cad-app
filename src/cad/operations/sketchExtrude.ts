// src/cad/operations/sketchExtrude.ts
//
// Converts a SketchData document into an OCCT solid by:
//   1. Finding closed loops in the sketch graph
//   2. Building OCCT edges (lines + arcs)
//   3. Assembling them into a BRep wire
//   4. Creating a planar face
//   5. Extruding with BRepPrimAPI_MakePrism

import { CadError } from '../types';
import type { SketchData, SketchPoint, SketchEntity, SketchBezier } from '../../sketch/sketchTypes';
import { entityPointIds } from '../../sketch/sketchTypes';

export interface SketchExtrudeParams {
  sketch: SketchData;
  height: number;
  baseZ?: number;
  direction?: 'x' | 'y' | 'z';
}

// ---------------------------------------------------------------------------
// Loop extraction
// ---------------------------------------------------------------------------

interface Loop {
  /** Entity IDs in order around the loop */
  entityIds: string[];
  /** For each entity: canonical PointId of the "from" end for traversal direction */
  fromPids: string[];
}

/** Union-Find: merge coincident point pairs into canonical IDs. */
function buildCanonicalIds(sketch: SketchData): Map<string, string> {
  const parent = new Map<string, string>();

  const find = (id: string): string => {
    if (!parent.has(id)) parent.set(id, id);
    const p = parent.get(id)!;
    if (p !== id) { const root = find(p); parent.set(id, root); return root; }
    return id;
  };
  const union = (a: string, b: string) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  for (const c of Object.values(sketch.constraints)) {
    if (c.type === 'coincident') union(c.p1, c.p2);
  }

  const canon = new Map<string, string>();
  for (const pid of Object.keys(sketch.points)) {
    canon.set(pid, find(pid));
  }
  return canon;
}

function buildAdjacency(
  entities: Record<string, SketchEntity>,
  canon: Map<string, string>,
): Map<string, Array<{ eid: string; other: string }>> {
  const cp = (id: string) => canon.get(id) ?? id;
  const adj = new Map<string, Array<{ eid: string; other: string }>>();
  for (const e of Object.values(entities)) {
    const pids = entityPointIds(e);
    if (e.type === 'line' || e.type === 'arc' || e.type === 'bezier') {
      add(adj, cp(e.p1), { eid: e.id, other: cp(e.p2) });
      add(adj, cp(e.p2), { eid: e.id, other: cp(e.p1) });
    }
    // Circles are handled as standalone full-circle loops
    void pids;
  }
  return adj;
}

function add<K, V>(m: Map<K, V[]>, k: K, v: V) {
  if (!m.has(k)) m.set(k, []);
  m.get(k)!.push(v);
}

function extractLoops(sketch: SketchData, canon: Map<string, string>): Loop[] {
  const loops: Loop[] = [];
  const visited = new Set<string>(); // visited entity IDs

  // Standalone circles → trivial loop
  for (const e of Object.values(sketch.entities)) {
    if (e.type === 'circle') {
      visited.add(e.id);
      loops.push({ entityIds: [e.id], fromPids: [e.center] });
    }
  }

  const adj = buildAdjacency(sketch.entities, canon);

  // Deduplicate to canonical IDs so each logical point is only a start once
  const canonicalPids = new Set<string>(Object.keys(sketch.points).map(pid => canon.get(pid) ?? pid));

  for (const startPid of canonicalPids) {
    const neighbors = adj.get(startPid);
    if (!neighbors) continue;

    for (const { eid: startEid, other: nextPid } of neighbors) {
      if (visited.has(startEid)) continue;

      // Walk the chain; fromPids stores canonical IDs (used for edge direction in buildWire)
      const entityIds: string[] = [startEid];
      const fromPids: string[] = [startPid];
      visited.add(startEid);

      let cur = nextPid;
      let closed = cur === startPid;

      while (!closed) {
        const ns = adj.get(cur) ?? [];
        const next = ns.find((n) => !visited.has(n.eid));
        if (!next) break; // open chain — can't close
        visited.add(next.eid);
        entityIds.push(next.eid);
        fromPids.push(cur);
        cur = next.other;
        if (cur === startPid) { closed = true; break; }
      }

      if (closed) loops.push({ entityIds, fromPids });
    }
  }

  return loops;
}

// ---------------------------------------------------------------------------
// OCCT edge builders
// ---------------------------------------------------------------------------

function pnt(oc: any, x: number, y: number, z: number): any {
  return new oc.gp_Pnt_3(x, y, z);
}

function makeLine(oc: any, p1: SketchPoint, p2: SketchPoint, z: number, trash: any[]): any {
  const a = pnt(oc, p1.x, p1.y, z);
  const b = pnt(oc, p2.x, p2.y, z);
  trash.push(a, b);

  for (const sfx of ['_3', '_2', '']) {
    const name = `BRepBuilderAPI_MakeEdge${sfx}`;
    if (typeof oc[name] !== 'function') continue;
    try {
      const maker = new oc[name](a, b);
      trash.push(maker);
      if (typeof maker.IsDone === 'function' && !maker.IsDone()) continue;
      return maker.Edge();
    } catch { /* */ }
  }
  throw new CadError({ code: 'invalid_input', message: 'sketchExtrude: BRepBuilderAPI_MakeEdge (line) not found' });
}

function makeArc(
  oc: any,
  centerPt: SketchPoint, p1Pt: SketchPoint, p2Pt: SketchPoint,
  fromPid: string,
  entity: SketchEntity & { type: 'arc' },
  z: number, trash: any[],
): any {
  // Determine direction: arc goes CCW from p1 to p2 around center.
  // "from" side tells us which is the start for this traversal direction.
  const forward = entity.p1 === fromPid;
  const startPt  = forward ? p1Pt : p2Pt;
  const endPt    = forward ? p2Pt : p1Pt;

  const r = Math.hypot(p1Pt.x - centerPt.x, p1Pt.y - centerPt.y);
  if (r < 1e-6) throw new CadError({ code: 'invalid_input', message: 'sketchExtrude: arc radius too small' });

  const a1 = Math.atan2(startPt.y - centerPt.y, startPt.x - centerPt.x);
  const a2 = Math.atan2(endPt.y - centerPt.y, endPt.x - centerPt.x);

  // gp_Ax2 with Z+ as normal → CCW positive
  const center3 = pnt(oc, centerPt.x, centerPt.y, z);
  trash.push(center3);

  let ax2: any;
  for (const sfx of ['_3', '_2', '']) {
    const gp_Ax2 = oc[`gp_Ax2${sfx}`];
    if (typeof gp_Ax2 !== 'function') continue;
    try {
      const dir = new oc.gp_Dir_4(0, 0, 1);
      trash.push(dir);
      ax2 = new gp_Ax2(center3, dir);
      trash.push(ax2);
      break;
    } catch { /* */ }
  }
  if (!ax2) throw new CadError({ code: 'invalid_input', message: 'sketchExtrude: could not create gp_Ax2' });

  // gp_Circ
  let circ: any;
  for (const sfx of ['_2', '_1', '']) {
    const gp_Circ = oc[`gp_Circ${sfx}`];
    if (typeof gp_Circ !== 'function') continue;
    try { circ = new gp_Circ(ax2, r); trash.push(circ); break; } catch { /* */ }
  }
  if (!circ) throw new CadError({ code: 'invalid_input', message: 'sketchExtrude: could not create gp_Circ' });

  // BRepBuilderAPI_MakeEdge with (circle, alpha1, alpha2)
  // alpha2 > alpha1 always for CCW arc (adjust if needed)
  let alpha2 = a2;
  if (forward) {
    // CCW from a1 to a2
    while (alpha2 <= a1) alpha2 += 2 * Math.PI;
  } else {
    // CW original = CCW reversed
    while (alpha2 >= a1) alpha2 -= 2 * Math.PI;
  }

  for (const sfx of ['_7', '_8', '_9', '']) {
    const MakeEdge = oc[`BRepBuilderAPI_MakeEdge${sfx}`];
    if (typeof MakeEdge !== 'function') continue;
    try {
      const maker = new MakeEdge(circ, a1, alpha2);
      trash.push(maker);
      if (typeof maker.IsDone === 'function' && !maker.IsDone()) continue;
      return maker.Edge();
    } catch { /* */ }
  }
  throw new CadError({ code: 'invalid_input', message: 'sketchExtrude: BRepBuilderAPI_MakeEdge (arc) not found' });
}

// Cubic Bézier edge via Geom_BSplineCurve (clamped cubic = exact bezier).
// Falls back to Geom_BezierCurve, then to a polyline approximation.
function makeBezierEdges(
  oc: any,
  p1s: SketchPoint, cp1s: SketchPoint, cp2s: SketchPoint, p2s: SketchPoint,
  z: number, trash: any[],
): any[] {
  const d1 = Math.hypot(cp1s.x - p1s.x, cp1s.y - p1s.y);
  const d2 = Math.hypot(cp2s.x - p2s.x, cp2s.y - p2s.y);
  if (d1 < 1e-6 && d2 < 1e-6) return [makeLine(oc, p1s, p2s, z, trash)];

  const pole1 = pnt(oc, p1s.x,  p1s.y,  z); trash.push(pole1);
  const pole2 = pnt(oc, cp1s.x, cp1s.y, z); trash.push(pole2);
  const pole3 = pnt(oc, cp2s.x, cp2s.y, z); trash.push(pole3);
  const pole4 = pnt(oc, p2s.x,  p2s.y,  z); trash.push(pole4);

  const tryMakeEdgeFromHandle = (handle: any): any | null => {
    for (const sfx of ['_24', '_25', '_26', '_27', '_28', '_29', '_30', '']) {
      const MakeEdge = oc[`BRepBuilderAPI_MakeEdge${sfx}`];
      if (typeof MakeEdge !== 'function') continue;
      try {
        const maker = new MakeEdge(handle);
        trash.push(maker);
        if (typeof maker.IsDone === 'function' && !maker.IsDone()) continue;
        return maker.Edge();
      } catch { /* */ }
    }
    return null;
  };

  // Attempt 1: Geom_BSplineCurve — cubic bezier as clamped B-spline
  // Knot vector [0,0,0,0,1,1,1,1], poles [P0,P1,P2,P3], degree 3
  for (const poleSfx of ['_2', '_1', '']) {
    const TColgp = oc[`TColgp_Array1OfPnt${poleSfx}`];
    if (typeof TColgp !== 'function') continue;
    for (const stdSfx of ['_2', '_1', '']) {
      const TColReal = oc[`TColStd_Array1OfReal${stdSfx}`];
      const TColInt  = oc[`TColStd_Array1OfInteger${stdSfx}`];
      if (typeof TColReal !== 'function' || typeof TColInt !== 'function') continue;
      try {
        const poles = new TColgp(1, 4);
        poles.SetValue(1, pole1); poles.SetValue(2, pole2);
        poles.SetValue(3, pole3); poles.SetValue(4, pole4);
        trash.push(poles);
        const knots = new TColReal(1, 2);
        knots.SetValue(1, 0.0); knots.SetValue(2, 1.0); trash.push(knots);
        const mults = new TColInt(1, 2);
        mults.SetValue(1, 4);   mults.SetValue(2, 4); trash.push(mults);
        const GBS = oc['Geom_BSplineCurve_1'] ?? oc['Geom_BSplineCurve'];
        if (typeof GBS !== 'function') break;
        const bspl = new GBS(poles, knots, mults, 3, false);
        trash.push(bspl);
        let h: any = bspl;
        try { h = new oc.Handle_Geom_Curve_2(bspl); trash.push(h); } catch { /* */ }
        const edge = tryMakeEdgeFromHandle(h);
        if (edge) return [edge];
      } catch { /* */ }
    }
  }

  // Attempt 2: Geom_BezierCurve
  for (const poleSfx of ['_2', '_1', '']) {
    const TColgp = oc[`TColgp_Array1OfPnt${poleSfx}`];
    if (typeof TColgp !== 'function') continue;
    try {
      const poles = new TColgp(1, 4);
      poles.SetValue(1, pole1); poles.SetValue(2, pole2);
      poles.SetValue(3, pole3); poles.SetValue(4, pole4);
      trash.push(poles);
      const GeomBez = oc['Geom_BezierCurve_1'] ?? oc['Geom_BezierCurve'];
      if (typeof GeomBez !== 'function') break;
      const curve = new GeomBez(poles); trash.push(curve);
      let h: any = curve;
      try { h = new oc.Handle_Geom_Curve_2(curve); trash.push(h); } catch { /* */ }
      const edge = tryMakeEdgeFromHandle(h);
      if (edge) return [edge];
    } catch { /* */ }
  }

  // Fallback: polyline (exact endpoints to guarantee wire closure)
  const N = 16;
  const edges: any[] = [];
  let prevP = pole1;
  for (let i = 1; i <= N; i++) {
    const t = i / N, mt = 1 - t;
    const bx = mt*mt*mt*p1s.x + 3*mt*mt*t*cp1s.x + 3*mt*t*t*cp2s.x + t*t*t*p2s.x;
    const by = mt*mt*mt*p1s.y + 3*mt*mt*t*cp1s.y + 3*mt*t*t*cp2s.y + t*t*t*p2s.y;
    const nextP = (i === N) ? pole4 : pnt(oc, bx, by, z);
    if (i !== N) trash.push(nextP);
    for (const sfx of ['_3', '_2', '']) {
      const MakeEdge = oc[`BRepBuilderAPI_MakeEdge${sfx}`];
      if (typeof MakeEdge !== 'function') continue;
      try {
        const m = new MakeEdge(prevP, nextP); trash.push(m);
        if (typeof m.IsDone === 'function' && !m.IsDone()) continue;
        edges.push(m.Edge()); break;
      } catch { /* */ }
    }
    prevP = nextP;
  }
  return edges;
}

// Returns 1 full-circle edge or 2 semicircular arc edges (fallback).
function makeFullCircle(
  oc: any, centerPt: SketchPoint, rimPt: SketchPoint, z: number, trash: any[],
): any[] {
  const r = Math.hypot(rimPt.x - centerPt.x, rimPt.y - centerPt.y);
  if (r < 1e-6) throw new CadError({ code: 'invalid_input', message: 'sketchExtrude: circle radius too small' });

  const center3 = pnt(oc, centerPt.x, centerPt.y, z);
  trash.push(center3);

  let ax2: any;
  for (const sfx of ['_3', '_2', '']) {
    const gp_Ax2 = oc[`gp_Ax2${sfx}`];
    if (typeof gp_Ax2 !== 'function') continue;
    try {
      const dir = new oc.gp_Dir_4(0, 0, 1);
      trash.push(dir);
      ax2 = new gp_Ax2(center3, dir);
      trash.push(ax2);
      break;
    } catch { /* */ }
  }
  if (!ax2) throw new CadError({ code: 'invalid_input', message: 'sketchExtrude: could not create gp_Ax2 (circle)' });

  let circ: any;
  for (const sfx of ['_2', '_1', '']) {
    const gp_Circ = oc[`gp_Circ${sfx}`];
    if (typeof gp_Circ !== 'function') continue;
    try { circ = new gp_Circ(ax2, r); trash.push(circ); break; } catch { /* */ }
  }
  if (!circ) throw new CadError({ code: 'invalid_input', message: 'sketchExtrude: could not create gp_Circ' });

  // Try single full-circle edge (no angle params) — try wide range of suffix numbers
  for (const sfx of ['_5', '_6', '_4', '_8', '_9', '_10', '_11', '_12', '']) {
    const MakeEdge = oc[`BRepBuilderAPI_MakeEdge${sfx}`];
    if (typeof MakeEdge !== 'function') continue;
    try {
      const maker = new MakeEdge(circ);
      trash.push(maker);
      if (typeof maker.IsDone === 'function' && !maker.IsDone()) continue;
      return [maker.Edge()];
    } catch { /* */ }
  }

  // Fallback: two 180° arcs (same overload as normal arcs — known to work)
  const arcEdges: any[] = [];
  for (const [a1, a2] of [[0, Math.PI], [Math.PI, 2 * Math.PI]] as [number, number][]) {
    let added = false;
    for (const sfx of ['_7', '_8', '_9', '_6', '']) {
      const MakeEdge = oc[`BRepBuilderAPI_MakeEdge${sfx}`];
      if (typeof MakeEdge !== 'function') continue;
      try {
        const maker = new MakeEdge(circ, a1, a2);
        trash.push(maker);
        if (typeof maker.IsDone === 'function' && !maker.IsDone()) continue;
        arcEdges.push(maker.Edge());
        added = true;
        break;
      } catch { /* */ }
    }
    if (!added) break;
  }
  if (arcEdges.length === 2) return arcEdges;

  const available = Object.keys(oc).filter((k) => k.startsWith('BRepBuilderAPI_MakeEdge')).join(', ');
  throw new CadError({ code: 'invalid_input', message: `sketchExtrude: BRepBuilderAPI_MakeEdge (circle) not found (verfügbar: ${available || 'keine'})` });
}

// ---------------------------------------------------------------------------
// Wire builder for one loop
// ---------------------------------------------------------------------------

function buildWire(oc: any, loop: Loop, sketch: SketchData, z: number, trash: any[], canon: Map<string, string>): any {
  const { entityIds, fromPids } = loop;
  const entities = sketch.entities;
  const pts = sketch.points;
  const cp = (id: string) => canon.get(id) ?? id;

  let wireMaker: any = null;
  for (const sfx of ['_1', '']) {
    const MakeWire = oc[`BRepBuilderAPI_MakeWire${sfx}`];
    if (typeof MakeWire !== 'function') continue;
    try { wireMaker = new MakeWire(); trash.push(wireMaker); break; } catch { /* */ }
  }
  if (!wireMaker) throw new CadError({ code: 'invalid_input', message: 'sketchExtrude: BRepBuilderAPI_MakeWire not found' });

  for (let i = 0; i < entityIds.length; i++) {
    const eid = entityIds[i];
    const fromPid = fromPids[i]; // canonical ID
    const e = entities[eid];
    if (!e) continue;

    let edges: any[] = [];
    if (e.type === 'line') {
      const fromIsP1 = cp(e.p1) === fromPid;
      const from = fromIsP1 ? pts[e.p1] : pts[e.p2];
      const to   = fromIsP1 ? pts[e.p2] : pts[e.p1];
      if (!from || !to) continue;
      edges = [makeLine(oc, from, to, z, trash)];
    } else if (e.type === 'arc') {
      const c = pts[e.center], p1 = pts[e.p1], p2 = pts[e.p2];
      if (!c || !p1 || !p2) continue;
      // makeArc uses entity.p1 === fromPid for direction; pass canonical p1/p2
      const canonEntity = { ...e, p1: cp(e.p1), p2: cp(e.p2) };
      edges = [makeArc(oc, c, p1, p2, fromPid, canonEntity as typeof e, z, trash)];
    } else if (e.type === 'circle') {
      const c = pts[e.center], rim = pts[e.rim];
      if (!c || !rim) continue;
      edges = makeFullCircle(oc, c, rim, z, trash);
    } else if (e.type === 'bezier') {
      const bz = e as SketchBezier;
      const fromIsP1 = cp(bz.p1) === fromPid;
      const p1s  = pts[fromIsP1 ? bz.p1 : bz.p2];
      const cp1s = pts[fromIsP1 ? bz.cp1 : bz.cp2];
      const cp2s = pts[fromIsP1 ? bz.cp2 : bz.cp1];
      const p2s  = pts[fromIsP1 ? bz.p2 : bz.p1];
      if (!p1s || !cp1s || !cp2s || !p2s) continue;
      edges = makeBezierEdges(oc, p1s, cp1s, cp2s, p2s, z, trash);
    }

    for (const edge of edges) {
      if (!edge) continue;
      trash.push(edge);
      try { wireMaker.Add_1(edge); } catch {
        try { wireMaker.Add(edge); } catch { /* skip bad edge */ }
      }
    }
  }

  let isDone = true;
  try { isDone = typeof wireMaker.IsDone !== 'function' || wireMaker.IsDone(); } catch { /* */ }
  if (!isDone) throw new CadError({ code: 'invalid_input', message: 'sketchExtrude: Wire build failed — sketch not closed?' });

  return wireMaker.Wire();
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function sketchExtrude(oc: any, params: SketchExtrudeParams): any {
  const { sketch, height, baseZ = 0, direction = 'z' } = params;

  if (!(height > 0)) {
    throw new CadError({ code: 'invalid_input', message: `sketchExtrude: height muss > 0 sein (${height})` });
  }

  const entCount = Object.keys(sketch.entities).length;
  if (entCount === 0) {
    throw new CadError({ code: 'invalid_input', message: 'sketchExtrude: Skizze ist leer' });
  }

  const canon = buildCanonicalIds(sketch);
  const loops = extractLoops(sketch, canon);
  if (loops.length === 0) {
    throw new CadError({ code: 'invalid_input', message: 'sketchExtrude: keine geschlossene Kontur gefunden — alle Linien/Bögen zu einem geschlossenen Profil verbinden' });
  }

  const trash: any[] = [];
  try {
    // Build a face for each loop, then union them all into one compound/solid
    let result: any = null;

    for (const loop of loops) {
      const wire = buildWire(oc, loop, sketch, baseZ, trash, canon);
      trash.push(wire);

      // Face from wire — must be a TRUE planar face to avoid BRepMesh_IncrementalMesh failures.
      // Strategy: find the gp_Pln ctor once, reuse across attempts.
      let faceMaker: any = null;

      let planeObj: any = null;
      for (const plnSfx of ['_3', '_2', '_1', '']) {
        const gp_Pln_ctor = oc[`gp_Pln${plnSfx}`];
        if (typeof gp_Pln_ctor !== 'function') continue;
        try {
          const orig = pnt(oc, 0, 0, baseZ); trash.push(orig);
          const dir  = new oc.gp_Dir_4(0, 0, 1); trash.push(dir);
          planeObj = new gp_Pln_ctor(orig, dir); trash.push(planeObj);
          break;
        } catch { /* */ }
      }

      // Attempt A: BRepBuilderAPI_MakeFace(gp_Pln) → Add(wire).
      // Constructor #3 of BRepBuilderAPI_MakeFace creates an infinite planar face;
      // Add(wire) adds the wire as the outer boundary. This guarantees a Geom_Plane
      // surface, which BRepMesh can always triangulate.
      if (!faceMaker && planeObj) {
        for (const faceSfx of ['_3', '_4', '_2', '_1', '']) {
          const MakeFaceFromPln = oc[`BRepBuilderAPI_MakeFace${faceSfx}`];
          if (typeof MakeFaceFromPln !== 'function') continue;
          try {
            const fm = new MakeFaceFromPln(planeObj);
            trash.push(fm);
            for (const addSfx of ['_1', '']) {
              if (typeof fm[`Add${addSfx}`] === 'function') {
                try { fm[`Add${addSfx}`](wire); break; } catch { /* */ }
              }
            }
            let ok = true;
            try { ok = typeof fm.IsDone !== 'function' || fm.IsDone(); } catch { /* */ }
            if (ok) { faceMaker = fm; break; }
          } catch { /* */ }
        }
      }

      // Attempt B: BRepBuilderAPI_MakeFace(gp_Pln, wire, true) — constructor #16 in OCCT.
      // Tries all suffix numbers since the exact index varies by opencascade.js build.
      if (!faceMaker && planeObj) {
        for (const sfx of ['_16', '_15', '_14', '_13', '_12', '_11', '_10', '_9', '_8', '_7', '_6', '_5', '']) {
          const MakeFace = oc[`BRepBuilderAPI_MakeFace${sfx}`];
          if (typeof MakeFace !== 'function') continue;
          try {
            const fm = new MakeFace(planeObj, wire, true);
            trash.push(fm);
            let ok = true;
            try { ok = typeof fm.IsDone !== 'function' || fm.IsDone(); } catch { /* */ }
            if (ok) { faceMaker = fm; break; }
          } catch { /* */ }
        }
      }

      // Attempt C: BRepBuilderAPI_MakeFace(wire, true) — constructor #9, OnlyPlane=true.
      if (!faceMaker) {
        for (const sfx of ['_9', '_15', '_8', '_16', '_7', '_6', '']) {
          const MakeFace = oc[`BRepBuilderAPI_MakeFace${sfx}`];
          if (typeof MakeFace !== 'function') continue;
          try {
            const fm = new MakeFace(wire, true);
            trash.push(fm);
            let ok = true;
            try { ok = typeof fm.IsDone !== 'function' || fm.IsDone(); } catch { /* */ }
            if (ok) { faceMaker = fm; break; }
          } catch { /* */ }
        }
      }

      // Attempt D: BRepBuilderAPI_MakeFace(wire) — last resort, may produce NURBS surface.
      if (!faceMaker) {
        for (const sfx of ['_9', '_15', '_8', '_16', '_7', '_6', '']) {
          const MakeFace = oc[`BRepBuilderAPI_MakeFace${sfx}`];
          if (typeof MakeFace !== 'function') continue;
          try {
            const fm = new MakeFace(wire);
            trash.push(fm);
            let ok = true;
            try { ok = typeof fm.IsDone !== 'function' || fm.IsDone(); } catch { /* */ }
            if (ok) { faceMaker = fm; break; }
          } catch { /* */ }
        }
      }

      if (!faceMaker) throw new CadError({ code: 'invalid_input', message: 'sketchExtrude: MakeFace failed' });

      let faceOk = true;
      try { faceOk = typeof faceMaker.IsDone !== 'function' || faceMaker.IsDone(); } catch { /* */ }
      if (!faceOk) throw new CadError({ code: 'invalid_input', message: 'sketchExtrude: Face IsDone()=false — Kontur überprüfen' });

      const face = faceMaker.Face();
      trash.push(face);

      // Extrusion vector
      let vecX = 0, vecY = 0, vecZ = 0;
      if (direction === 'x') vecX = height;
      else if (direction === 'y') vecY = height;
      else vecZ = height;

      const vec = new oc.gp_Vec_4(vecX, vecY, vecZ);
      trash.push(vec);

      let prism: any = null;
      try { prism = new oc.BRepPrimAPI_MakePrism_1(face, vec, false, true); } catch { /* */ }
      if (!prism) try { prism = new oc.BRepPrimAPI_MakePrism_2(face, vec); } catch { /* */ }
      if (!prism) throw new CadError({ code: 'invalid_input', message: 'sketchExtrude: MakePrism not found' });
      trash.push(prism);

      let prismOk = true;
      try { prismOk = typeof prism.IsDone !== 'function' || prism.IsDone(); } catch { /* */ }
      if (!prismOk) throw new CadError({ code: 'invalid_input', message: 'sketchExtrude: Prism IsDone()=false' });

      const shape = prism.Shape();

      if (!result) {
        result = shape;
      } else {
        // Union multiple loop solids
        trash.push(result, shape);
        let fuseMaker: any;
        try {
          const pr = new oc.Message_ProgressRange_1(); trash.push(pr);
          fuseMaker = new oc.BRepAlgoAPI_Fuse_3(result, shape, pr); trash.push(fuseMaker);
        } catch {
          fuseMaker = new oc.BRepAlgoAPI_Fuse_1(result, shape); trash.push(fuseMaker);
        }
        let fuseOk = true;
        try { fuseOk = typeof fuseMaker.IsDone !== 'function' || fuseMaker.IsDone(); } catch { /* */ }
        if (!fuseOk) throw new CadError({ code: 'boolean_failed', message: 'sketchExtrude: multi-loop union failed' });
        result = fuseMaker.Shape();
      }
    }

    if (!result) throw new CadError({ code: 'invalid_input', message: 'sketchExtrude: no result shape' });

    // Mark smooth edges so BRepMesh can triangulate spline side faces correctly.
    try {
      if (oc.BRepLib && typeof oc.BRepLib.EncodeRegularity === 'function') {
        oc.BRepLib.EncodeRegularity(result, 1e-10);
      }
    } catch { /* optional – safe to skip */ }

    return result;

  } finally {
    for (let i = trash.length - 1; i >= 0; i--) {
      try { trash[i].delete(); } catch { /* */ }
    }
  }
}
