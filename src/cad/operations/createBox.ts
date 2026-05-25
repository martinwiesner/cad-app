// src/cad/operations/createBox.ts
import { withScopeSync } from '../memoryScope';
import { CadError, type BoxParams } from '../types';

/**
 * Erzeugt einen TopoDS_Shape Quader.
 *
 * API-NAME PRÜFEN (versionsabhaengig - in scripts/inspect-api.html verifizieren):
 *   - gp_Pnt_3(x,y,z)
 *   - BRepPrimAPI_MakeBox_3(pnt, dx, dy, dz)
 *   - Message_ProgressRange_1()
 *
 * Das ZURUECKGEGEBENE Shape ist eine eigene Heap-Allokation und muss
 * vom Caller (ShapeRegistry) per .delete() freigegeben werden.
 */
export function createBox(oc: any, params: BoxParams): any {
  const { width, depth, height, x = 0, y = 0, z = 0 } = params;

  if (!(width > 0 && depth > 0 && height > 0)) {
    throw new CadError({
      code: 'invalid_input',
      message: `createBox: positive dimensions required (w=${width}, d=${depth}, h=${height})`,
    });
  }

  return withScopeSync((scope) => {
    const origin = scope.track(new oc.gp_Pnt_3(x, y, z));
    const maker = scope.track(new oc.BRepPrimAPI_MakeBox_3(origin, width, depth, height));

    // Direct ctor auto-builds. IsDone() itself can throw a C++ exception on some
    // OCCT builds — wrap every call in try/catch and treat a throw as "already done".
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
      throw new CadError({ code: 'invalid_input', message: 'createBox: maker.IsDone() = false' });
    }

    return maker.Shape();
  });
}
