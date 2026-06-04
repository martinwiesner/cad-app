// src/components/ConfiguratorView.tsx
import { useMemo, useState } from 'react';
import { useGraphStore } from '../state/graphStore';
import { useUiStore } from '../state/uiStore';
import { useStatusStore } from '../state/statusStore';
import { useViewerStore } from '../state/viewerStore';
import { CadViewer } from '../viewer/CadViewer';
import type { PublishedParam } from '../graph/graphTypes';
import { getKernel } from '../cad/CadKernelService';

export function ConfiguratorView() {
  const doc = useGraphStore((s) => s.doc);
  const updateNodeParam = useGraphStore((s) => s.updateNodeParam);
  const setMode = useUiStore((s) => s.setMode);
  const kernel = useStatusStore((s) => s.kernel);
  const compute = useStatusStore((s) => s.compute);
  const hasShapes = useViewerStore((s) => s.meshes.size) > 0;

  // Mobile-Tab: "viewer" | "params"
  const [mobileTab, setMobileTab] = useState<'viewer' | 'params'>('viewer');

  // Collapsible groups
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const toggleGroup = (name: string) =>
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });

  const visibleIds = useMemo(() => {
    const ids = doc.publishedNodes ?? [];
    return ids.length > 0 ? new Set(ids) : undefined;
  }, [doc.publishedNodes]);

  const published = useMemo(
    () => [...(doc.publishedParams ?? [])].sort((a, b) => a.order - b.order),
    [doc.publishedParams],
  );

  const grouped = useMemo(() => {
    const map = new Map<string, PublishedParam[]>();
    for (const p of published) {
      const g = p.group ?? 'Allgemein';
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(p);
    }
    return [...map.entries()];
  }, [published]);

  const getValue = (p: PublishedParam): unknown => {
    const node = doc.nodes.find((n) => n.id === p.nodeId);
    return node?.params[p.paramKey];
  };

  const exportSTL = async () => {
    const { getLastShapeForNode } = await import('../graph/graphExecution');
    const previews = doc.nodes.filter((n) => n.type === 'preview');
    let handle: string | null = null;
    for (let i = previews.length - 1; i >= 0; i--) {
      const h = getLastShapeForNode(previews[i].id);
      if (h) { handle = h; break; }
    }
    if (!handle) { alert('Kein Modell vorhanden.'); return; }
    try {
      const bytes = await getKernel().exportStl(handle as any);
      const blob = new Blob([bytes.slice()], { type: 'model/stl' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${doc.meta?.name?.replace(/[^a-z0-9_-]/gi, '_') || 'modell'}-${Date.now()}.stl`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
    } catch (e) {
      alert(`STL-Export fehlgeschlagen: ${(e as Error).message}`);
    }
  };

  const isComputing = compute === 'computing';

  return (
    <div className="configurator">
      {/* ── Header ── */}
      <header className="configurator__header">
        <div className="configurator__title">
          <strong>{doc.meta?.name ?? 'Konfigurator'}</strong>
          <span className="configurator__subtitle">passe das Modell an</span>
        </div>
        <div className="configurator__status">
          {kernel !== 'ready' ? (
            <span className="configurator__status-pill configurator__status-pill--wait">Laden…</span>
          ) : isComputing ? (
            <span className="configurator__status-pill configurator__status-pill--computing">
              <span className="cfg-status-dot" />Aktualisiere…
            </span>
          ) : compute === 'error' ? (
            <span className="configurator__status-pill configurator__status-pill--error">Fehler</span>
          ) : (
            <span className="configurator__status-pill configurator__status-pill--ok">Bereit</span>
          )}
        </div>
        <div className="configurator__actions">
          <button className="btn" onClick={exportSTL} disabled={!hasShapes}>⤓ STL</button>
          <button className="btn btn--ghost" onClick={() => setMode('editor')}>← Editor</button>
        </div>
      </header>

      {/* ── Mobile tabs ── */}
      <div className="cfg-tabs">
        <button
          className={`cfg-tab${mobileTab === 'viewer' ? ' cfg-tab--active' : ''}`}
          onClick={() => setMobileTab('viewer')}
        >
          Modell
        </button>
        <button
          className={`cfg-tab${mobileTab === 'params' ? ' cfg-tab--active' : ''}`}
          onClick={() => setMobileTab('params')}
        >
          Parameter
          {published.length > 0 && <span className="cfg-tab__badge">{published.length}</span>}
        </button>
      </div>

      {/* ── Main ── */}
      <main className="configurator__main">

        {/* 3-D Viewer */}
        <section
          className={`configurator__viewer${mobileTab === 'params' ? ' cfg-hidden-mobile' : ''}`}
        >
          <CadViewer visibleIds={visibleIds} />

          {/* Compute-Pulse: nur wenn bereits Shapes da sind (LoadingOverlay deckt Erstladen ab) */}
          {isComputing && hasShapes && (
            <div className="cfg-viewer-computing">
              <span className="cfg-spinner" />
              <span>Aktualisiere…</span>
            </div>
          )}

          {/* Fit-Button im Viewer */}
          {hasShapes && (
            <button
              className="cfg-fit-btn"
              title="Ansicht anpassen"
              onClick={() => useViewerStore.getState().requestFitView()}
            >
              ⊡
            </button>
          )}
        </section>

        {/* Parameter-Sidebar */}
        <aside
          className={`configurator__sidebar${mobileTab === 'viewer' ? ' cfg-hidden-mobile' : ''}`}
        >
          {published.length === 0 ? (
            <div className="configurator__empty">
              <strong>Noch keine Parameter veröffentlicht.</strong>
              <p>Wechsle in den Editor, wähle einen Parameter aus und klicke <em>☆ veröffentlichen</em>.</p>
              <button className="btn btn--primary" onClick={() => setMode('editor')}>Zum Editor</button>
            </div>
          ) : (
            grouped.map(([groupName, params]) => {
              const collapsed = collapsedGroups.has(groupName);
              return (
                <section key={groupName} className="configurator__group">
                  <button
                    className="configurator__group-title"
                    onClick={() => toggleGroup(groupName)}
                    aria-expanded={!collapsed}
                  >
                    <span>{groupName}</span>
                    <span className="cfg-chevron">{collapsed ? '▶' : '▼'}</span>
                  </button>
                  {!collapsed && params.map((p) => (
                    <ConfiguratorParam
                      key={p.id}
                      param={p}
                      value={getValue(p)}
                      onChange={(v) => updateNodeParam(p.nodeId, p.paramKey, v)}
                    />
                  ))}
                </section>
              );
            })
          )}
        </aside>
      </main>
    </div>
  );
}

// ─── Parameter-Control ────────────────────────────────────────────────────────

function ConfiguratorParam({
  param, value, onChange,
}: {
  param: PublishedParam;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const v = typeof value === 'number' ? value : Number(value) || 0;
  const hasRange = param.min !== undefined && param.max !== undefined
    && isFinite(param.min) && isFinite(param.max);
  const min = param.min ?? -Infinity;
  const max = param.max ?? Infinity;
  const step = param.step ?? 1;
  const clamp = (n: number) => Math.max(min, Math.min(max, n));

  const pct = hasRange ? ((v - min) / (max - min)) * 100 : 0;

  return (
    <div className="cfg-param">
      <div className="cfg-param__head">
        <label className="cfg-param__label">{param.label}</label>
        <div className="cfg-param__value">
          <input
            type="number"
            value={v}
            min={isFinite(min) ? min : undefined}
            max={isFinite(max) ? max : undefined}
            step={step}
            onChange={(e) => onChange(clamp(parseFloat(e.target.value) || 0))}
          />
          {param.unit && <span className="cfg-param__unit">{param.unit}</span>}
        </div>
      </div>

      {hasRange && (
        <div className="cfg-param__track-wrap">
          <input
            className="cfg-param__slider"
            type="range"
            value={v}
            min={min}
            max={max}
            step={step}
            style={{ '--pct': `${pct}%` } as React.CSSProperties}
            onChange={(e) => onChange(parseFloat(e.target.value))}
          />
          <div className="cfg-param__range-labels">
            <span>{min}{param.unit ?? ''}</span>
            <span>{max}{param.unit ?? ''}</span>
          </div>
        </div>
      )}

      {param.description && <p className="cfg-param__desc">{param.description}</p>}
    </div>
  );
}
