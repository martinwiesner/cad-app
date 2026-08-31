// src/cad/stlImport.ts
import { CadError } from './types';

/**
 * Liest STL-Bytes ein und liefert ein TopoDS_Shape.
 *
 * STL enthaelt nur ein Dreiecksnetz, keine parametrischen Flaechen/Kanten -
 * das Ergebnis ist ein reines Mesh-Shape. Es laesst sich positionieren,
 * transformieren und darstellen wie jedes andere Shape, aber Boolesche
 * Operationen/Fillets etc. koennen fehlschlagen, weil OCCT dafuer echte
 * BRep-Geometrie erwartet (siehe Statuslog nach dem Import).
 *
 * Pipeline:
 *   1. Bytes ins Emscripten-FS schreiben (oc.FS.writeFile)
 *   2. Leeres TopoDS_Shape anlegen
 *   3. StlAPI_Reader().Read(shape, filename) fuellt es
 *   4. Temp-File aus FS loeschen
 */
export function importStlBytes(oc: any, bytes: Uint8Array): any {
  // Eindeutiger Dateiname - egal wo im virtuellen FS
  const filename = `/import_${Date.now()}_${Math.floor(Math.random() * 1e9).toString(36)}.stl`;

  try {
    oc.FS.writeFile(filename, bytes);
  } catch (e) {
    throw new CadError({
      code: 'stl_parse_failed',
      message: 'STL: konnte Datei nicht ins WASM-FS schreiben',
      details: String((e as Error)?.message ?? e),
    });
  }

  const shape = new oc.TopoDS_Shape();
  const reader = new oc.StlAPI_Reader();
  try {
    let ok = false;
    try {
      ok = reader.Read(shape, filename);
    } catch (e) {
      throw new CadError({
        code: 'stl_parse_failed',
        message: 'STL: Read() schlug fehl',
        details: String((e as Error)?.message ?? e),
      });
    }

    if (!ok || shape.IsNull?.()) {
      throw new CadError({ code: 'empty_shape', message: 'STL: Read() lieferte kein gueltiges Shape' });
    }
    return shape;
  } finally {
    try { reader.delete(); } catch { /* ignore */ }
    try { oc.FS.unlink(filename); } catch { /* ignore */ }
  }
}
