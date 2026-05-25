// src/cad/operations/holePattern.ts
import { CadError } from '../types';
import { createCylinder } from './createCylinder';
import { booleanDifference } from './booleanOps';

export interface HolePatternParams {
  /** Bohrlochdurchmesser */
  diameter: number;
  /** Tiefe (=Hoehe der Subtraktionszylinder). Bei through=true wird sie automatisch +overhead gerechnet. */
  depth: number;
  /** Wenn true: Loch geht ganz durch (Tiefe wird automatisch ueberschritten). */
  through?: boolean;
  /** Wieviele Loecher in X-Richtung */
  countX: number;
  /** Wieviele Loecher in Y-Richtung */
  countY: number;
  /** Abstand zwischen Loechern in X */
  spacingX: number;
  /** Abstand zwischen Loechern in Y */
  spacingY: number;
  /** Position des ersten Loches (untere linke Ecke des Patterns) */
  originX: number;
  originY: number;
  originZ: number;
  /** Bohrachse */
  axis?: 'x' | 'y' | 'z';
}

/**
 * Erzeugt ein Raster aus Bohrungen und zieht alle vom Base-Shape ab.
 *
 * Wir machen das iterativ: pro Bohrung ein Difference. Das ist langsamer als
 * ein einziger Compound-Cut, dafuer robust - wenn eine einzelne Bohrung
 * fehlschlaegt (z.B. weil sie ganz ausserhalb des Shapes liegt), brechen wir
 * NICHT komplett ab, sondern ueberspringen sie und loggen eine Warnung.
 */
export function applyHolePattern(oc: any, base: any, p: HolePatternParams): any {
  const {
    diameter, depth, through = false,
    countX, countY, spacingX, spacingY,
    originX, originY, originZ,
    axis = 'z',
  } = p;

  if (!(diameter > 0)) throw new CadError({ code: 'invalid_input', message: `holePattern: diameter > 0 noetig (${diameter})` });
  if (!(depth > 0)) throw new CadError({ code: 'invalid_input', message: `holePattern: depth > 0 noetig (${depth})` });
  if (countX < 1 || countY < 1) throw new CadError({ code: 'invalid_input', message: 'holePattern: count >= 1' });
  if (countX * countY > 500) {
    throw new CadError({
      code: 'invalid_input',
      message: `holePattern: ${countX * countY} Loecher zu viele (max 500, sonst dauert es Minuten)`,
    });
  }

  const radius = diameter / 2;
  const cylDepth = through ? depth + 10 : depth;  // Through = bisschen Ueberhang fuer sauberes Cutten
  const cylZOffset = through ? -5 : 0;

  let current = base;
  let intermediates: any[] = [];   // Zwischenshapes, die wir am Ende loeschen
  let failedCount = 0;

  try {
    for (let iy = 0; iy < countY; iy++) {
      for (let ix = 0; ix < countX; ix++) {
        let cx = originX, cy = originY, cz = originZ;
        if (axis === 'z') {
          cx = originX + ix * spacingX;
          cy = originY + iy * spacingY;
          cz = originZ + cylZOffset;
        } else if (axis === 'x') {
          cx = originX + cylZOffset;
          cy = originY + ix * spacingX;
          cz = originZ + iy * spacingY;
        } else if (axis === 'y') {
          cx = originX + ix * spacingX;
          cy = originY + cylZOffset;
          cz = originZ + iy * spacingY;
        }

        let cyl: any = null;
        let next: any = null;
        try {
          cyl = createCylinder(oc, { radius, height: cylDepth, x: cx, y: cy, z: cz, axis });
          next = booleanDifference(oc, current, cyl);
        } catch (e) {
          // Eine einzelne Bohrung schlug fehl - behalten current, loeschen cyl, weiter
          failedCount++;
          if (cyl) { try { cyl.delete(); } catch { /* */ } }
          continue;
        }
        // cyl freigeben - nicht mehr noetig
        try { cyl.delete(); } catch { /* */ }

        // current wird zu next - aber das alte current evtl. loeschen
        if (current !== base) intermediates.push(current);
        current = next;
      }
    }

    if (failedCount > 0) {
      // eslint-disable-next-line no-console
      console.warn(`[holePattern] ${failedCount} Bohrung(en) fehlgeschlagen, ueberspringe`);
    }

    return current;
  } catch (e) {
    // Bei totalem Crash: aufraeumen
    if (current !== base) { try { current.delete(); } catch { /* */ } }
    throw e;
  } finally {
    // Zwischenergebnisse freigeben (das Endergebnis = current ist NICHT drin)
    for (const s of intermediates) {
      try { s.delete(); } catch { /* */ }
    }
  }
}
