// src/cad/operations/fillet.ts
import { CadError } from '../types';

/**
 * Verrundet alle Kanten des Shapes mit konstantem Radius.
 *
 * API:
 *   - BRepFilletAPI_MakeFillet(shape) ODER (shape, ChFi3d_FilletShape)
 *     Manche OCCT-Builds erwarten zwingend den 2-Parameter-Ctor.
 *   - mk.Add_2(radius, edge)
 *   - mk.Build(progress)
 *   - mk.IsDone(), mk.Shape()
 *
 * Wenn der Radius zu gross fuer die Geometrie ist, schlaegt IsDone() fehl.
 */
export function filletAllEdges(oc: any, shape: any, radius: number): any {
  if (!(radius > 0)) throw new CadError({ code: 'invalid_input', message: `fillet: radius must be > 0 (got ${radius})` });
  if (!shape || shape.IsNull?.()) throw new CadError({ code: 'invalid_input', message: 'fillet: shape is null' });

  const mk = buildFilletMakerCompat(oc, shape);
  const exp = new oc.TopExp_Explorer_2(
    shape,
    oc.TopAbs_ShapeEnum.TopAbs_EDGE,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
  );

  let edgeCount = 0;
  try {
    // Doppelten-Kanten-Tracking ueber HashCode-Set, sonst zaehlt OCCT manche Kanten mehrfach
    const seen = new Set<number>();
    while (exp.More()) {
      const edge = oc.TopoDS.Edge_1(exp.Current());
      let h: number;
      try { h = edge.HashCode(0x7fffffff); } catch { h = edgeCount; }
      if (!seen.has(h)) {
        seen.add(h);
        mk.Add_2(radius, edge);
        edgeCount++;
      }
      exp.Next();
    }
  } finally {
    try { exp.delete(); } catch { /* ignore */ }
  }

  if (edgeCount === 0) {
    try { mk.delete(); } catch { /* ignore */ }
    throw new CadError({ code: 'invalid_input', message: 'fillet: no edges in shape' });
  }

  const progress = new oc.Message_ProgressRange_1();
  try {
    mk.Build(progress);
    if (!mk.IsDone()) {
      throw new CadError({
        code: 'fillet_too_large',
        message: `fillet: not done - radius ${radius} likely too large for ${edgeCount} edges`,
      });
    }
    return mk.Shape();
  } finally {
    try { progress.delete(); } catch { /* ignore */ }
    try { mk.delete(); } catch { /* ignore */ }
  }
}

/**
 * Probiert BRepFilletAPI_MakeFillet mit 2-Parameter-Ctor zuerst (neuere OCCT-Versionen),
 * faellt auf 1-Parameter zurueck (aeltere).
 */
function buildFilletMakerCompat(oc: any, shape: any): any {
  if (oc.ChFi3d_FilletShape && oc.ChFi3d_FilletShape.ChFi3d_Rational !== undefined) {
    try {
      return new oc.BRepFilletAPI_MakeFillet(shape, oc.ChFi3d_FilletShape.ChFi3d_Rational);
    } catch { /* faellt durch zu 1-Param-Ctor */ }
  }
  return new oc.BRepFilletAPI_MakeFillet(shape);
}
