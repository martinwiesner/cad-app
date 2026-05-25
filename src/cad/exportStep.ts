// src/cad/exportStep.ts
// STEP-Export ueber STEPControl_Writer. Der Writer schreibt in das Emscripten-FS,
// von wo wir die Bytes wieder einlesen.
//
// API-NAME PRÜFEN (variiert zwischen OCCT-Versionen):
//   - STEPControl_Writer_1()             default Ctor
//   - writer.Transfer(shape, STEPControl_StepModelType.STEPControl_AsIs[, progress])
//        Schemata: AsIs, ManifoldSolidBrep, BrepWithVoids, FacettedBrep, ShellBasedSurfaceModel
//   - writer.Write(filename) -> IFSelect_ReturnStatus
//   - IFSelect_RetDone = Erfolg
//
// Optional vorab: Interface_Static.SetCVal("write.step.schema", "AP214") setzt den AP-Mode.
// Default in OCCT ist normalerweise AP214 - wir lassen das so.

import { CadError } from './types';

export function exportStepBytes(oc: any, shape: any): Uint8Array {
  if (!shape || shape.IsNull?.()) {
    throw new CadError({ code: 'invalid_input', message: 'exportStep: shape is null' });
  }

  // Filename ins Emscripten-FS
  const filename = `export_${Date.now()}_${Math.random().toString(36).slice(2)}.step`;

  let writer: any = null;
  try {
    // Versuch 1: STEPControl_Writer_1
    try {
      writer = new oc.STEPControl_Writer_1();
    } catch {
      // Versuch 2: ohne Suffix
      writer = new oc.STEPControl_Writer();
    }

    // Transfer - mehrere Signaturen probieren
    const modelType = oc.STEPControl_StepModelType?.STEPControl_AsIs ?? 0;
    let transferStatus: number | undefined;

    // Variante mit ProgressRange (neuere OCCT)
    try {
      const pr = new oc.Message_ProgressRange_1();
      try {
        transferStatus = writer.Transfer(shape, modelType, true, pr);
      } catch {
        // Variante ohne 'finite' bool
        transferStatus = writer.Transfer(shape, modelType, pr);
      } finally {
        try { pr.delete(); } catch { /* */ }
      }
    } catch {
      // Variante ohne ProgressRange
      try {
        transferStatus = writer.Transfer(shape, modelType);
      } catch (e) {
        throw new CadError({
          code: 'invalid_input',
          message: 'exportStep: Transfer-Signatur nicht erkannt',
          details: String((e as Error)?.message ?? e),
        });
      }
    }

    if (transferStatus !== undefined) {
      const done = oc.IFSelect_ReturnStatus?.IFSelect_RetDone ?? 1;
      if (transferStatus !== done) {
        throw new CadError({
          code: 'invalid_input',
          message: `exportStep: Transfer fehlgeschlagen (status=${transferStatus})`,
        });
      }
    }

    // Datei in MEMFS schreiben
    const writeStatus = writer.Write(filename);
    const done = oc.IFSelect_ReturnStatus?.IFSelect_RetDone ?? 1;
    if (writeStatus !== done) {
      throw new CadError({
        code: 'invalid_input',
        message: `exportStep: Write fehlgeschlagen (status=${writeStatus})`,
      });
    }

    // Bytes auslesen
    let bytes: Uint8Array;
    try {
      bytes = oc.FS.readFile(filename) as Uint8Array;
    } catch (e) {
      throw new CadError({
        code: 'invalid_input',
        message: 'exportStep: konnte geschriebene Datei nicht lesen',
        details: String((e as Error)?.message ?? e),
      });
    }

    // Kopie in einen normalen Uint8Array (FS.readFile liefert manchmal eine
    // Heap-View, die beim FS.unlink ungueltig wird)
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);

    try { oc.FS.unlink(filename); } catch { /* */ }
    return copy;
  } finally {
    try { writer?.delete(); } catch { /* */ }
  }
}
