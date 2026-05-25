// src/cad/memoryScope.ts
// OpenCascade.js Objekte leben im WASM-Heap. Ohne .delete() leaken sie.
// Dieser Scope sammelt alle Zwischenergebnisse einer Operation ein und
// gibt sie am Ende deterministisch wieder frei.
// WICHTIG: Das ZURUECKGEGEBENE Endergebnis (z.B. das Shape einer Box)
// darf NICHT im Scope getrackt sein - sonst wird es geloescht bevor der Caller
// es benutzen kann.

export interface Disposable {
  delete(): void;
}

export class MemoryScope {
  private items: Disposable[] = [];

  track<T extends Disposable>(obj: T): T {
    this.items.push(obj);
    return obj;
  }

  /**
   * Markiert ein Objekt als "uebergeben" - es wird NICHT mehr beim dispose
   * geloescht. Nuetzlich wenn ein Zwischenergebnis doch zum Endergebnis wird.
   */
  release<T extends Disposable>(obj: T): T {
    const idx = this.items.indexOf(obj);
    if (idx >= 0) this.items.splice(idx, 1);
    return obj;
  }

  dispose(): void {
    // In umgekehrter Reihenfolge freigeben (RAII-Konvention)
    for (let i = this.items.length - 1; i >= 0; i--) {
      try {
        this.items[i].delete();
      } catch (e) {
        // Vermutlich schon geloescht oder kein delete() vorhanden - ignorieren
        // eslint-disable-next-line no-console
        console.warn('[MemoryScope] dispose failed for item', i, e);
      }
    }
    this.items.length = 0;
  }
}

/** Asynchrone Variante - fuer Operationen die awaits enthalten. */
export async function withScope<T>(fn: (scope: MemoryScope) => Promise<T> | T): Promise<T> {
  const scope = new MemoryScope();
  try {
    return await fn(scope);
  } finally {
    scope.dispose();
  }
}

/** Synchrone Variante - fuer reine OCCT-Aufrufe ohne await. */
export function withScopeSync<T>(fn: (scope: MemoryScope) => T): T {
  const scope = new MemoryScope();
  try {
    return fn(scope);
  } finally {
    scope.dispose();
  }
}
