// src/cad/stepPrecision.ts
// Reduziert die Ziffern-Praezision von STEP-Dateien (nur fuers Teilen relevant,
// nicht fuer den kanonischen gespeicherten Asset-Text).
//
// Viele CAD-Programme exportieren Koordinaten mit 15-17 signifikanten Stellen,
// weit mehr als bei mm-massstaeblichen Bauteilen sinnvoll ist. Das Runden auf
// z.B. 7 signifikante Stellen (Sub-Mikrometer-Genauigkeit bei mm-Groessen)
// verkuerzt den ASCII-Text spuerbar und komprimiert danach auch besser, weil
// die Zahlen kuerzer und repetitiver werden.
//
// STEP (ISO-10303-21) Grammatik-Fakten, auf denen das hier aufbaut:
//   - String-Literale stehen in einfachen Anfuehrungszeichen, ein Zeichen ''
//     innerhalb eines Strings steht fuer ein escaptes '.
//   - "Real"-Literale enthalten IMMER einen Punkt (z.B. "5.", ".5", "1.23E+02").
//     Integer-Literale (Zaehler, Aufzaehlungswerte) und Entity-Referenzen (#123)
//     haben nie einen Punkt. Ein Regex, der nur Tokens mit "." matcht, trifft
//     also nie versehentlich einen Integer oder eine Entity-Referenz.
//
// Sicherheitsnetz: kuerzere Darstellung wird nur uebernommen, wenn sie
// tatsaechlich kuerzer ist als das Original - kurze/bereits kompakte Zahlen
// werden also nie kuenstlich aufgeblaeht.

const STEP_TOKEN_RE = /'(?:[^']|'')*'|(-?\d*\.\d+(?:[eE][+-]?\d+)?|-?\d+\.\d*(?:[eE][+-]?\d+)?)/g;

function roundSignificant(numStr: string, sigDigits: number): string {
  const num = Number(numStr);
  if (!Number.isFinite(num)) return numStr;
  if (num === 0) return numStr.startsWith('-') ? '-0.' : '0.';

  let s = num.toPrecision(sigDigits);

  if (s.includes('e') || s.includes('E')) {
    const [mantissaRaw, expRaw] = s.split(/[eE]/);
    const mantissa = mantissaRaw.includes('.') ? mantissaRaw : `${mantissaRaw}.`;
    const exp = expRaw.startsWith('+') || expRaw.startsWith('-') ? expRaw : `+${expRaw}`;
    s = `${mantissa}E${exp}`;
  } else if (!s.includes('.')) {
    s += '.';
  }
  return s;
}

/** Rundet alle Real-Literale in einem STEP-Text auf `sigDigits` signifikante Stellen. */
export function roundStepPrecision(text: string, sigDigits = 7): string {
  return text.replace(STEP_TOKEN_RE, (match, numGroup: string | undefined) => {
    if (numGroup === undefined) return match; // String-Literal - unangetastet lassen
    const rounded = roundSignificant(numGroup, sigDigits);
    return rounded.length < numGroup.length ? rounded : numGroup;
  });
}

/** true, wenn Dateiname/Mime auf eine (Text-)STEP-Datei hindeuten. */
export function looksLikeStepAsset(filename: string, mime: string): boolean {
  return /\.(step|stp)$/i.test(filename) || mime.toLowerCase() === 'application/step';
}

/**
 * Wendet die Praezisionsreduktion auf STEP-Asset-Bytes an - mit Fallback auf
 * die Original-Bytes bei jedem unerwarteten Fehler (z.B. Encoding-Problem).
 * Nur fuers Teilen gedacht, veraendert nie den kanonisch gespeicherten Asset.
 */
export function compactStepBytesForShare(bytes: Uint8Array, sigDigits = 7): Uint8Array {
  try {
    const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    const compacted = roundStepPrecision(text, sigDigits);
    const compactedBytes = new TextEncoder().encode(compacted);
    return compactedBytes.byteLength < bytes.byteLength ? compactedBytes : bytes;
  } catch {
    return bytes;
  }
}
