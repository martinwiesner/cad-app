// src/cad/operations/chamfer.ts
import { CadError } from '../types';

/**
 * Fast alle Kanten des Shapes.
 * API: BRepFilletAPI_MakeChamfer(shape), mk.Add_2(distance, edge)
 */
export function chamferAllEdges(oc: any, shape: any, distance: number): any {
  if (!(distance > 0)) throw new CadError({ code: 'invalid_input', message: `chamfer: distance must be > 0` });
  if (!shape || shape.IsNull?.()) throw new CadError({ code: 'invalid_input', message: 'chamfer: shape is null' });

  const mk = new oc.BRepFilletAPI_MakeChamfer(shape);
  const exp = new oc.TopExp_Explorer_2(
    shape,
    oc.TopAbs_ShapeEnum.TopAbs_EDGE,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
  );

  let edgeCount = 0;
  try {
    const seen = new Set<number>();
    while (exp.More()) {
      const edge = oc.TopoDS.Edge_1(exp.Current());
      let h: number;
      try { h = edge.HashCode(0x7fffffff); } catch { h = edgeCount; }
      if (!seen.has(h)) {
        seen.add(h);
        mk.Add_2(distance, edge);
        edgeCount++;
      }
      exp.Next();
    }
  } finally {
    try { exp.delete(); } catch { /* ignore */ }
  }

  if (edgeCount === 0) {
    try { mk.delete(); } catch { /* ignore */ }
    throw new CadError({ code: 'invalid_input', message: 'chamfer: no edges' });
  }

  const progress = new oc.Message_ProgressRange_1();
  try {
    mk.Build(progress);
    if (!mk.IsDone()) {
      throw new CadError({ code: 'chamfer_failed', message: `chamfer: not done - distance too large?` });
    }
    return mk.Shape();
  } finally {
    try { progress.delete(); } catch { /* ignore */ }
    try { mk.delete(); } catch { /* ignore */ }
  }
}
