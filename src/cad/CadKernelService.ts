// src/cad/CadKernelService.ts
// Main-Thread Singleton. Erzeugt den Worker und wickelt ihn in einen
// typsicheren Comlink-Proxy. Komponenten benutzen `kernel` direkt.

import * as Comlink from 'comlink';
import type { ICadKernel } from './types';

// Lazy: Worker erst beim ersten Zugriff starten. So bleibt der Initial-Load schnell.
let _kernel: Comlink.Remote<ICadKernel> | null = null;
let _worker: Worker | null = null;

export function getKernel(): Comlink.Remote<ICadKernel> {
  if (_kernel) return _kernel;

  _worker = new Worker(new URL('./kernel.worker.ts', import.meta.url), {
    type: 'module',
    name: 'cad-kernel',
  });

  _worker.addEventListener('error', (e) => {
    // eslint-disable-next-line no-console
    console.error('[CadKernel Worker] error event:', e.message, e.filename, e.lineno);
  });
  _worker.addEventListener('messageerror', (e) => {
    // eslint-disable-next-line no-console
    console.error('[CadKernel Worker] messageerror:', e);
  });

  _kernel = Comlink.wrap<ICadKernel>(_worker);
  return _kernel;
}

export function disposeKernel(): void {
  if (_worker) {
    _worker.terminate();
    _worker = null;
    _kernel = null;
  }
}
