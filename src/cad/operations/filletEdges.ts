// src/cad/operations/filletEdges.ts
import { CadError } from '../types';
import { computeEdgeId } from '../edgeExtraction';

/**
 * Fillet auf bestimmte Kanten (per stabile edgeIds).
 *
 * Vorgehen:
 *   1. TopExp_Explorer ueber alle Kanten
 *   2. Pro Kante: edgeId berechnen (via computeEdgeId - dieselbe Funktion wie in edgeExtraction)
 *   3. Wenn die edgeId in der Auswahl-Liste ist: zum Maker hinzufuegen
 *   4. Shared Edges werden ueber seenIds dedupliziert (Shared Edges erscheinen sonst doppelt)
 *
 * Liefert zusaetzlich foundIds / missingIds, damit die UI dem Nutzer zeigen
 * kann ob alle ausgewaehlten Kanten noch existieren.
 */
export function filletSelectedEdges(
  oc: any,
  shape: any,
  edgeIds: string[],
  radius: number,
): { shape: any; foundIds: string[]; missingIds: string[] } {
  return applySelective(oc, shape, edgeIds, {
    label: 'fillet',
    invalidCode: 'fillet_too_large',
    paramName: 'radius',
    paramValue: radius,
    makerCtor: (oc, s) => buildFilletMaker(oc, s),
  });
}

export function chamferSelectedEdges(
  oc: any,
  shape: any,
  edgeIds: string[],
  distance: number,
): { shape: any; foundIds: string[]; missingIds: string[] } {
  return applySelective(oc, shape, edgeIds, {
    label: 'chamfer',
    invalidCode: 'chamfer_failed',
    paramName: 'distance',
    paramValue: distance,
    makerCtor: (oc, s) => buildChamferMaker(oc, s),
  });
}

/**
 * BRepFilletAPI_MakeFillet hat je nach OCCT-Version unterschiedliche Konstruktoren:
 *   - (shape)                              <- alte API
 *   - (shape, ChFi3d_FilletShape)          <- neuere API, Default: ChFi3d_Rational
 *
 * Wir probieren beide. Wenn der 1-Parameter-Ctor fehlt, koennen wir nicht direkt
 * einen Konstruktor-Fehler abfangen (Embind wirft VOR dem JS-Konstruktor), darum
 * checken wir vorher ob das Enum vorhanden ist.
 *
 * API-NAME PRÜFEN:
 *   - oc.ChFi3d_FilletShape.ChFi3d_Rational (oder _Polynomial / _QuasiAngular)
 */
function buildFilletMaker(oc: any, shape: any): any {
  // Versuch 1: 2-Parameter-Ctor (neuere API)
  if (oc.ChFi3d_FilletShape && oc.ChFi3d_FilletShape.ChFi3d_Rational !== undefined) {
    try {
      return new oc.BRepFilletAPI_MakeFillet(shape, oc.ChFi3d_FilletShape.ChFi3d_Rational);
    } catch { /* faellt durch */ }
  }
  // Versuch 2: 1-Parameter-Ctor (alte API)
  try {
    return new oc.BRepFilletAPI_MakeFillet(shape);
  } catch (e) {
    throw new CadError({
      code: 'fillet_too_large',
      message: 'fillet: BRepFilletAPI_MakeFillet-Konstruktor nicht aufrufbar',
      details: String((e as Error)?.message ?? e),
    });
  }
}

/**
 * BRepFilletAPI_MakeChamfer hat in den meisten Versionen nur den 1-Parameter-Ctor,
 * aber zur Sicherheit machen wir es symmetrisch.
 */
function buildChamferMaker(oc: any, shape: any): any {
  try {
    return new oc.BRepFilletAPI_MakeChamfer(shape);
  } catch (e) {
    throw new CadError({
      code: 'chamfer_failed',
      message: 'chamfer: BRepFilletAPI_MakeChamfer-Konstruktor nicht aufrufbar',
      details: String((e as Error)?.message ?? e),
    });
  }
}

interface OpConfig {
  label: string;
  invalidCode: 'fillet_too_large' | 'chamfer_failed';
  paramName: string;
  paramValue: number;
  makerCtor: (oc: any, shape: any) => any;
}

function applySelective(
  oc: any,
  shape: any,
  edgeIds: string[],
  cfg: OpConfig,
): { shape: any; foundIds: string[]; missingIds: string[] } {
  if (!(cfg.paramValue > 0)) {
    throw new CadError({
      code: 'invalid_input',
      message: `${cfg.label}: ${cfg.paramName} muss > 0 sein (${cfg.paramValue})`,
    });
  }
  if (edgeIds.length === 0) {
    throw new CadError({ code: 'invalid_input', message: `${cfg.label}: keine Kanten ausgewaehlt` });
  }

  const wanted = new Set(edgeIds);
  const foundIds: string[] = [];
  const seenIds = new Set<string>();
  let addedToMaker = 0;

  const maker = cfg.makerCtor(oc, shape);
  const exp = new oc.TopExp_Explorer_2(
    shape,
    oc.TopAbs_ShapeEnum.TopAbs_EDGE,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
  );

  try {
    while (exp.More()) {
      const e = oc.TopoDS.Edge_1(exp.Current());
      const id = computeEdgeId(oc, e);
      if (id && !seenIds.has(id)) {
        seenIds.add(id);
        if (wanted.has(id)) {
          addToMaker(oc, maker, cfg, e);
          foundIds.push(id);
          addedToMaker++;
        }
      }
      exp.Next();
    }
  } finally {
    try { exp.delete(); } catch { /* */ }
  }

  const missingIds = edgeIds.filter((id) => !foundIds.includes(id));

  if (addedToMaker === 0) {
    try { maker.delete(); } catch { /* */ }
    throw new CadError({
      code: 'invalid_input',
      message: `${cfg.label}: keine der ${edgeIds.length} ausgewaehlten Kanten gefunden (Topologie geaendert?)`,
    });
  }

  try {
    const pr = new oc.Message_ProgressRange_1();
    try { maker.Build(pr); } finally { try { pr.delete(); } catch { /* */ } }
  } catch { /* manche Builds bauen automatisch */ }

  if (!maker.IsDone()) {
    try { maker.delete(); } catch { /* */ }
    throw new CadError({
      code: cfg.invalidCode,
      message: `${cfg.label}: IsDone() = false (${cfg.paramName} zu gross fuer Geometrie?)`,
    });
  }
  const out = maker.Shape();
  try { maker.delete(); } catch { /* */ }
  return { shape: out, foundIds, missingIds };
}

function addToMaker(oc: any, maker: any, cfg: OpConfig, edge: any): void {
  // API-NAME PRÜFEN: Add_2(value, edge) - kann je nach Version variieren
  try { maker.Add_2(cfg.paramValue, edge); return; } catch { /* */ }
  try { maker.Add(cfg.paramValue, edge); return; } catch (e) {
    throw new CadError({
      code: 'invalid_input',
      message: `${cfg.label}: Add(${cfg.paramName}, edge) API nicht gefunden`,
      details: String((e as Error)?.message ?? e),
    });
  }
}
