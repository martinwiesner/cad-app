// src/cad/operations/booleanOps.ts
// Boolesche Operationen mit defensiver API-Erkennung.
//
// In opencascade.js v2.x sind die Konstruktor-Suffixe der BRepAlgoAPI_*-Klassen
// nicht konsistent zwischen Builds:
//   - Manche Builds haben (a, b, progress)         als _3-Suffix
//   - Manche haben nur (a, b)                      als _2-Suffix
//   - Manche haben default-Ctor + Arguments() + Tools()
//
// Wir probieren die wahrscheinlichsten Varianten in der Reihenfolge:
//   1. Ctor mit (a, b, ProgressRange)
//   2. Ctor mit (a, b)
//   3. Default-Ctor + SetArguments/SetTools (sehr alte API)
//
// Build() braucht zusaetzlich entweder einen ProgressRange oder gar nichts -
// auch das versuchen wir defensiv.

import { CadError } from '../types';

type BooleanCtor = (oc: any) => any;

interface OpConfig {
  label: string;
  ctorNames: string[];          // z.B. ['BRepAlgoAPI_Cut_3', 'BRepAlgoAPI_Cut_2', 'BRepAlgoAPI_Cut']
  errorCode: 'boolean_failed';
}

const DIFF: OpConfig = {
  label: 'difference',
  ctorNames: ['BRepAlgoAPI_Cut_3', 'BRepAlgoAPI_Cut_2', 'BRepAlgoAPI_Cut'],
  errorCode: 'boolean_failed',
};

const UNION: OpConfig = {
  label: 'union',
  ctorNames: ['BRepAlgoAPI_Fuse_3', 'BRepAlgoAPI_Fuse_2', 'BRepAlgoAPI_Fuse'],
  errorCode: 'boolean_failed',
};

const INTER: OpConfig = {
  label: 'intersection',
  ctorNames: ['BRepAlgoAPI_Common_3', 'BRepAlgoAPI_Common_2', 'BRepAlgoAPI_Common'],
  errorCode: 'boolean_failed',
};

export function booleanDifference(oc: any, base: any, tool: any): any {
  return runBoolean(oc, base, tool, DIFF);
}

export function booleanUnion(oc: any, a: any, b: any): any {
  return runBoolean(oc, a, b, UNION);
}

export function booleanIntersection(oc: any, a: any, b: any): any {
  return runBoolean(oc, a, b, INTER);
}

function runBoolean(oc: any, a: any, b: any, cfg: OpConfig): any {
  if (!a || a.IsNull?.()) {
    throw new CadError({ code: 'invalid_input', message: `${cfg.label}: erstes Shape ist null` });
  }
  if (!b || b.IsNull?.()) {
    throw new CadError({ code: 'invalid_input', message: `${cfg.label}: zweites Shape ist null` });
  }

  let op: any = null;
  let progress: any = null;

  try {
    progress = new oc.Message_ProgressRange_1();

    // Versuch 1: ctor mit (a, b, progress)
    op = tryCtor3(oc, cfg.ctorNames, a, b, progress);

    // Versuch 2: ctor mit (a, b)
    if (!op) {
      op = tryCtor2(oc, cfg.ctorNames, a, b);
    }

    // Versuch 3: default-ctor + SetArguments/SetTools (selten in OCJS, aber sicher ist sicher)
    if (!op) {
      op = tryCtorDefault(oc, cfg.ctorNames, a, b);
    }

    if (!op) {
      throw new CadError({
        code: cfg.errorCode,
        message: `${cfg.label}: kein passender Konstruktor unter ${cfg.ctorNames.join(', ')} gefunden`,
      });
    }

    // Direct ctors auto-build. IsDone() itself can throw a C++ exception on some
    // builds — wrap every call in try/catch and treat a throw as "already built".
    let alreadyBuilt = false;
    try { alreadyBuilt = typeof op.IsDone === 'function' && op.IsDone(); } catch { alreadyBuilt = true; }
    if (!alreadyBuilt) {
      runBuild(op, progress);
    }

    let opDone = true;
    try { opDone = typeof op.IsDone !== 'function' || op.IsDone(); } catch { opDone = true; }
    if (!opDone) {
      throw new CadError({
        code: cfg.errorCode,
        message: `${cfg.label}: IsDone() = false - Geometrien ueberlappen nicht? Selbstueberschneidungen?`,
      });
    }
    if (typeof op.HasErrors === 'function' && op.HasErrors()) {
      const reason = readErrorReason(op);
      throw new CadError({
        code: cfg.errorCode,
        message: `${cfg.label}: HasErrors() = true${reason ? ` (${reason})` : ''}`,
      });
    }

    const result = op.Shape();
    if (!result || (typeof result.IsNull === 'function' && result.IsNull())) {
      throw new CadError({
        code: 'empty_shape',
        message: `${cfg.label}: leeres Ergebnis-Shape (Geometrien beruehren sich nicht?)`,
      });
    }
    return result;
  } finally {
    try { op?.delete(); } catch { /* */ }
    try { progress?.delete(); } catch { /* */ }
  }
}

function tryCtor3(oc: any, names: string[], a: any, b: any, progress: any): any {
  for (const name of names) {
    const ctor = oc[name];
    if (typeof ctor !== 'function') continue;
    try {
      return new ctor(a, b, progress);
    } catch { /* weiter */ }
  }
  return null;
}

function tryCtor2(oc: any, names: string[], a: any, b: any): any {
  for (const name of names) {
    const ctor = oc[name];
    if (typeof ctor !== 'function') continue;
    try {
      return new ctor(a, b);
    } catch { /* weiter */ }
  }
  return null;
}

function tryCtorDefault(oc: any, names: string[], a: any, b: any): any {
  for (const name of names) {
    const ctor = oc[name];
    if (typeof ctor !== 'function') continue;
    try {
      const op = new ctor();
      // Argumente setzen - braucht TopTools_ListOfShape
      try {
        const argsList = new oc.TopTools_ListOfShape_1();
        const toolsList = new oc.TopTools_ListOfShape_1();
        argsList.Append_1(a);
        toolsList.Append_1(b);
        op.SetArguments(argsList);
        op.SetTools(toolsList);
        // Listen sind nun owned by op (?) - vorsichtig nicht loeschen
        return op;
      } catch {
        try { op.delete(); } catch { /* */ }
      }
    } catch { /* weiter */ }
  }
  return null;
}

function runBuild(op: any, progress: any): void {
  // Variante A: Build(progress)
  try {
    op.Build(progress);
    return;
  } catch { /* */ }
  // Variante B: Build() ohne Argumente
  try {
    op.Build();
    return;
  } catch (e) {
    throw new CadError({
      code: 'boolean_failed',
      message: 'Build() Variante nicht aufrufbar',
      details: String((e as Error)?.message ?? e),
    });
  }
}

function readErrorReason(op: any): string {
  // OCCT bietet DumpErrors etc. - die Implementation variiert. Wir versuchen
  // nur die uebliche StatusCode-Methode.
  try {
    if (typeof op.ErrorStatus === 'function') return `status=${op.ErrorStatus()}`;
  } catch { /* */ }
  return '';
}

// ---------------------------------------------------------------------------
//   Multi-Shape Reduktion (z.B. fuer Vararg-Union)
// ---------------------------------------------------------------------------

/** Reduziert eine Liste auf eine Vereinigung. */
export function booleanUnionN(oc: any, shapes: any[]): any {
  if (shapes.length === 0) throw new CadError({ code: 'invalid_input', message: 'booleanUnionN: leere Liste' });
  if (shapes.length === 1) return shapes[0];
  let acc = shapes[0];
  const intermediates: any[] = [];
  for (let i = 1; i < shapes.length; i++) {
    const next = booleanUnion(oc, acc, shapes[i]);
    if (i > 1) intermediates.push(acc);  // den ersten NICHT loeschen, der kam von aussen
    acc = next;
  }
  for (const s of intermediates) {
    try { s.delete(); } catch { /* */ }
  }
  return acc;
}
