// src/cad/stepImport.ts
import { CadError } from './types';

/**
 * Liest STEP-Bytes ein und liefert ein TopoDS_Shape.
 *
 * Pipeline:
 *   1. Bytes ins Emscripten-FS schreiben (oc.FS.writeFile)
 *   2. STEPControl_Reader_1() instanziieren
 *   3. ReadFile(filename) -> IFSelect_ReturnStatus
 *   4. TransferRoots(progress) (oder ohne progress, je nach Version)
 *   5. OneShape() -> kombinierter Compound
 *   6. Temp-File aus FS loeschen
 */
export function importStepBytes(oc: any, bytes: Uint8Array): any {
  // Eindeutiger Dateiname - egal wo im virtuellen FS
  const filename = `/import_${Date.now()}_${Math.floor(Math.random() * 1e9).toString(36)}.step`;

  try {
    oc.FS.writeFile(filename, bytes);
  } catch (e) {
    throw new CadError({
      code: 'step_parse_failed',
      message: 'STEP: konnte Datei nicht ins WASM-FS schreiben',
      details: String((e as Error)?.message ?? e),
    });
  }

  const reader = new oc.STEPControl_Reader_1();
  try {
    const status = reader.ReadFile(filename);
    // IFSelect_RetDone = 1 in der OCCT-Konvention - wir vergleichen via Enum
    const ok = status === oc.IFSelect_ReturnStatus.IFSelect_RetDone;
    if (!ok) {
      throw new CadError({
        code: 'step_parse_failed',
        message: `STEP: ReadFile returned status ${status} (erwartet: IFSelect_RetDone)`,
      });
    }

    // TransferRoots: in neueren OCCT erwartet ein Message_ProgressRange.
    // Fallback: ohne Argument versuchen.
    let transferred = 0;
    const progress = new oc.Message_ProgressRange_1();
    try {
      transferred = reader.TransferRoots(progress);
    } catch {
      try {
        // @ts-ignore - Versuch ohne Progress (aeltere API)
        transferred = reader.TransferRoots();
      } catch (e) {
        throw new CadError({
          code: 'step_parse_failed',
          message: 'STEP: TransferRoots schlug fehl in beiden API-Varianten',
          details: String((e as Error)?.message ?? e),
        });
      }
    } finally {
      try { progress.delete(); } catch { /* ignore */ }
    }

    if (transferred === 0) {
      throw new CadError({ code: 'empty_shape', message: 'STEP: 0 Roots transferiert' });
    }

    const shape = reader.OneShape();
    if (shape.IsNull?.()) {
      throw new CadError({ code: 'empty_shape', message: 'STEP: OneShape() = null' });
    }
    return shape;
  } finally {
    try { reader.delete(); } catch { /* ignore */ }
    try { oc.FS.unlink(filename); } catch { /* ignore */ }
  }
}
