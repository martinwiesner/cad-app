// src/editor/NodePalette.tsx
import { listNodeTypes, CATEGORY_COLORS } from '../graph/nodeRegistry';
import type { DragEvent } from 'react';

const CATEGORY_ORDER = ['parameter', 'primitive', 'operation', 'feature', 'transform', 'render', 'io'] as const;
const CATEGORY_LABELS: Record<string, string> = {
  parameter: 'Parameter',
  primitive: 'Primitive',
  operation: 'Boolean',
  feature: 'Features',
  transform: 'Transform',
  io: 'Ein-/Ausgabe',
};

export function NodePalette() {
  const all = listNodeTypes();
  const byCat = new Map<string, typeof all>();
  for (const spec of all) {
    if (!byCat.has(spec.category)) byCat.set(spec.category, []);
    byCat.get(spec.category)!.push(spec);
  }

  const onDragStart = (e: DragEvent, type: string) => {
    e.dataTransfer.setData('application/cad-node', type);
    e.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div className="palette">
      <div className="palette__header">
        <span>NODES</span>
        <span className="palette__hint">drag in editor</span>
      </div>
      {CATEGORY_ORDER.filter((c) => byCat.has(c)).map((cat) => (
        <div key={cat} className="palette__group">
          <div className="palette__group-title" style={{ color: CATEGORY_COLORS[cat] }}>
            {CATEGORY_LABELS[cat]}
          </div>
          {byCat.get(cat)!.map((spec) => (
            <div
              key={spec.type}
              className="palette__item"
              draggable
              onDragStart={(e) => onDragStart(e, spec.type)}
              style={{ borderLeftColor: CATEGORY_COLORS[cat] }}
            >
              {spec.label}
            </div>
          ))}
        </div>
      ))}
      <div className="palette__shortcuts">
        <div className="palette__shortcuts-title">SHORTCUTS</div>
        <div className="palette__shortcut"><kbd>⌘C</kbd>/<kbd>Ctrl+C</kbd> kopieren</div>
        <div className="palette__shortcut"><kbd>⌘V</kbd>/<kbd>Ctrl+V</kbd> einfügen</div>
        <div className="palette__shortcut"><kbd>⌘D</kbd>/<kbd>Ctrl+D</kbd> duplizieren</div>
        <div className="palette__shortcut"><kbd>Del</kbd> löschen</div>
        <div className="palette__shortcut"><kbd>Esc</kbd> Picking abbrechen</div>
      </div>
    </div>
  );
}
