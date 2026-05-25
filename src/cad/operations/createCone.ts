// src/cad/operations/createCone.ts
import { withScopeSync } from '../memoryScope';
import { CadError, type ConeParams } from '../types';

/**
 * Versions-Strategie: BRepPrimAPI_MakeCone(ax2, r1, r2, h) ist die uebliche API.
 * Wir probieren die bekannten Suffixe durch.
 */

let cachedCtorName: string | null = null;

export function createCone(oc: any, params: ConeParams): any {
  const { radius1, radius2, height, x = 0, y = 0, z = 0, axis = 'z' } = params;

  if (radius1 < 0 || radius2 < 0) {
    throw new CadError({ code: 'invalid_input', message: 'createCone: Radien muessen >= 0 sein' });
  }
  if (radius1 === 0 && radius2 === 0) {
    throw new CadError({ code: 'invalid_input', message: 'createCone: mindestens ein Radius muss > 0 sein' });
  }
  if (!(height > 0)) {
    throw new CadError({ code: 'invalid_input', message: `createCone: height muss > 0 sein (${height})` });
  }

  return withScopeSync((scope) => {
    const origin = scope.track(new oc.gp_Pnt_3(x, y, z));
    let dir: any;
    switch (axis) {
      case 'x': dir = scope.track(new oc.gp_Dir_4(1, 0, 0)); break;
      case 'y': dir = scope.track(new oc.gp_Dir_4(0, 1, 0)); break;
      case 'z':
      default:  dir = scope.track(new oc.gp_Dir_4(0, 0, 1)); break;
    }
    const ax2 = scope.track(new oc.gp_Ax2_3(origin, dir));

    let maker: any = null;
    let usedName = '';

    /** Returns true if IsDone() is true or not callable. Swallows C++ throws. */
    const isDoneOk = (m: any): boolean => {
      try { return typeof m.IsDone !== 'function' || m.IsDone(); } catch { return true; }
    };

    const tryBuildAndCheck = (m: any): any => {
      if (!isDoneOk(m)) {
        try {
          const pr = scope.track(new oc.Message_ProgressRange_1());
          m.Build(pr);
        } catch { try { m.Build(); } catch { /* */ } }
        let done = true;
        try { done = typeof m.IsDone !== 'function' || m.IsDone(); } catch { done = true; }
        if (!done) return null;
      }
      return m;
    };

    const tryMakeCone = (name: string): any => {
      try {
        return tryBuildAndCheck(scope.track(new oc[name](ax2, radius1, radius2, height)));
      } catch { return null; }
    };

    // Cached zuerst
    if (cachedCtorName && typeof oc[cachedCtorName] === 'function') {
      maker = tryMakeCone(cachedCtorName);
      if (maker) {
        usedName = `${cachedCtorName} (cached)`;
      } else {
        cachedCtorName = null;
      }
    }

    // Alle bekannten Suffixe probieren
    if (!maker) {
      for (const suffix of ['_4', '_3', '_2', '_5', '_1', '']) {
        const name = `BRepPrimAPI_MakeCone${suffix}`;
        if (typeof oc[name] !== 'function') continue;
        const m = tryMakeCone(name);
        if (m) {
          maker = m;
          cachedCtorName = name;
          usedName = name;
          break;
        }
      }
    }

    if (!maker) {
      const available = Object.keys(oc).filter((k) => k.startsWith('BRepPrimAPI_MakeCone')).join(', ');
      throw new CadError({
        code: 'invalid_input',
        message: `createCone: kein passender Konstruktor (verfuegbar: ${available || 'keine'})`,
      });
    }

    // Direct ctors auto-build. Only call Build() if not already done.
    let alreadyBuilt = false;
    try { alreadyBuilt = typeof maker.IsDone === 'function' && maker.IsDone(); } catch { alreadyBuilt = true; }
    if (!alreadyBuilt) {
      try {
        const pr = scope.track(new oc.Message_ProgressRange_1());
        maker.Build(pr);
      } catch { try { maker.Build(); } catch { /* */ } }
    }

    let finalDone = true;
    try { finalDone = typeof maker.IsDone !== 'function' || maker.IsDone(); } catch { finalDone = true; }
    if (!finalDone) {
      throw new CadError({ code: 'invalid_input', message: `createCone: IsDone()=false (variant=${usedName})` });
    }
    return maker.Shape();
  });
}
