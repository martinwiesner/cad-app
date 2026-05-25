// src/cad/operations/createCylinder.ts
import { withScopeSync } from '../memoryScope';
import { CadError, type CylinderParams } from '../types';

/**
 * Erzeugt einen TopoDS_Shape Zylinder entlang einer Achse.
 *
 * API-NAME PRÜFEN:
 *   - gp_Pnt_3, gp_Dir_4(dx,dy,dz), gp_Ax2_3(pnt, dir)
 *   - BRepPrimAPI_MakeCylinder_3(ax2, radius, height)
 *   - Message_ProgressRange_1()
 */
export function createCylinder(oc: any, params: CylinderParams): any {
  const { radius, height, x = 0, y = 0, z = 0, axis = 'z' } = params;

  if (!(radius > 0 && height > 0)) {
    throw new CadError({
      code: 'invalid_input',
      message: `createCylinder: positive radius/height required (r=${radius}, h=${height})`,
    });
  }

  return withScopeSync((scope) => {
    const origin = scope.track(new oc.gp_Pnt_3(x, y, z));
    let dir: any;
    switch (axis) {
      case 'x':
        dir = scope.track(new oc.gp_Dir_4(1, 0, 0));
        break;
      case 'y':
        dir = scope.track(new oc.gp_Dir_4(0, 1, 0));
        break;
      case 'z':
      default:
        dir = scope.track(new oc.gp_Dir_4(0, 0, 1));
        break;
    }
    const ax2 = scope.track(new oc.gp_Ax2_3(origin, dir));
    const maker = scope.track(new oc.BRepPrimAPI_MakeCylinder_3(ax2, radius, height));

    let alreadyBuilt = false;
    try { alreadyBuilt = typeof maker.IsDone === 'function' && maker.IsDone(); } catch { alreadyBuilt = true; }
    if (!alreadyBuilt) {
      try {
        const pr = scope.track(new oc.Message_ProgressRange_1());
        maker.Build(pr);
      } catch { try { maker.Build(); } catch { /* */ } }
    }

    let done = true;
    try { done = typeof maker.IsDone !== 'function' || maker.IsDone(); } catch { done = true; }
    if (!done) {
      throw new CadError({ code: 'invalid_input', message: 'createCylinder: maker.IsDone() = false' });
    }

    return maker.Shape();
  });
}
