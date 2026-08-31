// src/editor/PropertiesPanel.tsx
import { useGraphStore } from '../state/graphStore';
import { useAssetStore } from '../state/assetStore';
import { useSelectionStore } from '../state/selectionStore';
import { getNodeSpec, type NodeParamSchema } from '../graph/nodeRegistry';
import type { GraphNode } from '../graph/graphTypes';
import { useRef, useState } from 'react';
import { SketchEditorModal } from '../sketch/SketchEditor';
import type { SketchConstraint } from '../sketch/sketchTypes';

export function PropertiesPanel() {
  const selectedId = useGraphStore((s) => s.selectedNodeId);
  const node = useGraphStore((s) => s.doc.nodes.find((n) => n.id === selectedId));

  if (!node) {
    return (
      <div className="props">
        <div className="props__empty">
          Wähle einen Node, um seine Eigenschaften zu bearbeiten.
        </div>
      </div>
    );
  }

  const spec = getNodeSpec(node.type);
  if (!spec) return <div className="props">Unbekannter Node-Typ</div>;

  return (
    <div className="props">
      <div className="props__header">
        <span className="props__type">{spec.category}</span>
        <span className="props__title">{spec.label}</span>
        {node.type === 'preview' && <NodeVisibilityToggle nodeId={node.id} />}
      </div>
      <div className="props__id">id: {node.id}</div>

      <div className="props__list">
        {spec.params.map((p) =>
          p.kind === 'sketch' ? null : <ParamRow key={p.key} node={node} schema={p} />,
        )}
        {node.type === 'sketch' ? <SketchControls node={node} /> : null}
        {node.type === 'sketch' ? <SketchConstraintControls node={node} /> : null}
        {node.type === 'importedStep' ? <ImportedStepControls node={node} /> : null}
        {node.type === 'importedStl' ? <ImportedStlControls node={node} /> : null}
        {spec.params.some((p) => p.kind === 'edgeList') ? <EdgeListControls node={node} /> : null}
      </div>
    </div>
  );
}

function ParamRow({ node, schema }: { node: GraphNode; schema: NodeParamSchema }) {
  const update = useGraphStore((s) => s.updateNodeParam);
  const value = node.params[schema.key] ?? schema.default;
  // Live-Subscription auf publishedParams - sonst aktualisiert sich der Stern-Indikator nicht
  const published = useGraphStore((s) =>
    (s.doc.publishedParams ?? []).find((p) => p.nodeId === node.id && p.paramKey === schema.key),
  );

  // edgeList und nicht-skalare Kinds koennen wir (noch) nicht veroeffentlichen
  const canPublish = schema.kind === 'number' || schema.kind === 'slider' || schema.kind === 'boolean' || schema.kind === 'select';

  return (
    <div className={`param-row ${published ? 'param-row--published' : ''}`}>
      <div className="param-row__head">
        <span className="param-row__label">
          {schema.label}
          {schema.unit ? <em className="param-row__unit"> ({schema.unit})</em> : null}
        </span>
        {canPublish && (
          <PublishToggle node={node} schema={schema} currentValue={Number(value)} />
        )}
      </div>
      <ParamInput schema={schema} value={value} onChange={(v) => update(node.id, schema.key, v)} />
    </div>
  );
}

function PublishToggle({
  node, schema, currentValue,
}: { node: GraphNode; schema: NodeParamSchema; currentValue: number }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const publishParam = useGraphStore((s) => s.publishParam);
  const unpublishParam = useGraphStore((s) => s.unpublishParam);
  const published = useGraphStore((s) =>
    (s.doc.publishedParams ?? []).find((p) => p.nodeId === node.id && p.paramKey === schema.key),
  );

  if (published) {
    return (
      <button
        className="publish-toggle publish-toggle--on"
        title="Aus Konfigurator entfernen"
        onClick={(e) => { e.stopPropagation(); unpublishParam(published.id); }}
      >
        ★ veröffentlicht
      </button>
    );
  }

  return (
    <>
      <button
        className="publish-toggle"
        title="Im Konfigurator-Modus zeigen"
        onClick={(e) => { e.stopPropagation(); setDialogOpen(true); }}
      >
        ☆ veröffentlichen
      </button>
      {dialogOpen && (
        <PublishDialog
          node={node}
          schema={schema}
          currentValue={currentValue}
          onCancel={() => setDialogOpen(false)}
          onConfirm={(payload) => {
            publishParam(payload);
            setDialogOpen(false);
          }}
        />
      )}
    </>
  );
}

function NodeVisibilityToggle({ nodeId }: { nodeId: string }) {
  const publishNode = useGraphStore((s) => s.publishNode);
  const unpublishNode = useGraphStore((s) => s.unpublishNode);
  const isPublished = useGraphStore((s) => s.isNodePublished(nodeId));
  const anyPublished = useGraphStore((s) => (s.doc.publishedNodes ?? []).length > 0);

  if (isPublished) {
    return (
      <button className="publish-toggle publish-toggle--on" title="Aus Konfigurator ausblenden"
        onClick={() => unpublishNode(nodeId)}>
        ★ im Konfigurator sichtbar
      </button>
    );
  }
  return (
    <button className="publish-toggle" title="Im Konfigurator anzeigen"
      onClick={() => publishNode(nodeId)}>
      {anyPublished ? '☆ ausgeblendet' : '☆ im Konfigurator zeigen'}
    </button>
  );
}

function PublishDialog({
  node, schema, currentValue, onCancel, onConfirm,
}: {
  node: GraphNode;
  schema: NodeParamSchema;
  currentValue: number;
  onCancel: () => void;
  onConfirm: (p: {
    nodeId: string;
    paramKey: string;
    label: string;
    group?: string;
    min?: number;
    max?: number;
    step?: number;
    unit?: string;
    description?: string;
  }) => void;
}) {
  // Defaults aus dem Schema + sinnvolle Grenzen um den aktuellen Wert
  const [label, setLabel] = useState(schema.label);
  const [group, setGroup] = useState('');
  const [min, setMin] = useState<number>(schema.min ?? Math.max(0, currentValue * 0.5));
  const [max, setMax] = useState<number>(schema.max ?? currentValue * 2 + 1);
  const [step, setStep] = useState<number>(schema.step ?? 1);
  const [description, setDescription] = useState('');

  const isNumericKind = schema.kind === 'number' || schema.kind === 'slider';

  return (
    <div className="publish-dialog" onPointerDown={(e) => e.stopPropagation()}>
      <div className="publish-dialog__backdrop" onClick={onCancel} />
      <div className="publish-dialog__panel">
        <h3>Parameter veröffentlichen</h3>
        <p className="publish-dialog__desc">
          Dieser Parameter erscheint dann im Konfigurator-Modus. Endnutzer können nur innerhalb des angegebenen Bereichs editieren.
        </p>

        <label className="dialog-field">
          <span>Anzeigename</span>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="z.B. Breite"
            autoFocus
          />
        </label>

        <label className="dialog-field">
          <span>Gruppe <em>(optional)</em></span>
          <input
            type="text"
            value={group}
            onChange={(e) => setGroup(e.target.value)}
            placeholder="z.B. Abmessungen"
          />
        </label>

        {isNumericKind && (
          <div className="dialog-field-row">
            <label className="dialog-field">
              <span>Minimum</span>
              <input type="number" value={min} onChange={(e) => setMin(parseFloat(e.target.value))} />
            </label>
            <label className="dialog-field">
              <span>Maximum</span>
              <input type="number" value={max} onChange={(e) => setMax(parseFloat(e.target.value))} />
            </label>
            <label className="dialog-field">
              <span>Schrittweite</span>
              <input type="number" value={step} onChange={(e) => setStep(parseFloat(e.target.value))} step={0.01} />
            </label>
          </div>
        )}

        <label className="dialog-field">
          <span>Beschreibung <em>(optional)</em></span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder="Hilfetext fuer Endnutzer"
          />
        </label>

        <div className="dialog-field publish-dialog__preview">
          <span>Aktueller Wert: <code>{currentValue}</code> {schema.unit ?? ''}</span>
        </div>

        <div className="publish-dialog__actions">
          <button className="btn" onClick={onCancel}>Abbrechen</button>
          <button
            className="btn btn--primary"
            disabled={!label.trim() || (isNumericKind && !(max > min))}
            onClick={() => onConfirm({
              nodeId: node.id,
              paramKey: schema.key,
              label: label.trim(),
              group: group.trim() || undefined,
              min: isNumericKind ? min : undefined,
              max: isNumericKind ? max : undefined,
              step: isNumericKind ? step : undefined,
              unit: schema.unit,
              description: description.trim() || undefined,
            })}
          >
            Veröffentlichen
          </button>
        </div>
      </div>
    </div>
  );
}

function ParamInput({
  schema, value, onChange,
}: { schema: NodeParamSchema; value: unknown; onChange: (v: unknown) => void }) {
  switch (schema.kind) {
    case 'number':
      return (
        <input
          type="number"
          value={typeof value === 'number' ? value : Number(value) || 0}
          min={schema.min}
          max={schema.max}
          step={schema.step ?? 1}
          onChange={(e) => onChange(parseFloat(e.target.value))}
        />
      );
    case 'slider':
      return (
        <div className="param-row__slider">
          <input
            type="range"
            value={Number(value)}
            min={schema.min ?? 0}
            max={schema.max ?? 100}
            step={schema.step ?? 1}
            onChange={(e) => onChange(parseFloat(e.target.value))}
          />
          <input
            type="number"
            value={Number(value)}
            step={schema.step ?? 1}
            onChange={(e) => onChange(parseFloat(e.target.value))}
          />
        </div>
      );
    case 'boolean':
      return (
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
        />
      );
    case 'string':
      return (
        <input
          type="text"
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case 'select':
      return (
        <select value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
          {(schema.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      );
    case 'color':
      return (
        <div className="color-input">
          <input
            type="color"
            value={String(value ?? '#b8c4d0')}
            onChange={(e) => onChange(e.target.value)}
            title="Farbe waehlen"
          />
          <input
            type="text"
            value={String(value ?? '')}
            onChange={(e) => onChange(e.target.value)}
            className="color-input__hex"
            placeholder="#b8c4d0"
          />
        </div>
      );
    case 'edgeList':
      return null; // wird separat via EdgeListControls gerendert, weil node-id benoetigt wird
  }
}

function SketchControls({ node }: { node: GraphNode }) {
  const [open, setOpen] = useState(false);
  const sketchJson = (node.params.sketchJson as string) ?? '';
  const hasSketch = sketchJson.length > 10;
  return (
    <div className="sketch-controls">
      <button className="btn btn--primary" style={{ width: '100%' }} onClick={() => setOpen(true)}>
        ✏️ {hasSketch ? 'Skizze bearbeiten' : 'Skizze zeichnen'}
      </button>
      {hasSketch && (
        <div className="sketch-controls__hint">
          Skizze vorhanden — bearbeiten oder neu zeichnen
        </div>
      )}
      {open && <SketchEditorModal nodeId={node.id} onClose={() => setOpen(false)} />}
    </div>
  );
}

function ImportedStepControls({ node }: { node: GraphNode }) {
  const update = useGraphStore((s) => s.updateNodeParam);
  const assets = useAssetStore((s) => s.assets);
  const addAsset = useAssetStore((s) => s.addAsset);
  const fileRef = useRef<HTMLInputElement>(null);
  const currentId = String(node.params.assetId ?? '');
  const current = currentId ? assets.get(currentId) : undefined;

  const handleFile = async (file: File) => {
    const buf = await file.arrayBuffer();
    const id = await addAsset(file.name, new Uint8Array(buf));
    update(node.id, 'assetId', id);
    update(node.id, 'filename', file.name);
  };

  return (
    <div className="step-controls">
      <div className="step-controls__current">
        {current ? (
          <>
            <div><strong>{current.filename}</strong></div>
            <div className="step-controls__meta">{(current.size / 1024).toFixed(1)} KB</div>
          </>
        ) : (
          <div className="step-controls__empty">noch keine Datei geladen</div>
        )}
      </div>
      <input
        type="file"
        ref={fileRef}
        accept=".step,.stp,.STEP,.STP"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f).catch(console.error);
        }}
      />
      <button className="btn" onClick={() => fileRef.current?.click()}>
        📂 STEP-Datei wählen
      </button>
    </div>
  );
}

function ImportedStlControls({ node }: { node: GraphNode }) {
  const update = useGraphStore((s) => s.updateNodeParam);
  const assets = useAssetStore((s) => s.assets);
  const addAsset = useAssetStore((s) => s.addAsset);
  const fileRef = useRef<HTMLInputElement>(null);
  const currentId = String(node.params.assetId ?? '');
  const current = currentId ? assets.get(currentId) : undefined;

  const handleFile = async (file: File) => {
    const buf = await file.arrayBuffer();
    const id = await addAsset(file.name, new Uint8Array(buf));
    update(node.id, 'assetId', id);
    update(node.id, 'filename', file.name);
  };

  return (
    <div className="step-controls">
      <div className="step-controls__current">
        {current ? (
          <>
            <div><strong>{current.filename}</strong></div>
            <div className="step-controls__meta">{(current.size / 1024).toFixed(1)} KB</div>
          </>
        ) : (
          <div className="step-controls__empty">noch keine Datei geladen</div>
        )}
      </div>
      <input
        type="file"
        ref={fileRef}
        accept=".stl,.STL"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f).catch(console.error);
        }}
      />
      <button className="btn" onClick={() => fileRef.current?.click()}>
        📂 STL-Datei wählen
      </button>
    </div>
  );
}

function EdgeListControls({ node }: { node: GraphNode }) {
  const pickingNodeId = useSelectionStore((s) => s.pickingNodeId);
  const startPicking = useSelectionStore((s) => s.startPicking);
  const stopPicking = useSelectionStore((s) => s.stopPicking);
  const updateParam = useGraphStore((s) => s.updateNodeParam);
  const edgeIds: string[] = Array.isArray(node.params.edgeIds) ? (node.params.edgeIds as string[]) : [];
  const isPickingThis = pickingNodeId === node.id;

  const clearAll = () => updateParam(node.id, 'edgeIds', []);
  const removeOne = (id: string) =>
    updateParam(node.id, 'edgeIds', edgeIds.filter((e) => e !== id));

  return (
    <div className="edge-list">
      <div className="edge-list__header">
        <span>Kanten-Auswahl</span>
        <span className="edge-list__count">{edgeIds.length}</span>
      </div>
      <div className="edge-list__actions">
        {isPickingThis ? (
          <button className="btn btn--primary" onClick={stopPicking}>
            ✓ Auswahl fertig
          </button>
        ) : (
          <button className="btn" onClick={() => startPicking(node.id)}>
            🎯 Kanten waehlen
          </button>
        )}
        {edgeIds.length > 0 && (
          <button className="btn btn--ghost" onClick={clearAll}>
            ✕ Alle entfernen
          </button>
        )}
      </div>
      {edgeIds.length === 0 ? (
        <div className="edge-list__hint">
          Klicke <em>Kanten waehlen</em> und dann im Viewer auf die gewuenschten Kanten.
        </div>
      ) : (
        <ul className="edge-list__items">
          {edgeIds.map((id) => (
            <li key={id} className="edge-list__item">
              <code>{id.slice(0, 18)}…</code>
              <button className="btn btn--ghost" onClick={() => removeOne(id)} title="entfernen">×</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sketch dimensional constraint params (publishable)
// ---------------------------------------------------------------------------

const DIM_TYPES = ['length', 'radius', 'distance', 'angle'] as const;
type DimType = typeof DIM_TYPES[number];

function SketchConstraintControls({ node }: { node: GraphNode }) {
  let constraints: SketchConstraint[] = [];
  try {
    const sk = JSON.parse((node.params.sketchJson as string) ?? '{}');
    constraints = Object.values(sk.constraints ?? {}) as SketchConstraint[];
  } catch { /* */ }

  const dimConstraints = constraints.filter(
    (c): c is SketchConstraint & { type: DimType; value: number } =>
      DIM_TYPES.includes(c.type as DimType),
  );
  const fixedConstraints = constraints.filter(
    (c): c is Extract<SketchConstraint, { type: 'fixed' }> => c.type === 'fixed',
  );

  if (dimConstraints.length === 0 && fixedConstraints.length === 0) return null;

  const schemas: NodeParamSchema[] = [];
  const typeCount: Record<string, number> = {};

  for (const c of dimConstraints) {
    typeCount[c.type] = (typeCount[c.type] ?? 0) + 1;
    const n = typeCount[c.type];
    const lbl: Record<DimType, string> = { length: 'Länge', radius: 'Radius', distance: 'Abstand', angle: 'Winkel' };
    schemas.push({
      key: c.id,
      label: `${lbl[c.type as DimType]} ${n}`,
      kind: 'number',
      unit: c.type === 'angle' ? '°' : 'mm',
      min: c.type === 'angle' ? -360 : 0.1,
      max: c.type === 'angle' ? 360 : 10000,
      step: 0.1,
      default: c.value,
    });
  }
  for (const fc of fixedConstraints) {
    schemas.push(
      { key: fc.id + '_x', label: 'Koordinate X', kind: 'number', unit: 'mm', min: -10000, max: 10000, step: 0.1, default: fc.x },
      { key: fc.id + '_y', label: 'Koordinate Y', kind: 'number', unit: 'mm', min: -10000, max: 10000, step: 0.1, default: fc.y },
    );
  }

  return (
    <div className="sketch-constraint-params">
      <div className="sketch-constraint-params__title">Maße &amp; Koordinaten</div>
      {schemas.map((s) => <ParamRow key={s.key} node={node} schema={s} />)}
    </div>
  );
}
