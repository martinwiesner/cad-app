// src/App.tsx
import { useEffect } from 'react';
import { CadViewer } from './viewer/CadViewer';
import { Toolbar } from './components/Toolbar';
import { DiagnosticsPanel } from './components/DiagnosticsPanel';
import { GraphEditor } from './editor/GraphEditor';
import { NodePalette } from './editor/NodePalette';
import { PropertiesPanel } from './editor/PropertiesPanel';
import { getKernel } from './cad/CadKernelService';
import { useStatusStore } from './state/statusStore';
import { useAssetStore } from './state/assetStore';
import { useSelectionStore } from './state/selectionStore';
import { useUiStore } from './state/uiStore';
import { useGraphStore } from './state/graphStore';
import { ConfiguratorView } from './components/ConfiguratorView';
import { applySharedDocument, decodeShareUrl } from './storage/shareEncoding';
import { clearGraphCache } from './graph/graphExecution';
import { parseUrlParams, buildGraphFromMaterialParams } from './utils/urlParams';
import { usePostMessage } from './utils/usePostMessage';
import { LoadingOverlay } from './components/LoadingOverlay';

export default function App() {
  usePostMessage();

  // Kernel beim Mount initialisieren + Assets aus IndexedDB hydrieren
  useEffect(() => {
    // Assets sofort hydrieren - parallel zum Kernel
    useAssetStore.getState().hydrate().catch((e) => {
      // eslint-disable-next-line no-console
      console.warn('assetStore hydrate failed', e);
    });

    const st = useStatusStore.getState();
    if (st.kernel !== 'uninitialized') return;
    st.setKernel('initializing');
    st.log('info', 'OpenCascade.js wird geladen (~30 MB WASM, einmalig)…');
    getKernel()
      .init()
      .then(() => {
        useStatusStore.getState().setKernel('ready');
        useStatusStore.getState().log('info', 'Kernel bereit.');

        // URL-Material-Parameter anwenden (nur wenn kein share= vorhanden)
        if (!window.location.hash.includes('share=')) {
          const matParams = parseUrlParams();
          if (matParams) {
            clearGraphCache();
            const doc = buildGraphFromMaterialParams(matParams);
            useGraphStore.getState().setDoc(doc);
            if (matParams.mode === 'configurator') {
              useUiStore.getState().setMode('configurator');
            }
            useGraphStore.getState().run().catch(console.error);
            useStatusStore.getState().log('info', `Material geladen: ${matParams.material ?? '—'}`);
          }
        }

        // NACH Kernel-Init: ggf. shared URL anwenden
        tryLoadFromUrl().catch((e) => {
          // eslint-disable-next-line no-console
          console.error('[share] load failed', e);
          useStatusStore.getState().log('error', `Share-URL konnte nicht geladen werden: ${(e as Error).message}`);
        });
      })
      .catch((e: unknown) => {
        const msg = (e as Error)?.message ?? String(e);
        useStatusStore.getState().setKernel('error', msg);
        useStatusStore.getState().log('error', `Kernel-Init: ${msg}`);
      });
  }, []);

  // ESC beendet den Pick-Modus
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        const { pickingNodeId, stopPicking } = useSelectionStore.getState();
        if (pickingNodeId) stopPicking();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const mode = useUiStore((s) => s.mode);

  if (mode === 'configurator') {
    return (
      <>
        <LoadingOverlay />
        <ConfiguratorView />
      </>
    );
  }

  return (
    <>
    <LoadingOverlay />
    <div className="app">
      <header className="app__header">
        <Toolbar />
      </header>

      <main className="app__main">
        <aside className="app__palette">
          <NodePalette />
        </aside>

        <section className="app__center">
          <div className="app__editor">
            <GraphEditor />
          </div>
          <div className="app__viewer">
            <CadViewer />
          </div>
        </section>

        <aside className="app__props">
          <PropertiesPanel />
          <DiagnosticsPanel />
        </aside>
      </main>
    </div>
    </>
  );
}

/**
 * Liest #share=... aus URL und ersetzt den aktuellen Graph durch das Geteilte.
 * Setzt openInConfigurator entsprechend dem Payload.
 */
async function tryLoadFromUrl(): Promise<void> {
  const hash = window.location.hash;
  if (!hash || !hash.includes('share=')) return;

  // share=... aus dem Fragment extrahieren
  const m = hash.match(/share=([^&]+)/);
  if (!m) return;
  const encoded = m[1];

  useStatusStore.getState().log('info', 'Geteiltes Projekt wird geladen…');
  const shared = await decodeShareUrl(encoded);
  const doc = await applySharedDocument(shared);

  // Hydrieren des Asset-Stores muss laufen, bevor wir den Graph ausfuehren
  await useAssetStore.getState().hydrate().catch(() => { /* ignore */ });

  useGraphStore.getState().setDoc(doc);
  if (shared.openInConfigurator) {
    useUiStore.getState().setMode('configurator');
  }

  // Graph einmal ausfuehren
  useGraphStore.getState().run().catch((e) => {
    useStatusStore.getState().log('error', `Graph-Ausfuehrung fehlgeschlagen: ${(e as Error).message}`);
  });

  // URL aufraeumen: Share-Fragment entfernen, damit ein Refresh nicht das Projekt zurueckholt
  // (der Empfaenger soll danach im aktuellen Stand bleiben). Wir behalten den Pfad.
  history.replaceState(null, '', window.location.pathname + window.location.search);

  useStatusStore.getState().log('info', shared.openInConfigurator
    ? 'Konfigurator-Modus aktiv.'
    : 'Editor-Modus aktiv.');
}
