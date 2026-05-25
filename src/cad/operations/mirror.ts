// src/cad/operations/mirror.ts
import { withScopeSync } from '../memoryScope';
import { CadError, type MirrorParams } from '../types';

/**
 * Spiegelt ein Shape an einer der drei Hauptebenen (XY / XZ / YZ).
 *
 * Implementierung: gp_Trsf.SetMirror_3(gp_Ax2) — das gp_Ax2 definiert die
 * Spiegelebene durch seine XY-Ebene (der Hauptvektor ist die Normale).
 *
 * Optional: keepOriginal=true -> Union des Originals + Spiegels (fuer
 * symmetrische Bauteile aus einem Halb-Profil).
 */
export function mirrorShape(oc: any, shape: any, p: MirrorParams): any {
  return withScopeSync((scope) => {
    const origin = scope.track(new oc.gp_Pnt_3(
      p.originX ?? 0,
      p.originY ?? 0,
      p.originZ ?? 0,
    ));

    // Normale der Spiegelebene
    let normal: any;
    switch (p.plane) {
      case 'XZ': normal = scope.track(new oc.gp_Dir_4(0, 1, 0)); break; // YZ-Normale = X? no: XZ hat Y als Normale
      case 'YZ': normal = scope.track(new oc.gp_Dir_4(1, 0, 0)); break;
      case 'XY':
      default:   normal = scope.track(new oc.gp_Dir_4(0, 0, 1)); break;
    }

    const ax2 = scope.track(new oc.gp_Ax2_3(origin, normal));
    const trsf = scope.track(new oc.gp_Trsf_1());

    try {
      trsf.SetMirror_3(ax2);
    } catch {
      try {
        trsf.SetMirror(ax2);
      } catch (e) {
        throw new CadError({
          code: 'invalid_input',
          message: `mirrorShape: SetMirror API nicht gefunden`,
          details: String((e as Error)?.message ?? e),
        });
      }
    }

    return applyMirrorTransform(oc, scope, shape, trsf, p.keepOriginal === true);
  });
}

function applyMirrorTransform(oc: any, scope: any, shape: any, trsf: any, keepOriginal: boolean): any {
  let mirrored: any = null;
  try {
    mirrored = new oc.BRepBuilderAPI_Transform_2(shape, trsf, true);
    if (typeof mirrored.Build === 'function') {
      try {
        const pr = scope.track(new oc.Message_ProgressRange_1());
        mirrored.Build(pr);
      } catch { try { mirrored.Build(); } catch { /* auto-built */ } }
    }
    let done = true;
    try { done = typeof mirrored.IsDone !== 'function' || mirrored.IsDone(); } catch { done = true; }
    if (!done) {
      throw new CadError({ code: 'invalid_input', message: 'mirrorShape: BRepBuilderAPI_Transform IsDone()=false' });
    }
    const mirroredShape = mirrored.Shape();

    if (!keepOriginal) return mirroredShape;

    // Union original + gespiegelt
    let fuser: any = null;
    try {
      const pr = scope.track(new oc.Message_ProgressRange_1());
      fuser = new oc.BRepAlgoAPI_Fuse_3(shape, mirroredShape, pr);
    } catch {
      try { fuser = new oc.BRepAlgoAPI_Fuse_2(shape, mirroredShape); } catch { /* */ }
    }
    if (!fuser) {
      throw new CadError({ code: 'boolean_failed', message: 'mirrorShape: keepOriginal-Union fehlgeschlagen' });
    }
    let fuseDone = true;
    try { fuseDone = typeof fuser.IsDone !== 'function' || fuser.IsDone(); } catch { fuseDone = true; }
    if (!fuseDone) {
      try {
        const pr = scope.track(new oc.Message_ProgressRange_1());
        fuser.Build(pr);
      } catch { try { fuser.Build(); } catch { /* */ } }
    }
    return fuser.Shape();
  } finally {
    try { mirrored?.delete(); } catch { /* */ }
  }
}
