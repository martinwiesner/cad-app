// src/cad/operations/extrudePolygon.ts
import { CadError } from '../types';

export interface ExtrudePolygonParams {
  /** 2D-Punkte als flaches Array: [x0, y0, x1, y1, x2, y2, ...]
   *  Polygon wird automatisch geschlossen (letzter Punkt zu erstem). */
  points: number[];
  /** Extrusionshoehe */
  height: number;
  /** Wo das Polygon liegt (Default: XY-Ebene auf Z=0) */
  baseZ?: number;
  /** Extrusionsrichtung: 'z' = nach oben, 'x' = in X, 'y' = in Y */
  direction?: 'x' | 'y' | 'z';
}

/**
 * Extrudiert ein 2D-Polygon zu einem 3D-Solid.
 *
 * Workflow:
 *   1. gp_Pnt-Liste aus 2D-Koordinaten
 *   2. BRepBuilderAPI_MakePolygon  -> TopoDS_Wire (geschlossen)
 *   3. BRepBuilderAPI_MakeFace     -> TopoDS_Face
 *   4. BRepPrimAPI_MakePrism       -> Solid
 *
 * API-NAME PRÜFEN:
 *   - BRepBuilderAPI_MakePolygon_1 (default ctor), dann .Add(gp_Pnt) und .Close()
 *   - BRepBuilderAPI_MakeFace_15(wire, onlyPlane=false) ODER MakeFace_8
 *   - BRepPrimAPI_MakePrism_1(shape, gp_Vec)
 */
export function extrudePolygon(oc: any, params: ExtrudePolygonParams): any {
  const { points, height, baseZ = 0, direction = 'z' } = params;

  if (points.length < 6 || points.length % 2 !== 0) {
    throw new CadError({
      code: 'invalid_input',
      message: `extrudePolygon: brauche mindestens 3 Punkte als [x0,y0, x1,y1, ...] (got ${points.length / 2})`,
    });
  }
  if (!(height > 0)) {
    throw new CadError({ code: 'invalid_input', message: `extrudePolygon: height muss > 0 sein (${height})` });
  }

  // Track all OCCT-Objekte fuer cleanup
  const trash: any[] = [];

  try {
    // Polygon aus Punkten bauen
    let polygon: any;
    try {
      polygon = new oc.BRepBuilderAPI_MakePolygon_1();
    } catch (e) {
      throw new CadError({
        code: 'invalid_input',
        message: 'extrudePolygon: BRepBuilderAPI_MakePolygon nicht verfuegbar',
        details: String((e as Error)?.message ?? e),
      });
    }
    trash.push(polygon);

    for (let i = 0; i < points.length; i += 2) {
      const x = points[i];
      const y = points[i + 1];
      // Wir legen das Polygon in die Ebene, die durch baseZ definiert ist.
      // Bei direction='z': Polygon liegt in XY, extrudiert in Z
      // Bei direction='x': Polygon liegt in YZ, extrudiert in X  (Tausch der Achsen)
      // Bei direction='y': Polygon liegt in XZ, extrudiert in Y
      let pnt: any;
      switch (direction) {
        case 'x': pnt = new oc.gp_Pnt_3(baseZ, x, y); break;
        case 'y': pnt = new oc.gp_Pnt_3(x, baseZ, y); break;
        case 'z':
        default:  pnt = new oc.gp_Pnt_3(x, y, baseZ); break;
      }
      try {
        polygon.Add_1(pnt);
      } catch {
        try { polygon.Add(pnt); } catch (e) {
          try { pnt.delete(); } catch { /* */ }
          throw new CadError({
            code: 'invalid_input',
            message: 'extrudePolygon: polygon.Add API nicht gefunden',
            details: String((e as Error)?.message ?? e),
          });
        }
      }
      try { pnt.delete(); } catch { /* */ }
    }

    // Schliessen
    polygon.Close();

    // Wire holen
    const wire = polygon.Wire();
    // Wire ist eine eigene Allokation - NICHT trashen, faceMaker uebernimmt es nicht.
    // Wir loeschen wire am Ende explizit.

    if (!wire || (typeof wire.IsNull === 'function' && wire.IsNull())) {
      throw new CadError({ code: 'invalid_input', message: 'extrudePolygon: Wire() returned null — Polygon ungueltig?' });
    }

    // Face aus Wire — Suffix-Nummerierung variiert je nach OCCT/opencascade.js-Build.
    // Wir probieren alle bekannten Varianten die (wire, bool) oder (wire) akzeptieren.
    let faceMaker: any = null;
    const wireSuffixes = ['_15', '_8', '_9', '_16', '_14', '_7', '_6', ''];
    for (const sfx of wireSuffixes) {
      const ctorName = `BRepBuilderAPI_MakeFace${sfx}`;
      if (typeof oc[ctorName] !== 'function') continue;
      try { faceMaker = new oc[ctorName](wire, false); break; } catch { /* */ }
      try { faceMaker = new oc[ctorName](wire); break; } catch { /* */ }
    }
    if (!faceMaker) {
      const available = Object.keys(oc).filter((k) => k.startsWith('BRepBuilderAPI_MakeFace')).join(', ');
      try { wire.delete(); } catch { /* */ }
      throw new CadError({
        code: 'invalid_input',
        message: `extrudePolygon: kein MakeFace-Ctor mit Wire gefunden (verfuegbar: ${available || 'keine'})`,
      });
    }
    trash.push(faceMaker);

    // Direct ctors auto-build; only call Build() if not already done.
    if (typeof faceMaker.IsDone !== 'function' || !faceMaker.IsDone()) {
      try {
        const pr = new oc.Message_ProgressRange_1();
        try { faceMaker.Build(pr); } finally { try { pr.delete(); } catch { /* */ } }
      } catch { /* */ }
    }
    if (typeof faceMaker.IsDone === 'function' && !faceMaker.IsDone()) {
      try { wire.delete(); } catch { /* */ }
      throw new CadError({
        code: 'invalid_input',
        message: 'extrudePolygon: Face konnte nicht erzeugt werden (Polygon selbstueberschneidend?)',
      });
    }

    const face = faceMaker.Face();
    try { wire.delete(); } catch { /* */ }
    // face gehoert uns - trashen
    trash.push(face);

    // Extrusionsvektor
    let vec: any;
    switch (direction) {
      case 'x': vec = new oc.gp_Vec_4(height, 0, 0); break;
      case 'y': vec = new oc.gp_Vec_4(0, height, 0); break;
      case 'z':
      default:  vec = new oc.gp_Vec_4(0, 0, height); break;
    }
    trash.push(vec);

    // Prism: face entlang vec extrudieren
    let prism: any;
    try {
      prism = new oc.BRepPrimAPI_MakePrism_1(face, vec, false, true);
    } catch {
      try {
        prism = new oc.BRepPrimAPI_MakePrism_2(face, vec);
      } catch (e) {
        throw new CadError({
          code: 'invalid_input',
          message: 'extrudePolygon: kein MakePrism-Ctor gefunden',
          details: String((e as Error)?.message ?? e),
        });
      }
    }
    trash.push(prism);

    // Direct ctors auto-build; only call Build() if not already done.
    if (typeof prism.IsDone !== 'function' || !prism.IsDone()) {
      try {
        const pr = new oc.Message_ProgressRange_1();
        try { prism.Build(pr); } finally { try { pr.delete(); } catch { /* */ } }
      } catch { /* */ }
    }
    if (typeof prism.IsDone === 'function' && !prism.IsDone()) {
      throw new CadError({ code: 'invalid_input', message: 'extrudePolygon: Prism IsDone()=false' });
    }

    return prism.Shape();
  } finally {
    for (let i = trash.length - 1; i >= 0; i--) {
      try { trash[i].delete(); } catch { /* */ }
    }
  }
}
