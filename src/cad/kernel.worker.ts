// src/cad/kernel.worker.ts
// Worker-Entry. Wird vom Main-Thread via:
//   new Worker(new URL('./kernel.worker.ts', import.meta.url), { type: 'module' })
// geladen. Comlink exponiert die Kernel-Instanz fuer RPC-Aufrufe.

import * as Comlink from 'comlink';
import { OpenCascadeKernel } from './OpenCascadeKernel';

const kernel = new OpenCascadeKernel();
Comlink.expose(kernel);
