// src/cad/meshConversion.ts
import { CadError, type MeshArrays, type MeshOptions } from './types';

/**
 * Trianguliert ein TopoDS_Shape und liefert flache TypedArrays.
 *
 * WICHTIGER FIX (vorher: Bug)
 * ---------------------------
 * Die VORIGE Version hat das Triangulation-Objekt der ersten Face in einem
 * Closure gecached und fuer ALLE Folge-Faces wiederverwendet. Dadurch wurden
 * z.B. Box-Seitenwaende und Zylinder-Deckel mit den Vertices der Top-Face
 * gerendert -> "flache Scheibe, Bohrung fehlt, Zylinder offen".
 *
 * Jetzt: Wir bestimmen NUR die API-Variante einmal (direct vs. handle.get,
 * direct vs. _1-Suffix). Pro Face wird das uebergebene Triangulation-Objekt
 * mit der erkannten Strategie aufgemacht.
 *
 * VERSIONS-ROBUSTHEIT
 * --------------------
 * OpenCascade.js v2.x liefert je nach Build und OCCT-Version unterschiedliche
 * Zugriffspfade auf Poly_Triangulation. Wir probieren:
 *   A) direct       triangulation.NbNodes() / Node(i) / NbTriangles() / Triangle(i)
 *   B) handle.get   triangulation.get().NbNodes() ...  (Handle<Poly_Triangulation>)
 *   C) suffix       triangulation.NbNodes_1() ...      (Overload-Suffix)
 *   D) handle+suffix triangulation.get().NbNodes_1() ...
 *
 * Wenn keine Variante passt, gibt es einen Fehler mit Probe-Diagnostik.
 */
export function triangulateShape(oc: any, shape: any, opt: MeshOptions = {}): MeshArrays {
  const lin = opt.linearDeflection ?? 0.1;
  const ang = opt.angularDeflection ?? 0.5;

  meshShape(oc, shape, lin, ang);

  const positions: number[] = [];
  const normalsAcc: number[][] = [];
  const indices: number[] = [];
  const faceGroups: MeshArrays['faceGroups'] = [];

  const exp = new oc.TopExp_Explorer_2(
    shape,
    oc.TopAbs_ShapeEnum.TopAbs_FACE,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
  );

  let faceId = 0;
  let accessor: TriAccessor | null = null;
  let lastDiagnostic = '';

  try {
    while (exp.More()) {
      const face = oc.TopoDS.Face_1(exp.Current());
      const loc = new oc.TopLoc_Location_1();

      const triangulation = readTriangulation(oc, face, loc);
      if (triangulation && !isNull(triangulation)) {
        if (!accessor) {
          try {
            accessor = detectAccessor(triangulation);
          } catch (e) {
            lastDiagnostic = String((e as Error)?.message ?? e);
            try { loc.delete(); } catch { /* ignore */ }
            exp.Next();
            faceId++;
            continue;
          }
        }
        appendFace(
          accessor, triangulation, face, loc, oc,
          faceId, positions, normalsAcc, indices, faceGroups,
        );
      }

      try { loc.delete(); } catch { /* ignore */ }
      exp.Next();
      faceId++;
    }
  } finally {
    try { exp.delete(); } catch { /* ignore */ }
  }

  if (positions.length === 0 || indices.length === 0) {
    throw new CadError({
      code: 'triangulation_failed',
      message: accessor
        ? 'triangulateShape: leeres Mesh - Shape valide?'
        : `triangulateShape: keine Poly_Triangulation-API erkannt`,
      details: lastDiagnostic || undefined,
    });
  }

  const normals = new Float32Array(normalsAcc.length * 3);
  for (let i = 0; i < normalsAcc.length; i++) {
    const [x, y, z] = normalsAcc[i];
    const len = Math.hypot(x, y, z) || 1;
    normals[i * 3] = x / len;
    normals[i * 3 + 1] = y / len;
    normals[i * 3 + 2] = z / len;
  }

  return {
    positions: new Float32Array(positions),
    normals,
    indices: new Uint32Array(indices),
    faceGroups,
  };
}

// ===========================================================================
//   Mesh erzeugen
// ===========================================================================
function meshShape(oc: any, shape: any, lin: number, ang: number): void {
  // Encode edge regularity so the mesher can handle smooth spline side faces
  // (extruded B-spline solids need this to avoid mesher ctor failures).
  try {
    if (oc.BRepLib && typeof oc.BRepLib.EncodeRegularity === 'function') {
      oc.BRepLib.EncodeRegularity(shape, 1e-10);
    }
  } catch { /* optional */ }

  let mesher: any = null;
  try {
    // Try 5-param ctor first (_2), then progressively simpler variants.
    if (typeof oc.BRepMesh_IncrementalMesh_2 === 'function') {
      try { mesher = new oc.BRepMesh_IncrementalMesh_2(shape, lin, false, ang, false); } catch { /* */ }
    }
    if (!mesher && typeof oc.BRepMesh_IncrementalMesh_1 === 'function') {
      try { mesher = new oc.BRepMesh_IncrementalMesh_1(shape, lin); } catch { /* */ }
    }
    if (!mesher && typeof oc.BRepMesh_IncrementalMesh === 'function') {
      try { mesher = new oc.BRepMesh_IncrementalMesh(shape, lin, false, ang, false); } catch { /* */ }
      if (!mesher) {
        try { mesher = new oc.BRepMesh_IncrementalMesh(shape, lin); } catch { /* */ }
      }
    }
    // Coarser-tolerance fallback: spline surfaces sometimes need larger deflection
    // to pass the mesher's validity checks.
    if (!mesher) {
      const coarseLin = Math.max(lin * 10, 1.0);
      if (typeof oc.BRepMesh_IncrementalMesh_2 === 'function') {
        try { mesher = new oc.BRepMesh_IncrementalMesh_2(shape, coarseLin); } catch { /* */ }
      }
      if (!mesher && typeof oc.BRepMesh_IncrementalMesh_1 === 'function') {
        try { mesher = new oc.BRepMesh_IncrementalMesh_1(shape, coarseLin); } catch { /* */ }
      }
      if (!mesher && typeof oc.BRepMesh_IncrementalMesh === 'function') {
        try { mesher = new oc.BRepMesh_IncrementalMesh(shape, coarseLin); } catch { /* */ }
      }
    }
    if (!mesher) throw new Error('Kein BRepMesh_IncrementalMesh-Ctor gefunden');

    // Perform only if ctor did not already mesh (same double-build guard).
    if (typeof mesher.Perform === 'function') {
      try {
        const pr = new oc.Message_ProgressRange_1();
        try { mesher.Perform(pr); } finally { try { pr.delete(); } catch { /* ignore */ } }
      } catch { /* ctor already meshed */ }
    }
  } catch (e) {
    throw new CadError({
      code: 'triangulation_failed',
      message: 'BRepMesh_IncrementalMesh failed',
      details: String((e as Error)?.message ?? e),
    });
  } finally {
    try { mesher?.delete(); } catch { /* ignore */ }
  }
}

// ===========================================================================
//   BRep_Tool.Triangulation - Signatur variiert
// ===========================================================================
function readTriangulation(oc: any, face: any, loc: any): any {
  try {
    return oc.BRep_Tool.Triangulation(face, loc, 0);
  } catch {
    try {
      return oc.BRep_Tool.Triangulation(face, loc);
    } catch (e) {
      throw new CadError({
        code: 'triangulation_failed',
        message: 'BRep_Tool.Triangulation: signature mismatch',
        details: String((e as Error)?.message ?? e),
      });
    }
  }
}

// ===========================================================================
//   API-Erkennung fuer Poly_Triangulation - jetzt OHNE Caching des Targets
// ===========================================================================
interface TriAccessor {
  variant: string;
  /** Erzeugt aus einem rohen Triangulation-Objekt das tatsaechlich nutzbare Target. */
  unwrap(t: any): any;
  nbNodes(u: any): number;
  nodeXYZ(u: any, i1: number): [number, number, number];
  nbTriangles(u: any): number;
  triangleIdx(u: any, i1: number): [number, number, number];
}

function detectAccessor(triangulation: any): TriAccessor {
  // Schritt 1: brauchen wir .get() Unwrap?
  let needsUnwrap = false;
  let probe: any = triangulation;

  const hasDirectApi =
    isFn(probe.NbNodes) || isFn(probe.NbNodes_1);

  if (!hasDirectApi && typeof triangulation.get === 'function') {
    try {
      const inner = triangulation.get();
      if (inner && (isFn(inner.NbNodes) || isFn(inner.NbNodes_1))) {
        needsUnwrap = true;
        probe = inner;
      }
    } catch { /* ignore */ }
  }

  const unwrap: (t: any) => any = needsUnwrap
    ? (t) => t.get()
    : (t) => t;

  // Schritt 2: Variante anhand probe bestimmen, Methoden benutzen `u` (unwrapped per Face)
  if (isFn(probe.NbNodes) && isFn(probe.Node) && isFn(probe.NbTriangles) && isFn(probe.Triangle)) {
    return {
      variant: needsUnwrap ? 'handle.get/direct' : 'direct',
      unwrap,
      nbNodes: (u) => u.NbNodes(),
      nodeXYZ: (u, i) => pntToXYZ(u.Node(i)),
      nbTriangles: (u) => u.NbTriangles(),
      triangleIdx: (u, i) => triToIdx(u.Triangle(i)),
    };
  }

  if (isFn(probe.NbNodes_1) && isFn(probe.Node_1)) {
    return {
      variant: needsUnwrap ? 'handle.get/suffix_1' : 'suffix_1',
      unwrap,
      nbNodes: (u) => u.NbNodes_1(),
      nodeXYZ: (u, i) => pntToXYZ(u.Node_1(i)),
      nbTriangles: (u) => (isFn(u.NbTriangles_1) ? u.NbTriangles_1() : u.NbTriangles()),
      triangleIdx: (u, i) => triToIdx(isFn(u.Triangle_1) ? u.Triangle_1(i) : u.Triangle(i)),
    };
  }

  // Diagnose
  throw new Error(
    `Poly_Triangulation API nicht erkannt. ` +
    `Probe (needsUnwrap=${needsUnwrap}): ${describeObject(probe)}`
  );
}

function isFn(v: any): boolean {
  return typeof v === 'function';
}

function isNull(t: any): boolean {
  try { return t.IsNull?.() === true; } catch { return false; }
}

function pntToXYZ(p: any): [number, number, number] {
  return [p.X(), p.Y(), p.Z()];
}

function triToIdx(tri: any): [number, number, number] {
  return [tri.Value(1), tri.Value(2), tri.Value(3)];
}

function describeObject(o: any): string {
  if (!o || typeof o !== 'object') return `(typeof=${typeof o})`;
  const ctor = o.constructor?.name ?? '(no ctor)';
  const ownKeys = Object.keys(o).slice(0, 10).join(',');
  let protoKeys = '';
  try {
    const proto = Object.getPrototypeOf(o);
    if (proto) {
      protoKeys = Object.getOwnPropertyNames(proto)
        .filter((k) => !k.startsWith('_') && k !== 'constructor')
        .slice(0, 25).join(',');
    }
  } catch { /* ignore */ }
  return `ctor=${ctor} own=[${ownKeys}] proto=[${protoKeys}]`;
}

// ===========================================================================
//   Face anhaengen - jetzt mit unwrap pro Face
// ===========================================================================
function appendFace(
  accessor: TriAccessor,
  triangulation: any,
  face: any,
  loc: any,
  oc: any,
  faceId: number,
  positions: number[],
  normalsAcc: number[][],
  indices: number[],
  faceGroups: MeshArrays['faceGroups'],
): void {
  // EINMAL pro Face unwrappen - das ist das Target fuer alle weiteren Aufrufe.
  // Vorher war hier ein Closure-Bug: das Target wurde im Accessor gecached
  // (= immer das Target der ERSTEN Face). Jetzt ist u face-lokal.
  const u = accessor.unwrap(triangulation);

  const trsf = loc.Transformation();

  let reversed = false;
  try {
    reversed = face.Orientation_1() === oc.TopAbs_Orientation.TopAbs_REVERSED;
  } catch {
    try {
      reversed = face.Orientation() === oc.TopAbs_Orientation.TopAbs_REVERSED;
    } catch { /* default false */ }
  }

  const nbNodes = accessor.nbNodes(u);
  const baseIndex = positions.length / 3;

  for (let i = 1; i <= nbNodes; i++) {
    const [x, y, z] = accessor.nodeXYZ(u, i);
    const [tx, ty, tz] = applyTrsf(trsf, x, y, z);
    positions.push(tx, ty, tz);
    normalsAcc.push([0, 0, 0]);
  }

  const groupStart = indices.length;
  const nbTri = accessor.nbTriangles(u);
  for (let i = 1; i <= nbTri; i++) {
    let [n1, n2, n3] = accessor.triangleIdx(u, i);
    if (reversed) { const t = n2; n2 = n3; n3 = t; }

    const ia = baseIndex + n1 - 1;
    const ib = baseIndex + n2 - 1;
    const ic = baseIndex + n3 - 1;
    indices.push(ia, ib, ic);

    const ax = positions[ia * 3], ay = positions[ia * 3 + 1], az = positions[ia * 3 + 2];
    const bx = positions[ib * 3], by = positions[ib * 3 + 1], bz = positions[ib * 3 + 2];
    const cx = positions[ic * 3], cy = positions[ic * 3 + 1], cz = positions[ic * 3 + 2];

    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;

    normalsAcc[ia][0] += nx; normalsAcc[ia][1] += ny; normalsAcc[ia][2] += nz;
    normalsAcc[ib][0] += nx; normalsAcc[ib][1] += ny; normalsAcc[ib][2] += nz;
    normalsAcc[ic][0] += nx; normalsAcc[ic][1] += ny; normalsAcc[ic][2] += nz;
  }
  faceGroups.push({ faceId, start: groupStart, count: indices.length - groupStart });
}

// ===========================================================================
//   gp_Trsf manuell anwenden
// ===========================================================================
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
