// src/cad/operations/transform.ts
import { withScopeSync } from '../memoryScope';
import { CadError, type RotateParams, type ScaleParams, type TranslateParams } from '../types';

/**
 * Wendet eine affine Transformation auf ein Shape an.
 *
 * Wir benutzen BRepBuilderAPI_Transform statt manuelles TopLoc_Location setzen,
 * weil das die Geometrie tatsaechlich transformiert (statt nur eine Location
 * anzuhaengen). Das macht das Mesh und alle Downstream-Operationen korrekt.
 *
 * API-NAME PRÜFEN:
 *   - gp_Trsf_1() default-Ctor
 *   - trsf.SetTranslation_1(gp_Vec)
 *   - trsf.SetRotation_1(gp_Ax1, angleRad)
 *   - trsf.SetScale(gp_Pnt, factor)
 *   - BRepBuilderAPI_Transform_2(shape, trsf, copy=true)
 */

export function translateShape(oc: any, shape: any, p: TranslateParams): any {
  return withScopeSync((scope) => {
    const trsf = scope.track(new oc.gp_Trsf_1());
    const vec = scope.track(new oc.gp_Vec_4(p.dx, p.dy, p.dz));
    // Versuch beide moegliche Methodennamen
    try {
      trsf.SetTranslation_1(vec);
    } catch {
      try {
        trsf.SetTranslation(vec);
      } catch (e) {
        throw new CadError({
          code: 'invalid_input',
          message: 'translateShape: SetTranslation API nicht gefunden',
          details: String((e as Error)?.message ?? e),
        });
      }
    }
    return applyTransform(oc, shape, trsf);
  });
}

export function rotateShape(oc: any, shape: any, p: RotateParams): any {
  return withScopeSync((scope) => {
    const trsf = scope.track(new oc.gp_Trsf_1());
    const pivot = scope.track(new oc.gp_Pnt_3(p.px ?? 0, p.py ?? 0, p.pz ?? 0));
    let dir: any;
    switch (p.axis) {
      case 'x': dir = scope.track(new oc.gp_Dir_4(1, 0, 0)); break;
      case 'y': dir = scope.track(new oc.gp_Dir_4(0, 1, 0)); break;
      case 'z':
      default:  dir = scope.track(new oc.gp_Dir_4(0, 0, 1)); break;
    }
    const ax1 = scope.track(new oc.gp_Ax1_2(pivot, dir));
    const angleRad = (p.angleDeg * Math.PI) / 180;
    try {
      trsf.SetRotation_1(ax1, angleRad);
    } catch {
      try {
        trsf.SetRotation(ax1, angleRad);
      } catch (e) {
        throw new CadError({
          code: 'invalid_input',
          message: 'rotateShape: SetRotation API nicht gefunden',
          details: String((e as Error)?.message ?? e),
        });
      }
    }
    return applyTransform(oc, shape, trsf);
  });
}

export function scaleShape(oc: any, shape: any, p: ScaleParams): any {
  if (!(p.factor > 0)) {
    throw new CadError({ code: 'invalid_input', message: `scaleShape: factor muss > 0 sein (${p.factor})` });
  }
  return withScopeSync((scope) => {
    const trsf = scope.track(new oc.gp_Trsf_1());
    const center = scope.track(new oc.gp_Pnt_3(p.px ?? 0, p.py ?? 0, p.pz ?? 0));
    try {
      trsf.SetScale(center, p.factor);
    } catch (e) {
      throw new CadError({
        code: 'invalid_input',
        message: 'scaleShape: SetScale API nicht gefunden',
        details: String((e as Error)?.message ?? e),
      });
    }
    return applyTransform(oc, shape, trsf);
  });
}

function applyTransform(oc: any, shape: any, trsf: any): any {
  let transformer: any = null;
  try {
    // copy=false ist effizienter, aber kann bei spaeteren Operationen Probleme
    // machen. Wir kopieren defensiv (true).
    transformer = new oc.BRepBuilderAPI_Transform_2(shape, trsf, true);
    if (typeof transformer.Build === 'function') {
      try {
        const pr = new oc.Message_ProgressRange_1();
        try { transformer.Build(pr); } finally { try { pr.delete(); } catch { /* */ } }
      } catch { /* manche Builds bauen im Ctor */ }
    }
    if (typeof transformer.IsDone === 'function' && !transformer.IsDone()) {
      throw new CadError({ code: 'invalid_input', message: 'transform: IsDone() = false' });
    }
    return transformer.Shape();
  } finally {
    try { transformer?.delete(); } catch { /* */ }
  }
}
