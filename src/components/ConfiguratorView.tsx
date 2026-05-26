// src/components/ConfiguratorView.tsx
// Fullscreen-Ansicht fuer Endnutzer ohne CAD-Erfahrung.
// Linke Sidebar: alle veroeffentlichten Parameter, gruppiert.
// Hauptbereich: nur der 3D-Viewer.
// Endnutzer koennen Parameter nur innerhalb der vom Designer festgelegten
// Grenzen veraendern, und sie sehen weder Graph noch interne Node-Details.

import { useMemo } from 'react';
import { useGraphStore } from '../state/graphStore';
import { useUiStore } from '../state/uiStore';
import { useStatusStore } from '../state/statusStore';
import { CadViewer } from '../viewer/CadViewer';
import type { PublishedParam } from '../graph/graphTypes';
import { getKernel } from '../cad/CadKernelService';

export function ConfiguratorView() {
  const doc = useGraphStore((s) => s.doc);
  const updateNodeParam = useGraphStore((s) => s.updateNodeParam);
  const setMode = useUiStore((s) => s.setMode);
  const kernel = useStatusStore((s) => s.kernel);
  const compute = useStatusStore((s) => s.compute);

  const visibleIds = useMemo(() => {
    const ids = doc.publishedNodes ?? [];
    return ids.length > 0 ? new Set(ids) : undefined;
  }, [doc.publishedNodes]);

  const published = useMemo(() => {
    const list = [...(doc.publishedParams ?? [])].sort((a, b) => a.order - b.order);
    return list;
  }, [doc.publishedParams]);

  // Gruppieren nach group (undefined -> "Allgemein")
  const grouped = useMemo(() => {
    const map = new Map<string, PublishedParam[]>();
    for (const p of published) {
      const g = p.group ?? 'Allgemein';
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(p);
    }
    return [...map.entries()];
  }, [published]);

  // Wert aus dem zugehoerigen Node holen
  const getValue = (p: PublishedParam): unknown => {
    const node = doc.nodes.find((n) => n.id === p.nodeId);
    return node?.params[p.paramKey];
  };

  // STL/GLB exportieren
  const exportSTL = async () => {
    // Findet das Preview-Shape - identisch zur Toolbar-Logik aus Sprint 3
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

  return (
    <div className="configurator">
      <header className="configurator__header">
        <div className="configurator__title">
          <strong>{doc.meta?.name ?? 'Konfigurator'}</strong>
          <span className="configurator__subtitle">passe das Modell an</span>
        </div>
        <div className="configurator__status">
          {kernel !== 'ready' ? (
            <span className="configurator__status-pill configurator__status-pill--wait">Laden…</span>
          ) : compute === 'computing' ? (
            <span className="configurator__status-pill configurator__status-pill--computing">Aktualisiere…</span>
          ) : compute === 'error' ? (
            <span className="configurator__status-pill configurator__status-pill--error">Fehler</span>
          ) : (
            <span className="configurator__status-pill configurator__status-pill--ok">Bereit</span>
          )}
        </div>
        <div className="configurator__actions">
          <button className="btn" onClick={exportSTL}>⤓ STL herunterladen</button>
          <button className="btn btn--ghost" onClick={() => setMode('editor')}>
            ← zurück zum Editor
          </button>
        </div>
      </header>

      <main className="configurator__main">
        <aside className="configurator__sidebar">
          {published.length === 0 ? (
            <div className="configurator__empty">
              <strong>Noch keine Parameter veröffentlicht.</strong>
              <p>Wechsle in den Editor, wähle einen Parameter aus und klicke <em>☆ veröffentlichen</em>.</p>
              <button className="btn btn--primary" onClick={() => setMode('editor')}>
                Zum Editor
              </button>
            </div>
          ) : (
            grouped.map(([groupName, params]) => (
              <section key={groupName} className="configurator__group">
                <h3 className="configurator__group-title">{groupName}</h3>
                {params.map((p) => (
                  <ConfiguratorParam
                    key={p.id}
                    param={p}
                    value={getValue(p)}
                    onChange={(v) => updateNodeParam(p.nodeId, p.paramKey, v)}
                  />
                ))}
              </section>
            ))
          )}
        </aside>

        <section className="configurator__viewer">
          <CadViewer visibleIds={visibleIds} />
        </section>
      </main>
    </div>
  );
}

function ConfiguratorParam({
  param, value, onChange,
}: {
  param: PublishedParam;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  // Wir gehen davon aus, dass nur skalare Werte veroeffentlicht sind.
  // Numerische Werte werden geklemmt - der Endnutzer kann nicht ausserhalb editieren.
  const v = typeof value === 'number' ? value : Number(value) || 0;
  const min = param.min ?? -Infinity;
  const max = param.max ?? Infinity;
  const step = param.step ?? 1;

  const clamp = (n: number) => Math.max(min, Math.min(max, n));

  return (
    <div className="cfg-param">
      <div className="cfg-param__head">
        <label className="cfg-param__label">{param.label}</label>
        <div className="cfg-param__value">
          <input
            type="number"
            value={v}
            min={min === -Infinity ? undefined : min}
            max={max === Infinity ? undefined : max}
            step={step}
            onChange={(e) => onChange(clamp(parseFloat(e.target.value) || 0))}
          />
          {param.unit && <span className="cfg-param__unit">{param.unit}</span>}
        </div>
      </div>
      {min !== -Infinity && max !== Infinity && (
        <input
          className="cfg-param__slider"
          type="range"
          value={v}
          min={min}
          max={max}
          step={step}
          onChange={(e) => onChange(parseFloat(e.target.value))}
        />
      )}
      {param.description && <p className="cfg-param__desc">{param.description}</p>}
    </div>
  );
}
