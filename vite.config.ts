import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite 5 + opencascade.js + Web Worker
// Wichtigste Punkte:
//  - opencascade.js aus optimizeDeps ausschliessen, sonst stolpert esbuild ueber das WASM-Modul
//  - Worker als ES-Modul ausliefern (siehe new Worker(..., { type: 'module' }) im Code)
//  - WASM-Dateien als Asset markieren, damit sie korrekt kopiert werden
export default defineConfig({
  plugins: [react()],
  base: ((globalThis as any).process?.env?.IS_GH_PAGES === 'true') ? '/cad-app/' : '/',
  server: {
    // Falls du spaeter SharedArrayBuffer / Worker-Pool brauchst:
    // headers: {
    //   'Cross-Origin-Opener-Policy': 'same-origin',
    //   'Cross-Origin-Embedder-Policy': 'require-corp',
    // },
  },
  optimizeDeps: {
    exclude: ['opencascade.js'],
  },
  worker: {
    format: 'es',
  },
  assetsInclude: ['**/*.wasm'],
  build: {
    target: 'esnext',
  },
});
