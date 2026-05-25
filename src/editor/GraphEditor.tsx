// src/editor/GraphEditor.tsx
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  type Node as RFNode,
  type Edge as RFEdge,
  type Connection,
  type NodeProps,
  useReactFlow,
  ReactFlowProvider,
  BackgroundVariant,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useCallback, useMemo, type DragEvent } from 'react';
import { useGraphStore } from '../state/graphStore';
import { useStatusStore } from '../state/statusStore';
import { useClipboardShortcuts } from './useClipboard';
import { getNodeSpec, SOCKET_COLORS, CATEGORY_COLORS } from '../graph/nodeRegistry';
import type { GraphEdge, GraphNode } from '../graph/graphTypes';

// ============================================================================
// Custom Node-Komponente - eine fuer alle Typen, gesteuert per NodeSpec
// ============================================================================

interface CustomNodeData extends Record<string, unknown> {
  graphNode: GraphNode;
}

function CustomNode({ id, data, selected }: NodeProps<RFNode<CustomNodeData>>) {
  const node = data.graphNode;
  const spec = getNodeSpec(node.type);
  const setSelected = useGraphStore((s) => s.setSelectedNode);
  const remove = useGraphStore((s) => s.removeNode);
  const updateParam = useGraphStore((s) => s.updateNodeParam);
  const status = useStatusStore((s) => s.nodeDiagnostics.statusByNode.get(id));
  const error = useStatusStore((s) => s.nodeDiagnostics.errors.get(id));
  const duration = useStatusStore((s) => s.nodeDiagnostics.durations.get(id));

  if (!spec) {
    return <div className="node node--unknown">Unbekannt: {node.type}</div>;
  }

  const accent = spec.accent ?? CATEGORY_COLORS[spec.category];

  return (
    <div
      className={`node node--${spec.category} ${selected ? 'node--selected' : ''} ${status === 'error' ? 'node--error' : ''}`}
      onClick={() => setSelected(id)}
      style={{ '--accent': accent } as React.CSSProperties}
    >
      <div className="node__header">
        <span className="node__category">{spec.category}</span>
        <span className="node__title">{spec.label}</span>
        <button
          className="node__close"
          onClick={(e) => { e.stopPropagation(); remove(id); }}
          title="löschen"
        >×</button>
      </div>

      <div className="node__body">
        {/* Inline-Slider/Number direkt am Node fuer schnelle Bedienung */}
        {node.type === 'slider' && (
          <SliderInline
            value={Number(node.params.value ?? 0)}
            min={Number(node.params.min ?? 0)}
            max={Number(node.params.max ?? 100)}
            step={Number(node.params.step ?? 1)}
            label={String(node.params.label ?? '')}
            onChange={(v) => updateParam(id, 'value', v)}
          />
        )}
        {node.type === 'number' && (
          <input
            type="number"
            className="node__inline-input nodrag nopan"
            value={Number(node.params.value ?? 0)}
            step={0.1}
            onChange={(e) => updateParam(id, 'value', parseFloat(e.target.value))}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          />
        )}

        <div className="node__sockets">
          <div className="node__inputs">
            {spec.inputs.map((s, i) => (
              <div key={s.id} className="socket-row" style={{ top: 38 + i * 18 }}>
                <Handle
                  id={s.id}
                  type="target"
                  position={Position.Left}
                  style={{ background: SOCKET_COLORS[s.dataType] ?? '#888', top: 38 + i * 18 }}
                />
                <span className="socket-row__label">{s.label}</span>
              </div>
            ))}
          </div>
          <div className="node__outputs">
            {spec.outputs.map((s, i) => (
              <div key={s.id} className="socket-row socket-row--out" style={{ top: 38 + i * 18 }}>
                <span className="socket-row__label">{s.label}</span>
                <Handle
                  id={s.id}
                  type="source"
                  position={Position.Right}
                  style={{ background: SOCKET_COLORS[s.dataType] ?? '#888', top: 38 + i * 18 }}
                />
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="node__footer">
        {status === 'error' ? (
          <span className="node__status node__status--error" title={error}>⚠ Fehler</span>
        ) : status === 'ok' ? (
          <span className="node__status node__status--ok">
            ✓ {duration !== undefined ? `${duration.toFixed(0)} ms` : ''}
          </span>
        ) : (
          <span className="node__status">…</span>
        )}
      </div>
    </div>
  );
}

function SliderInline({
  value, min, max, step, label, onChange,
}: { value: number; min: number; max: number; step: number; label: string; onChange: (v: number) => void }) {
  // WICHTIG fuer React Flow:
  //   - className "nodrag" + "nopan" verhindert, dass RF den Slider als Node-Drag interpretiert
  //   - onPointerDown stopPropagation: zusaetzlicher Schutz fuer Browser, die Pointer-Capture
  //     anders handhaben (Safari, manche Firefox-Versionen). Ohne das laesst sich der Slider
  //     teilweise nicht "loslassen", weil RF den Pointer kapert.
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <div
      className="slider-inline nodrag nopan"
      onPointerDown={stop}
      onMouseDown={stop}
      onClick={stop}
    >
      {label ? <div className="slider-inline__label">{label}</div> : null}
      <div className="slider-inline__row">
        <input
          type="range"
          className="nodrag nopan"
          min={min} max={max} step={step} value={value}
          onPointerDown={stop}
          onMouseDown={stop}
          onChange={(e) => onChange(parseFloat(e.target.value))}
        />
        <input
          type="number"
          className="nodrag nopan"
          min={min} max={max} step={step} value={value}
          onPointerDown={stop}
          onMouseDown={stop}
          onChange={(e) => onChange(parseFloat(e.target.value))}
        />
      </div>
    </div>
  );
}

const nodeTypes = { custom: CustomNode };

// ============================================================================
// Graph Editor selbst
// ============================================================================

function GraphEditorInner() {
  const doc = useGraphStore((s) => s.doc);
  const updatePos = useGraphStore((s) => s.updateNodePosition);
  const addEdge = useGraphStore((s) => s.addEdge);
  const removeEdge = useGraphStore((s) => s.removeEdge);
  const addNode = useGraphStore((s) => s.addNode);
  const setSelected = useGraphStore((s) => s.setSelectedNode);

  // Tastatur-Shortcuts: Cmd/Ctrl+C/V/D, Del/Backspace
  useClipboardShortcuts();

  const { screenToFlowPosition } = useReactFlow();

  const rfNodes: RFNode<CustomNodeData>[] = useMemo(
    () =>
      doc.nodes.map((n) => ({
        id: n.id,
        position: n.position,
        type: 'custom',
        data: { graphNode: n },
      })),
    [doc.nodes],
  );

  const rfEdges: RFEdge[] = useMemo(
    () =>
      doc.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle,
        targetHandle: e.targetHandle,
        type: 'default',
      })),
    [doc.edges],
  );

  const onConnect = useCallback(
    (c: Connection) => {
      if (!c.source || !c.target || !c.sourceHandle || !c.targetHandle) return;
      addEdge({
        source: c.source,
        sourceHandle: c.sourceHandle,
        target: c.target,
        targetHandle: c.targetHandle,
      });
    },
    [addEdge],
  );

  const onEdgesDelete = useCallback(
    (edges: RFEdge[]) => edges.forEach((e) => removeEdge(e.id)),
    [removeEdge],
  );

  const onNodeDragStop = useCallback(
    (_e: unknown, node: RFNode) => updatePos(node.id, node.position),
    [updatePos],
  );

  const onPaneClick = useCallback(() => setSelected(null), [setSelected]);

  const onDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault();
      const type = event.dataTransfer.getData('application/cad-node');
      if (!type) return;
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      addNode(type, position);
    },
    [addNode, screenToFlowPosition],
  );

  const onDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  return (
    <div className="graph-editor" onDrop={onDrop} onDragOver={onDragOver}>
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        onConnect={onConnect}
        onEdgesDelete={onEdgesDelete}
        onNodeDragStop={onNodeDragStop}
        onPaneClick={onPaneClick}
        proOptions={{ hideAttribution: true }}
        fitView
        defaultEdgeOptions={{
          style: { stroke: '#5a6470', strokeWidth: 1.8 },
        }}
        connectionLineStyle={{ stroke: '#1e3a8a', strokeWidth: 2 }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#cdd3dc" />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable nodeStrokeWidth={2} maskColor="rgba(220, 226, 234, 0.7)" />
      </ReactFlow>
    </div>
  );
}

export function GraphEditor() {
  return (
    <ReactFlowProvider>
      <GraphEditorInner />
    </ReactFlowProvider>
  );
}
