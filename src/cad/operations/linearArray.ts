// src/cad/operations/linearArray.ts
import { withScopeSync } from '../memoryScope';
import { CadError, type LinearArrayParams } from '../types';
import { booleanUnionN } from './booleanOps';

/**
 * Erstellt ein lineares Muster: `count` Kopien des Shapes, jeweils um
 * (dx, dy, dz) versetzt. Kopie 0 ist das Original an seinem Platz,
 * Kopie i sitzt bei Original + i*(dx, dy, dz).
 *
 * Alle Kopien werden zu einem einzigen Solid vereinigt.
 */
export function linearArray(oc: any, shape: any, p: LinearArrayParams): any {
  const count = Math.max(1, Math.round(p.count));
  if (count === 1) return shape;

  const shapes: any[] = [];
  const toDelete: any[] = [];

  try {
    for (let i = 0; i < count; i++) {
      if (i === 0) {
        shapes.push(shape);
        continue;
      }
      const copy = withScopeSync((scope) => {
        const trsf = scope.track(new oc.gp_Trsf_1());
        const vec = scope.track(new oc.gp_Vec_4(p.dx * i, p.dy * i, p.dz * i));
        try {
          trsf.SetTranslation_1(vec);
        } catch {
          try { trsf.SetTranslation(vec); } catch (e) {
            throw new CadError({
              code: 'invalid_input',
              message: 'linearArray: SetTranslation API nicht gefunden',
              details: String((e as Error)?.message ?? e),
            });
          }
        }
        let transformer: any = null;
        try {
          transformer = new oc.BRepBuilderAPI_Transform_2(shape, trsf, true);
          if (typeof transformer.Build === 'function') {
            try {
              const pr = scope.track(new oc.Message_ProgressRange_1());
              transformer.Build(pr);
            } catch { try { transformer.Build(); } catch { /* auto-built */ } }
          }
          let done = true;
          try { done = typeof transformer.IsDone !== 'function' || transformer.IsDone(); } catch { done = true; }
          if (!done) throw new CadError({ code: 'invalid_input', message: `linearArray: Transform IsDone()=false (i=${i})` });
          return transformer.Shape();
        } finally {
          try { transformer?.delete(); } catch { /* */ }
        }
      });
      shapes.push(copy);
      toDelete.push(copy);
    }

    return booleanUnionN(oc, shapes);
  } finally {
    for (const s of toDelete) {
      try { s.delete(); } catch { /* */ }
    }
  }
}
