// src/utils/usePostMessage.ts
// Macht die CAD-App iframe-fähig über die postMessage-API.
//
// Eingehende Nachrichten (von der Materialdatenbank):
//   { type: 'cad:setMaterial', material, width, height, thickness, density }
//
// Ausgehende Nachrichten (an die Materialdatenbank):
//   { type: 'cad:ready' }              – beim Mount, wenn in iframe eingebettet
//   { type: 'cad:materialApplied', material }  – nach Übernahme der Daten

import { useEffect } from 'react';
import { useGraphStore } from '../state/graphStore';
import { clearGraphCache } from '../graph/graphExecution';
import { buildGraphFromMaterialParams } from './urlParams';
import { useUiStore } from '../state/uiStore';

const isIframe = (): boolean => {
  try { return window.self !== window.top; } catch { return true; }
};

export function usePostMessage() {
  useEffect(() => {
    if (isIframe()) {
      window.parent.postMessage({ type: 'cad:ready' }, '*');
    }

    const handler = (event: MessageEvent) => {
      if (!event.data || typeof event.data !== 'object') return;
      const { type, ...payload } = event.data as Record<string, unknown>;

      if (type === 'cad:setMaterial') {
        const doc = buildGraphFromMaterialParams({
          material:  payload.material  as string | undefined,
          width:     payload.width     != null ? Number(payload.width)     : undefined,
          height:    payload.height    != null ? Number(payload.height)    : undefined,
          thickness: payload.thickness != null ? Number(payload.thickness) : undefined,
          density:   payload.density   as string | undefined,
        });

        clearGraphCache();
        useGraphStore.getState().setDoc(doc);
        useGraphStore.getState().run().catch(console.error);

        // Konfigurator-Modus aktivieren wenn gewünscht
        if (payload.mode === 'configurator') {
          useUiStore.getState().setMode('configurator');
        }

        if (isIframe()) {
          window.parent.postMessage({ type: 'cad:materialApplied', material: payload.material }, '*');
        }
      }
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);
}
