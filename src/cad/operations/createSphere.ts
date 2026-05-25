// src/cad/operations/createSphere.ts
import { withScopeSync } from '../memoryScope';
import { CadError, type SphereParams } from '../types';

/**
 * Erzeugt eine TopoDS_Shape Sphere.
 *
 * Versions-Strategie: BRepPrimAPI_MakeSphere existiert in OCJS unter wechselnden
 * Suffixen je nach Overload. Wir probieren alle bekannten Varianten:
 *
 *   1. (gp_Ax2, radius)            - mit Axis-System (am vollstaendigsten)
 *   2. (gp_Pnt, radius)             - mit Center-Punkt
 *   3. (radius)                     - nur Radius (am Ursprung), fuer x=y=z=0
 *
 * Der gefundene Konstruktor wird beim ersten Aufruf cached. So fragen wir
 * die API-Suffixe nicht jedes Mal neu ab.
 */

let cachedVariant: 'ax2' | 'pnt' | 'plain' | null = null;
let cachedCtorName: string | null = null;

export function createSphere(oc: any, params: SphereParams): any {
  const { radius, x = 0, y = 0, z = 0 } = params;
  if (!(radius > 0)) {
    throw new CadError({ code: 'invalid_input', message: `createSphere: radius muss > 0 sein (${radius})` });
  }

  return withScopeSync((scope) => {
    let maker: any = null;
    let variantUsed: string = '';

    // Versuch 1: Cached Variante
    if (cachedVariant && cachedCtorName) {
      maker = trySpecificVariant(oc, scope, cachedVariant, cachedCtorName, radius, x, y, z);
      if (maker) {
        variantUsed = `${cachedVariant}/${cachedCtorName} (cached)`;
      } else {
        // Cached variant no longer works — clear cache and re-detect
        cachedVariant = null; cachedCtorName = null;
      }
    }

    // OCCT overload numbering: _1–_4 = (R[,angles]), _5–_8 = (gp_Pnt,R[,…]), _9–_12 = (gp_Ax2,R[,…])
    // Versuch 2: ax2-Variante
    if (!maker) {
      for (const suffix of ['_9', '_10', '_11', '_12', '_3', '_5', '_2', '_4', '']) {
        const name = `BRepPrimAPI_MakeSphere${suffix}`;
        if (typeof oc[name] !== 'function') continue;
        const m = tryWithAx2(oc, scope, name, radius, x, y, z);
        if (m) {
          cachedVariant = 'ax2'; cachedCtorName = name;
          variantUsed = `ax2/${name}`;
          maker = m;
          break;
        }
      }
    }

    // Versuch 3: pnt-Variante
    if (!maker) {
      for (const suffix of ['_5', '_6', '_7', '_8', '_3', '_2', '_4', '_1', '']) {
        const name = `BRepPrimAPI_MakeSphere${suffix}`;
        if (typeof oc[name] !== 'function') continue;
        const m = tryWithPnt(oc, scope, name, radius, x, y, z);
        if (m) {
          cachedVariant = 'pnt'; cachedCtorName = name;
          variantUsed = `pnt/${name}`;
          maker = m;
          break;
        }
      }
    }

    // Versuch 4: Plain Radius (nur wenn am Ursprung)
    if (!maker && x === 0 && y === 0 && z === 0) {
      for (const suffix of ['_1', '_2', '']) {
        const name = `BRepPrimAPI_MakeSphere${suffix}`;
        if (typeof oc[name] !== 'function') continue;
        try {
          const m = buildAndCheck(oc, scope, scope.track(new oc[name](radius)));
          if (m) {
            cachedVariant = 'plain'; cachedCtorName = name;
            variantUsed = `plain/${name}`;
            maker = m;
            break;
          }
        } catch { /* weiter */ }
      }
    }

    if (!maker) {
      // Diagnose: welche Symbole gibt es?
      const available = Object.keys(oc).filter((k) => k.startsWith('BRepPrimAPI_MakeSphere')).join(', ');
      throw new CadError({
        code: 'invalid_input',
        message: `createSphere: kein passender Konstruktor (verfuegbar: ${available || 'keine'})`,
      });
    }

    // Direct ctors auto-build; only call Build() if not already done.
    // IsDone() itself can throw on some OCCT builds — treat throw as "already built".
    if (!isDoneOk(maker)) {
      try {
        const pr = scope.track(new oc.Message_ProgressRange_1());
        maker.Build(pr);
      } catch {
        try { maker.Build(); } catch { /* */ }
      }
    }
    let finalDone = true;
    try { finalDone = typeof maker.IsDone !== 'function' || maker.IsDone(); } catch { finalDone = true; }
    if (!finalDone) {
      throw new CadError({ code: 'invalid_input', message: `createSphere: IsDone()=false (variant=${variantUsed})` });
    }
    return maker.Shape();
  });
}

function trySpecificVariant(
  oc: any, scope: any, variant: 'ax2' | 'pnt' | 'plain', ctorName: string,
  radius: number, x: number, y: number, z: number,
): any {
  if (typeof oc[ctorName] !== 'function') return null;
  if (variant === 'ax2') return tryWithAx2(oc, scope, ctorName, radius, x, y, z);
  if (variant === 'pnt') return tryWithPnt(oc, scope, ctorName, radius, x, y, z);
  if (variant === 'plain' && x === 0 && y === 0 && z === 0) {
    try { return buildAndCheck(oc, scope, scope.track(new oc[ctorName](radius))); } catch { return null; }
  }
  return null;
}

/** Returns true if IsDone() is true or not callable. Swallows C++ throws. */
function isDoneOk(maker: any): boolean {
  try { return typeof maker.IsDone !== 'function' || maker.IsDone(); } catch { return true; }
}

/**
 * Tries Build() if the maker is not yet done, then checks again.
 * Returns maker on success, null if still not done (wrong overload).
 */
function buildAndCheck(oc: any, scope: any, m: any): any {
  if (!isDoneOk(m)) {
    try {
      const pr = scope.track(new oc.Message_ProgressRange_1());
      m.Build(pr);
    } catch { try { m.Build(); } catch { /* */ } }
    // After Build: if still not done → wrong overload
    let done = true;
    try { done = typeof m.IsDone !== 'function' || m.IsDone(); } catch { done = true; }
    if (!done) return null;
  }
  return m;
}

function tryWithAx2(oc: any, scope: any, ctorName: string, radius: number, x: number, y: number, z: number): any {
  try {
    const pnt = scope.track(new oc.gp_Pnt_3(x, y, z));
    const dir = scope.track(new oc.gp_Dir_4(0, 0, 1));
    const ax2 = scope.track(new oc.gp_Ax2_3(pnt, dir));
    return buildAndCheck(oc, scope, scope.track(new oc[ctorName](ax2, radius)));
  } catch {
    return null;
  }
}

function tryWithPnt(oc: any, scope: any, ctorName: string, radius: number, x: number, y: number, z: number): any {
  try {
    const pnt = scope.track(new oc.gp_Pnt_3(x, y, z));
    return buildAndCheck(oc, scope, scope.track(new oc[ctorName](pnt, radius)));
  } catch {
    return null;
  }
}
