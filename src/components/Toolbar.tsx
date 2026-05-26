// src/components/Toolbar.tsx
import { useState } from 'react';
import { useGraphStore } from '../state/graphStore';
import { useStatusStore } from '../state/statusStore';
import { useAssetStore } from '../state/assetStore';
import { useViewerStore } from '../state/viewerStore';
import { useUiStore } from '../state/uiStore';
import { exampleBoxWithHole, exampleSimpleBox, exampleUnion, exampleSelectiveFillet, exampleShelfBoard, exampleHousePolygon, exampleIntersection, exampleWoodPlate, exampleMultiPreview } from '../graph/examples';
import { clearGraphCache, getLastShapeForNode } from '../graph/graphExecution';
import { getKernel } from '../cad/CadKernelService';
import { ShareDialog } from './ShareDialog';
import { parseSvg } from '../utils/svgImport';
import type { ShapeHandle } from '../cad/types';

export function Toolbar() {
  const kernel = useStatusStore((s) => s.kernel);
  const compute = useStatusStore((s) => s.compute);
  const lastMs = useStatusStore((s) => s.lastComputeMs);
  const setDoc = useGraphStore((s) => s.setDoc);
  const reset = useGraphStore((s) => s.reset);
  const run = useGraphStore((s) => s.run);
  const addNode = useGraphStore((s) => s.addNode);
  const [busy, setBusy] = useState<string | null>(null);
  const hasShapes = useViewerStore((s) => s.meshes.size) > 0;

  const loadExample = (doc: typeof exampleBoxWithHole) => {
    clearGraphCache();
    setDoc(structuredClone(doc));
    run().catch(console.error);
  };

  const exportProject = () => {
    const doc = useGraphStore.getState().doc;
    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
    downloadBlob(blob, `cad-project-${Date.now()}.json`);
  };

  const importProject = () => {
    pickFile('application/json').then(async (file) => {
      if (!file) return;
      const text = await file.text();
      try {
        const doc = JSON.parse(text);
        clearGraphCache();
        setDoc(doc);
        run().catch(console.error);
      } catch (e) {
        alert(`Konnte Datei nicht laden: ${(e as Error).message}`);
      }
    });
  };

  const importSvg = async () => {
    const file = await pickFile('.svg,image/svg+xml');
    if (!file) return;
    setBusy('SVG importieren…');
    useStatusStore.getState().log('info', `SVG-Import: ${file.name} (${formatBytes(file.size)})`);
    try {
      const text = await file.text();
      const result = parseSvg(text);
      const { contours, scaleMmPerUnit } = result;

      useStatusStore.getState().log(
        'info',
        `SVG geparst: ${contours.length} Kontur(en), Skalierung ${scaleMmPerUnit.toFixed(4)} mm/Unit`,
      );

      // Für jede Kontur einen extrudePolygon-Node + Preview-Node anlegen
      const COL_SPACING = 420;
      const ROW_Y = 80;
      for (let i = 0; i < contours.length; i++) {
        const c = contours[i];
        const baseX = 80 + i * COL_SPACING;
        const extId = addNode(
          'extrudePolygon',
          { x: baseX, y: ROW_Y },
          {
            pointsJson: JSON.stringify(c.points),
            height: 10,
            baseZ: 0,
            direction: 'z',
          },
        );
        const prvId = addNode('preview', { x: baseX + 240, y: ROW_Y }, {
          color: '#b8c4d0',
          quality: 'normal',
        });
        // Verbindung ExtrudePolygon → Preview
        useGraphStore.getState().addEdge({
          source: extId,
          sourceHandle: 'shape',
          target: prvId,
          targetHandle: 'shape',
        });
      }

      run().catch(console.error);
      useStatusStore.getState().log('info', `SVG-Import abgeschlossen: ${contours.length} Node(s) angelegt`);
    } catch (e) {
      const msg = (e as Error)?.message ?? String(e);
      useStatusStore.getState().log('error', `SVG-Import fehlgeschlagen: ${msg}`);
      alert(`SVG-Import fehlgeschlagen:\n${msg}`);
    } finally {
      setBusy(null);
    }
  };

  const importStep = async () => {
    const file = await pickFile('.step,.stp,model/step,application/STEP');
    if (!file) return;
    setBusy('STEP-Import…');
    useStatusStore.getState().log('info', `STEP-Import: ${file.name} (${formatBytes(file.size)})`);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const assetId = await useAssetStore.getState().addAsset(file.name, bytes);
      addNode('importedStep', { x: 80, y: 80 }, { assetId, filename: file.name });
      useStatusStore.getState().log('info', `Asset gespeichert: ${assetId}`);
      run().catch(console.error);
    } catch (e) {
      const msg = (e as Error)?.message ?? String(e);
      useStatusStore.getState().log('error', `STEP-Import fehlgeschlagen: ${msg}`);
      alert(`STEP-Import fehlgeschlagen:\n${msg}`);
    } finally {
      setBusy(null);
    }
  };

  const findActiveShape = (): { handle: ShapeHandle; nodeId: string } | null => {
    const doc = useGraphStore.getState().doc;
    const previews = doc.nodes.filter((n) => n.type === 'preview');
    for (let i = previews.length - 1; i >= 0; i--) {
      const handle = getLastShapeForNode(previews[i].id);
      if (handle) return { handle, nodeId: previews[i].id };
    }
    for (const n of [...doc.nodes].reverse()) {
      const handle = getLastShapeForNode(n.id);
      if (handle) return { handle, nodeId: n.id };
    }
    return null;
  };

  const exportStl = async () => {
    const active = findActiveShape();
    if (!active) { alert('Kein berechnetes Shape vorhanden. Erst Graph ausfuehren.'); return; }
    setBusy('STL exportieren…');
    try {
      const bytes = await getKernel().exportStl(active.handle);
      const blob = new Blob([bytes.slice()], { type: 'model/stl' });
      downloadBlob(blob, `cad-export-${Date.now()}.stl`);
      useStatusStore.getState().log('info', `STL exportiert: ${formatBytes(bytes.byteLength)}`);
    } catch (e) {
      const msg = (e as Error)?.message ?? String(e);
      useStatusStore.getState().log('error', `STL-Export fehlgeschlagen: ${msg}`);
      alert(`STL-Export fehlgeschlagen:\n${msg}`);
    } finally {
      setBusy(null);
    }
  };

  const exportGlb = async () => {
    const active = findActiveShape();
    if (!active) { alert('Kein berechnetes Shape vorhanden. Erst Graph ausfuehren.'); return; }
    setBusy('GLB exportieren…');
    try {
      const bytes = await getKernel().exportGlb(active.handle);
      const blob = new Blob([bytes.slice()], { type: 'model/gltf-binary' });
      downloadBlob(blob, `cad-export-${Date.now()}.glb`);
      useStatusStore.getState().log('info', `GLB exportiert: ${formatBytes(bytes.byteLength)}`);
    } catch (e) {
      const msg = (e as Error)?.message ?? String(e);
      useStatusStore.getState().log('error', `GLB-Export fehlgeschlagen: ${msg}`);
      alert(`GLB-Export fehlgeschlagen:\n${msg}`);
    } finally {
      setBusy(null);
    }
  };

  const exportStep = async () => {
    const active = findActiveShape();
    if (!active) { alert('Kein berechnetes Shape vorhanden. Erst Graph ausfuehren.'); return; }
    setBusy('STEP exportieren…');
    try {
      const bytes = await getKernel().exportStep(active.handle);
      const blob = new Blob([bytes.slice()], { type: 'model/step' });
      downloadBlob(blob, `cad-export-${Date.now()}.step`);
      useStatusStore.getState().log('info', `STEP exportiert: ${formatBytes(bytes.byteLength)}`);
    } catch (e) {
      const msg = (e as Error)?.message ?? String(e);
      useStatusStore.getState().log('error', `STEP-Export fehlgeschlagen: ${msg}`);
      alert(`STEP-Export fehlgeschlagen:\n${msg}`);
    } finally {
      setBusy(null);
    }
  };

  const [shareOpen, setShareOpen] = useState(false);
  const [showExamples, setShowExamples] = useState(false);
  const [showExport, setShowExport] = useState(false);

  const exampleItems = [
    { label: 'Box', fn: exampleSimpleBox },
    { label: 'Union', fn: exampleUnion },
    { label: 'Intersection', fn: exampleIntersection },
    { label: 'Platte + Bohrung + Fase', fn: exampleBoxWithHole, primary: true },
    { label: 'Edge-Pick Demo', fn: exampleSelectiveFillet },
    { label: 'Regalbrett', fn: exampleShelfBoard },
    { label: 'Polygon-Extrusion', fn: exampleHousePolygon },
    { label: 'Holzplatte', fn: exampleWoodPlate },
    { label: '3 Körper', fn: exampleMultiPreview },
  ];

  return (
    <div className="toolbar">
      <div className="toolbar__group toolbar__group--brand">
        <strong className="brand">CAD&nbsp;//&nbsp;0.3</strong>
        <KernelBadge state={kernel} />
        <ComputeBadge state={compute} ms={lastMs} />
      </div>

      {/* Desktop: alle Beispiele inline */}
      <div className="toolbar__group toolbar__desktop-only">
        <span className="toolbar__label">Beispiele:</span>
        {exampleItems.map((ex) => (
          <button key={ex.label} className={`btn${ex.primary ? ' btn--primary' : ''}`}
            onClick={() => loadExample(ex.fn)}>{ex.label}</button>
        ))}
      </div>

      {/* Desktop: Import + Export inline */}
      <div className="toolbar__group toolbar__desktop-only">
        <button className="btn" onClick={importSvg} disabled={kernel !== 'ready' || !!busy}>📐 SVG importieren</button>
        <button className="btn" onClick={importStep} disabled={kernel !== 'ready' || !!busy}>📥 STEP importieren</button>
        <button className="btn" onClick={exportStl} disabled={!hasShapes || !!busy}>⤓ STL</button>
        <button className="btn" onClick={exportGlb} disabled={!hasShapes || !!busy}>⤓ GLB</button>
        <button className="btn" onClick={exportStep} disabled={!hasShapes || !!busy}>⤓ STEP</button>
      </div>

      {/* Mobile: Beispiele-Dropdown */}
      <div className="toolbar__group toolbar__mobile-only" style={{ position: 'relative' }}>
        <button className="btn" onClick={() => { setShowExamples(v => !v); setShowExport(false); }}>
          Beispiele {showExamples ? '▲' : '▼'}
        </button>
        {showExamples && (
          <div className="toolbar__dropdown">
            {exampleItems.map((ex) => (
              <button key={ex.label} className={`toolbar__dropdown-item${ex.primary ? ' toolbar__dropdown-item--primary' : ''}`}
                onClick={() => { loadExample(ex.fn); setShowExamples(false); }}>
                {ex.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Mobile: Export-Dropdown */}
      <div className="toolbar__group toolbar__mobile-only" style={{ position: 'relative' }}>
        <button className="btn" onClick={() => { setShowExport(v => !v); setShowExamples(false); }}
          disabled={!hasShapes || !!busy}>
          ⤓ Export {showExport ? '▲' : '▼'}
        </button>
        {showExport && (
          <div className="toolbar__dropdown">
            <button className="toolbar__dropdown-item" onClick={() => { exportStl(); setShowExport(false); }}>⤓ STL</button>
            <button className="toolbar__dropdown-item" onClick={() => { exportGlb(); setShowExport(false); }}>⤓ GLB</button>
            <button className="toolbar__dropdown-item" onClick={() => { exportStep(); setShowExport(false); }}>⤓ STEP</button>
          </div>
        )}
      </div>

      <div className="toolbar__group toolbar__group--actions">
        <button className="btn" onClick={() => setShareOpen(true)}>🔗 Teilen</button>
        <ConfiguratorToggle />
        <button className="btn" onClick={importProject}>📂 Laden</button>
        <button className="btn" onClick={exportProject}>💾 Speichern</button>
        <button className="btn btn--ghost" onClick={() => { clearGraphCache(); reset(); useViewerStore.getState().clear(); }}>
          ✕ Leer
        </button>
      </div>

      {busy && <div className="toolbar__busy">{busy}</div>}
      {shareOpen && <ShareDialog onClose={() => setShareOpen(false)} />}
    </div>
  );
}

function ConfiguratorToggle() {
  const setMode = useUiStore((s) => s.setMode);
  const pubCount = useGraphStore((s) => (s.doc.publishedParams ?? []).length);
  return (
    <button
      className="btn btn--primary"
      onClick={() => setMode('configurator')}
      title={pubCount > 0
        ? `${pubCount} Parameter veröffentlicht`
        : 'Noch keine Parameter veröffentlicht — bitte erst veröffentlichen'}
    >
      🎛 Konfigurator
      {pubCount > 0 && <span className="badge-inline">{pubCount}</span>}
    </button>
  );
}

// ===========================================================================
//   Helpers
// ===========================================================================

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}

function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = accept;
    // Muss im DOM sein damit onchange in allen Browsern zuverlaessig feuert
    inp.style.cssText = 'position:fixed;top:-200px;left:-200px;opacity:0;pointer-events:none';
    document.body.appendChild(inp);

    const cleanup = () => { try { document.body.removeChild(inp); } catch { /* */ } };

    inp.addEventListener('change', () => {
      cleanup();
      resolve(inp.files?.[0] ?? null);
    });
    inp.addEventListener('cancel', () => {
      cleanup();
      resolve(null);
    });
    inp.click();
  });
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function KernelBadge({ state }: { state: ReturnType<typeof useStatusStore.getState>['kernel'] }) {
  const color = state === 'ready' ? '#1f8a3a' : state === 'error' ? '#b3261e' : '#9a6700';
  return <span className="status-pill" style={{ background: color }}>Kernel: {state}</span>;
}

function ComputeBadge({ state, ms }: { state: ReturnType<typeof useStatusStore.getState>['compute']; ms?: number }) {
  const map = {
    idle: { c: '#5a6470', t: 'idle' },
    computing: { c: '#9a6700', t: 'rechne…' },
    success: { c: '#1f8a3a', t: ms ? `ok (${ms.toFixed(0)} ms)` : 'ok' },
    error: { c: '#b3261e', t: 'error' },
  } as const;
  const { c, t } = map[state];
  return <span className="status-pill" style={{ background: c }}>{t}</span>;
}
