// src/sketch/SketchEditor.tsx
// Full-screen modal sketch editor.

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { SketchCanvas, type DrawTool } from './SketchCanvas';
import { type SketchData, emptySketch } from './sketchTypes';
import { solveSketch } from './sketchSolver';
import { useGraphStore } from '../state/graphStore';

// ---------------------------------------------------------------------------
// Exported opener (used from PropertiesPanel)
// ---------------------------------------------------------------------------

interface EditorModalProps {
  nodeId: string;
  onClose: () => void;
}

export function SketchEditorModal({ nodeId, onClose }: EditorModalProps) {
  const updateParam = useGraphStore((s) => s.updateNodeParam);
  const node = useGraphStore((s) => s.doc.nodes.find((n) => n.id === nodeId));
  const run = useGraphStore((s) => s.run);

  const initialSketch: SketchData = (() => {
    try {
      const raw = node?.params?.sketchJson;
      if (typeof raw === 'string' && raw) return JSON.parse(raw) as SketchData;
    } catch { /* */ }
    return emptySketch();
  })();

  const [sketch, setSketch] = useState<SketchData>(initialSketch);
  const [tool, setTool] = useState<DrawTool>('select');
  const [dof, setDof] = useState<number | null>(null);

  const handleChange = (s: SketchData) => {
    setSketch(s);
    const result = solveSketch(s);
    setDof(result.dof);
  };

  const handleConfirm = () => {
    const solved = solveSketch(sketch);
    updateParam(nodeId, 'sketchJson', JSON.stringify(solved.sketch));
    run().catch(console.error);
    onClose();
  };

  return createPortal(
    <div className="sk-modal" onKeyDown={(e) => e.stopPropagation()}>
      {/* Toolbar */}
      <div className="sk-toolbar">
        <span className="sk-toolbar__brand">Skizze bearbeiten</span>

        <div className="sk-toolbar__tools">
          <button
            className={`sk-tool-btn ${tool === 'select' ? 'sk-tool-btn--active' : ''}`}
            onClick={() => setTool('select')} title="Auswählen / Verschieben (S)">
            ↖ Auswahl
          </button>
          <button
            className={`sk-tool-btn ${tool === 'line' ? 'sk-tool-btn--active' : ''}`}
            onClick={() => setTool('line')} title="Linie zeichnen (L)">
            / Linie
          </button>
          <button
            className={`sk-tool-btn ${tool === 'arc' ? 'sk-tool-btn--active' : ''}`}
            onClick={() => setTool('arc')} title="Bogen zeichnen (A)">
            ⌒ Bogen
          </button>
          <button
            className={`sk-tool-btn ${tool === 'circle' ? 'sk-tool-btn--active' : ''}`}
            onClick={() => setTool('circle')} title="Kreis zeichnen (C)">
            ○ Kreis
          </button>
          <button
            className={`sk-tool-btn ${tool === 'bezier' ? 'sk-tool-btn--active' : ''}`}
            onClick={() => setTool('bezier')} title="Bézierkurve zeichnen (B)">
            ∿ Bézier
          </button>
        </div>

        <div className="sk-toolbar__divider" />

        <div className="sk-toolbar__info">
          <ConstraintStatusBadge dof={dof} />
          <span className="sk-stat">
            {Object.keys(sketch.entities).length} Elemente
          </span>
          <span className="sk-stat">
            {Object.keys(sketch.constraints).length} Bedingungen
          </span>
        </div>

        <div className="sk-toolbar__divider" />

        <div className="sk-toolbar__help">
          <small>
            Linie: Klick→Klick→…→Doppelklick/ESC · Bézier: Klick=Eck, Klick+Ziehen=glatt · 2 Elemente→Tangential/Parallel · Entf: löschen
          </small>
        </div>

        <div className="sk-toolbar__actions">
          <button className="btn" onClick={onClose}>Abbrechen</button>
          <button className="btn btn--primary" onClick={handleConfirm}>✓ Übernehmen</button>
        </div>
      </div>

      {/* Canvas */}
      <SketchCanvas
        sketch={sketch}
        tool={tool}
        onChange={handleChange}
        onToolChange={setTool}
      />
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// DOF badge
// ---------------------------------------------------------------------------

function ConstraintStatusBadge({ dof }: { dof: number | null }) {
  if (dof === null) return <span className="sk-dof sk-dof--neutral">–</span>;
  if (dof === 0) return <span className="sk-dof sk-dof--ok">✓ Vollständig bestimmt</span>;
  if (dof > 0) return <span className="sk-dof sk-dof--under">+{dof} FG unbestimmt</span>;
  return <span className="sk-dof sk-dof--over">{dof} überbestimmt</span>;
}

