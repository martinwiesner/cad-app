// src/sketch/SketchCanvas.tsx
// Interactive SVG canvas for 2D sketch editing.
// Coordinate system: sketch = standard math (Y up), canvas = SVG (Y down).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type SketchData,
  type PointId,
  type EntityId,
  type ConstraintId,
  type SketchEntity,
  type SketchBezier,
  type SketchConstraint,
  newId,
  entityPointIds,
} from './sketchTypes';
import { solveSketch } from './sketchSolver';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DrawTool = 'select' | 'line' | 'arc' | 'circle' | 'bezier';

type DrawState =
  | { mode: 'idle' }
  | { mode: 'line'; chainStart: PointId; prev: PointId }
  | { mode: 'arc_center' }
  | { mode: 'arc_p1'; center: PointId }
  | { mode: 'arc_p2'; center: PointId; p1: PointId }
  | { mode: 'circle_center' }
  | { mode: 'circle_rim'; center: PointId }
  | {
      mode: 'bezier';
      chainStart: PointId;
      chainStartIn: PointId; // in-handle of first anchor (for loop-close)
      prevAnchor: PointId;
      prevOut: PointId;      // out-handle of prevAnchor
    };

interface BezierDragState {
  anchorId: PointId;
  startX: number; startY: number;
  hasSeparated: boolean;
  outId: PointId | null;
  inId: PointId | null;
  bezierEid: EntityId | null; // entity whose cp2 we may need to update
}

interface DragState {
  type: 'point';
  pid: PointId;
  startParams: Float64Array;
}

export interface ConstraintCandidate {
  type: SketchConstraint['type'];
  label: string;
}

interface Props {
  sketch: SketchData;
  tool: DrawTool;
  onChange: (s: SketchData) => void;
  onToolChange: (t: DrawTool) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SNAP_PX = 18;
const POINT_R = 4;
const COLORS = {
  grid: '#2a2a30',
  axis: '#3a3a44',
  entity: '#6b8090',
  entityHover: '#9ab4c8',
  entitySelected: '#5c9bff',
  point: '#7888a0',
  pointHover: '#aaccdd',
  pointSelected: '#5c9bff',
  pointFixed: '#44cc66',
  dim: '#c8a060',
  conIcon: '#a08040',
  preview: '#4488cc88',
  chainClose: '#44dd88',
  bezierHandle: '#cc88ff',
};

const BEZIER_DRAG_THRESHOLD_PX = 4;

// ---------------------------------------------------------------------------
// Canvas component
// ---------------------------------------------------------------------------

export function SketchCanvas({ sketch, tool, onChange, onToolChange }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);

  // Viewport state
  const [zoom, setZoom] = useState(4); // px per mm
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);

  // Interaction state
  const [drawState, setDrawState] = useState<DrawState>({ mode: 'idle' });
  const [hover, setHover] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [drag, setDrag] = useState<DragState | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef<{ mx: number; my: number; px: number; py: number } | null>(null);

  // Two-step coincident pick mode: user clicks "Kongruenz", then picks second point
  const [coincidentPick, setCoincidentPick] = useState<PointId | null>(null);

  // Bézier handle drag state (tracks mouse-down while placing bezier anchors)
  const [bezierDrag, setBezierDrag] = useState<BezierDragState | null>(null);

  // Inline dimension editing (fixed-point coordinates)
  const [editingDim, setEditingDim] = useState<{
    constraintId: ConstraintId;
    axis: 'x' | 'y';
    value: string;
    screenX: number;
    screenY: number;
  } | null>(null);

  // Bezier control-handle point IDs — hidden from regular point rendering
  const bezierHandleIds = useMemo(() => {
    const s = new Set<PointId>();
    for (const e of Object.values(sketch.entities)) {
      if (e.type !== 'bezier') continue;
      if (e.cp1 !== e.p1) s.add(e.cp1);
      if (e.cp2 !== e.p2) s.add(e.cp2);
    }
    return s;
  }, [sketch.entities]);

  // Size
  const [size, setSize] = useState({ w: 800, h: 600 });
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setSize({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Reset draw state when tool changes
  useEffect(() => { setDrawState({ mode: 'idle' }); }, [tool]);

  // Commit inline dim edit
  const commitDimEdit = useCallback(() => {
    if (!editingDim) return;
    const v = parseFloat(editingDim.value.replace(',', '.'));
    const c = sketch.constraints[editingDim.constraintId];
    if (isFinite(v) && c && c.type === 'fixed') {
      const updated = editingDim.axis === 'x' ? { ...c, x: v } : { ...c, y: v };
      const next = { ...sketch, constraints: { ...sketch.constraints, [c.id]: updated } };
      onChange(solveSketch(next).sketch);
    }
    setEditingDim(null);
  }, [editingDim, sketch, onChange]);

  // Key handler: Escape to cancel draw / deselect
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      // Don't steal keypresses from the inline dim input
      if (document.activeElement?.tagName === 'INPUT') return;
      if (e.key === 'Escape') {
        setDrawState({ mode: 'idle' });
        setSelected(new Set());
        setBezierDrag(null);
        onToolChange('select');
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selected.size > 0) {
          onChange(deleteSelected(sketch, selected));
          setSelected(new Set());
        }
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [sketch, selected, onChange, onToolChange]);

  // ---------------------------------------------------------------------------
  // Coordinate helpers
  // ---------------------------------------------------------------------------

  const cx = size.w / 2 + panX;
  const cy = size.h / 2 + panY;

  const s2c = useCallback((x: number, y: number) => ({
    sx: cx + x * zoom,
    sy: cy - y * zoom,
  }), [cx, cy, zoom]);

  const c2s = useCallback((sx: number, sy: number) => ({
    x: (sx - cx) / zoom,
    y: -(sy - cy) / zoom,
  }), [cx, cy, zoom]);

  const clientToSketch = (e: React.MouseEvent | MouseEvent) => {
    const rect = svgRef.current!.getBoundingClientRect();
    return c2s(e.clientX - rect.left, e.clientY - rect.top);
  };

  // Snap: find nearest point within SNAP_PX (optionally excluding a set of IDs)
  const snapToPoint = (x: number, y: number, excludeId?: PointId, excludeSet?: Set<PointId>): PointId | null => {
    const snapMm = SNAP_PX / zoom;
    let best: PointId | null = null;
    let bestDist = snapMm;
    for (const p of Object.values(sketch.points)) {
      if (p.id === excludeId) continue;
      if (excludeSet?.has(p.id)) continue;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bestDist) { bestDist = d; best = p.id; }
    }
    return best;
  };

  // ---------------------------------------------------------------------------
  // Mouse event handlers
  // ---------------------------------------------------------------------------

  const handleMouseMove = (e: React.MouseEvent) => {
    const sk = clientToSketch(e);
    setCursor(sk);

    if (isPanning && panStart.current) {
      const rect = svgRef.current!.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      setPanX(panStart.current.px + mx - panStart.current.mx);
      setPanY(panStart.current.py + my - panStart.current.my);
      return;
    }

    // Bézier handle drag (pulling handles while placing a bezier anchor)
    if (bezierDrag) {
      const anchor = sketch.points[bezierDrag.anchorId];
      if (!anchor) return;
      const dxPx = (sk.x - bezierDrag.startX) * zoom;
      const dyPx = (sk.y - bezierDrag.startY) * zoom;

      if (!bezierDrag.hasSeparated && Math.hypot(dxPx, dyPx) > BEZIER_DRAG_THRESHOLD_PX) {
        // First real drag: create separate handle points
        let s = sketch;
        const { id: outId, sketch: s1 } = addPoint(s, sk.x, sk.y);
        s = s1;
        const { id: inId, sketch: s2 } = addPoint(s, 2 * anchor.x - sk.x, 2 * anchor.y - sk.y);
        s = s2;
        // If there's a bezier entity waiting for its cp2, update it
        if (bezierDrag.bezierEid) {
          const bz = s.entities[bezierDrag.bezierEid] as SketchBezier;
          s = { ...s, entities: { ...s.entities, [bz.id]: { ...bz, cp2: inId } } };
        }
        onChange(s);
        setBezierDrag({ ...bezierDrag, hasSeparated: true, outId, inId });
      } else if (bezierDrag.hasSeparated && bezierDrag.outId && bezierDrag.inId) {
        let s = movePoint(sketch, bezierDrag.outId, sk.x, sk.y);
        s = movePoint(s, bezierDrag.inId, 2 * anchor.x - sk.x, 2 * anchor.y - sk.y);
        onChange(s);
      }
      return;
    }

    if (drag) {
      const isFixed = Object.values(sketch.constraints).some(
        (c) => c.type === 'fixed' && c.point === drag.pid,
      );
      if (!isFixed) {
        const solved = solveSketch(movePoint(sketch, drag.pid, sk.x, sk.y));
        onChange(solved.sketch);
      }
      return;
    }

    // Hover detection
    const snapPid = snapToPoint(sk.x, sk.y);
    if (snapPid) { setHover(snapPid); return; }
    const eid = hitEntity(sk.x, sk.y, sketch, zoom);
    setHover(eid);
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      // Middle-drag = pan
      const rect = svgRef.current!.getBoundingClientRect();
      panStart.current = {
        mx: e.clientX - rect.left,
        my: e.clientY - rect.top,
        px: panX, py: panY,
      };
      setIsPanning(true);
      return;
    }
    if (e.button !== 0) return;

    const sk = clientToSketch(e);

    // Point drag in select mode
    if (tool === 'select') {
      const snapPid = snapToPoint(sk.x, sk.y);

      // Coincident pick mode: second click picks target point
      if (coincidentPick && snapPid && snapPid !== coincidentPick) {
        const c: SketchConstraint = { id: newId('con'), type: 'coincident', p1: coincidentPick, p2: snapPid };
        addConstraint(c);
        setCoincidentPick(null);
        setSelected(new Set());
        return;
      }
      if (coincidentPick && snapPid === null) {
        // Clicked empty space — cancel
        setCoincidentPick(null);
        setSelected(new Set());
        return;
      }

      if (snapPid) {
        setDrag({ type: 'point', pid: snapPid, startParams: new Float64Array(0) });
        setSelected(new Set([snapPid]));
        return;
      }
      const eid = hitEntity(sk.x, sk.y, sketch, zoom);
      if (eid) {
        setSelected(prev => {
          const next = new Set(e.shiftKey ? prev : []);
          if (prev.has(eid)) next.delete(eid); else next.add(eid);
          return next;
        });
        return;
      }
      if (!e.shiftKey) setSelected(new Set());
      return;
    }

    // Drawing tools (exclude bezier handle points from snap)
    const snapPid = snapToPoint(sk.x, sk.y, undefined, bezierHandleIds);

    // -----------------------------------------------------------------------
    // Bézier pen tool
    // -----------------------------------------------------------------------
    if (tool === 'bezier') {
      if (drawState.mode === 'idle' || drawState.mode === 'bezier') {
        const isBezierChain = drawState.mode === 'bezier';

        // Close bezier chain
        if (isBezierChain && snapPid === drawState.chainStart) {
          const closingEid = newId('bz');
          const closingBezier: SketchBezier = {
            id: closingEid, type: 'bezier',
            p1: drawState.prevAnchor, cp1: drawState.prevOut,
            cp2: drawState.chainStartIn, p2: drawState.chainStart,
          };
          onChange({ ...sketch, entities: { ...sketch.entities, [closingEid]: closingBezier } });
          setDrawState({ mode: 'idle' });
          onToolChange('select');
          return;
        }

        // Place new anchor
        let anchorId: PointId;
        let workSketch = sketch;
        if (snapPid) {
          anchorId = snapPid;
        } else {
          const { id, sketch: sk1 } = addPoint(sketch, sk.x, sk.y);
          anchorId = id;
          workSketch = sk1;
        }

        // If chaining: create bezier segment from prevAnchor to new anchor (cp2=anchor=corner by default)
        let bezierEid: EntityId | null = null;
        if (isBezierChain) {
          bezierEid = newId('bz');
          const seg: SketchBezier = {
            id: bezierEid, type: 'bezier',
            p1: drawState.prevAnchor, cp1: drawState.prevOut,
            cp2: anchorId,  // corner, may be updated on drag
            p2: anchorId,
          };
          workSketch = { ...workSketch, entities: { ...workSketch.entities, [bezierEid]: seg } };
        }

        onChange(workSketch);
        setBezierDrag({
          anchorId,
          startX: sk.x, startY: sk.y,
          hasSeparated: false,
          outId: null, inId: null,
          bezierEid,
        });
      }
      return;
    }

    if (tool === 'line') {
      if (drawState.mode === 'idle') {
        if (snapPid) {
          setDrawState({ mode: 'line', chainStart: snapPid, prev: snapPid });
        } else {
          const { id, sketch: sk1 } = addPoint(sketch, sk.x, sk.y);
          onChange(sk1);
          setDrawState({ mode: 'line', chainStart: id, prev: id });
        }
      } else if (drawState.mode === 'line') {
        let nextPid: PointId;
        let closing = false;
        let base = sketch;
        if (snapPid && snapPid === drawState.chainStart) {
          nextPid = drawState.chainStart;
          closing = true;
        } else if (snapPid) {
          nextPid = snapPid;
        } else {
          const { id, sketch: sk1 } = addPoint(sketch, sk.x, sk.y);
          nextPid = id;
          base = sk1;
        }
        onChange(addLine(base, drawState.prev, nextPid));
        if (closing) {
          setDrawState({ mode: 'idle' });
          onToolChange('select');
        } else {
          setDrawState({ mode: 'line', chainStart: drawState.chainStart, prev: nextPid });
        }
      }
    } else if (tool === 'arc') {
      if (drawState.mode === 'idle') {
        if (snapPid) {
          setDrawState({ mode: 'arc_p1', center: snapPid });
        } else {
          const { id, sketch: sk1 } = addPoint(sketch, sk.x, sk.y);
          onChange(sk1);
          setDrawState({ mode: 'arc_p1', center: id });
        }
      } else if (drawState.mode === 'arc_p1') {
        if (snapPid) {
          setDrawState({ mode: 'arc_p2', center: drawState.center, p1: snapPid });
        } else {
          const { id, sketch: sk1 } = addPoint(sketch, sk.x, sk.y);
          onChange(sk1);
          setDrawState({ mode: 'arc_p2', center: drawState.center, p1: id });
        }
      } else if (drawState.mode === 'arc_p2') {
        let nextPid: PointId;
        let base = sketch;
        if (snapPid) {
          nextPid = snapPid;
        } else {
          const { id, sketch: sk1 } = addPoint(sketch, sk.x, sk.y);
          nextPid = id;
          base = sk1;
        }
        onChange(addArc(base, drawState.center, drawState.p1, nextPid));
        setDrawState({ mode: 'idle' });
        onToolChange('select');
      }
    } else if (tool === 'circle') {
      if (drawState.mode === 'idle') {
        if (snapPid) {
          setDrawState({ mode: 'circle_rim', center: snapPid });
        } else {
          const { id, sketch: sk1 } = addPoint(sketch, sk.x, sk.y);
          onChange(sk1);
          setDrawState({ mode: 'circle_rim', center: id });
        }
      } else if (drawState.mode === 'circle_rim') {
        let nextPid: PointId;
        let base = sketch;
        if (snapPid) {
          nextPid = snapPid;
        } else {
          const { id, sketch: sk1 } = addPoint(sketch, sk.x, sk.y);
          nextPid = id;
          base = sk1;
        }
        onChange(addCircle(base, drawState.center, nextPid));
        setDrawState({ mode: 'idle' });
        onToolChange('select');
      }
    }
  };

  const handleMouseUp = () => {
    if (isPanning) { setIsPanning(false); panStart.current = null; }
    if (drag) setDrag(null);

    if (bezierDrag) {
      const { anchorId, hasSeparated, outId, inId, bezierEid } = bezierDrag;
      const outHandle = hasSeparated && outId ? outId : anchorId;
      const inHandle  = hasSeparated && inId  ? inId  : anchorId;

      if (hasSeparated && bezierEid) {
        // Ensure the closing bezier's cp2 is the actual inHandle
        const bz = sketch.entities[bezierEid] as SketchBezier | undefined;
        if (bz && bz.cp2 !== inHandle) {
          onChange({ ...sketch, entities: { ...sketch.entities, [bz.id]: { ...bz, cp2: inHandle } } });
        }
      }

      setDrawState((prev) => {
        if (prev.mode === 'idle') {
          return {
            mode: 'bezier',
            chainStart: anchorId,
            chainStartIn: inHandle,
            prevAnchor: anchorId,
            prevOut: outHandle,
          };
        }
        if (prev.mode === 'bezier') {
          return { ...prev, prevAnchor: anchorId, prevOut: outHandle };
        }
        return prev;
      });
      setBezierDrag(null);
    }
  };

  const handleDblClick = (e: React.MouseEvent) => {
    if ((tool === 'line' && drawState.mode === 'line') ||
        (tool === 'bezier' && drawState.mode === 'bezier')) {
      e.preventDefault();
      setDrawState({ mode: 'idle' });
      setBezierDrag(null);
      onToolChange('select');
    }
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const rect = svgRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    const newZoom = Math.max(0.5, Math.min(200, zoom * factor));
    // Zoom around cursor
    setPanX(mx - (mx - panX) * (newZoom / zoom));
    setPanY(my - (my - panY) * (newZoom / zoom));
    setZoom(newZoom);
  };

  // ---------------------------------------------------------------------------
  // Constraint helpers
  // ---------------------------------------------------------------------------

  const addConstraint = (c: SketchConstraint) => {
    onChange(solveSketch({
      ...sketch,
      constraints: { ...sketch.constraints, [c.id]: c },
    }).sketch);
  };

  const removeConstraint = (cid: ConstraintId) => {
    const { [cid]: _removed, ...rest } = sketch.constraints;
    onChange({ ...sketch, constraints: rest });
  };

  // ---------------------------------------------------------------------------
  // Constraint suggestion popup (for selected entities/points)
  // ---------------------------------------------------------------------------

  const candidates = getConstraintCandidates(selected, sketch);

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  // Grid lines
  const gridLines = buildGrid(cx, cy, zoom, size.w, size.h);

  // Preview ghost during drawing
  const previewElems = buildPreview(drawState, cursor, sketch, s2c);

  return (
    <div ref={containerRef} className="sk-canvas-wrap">
      <svg
        ref={svgRef}
        className="sk-canvas"
        data-tool={tool}
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onDoubleClick={handleDblClick}
        onWheel={handleWheel}
        style={{ cursor: drag ? 'grabbing' : isPanning ? 'grab' : tool === 'select' ? 'default' : tool === 'bezier' ? undefined : 'crosshair' }}
      >
        <defs>
          <marker id="arrowhead" markerWidth="6" markerHeight="4" refX="6" refY="2" orient="auto">
            <polygon points="0 0, 6 2, 0 4" fill={COLORS.dim} />
          </marker>
        </defs>

        {/* Grid */}
        <g className="sk-grid">{gridLines}</g>

        {/* Entities */}
        <g className="sk-entities">
          {Object.values(sketch.entities).map((e) => (
            <EntityShape
              key={e.id}
              entity={e}
              sketch={sketch}
              s2c={s2c}
              zoom={zoom}
              selected={selected.has(e.id)}
              hovered={hover === e.id}
            />
          ))}
        </g>

        {/* Preview */}
        <g className="sk-preview">{previewElems}</g>

        {/* Constraints */}
        <g className="sk-constraints">
          {Object.values(sketch.constraints).map((c) => (
            <ConstraintViz
              key={c.id}
              constraint={c}
              sketch={sketch}
              s2c={s2c}
              zoom={zoom}
              onRemove={removeConstraint}
            />
          ))}
        </g>

        {/* Coordinate dimension callouts for fixed points — double-click to edit */}
        <g className="sk-coord-dims">
          {Object.values(sketch.constraints)
            .filter((c): c is Extract<SketchConstraint, { type: 'fixed' }> => c.type === 'fixed')
            .flatMap((c) => {
              const pt = sketch.points[c.point];
              if (!pt) return [];
              const result = [];
              if (Math.abs(c.x) > 0.5) {
                result.push(
                  <DimLine key={`${c.id}_x`}
                    p1={{ x: 0, y: c.y }} p2={{ x: c.x, y: c.y }}
                    value={`x=${c.x.toFixed(1)}`}
                    s2c={s2c} zoom={zoom}
                    onDblClick={(sx, sy) => setEditingDim({
                      constraintId: c.id, axis: 'x',
                      value: String(c.x.toFixed(3)),
                      screenX: sx, screenY: sy,
                    })} />,
                );
              }
              if (Math.abs(c.y) > 0.5) {
                result.push(
                  <DimLine key={`${c.id}_y`}
                    p1={{ x: c.x, y: 0 }} p2={{ x: c.x, y: c.y }}
                    value={`y=${c.y.toFixed(1)}`}
                    s2c={s2c} zoom={zoom}
                    onDblClick={(sx, sy) => setEditingDim({
                      constraintId: c.id, axis: 'y',
                      value: String(c.y.toFixed(3)),
                      screenX: sx, screenY: sy,
                    })} />,
                );
              }
              return result;
            })}
        </g>

        {/* Bézier handles for selected bezier entities */}
        {Object.values(sketch.entities)
          .filter((e): e is SketchBezier => e.type === 'bezier' && selected.has(e.id))
          .flatMap((e) => {
            const p1 = sketch.points[e.p1], cp1 = sketch.points[e.cp1];
            const cp2 = sketch.points[e.cp2], p2 = sketch.points[e.p2];
            if (!p1 || !cp1 || !cp2 || !p2) return [];
            const a = s2c(p1.x, p1.y), b = s2c(p2.x, p2.y);
            const h1 = s2c(cp1.x, cp1.y), h2 = s2c(cp2.x, cp2.y);
            const result: React.ReactNode[] = [];
            if (e.cp1 !== e.p1) {
              result.push(
                <line key={`${e.id}_hl1`} x1={a.sx} y1={a.sy} x2={h1.sx} y2={h1.sy}
                  stroke={COLORS.bezierHandle} strokeWidth={0.8} strokeDasharray="2 2"
                  style={{ pointerEvents: 'none' }} />,
                <circle key={`${e.id}_hc1`} cx={h1.sx} cy={h1.sy} r={4}
                  fill={COLORS.bezierHandle} stroke="none" style={{ cursor: 'pointer' }}
                  onMouseDown={(ev) => { ev.stopPropagation(); setDrag({ type: 'point', pid: e.cp1, startParams: new Float64Array(0) }); }} />,
              );
            }
            if (e.cp2 !== e.p2) {
              result.push(
                <line key={`${e.id}_hl2`} x1={b.sx} y1={b.sy} x2={h2.sx} y2={h2.sy}
                  stroke={COLORS.bezierHandle} strokeWidth={0.8} strokeDasharray="2 2"
                  style={{ pointerEvents: 'none' }} />,
                <circle key={`${e.id}_hc2`} cx={h2.sx} cy={h2.sy} r={4}
                  fill={COLORS.bezierHandle} stroke="none" style={{ cursor: 'pointer' }}
                  onMouseDown={(ev) => { ev.stopPropagation(); setDrag({ type: 'point', pid: e.cp2, startParams: new Float64Array(0) }); }} />,
              );
            }
            return result;
          })}

        {/* Points (skip bezier control handles — rendered above) */}
        {Object.values(sketch.points)
          .filter((p) => !bezierHandleIds.has(p.id))
          .map((p) => {
            const { sx, sy } = s2c(p.x, p.y);
            const isFixed = Object.values(sketch.constraints).some(
              (c) => c.type === 'fixed' && c.point === p.id,
            );
            const isSelected = selected.has(p.id);
            const isHovered = hover === p.id;
            return (
              <circle
                key={p.id}
                cx={sx} cy={sy} r={POINT_R}
                fill={isFixed ? COLORS.pointFixed : isSelected ? COLORS.pointSelected : isHovered ? COLORS.pointHover : COLORS.point}
                stroke="none"
                style={{ cursor: 'pointer' }}
                onMouseDown={(ev) => {
                  ev.stopPropagation();
                  if (tool === 'select') {
                    setDrag({ type: 'point', pid: p.id, startParams: new Float64Array(0) });
                    setSelected(new Set([p.id]));
                  }
                }}
              />
            );
          })}

        {/* Chain-close highlight for line and bezier modes */}
        {(drawState.mode === 'line' || drawState.mode === 'bezier') && (() => {
          const cp = sketch.points[drawState.chainStart];
          if (!cp) return null;
          const { sx, sy } = s2c(cp.x, cp.y);
          const isSnapping = cursor && snapToPoint(cursor.x, cursor.y, undefined, bezierHandleIds) === drawState.chainStart;
          const col = drawState.mode === 'bezier' ? COLORS.bezierHandle : COLORS.chainClose;
          return (
            <g>
              <circle cx={sx} cy={sy} r={POINT_R + 7} fill="none"
                stroke={isSnapping ? col : `${col}55`}
                strokeWidth={isSnapping ? 2 : 1}
                strokeDasharray={isSnapping ? undefined : '4 3'} />
              {isSnapping && (
                <text x={sx + 14} y={sy - 10} fill={col}
                  fontSize={11} fontFamily="monospace" fontWeight="bold">
                  ⊙ schließen
                </text>
              )}
            </g>
          );
        })()}

        {/* Snap indicator */}
        {cursor && (() => {
          const pid = snapToPoint(cursor.x, cursor.y, undefined, bezierHandleIds);
          if (!pid) return null;
          const pp = sketch.points[pid];
          if (!pp) return null;
          const { sx, sy } = s2c(pp.x, pp.y);
          if ((drawState.mode === 'line' || drawState.mode === 'bezier') && pid === drawState.chainStart) return null;
          return <circle cx={sx} cy={sy} r={POINT_R + 4} fill="none" stroke="#5c9bff88" strokeWidth={1.5} />;
        })()}
      </svg>

      {/* Inline dimension edit input */}
      {editingDim && (
        <input
          className="sk-dim-input"
          style={{ left: editingDim.screenX, top: editingDim.screenY }}
          value={editingDim.value}
          onChange={(e) => setEditingDim({ ...editingDim, value: e.target.value })}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') commitDimEdit();
            if (e.key === 'Escape') setEditingDim(null);
          }}
          onBlur={commitDimEdit}
          autoFocus
          onFocus={(e) => e.target.select()}
        />
      )}

      {/* Constraint bar — always visible in select mode */}
      {tool === 'select' && (
        <div className="sk-constraint-bar">
          {coincidentPick ? (
            <>
              <span className="sk-constraint-bar__title" style={{ color: COLORS.chainClose }}>
                Koinzident: zweiten Punkt anklicken
              </span>
              <button className="sk-constraint-btn" onClick={() => { setCoincidentPick(null); setSelected(new Set()); }}>
                ✕ Abbrechen
              </button>
            </>
          ) : candidates.length > 0 ? (
            <>
              <span className="sk-constraint-bar__title">Bedingung:</span>
              {/* Quick coincident button when exactly one point is selected */}
              {[...selected].length === 1 && sketch.points[[...selected][0]] && (
                <button
                  className="sk-constraint-btn sk-constraint-btn--highlight"
                  onClick={() => { setCoincidentPick([...selected][0]); setSelected(new Set()); }}
                >
                  · Koinzident
                </button>
              )}
              {candidates.map((cand) => (
                <button
                  key={cand.type}
                  className="sk-constraint-btn"
                  onClick={() => {
                    const c = buildConstraint(cand.type, selected, sketch);
                    if (c) addConstraint(c);
                    setSelected(new Set());
                  }}
                >
                  {cand.label}
                </button>
              ))}
            </>
          ) : (
            <span className="sk-constraint-bar__hint">
              1 Linie → Länge / Horiz / Vert &nbsp;·&nbsp; 2 Linien → Parallel / Senkrecht &nbsp;·&nbsp;
              2 angrenzende → Tangentenstetigkeit &nbsp;·&nbsp; Punkt → Fixiert / Koinzident
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Entity shape renderer
// ---------------------------------------------------------------------------

interface EntityShapeProps {
  entity: SketchEntity;
  sketch: SketchData;
  s2c: (x: number, y: number) => { sx: number; sy: number };
  zoom: number;
  selected: boolean;
  hovered: boolean;
}

function EntityShape({ entity: e, sketch, s2c, zoom, selected, hovered }: EntityShapeProps) {
  const pts = sketch.points;
  const color = selected ? COLORS.entitySelected : hovered ? COLORS.entityHover : COLORS.entity;
  const sw = selected || hovered ? 2 : 1.5;

  if (e.type === 'line') {
    const p1 = pts[e.p1], p2 = pts[e.p2];
    if (!p1 || !p2) return null;
    const a = s2c(p1.x, p1.y), b = s2c(p2.x, p2.y);
    return <line x1={a.sx} y1={a.sy} x2={b.sx} y2={b.sy} stroke={color} strokeWidth={sw} strokeLinecap="round" />;
  }

  if (e.type === 'circle') {
    const c = pts[e.center], r = pts[e.rim];
    if (!c || !r) return null;
    const { sx: ccx, sy: ccy } = s2c(c.x, c.y);
    const radius = Math.hypot(r.x - c.x, r.y - c.y) * zoom;
    return <circle cx={ccx} cy={ccy} r={radius} stroke={color} strokeWidth={sw} fill="none" />;
  }

  if (e.type === 'arc') {
    const c = pts[e.center], p1 = pts[e.p1], p2 = pts[e.p2];
    if (!c || !p1 || !p2) return null;
    const r = Math.hypot(p1.x - c.x, p1.y - c.y);
    if (r < 1e-6) return null;
    const a1 = Math.atan2(p1.y - c.y, p1.x - c.x);
    const a2 = Math.atan2(p2.y - c.y, p2.x - c.x);
    let da = ((a2 - a1) + 2 * Math.PI) % (2 * Math.PI);
    const largeArc = da > Math.PI ? 1 : 0;
    const { sx: sx1, sy: sy1 } = s2c(p1.x, p1.y);
    const { sx: sx2, sy: sy2 } = s2c(p2.x, p2.y);
    const rPx = r * zoom;
    return (
      <path
        d={`M ${sx1} ${sy1} A ${rPx} ${rPx} 0 ${largeArc} 0 ${sx2} ${sy2}`}
        stroke={color} strokeWidth={sw} fill="none" strokeLinecap="round"
      />
    );
  }

  if (e.type === 'bezier') {
    const p1 = pts[e.p1], cp1 = pts[e.cp1], cp2 = pts[e.cp2], p2 = pts[e.p2];
    if (!p1 || !cp1 || !cp2 || !p2) return null;
    const a = s2c(p1.x, p1.y), b = s2c(p2.x, p2.y);
    const c1 = s2c(cp1.x, cp1.y), c2 = s2c(cp2.x, cp2.y);
    return (
      <path
        d={`M ${a.sx} ${a.sy} C ${c1.sx} ${c1.sy} ${c2.sx} ${c2.sy} ${b.sx} ${b.sy}`}
        stroke={color} strokeWidth={sw} fill="none" strokeLinecap="round"
      />
    );
  }

  return null;
}

// ---------------------------------------------------------------------------
// Constraint visualization
// ---------------------------------------------------------------------------

interface ConstraintVizProps {
  constraint: SketchConstraint;
  sketch: SketchData;
  s2c: (x: number, y: number) => { sx: number; sy: number };
  zoom: number;
  onRemove: (id: ConstraintId) => void;
}

function ConstraintViz({ constraint: c, sketch, s2c, zoom, onRemove }: ConstraintVizProps) {
  const pts = sketch.points;
  const entities = sketch.entities;

  // Dimensional constraints: render annotation line + text
  if (c.type === 'length') {
    const e = entities[c.entity];
    if (!e || e.type !== 'line') return null;
    const p1 = pts[e.p1], p2 = pts[e.p2];
    if (!p1 || !p2) return null;
    return <DimLine p1={p1} p2={p2} value={`${c.value} mm`} s2c={s2c} zoom={zoom} onRemove={() => onRemove(c.id)} />;
  }

  if (c.type === 'radius') {
    const e = entities[c.entity];
    if (!e || e.type === 'line') return null;
    const center = pts[(e as { center: string }).center];
    const p1x = center.x + c.value, p1y = center.y;
    return (
      <DimLine
        p1={center}
        p2={{ x: p1x, y: p1y }}
        value={`R${c.value}`}
        s2c={s2c}
        zoom={zoom}
        onRemove={() => onRemove(c.id)}
      />
    );
  }

  if (c.type === 'distance') {
    const p1 = pts[c.p1], p2 = pts[c.p2];
    if (!p1 || !p2) return null;
    return <DimLine p1={p1} p2={p2} value={`${c.value} mm`} s2c={s2c} zoom={zoom} onRemove={() => onRemove(c.id)} />;
  }

  // Geometric constraints: small icon near entity
  return <GeomConstraintIcon constraint={c} sketch={sketch} s2c={s2c} onRemove={() => onRemove(c.id)} />;
}

function DimLine({
  p1, p2, value, s2c, zoom, onRemove, onDblClick,
}: {
  p1: { x: number; y: number; id?: string };
  p2: { x: number; y: number; id?: string };
  value: string;
  s2c: (x: number, y: number) => { sx: number; sy: number };
  zoom: number;
  onRemove?: () => void;
  onDblClick?: (sx: number, sy: number) => void;
}) {
  const a = s2c(p1.x, p1.y), b = s2c(p2.x, p2.y);
  const OFFSET_PX = 14;
  const dx = b.sx - a.sx, dy = b.sy - a.sy;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len * OFFSET_PX, ny = dx / len * OFFSET_PX;
  const ax = a.sx + nx, ay = a.sy + ny;
  const bx = b.sx + nx, by = b.sy + ny;
  const mx = (ax + bx) / 2, my = (ay + by) / 2;
  const textY = my - 5;
  const noInteraction = !onRemove && !onDblClick;
  return (
    <g
      onClick={onRemove}
      style={noInteraction ? { pointerEvents: 'none' } : onRemove ? { cursor: 'pointer' } : undefined}
    >
      <line x1={a.sx} y1={a.sy} x2={ax} y2={ay} stroke={COLORS.dim} strokeWidth={0.8} strokeDasharray="2 2" />
      <line x1={b.sx} y1={b.sy} x2={bx} y2={by} stroke={COLORS.dim} strokeWidth={0.8} strokeDasharray="2 2" />
      <line x1={ax} y1={ay} x2={bx} y2={by} stroke={COLORS.dim} strokeWidth={1} markerEnd="url(#arrowhead)" />
      <text
        x={mx} y={textY}
        fill={COLORS.dim} fontSize={11} textAnchor="middle" fontFamily="monospace"
        style={onDblClick ? { cursor: 'text', pointerEvents: 'auto' } : undefined}
        onDoubleClick={onDblClick ? (e) => { e.stopPropagation(); onDblClick(mx, textY); } : undefined}
      >
        {value}
      </text>
    </g>
  );
}

function GeomConstraintIcon({
  constraint: c, sketch, s2c, onRemove,
}: {
  constraint: SketchConstraint;
  sketch: SketchData;
  s2c: (x: number, y: number) => { sx: number; sy: number };
  onRemove: () => void;
}) {
  const pts = sketch.points;
  const entities = sketch.entities;

  let x = 0, y = 0;
  let symbol = '?';

  if (c.type === 'fixed') {
    const p = pts[c.point]; if (!p) return null;
    const sv = s2c(p.x, p.y); x = sv.sx + 8; y = sv.sy - 8; symbol = '◆';
  } else if (c.type === 'horizontal') {
    const e = entities[c.entity]; if (!e || e.type !== 'line') return null;
    const p1 = pts[e.p1], p2 = pts[e.p2]; if (!p1 || !p2) return null;
    const mid = s2c((p1.x + p2.x) / 2, (p1.y + p2.y) / 2); x = mid.sx; y = mid.sy - 10; symbol = '⟷';
  } else if (c.type === 'vertical') {
    const e = entities[c.entity]; if (!e || e.type !== 'line') return null;
    const p1 = pts[e.p1], p2 = pts[e.p2]; if (!p1 || !p2) return null;
    const mid = s2c((p1.x + p2.x) / 2, (p1.y + p2.y) / 2); x = mid.sx + 10; y = mid.sy; symbol = '↕';
  } else if (c.type === 'parallel') {
    const e1 = entities[c.e1]; if (!e1 || e1.type !== 'line') return null;
    const p = pts[e1.p1]; if (!p) return null;
    const sv = s2c(p.x, p.y); x = sv.sx - 10; y = sv.sy; symbol = '∥';
  } else if (c.type === 'perpendicular') {
    const e1 = entities[c.e1]; if (!e1 || e1.type !== 'line') return null;
    const p = pts[e1.p1]; if (!p) return null;
    const sv = s2c(p.x, p.y); x = sv.sx - 10; y = sv.sy; symbol = '⊥';
  } else if (c.type === 'equal') {
    const e1 = entities[c.e1]; if (!e1) return null;
    const pid = entityPointIds(e1)[0];
    const p = pts[pid]; if (!p) return null;
    const sv = s2c(p.x, p.y); x = sv.sx; y = sv.sy - 10; symbol = '=';
  } else if (c.type === 'tangent') {
    const e1 = entities[c.e1]; if (!e1) return null;
    const pid = entityPointIds(e1)[0];
    const p = pts[pid]; if (!p) return null;
    const sv = s2c(p.x, p.y); x = sv.sx + 8; y = sv.sy - 8; symbol = '⌒';
  } else if (c.type === 'concentric') {
    const e1 = entities[c.e1]; if (!e1 || !('center' in e1)) return null;
    const p = pts[(e1 as { center: string }).center]; if (!p) return null;
    const sv = s2c(p.x, p.y); x = sv.sx + 8; y = sv.sy + 8; symbol = '◎';
  } else if (c.type === 'coincident') {
    const p = pts[c.p1]; if (!p) return null;
    const sv = s2c(p.x, p.y); x = sv.sx + 6; y = sv.sy - 6; symbol = '·';
  } else if (c.type === 'midpoint') {
    const p = pts[c.point]; if (!p) return null;
    const sv = s2c(p.x, p.y); x = sv.sx + 8; y = sv.sy - 8; symbol = '⊙';
  } else if (c.type === 'symmetric') {
    const p = pts[c.p1]; if (!p) return null;
    const sv = s2c(p.x, p.y); x = sv.sx - 10; y = sv.sy - 8; symbol = '↔';
  } else if (c.type === 'angle') {
    const e1 = entities[c.e1]; if (!e1 || e1.type !== 'line') return null;
    const p = pts[e1.p1]; if (!p) return null;
    const sv = s2c(p.x, p.y); x = sv.sx; y = sv.sy - 12;
    symbol = `${c.value}°`;
  } else {
    return null;
  }

  return (
    <g onClick={onRemove} style={{ cursor: 'pointer' }}>
      <circle cx={x} cy={y} r={9} fill="#1e2028" stroke={COLORS.conIcon} strokeWidth={0.8} />
      <text x={x} y={y + 4} fill={COLORS.conIcon} fontSize={9} textAnchor="middle" fontFamily="monospace">{symbol}</text>
    </g>
  );
}

// ---------------------------------------------------------------------------
// Draw preview
// ---------------------------------------------------------------------------

function buildPreview(
  drawState: DrawState,
  cursor: { x: number; y: number } | null,
  sketch: SketchData,
  s2c: (x: number, y: number) => { sx: number; sy: number },
): React.ReactNode {
  if (!cursor) return null;
  const { sx: cx2, sy: cy2 } = s2c(cursor.x, cursor.y);

  if (drawState.mode === 'line') {
    const prev = sketch.points[drawState.prev];
    if (!prev) return null;
    const { sx: px, sy: py } = s2c(prev.x, prev.y);
    return <line x1={px} y1={py} x2={cx2} y2={cy2} stroke={COLORS.preview} strokeWidth={1.5} strokeDasharray="4 3" />;
  }

  if (drawState.mode === 'bezier') {
    const prev = sketch.points[drawState.prevAnchor];
    const prevOut = sketch.points[drawState.prevOut];
    if (!prev || !prevOut) return null;
    const { sx: px, sy: py } = s2c(prev.x, prev.y);
    const { sx: hx, sy: hy } = s2c(prevOut.x, prevOut.y);
    // Preview: cubic bezier from prevAnchor using prevOut as cp1, cursor as cp2 and p2
    return (
      <path
        d={`M ${px} ${py} C ${hx} ${hy} ${cx2} ${cy2} ${cx2} ${cy2}`}
        stroke={COLORS.preview} strokeWidth={1.5} fill="none" strokeDasharray="4 3"
      />
    );
  }

  if (drawState.mode === 'arc_p1') {
    const center = sketch.points[drawState.center];
    if (!center) return null;
    const { sx: ccx, sy: ccy } = s2c(center.x, center.y);
    return <line x1={ccx} y1={ccy} x2={cx2} y2={cy2} stroke={COLORS.preview} strokeWidth={1} strokeDasharray="3 2" />;
  }

  if (drawState.mode === 'arc_p2') {
    const center = sketch.points[drawState.center];
    const p1 = sketch.points[drawState.p1];
    if (!center || !p1) return null;
    const r = Math.hypot(p1.x - center.x, p1.y - center.y);
    const a1 = Math.atan2(p1.y - center.y, p1.x - center.x);
    const a2 = Math.atan2(cursor.y - center.y, cursor.x - center.x);
    const da = ((a2 - a1) + 2 * Math.PI) % (2 * Math.PI);
    const la = da > Math.PI ? 1 : 0;
    const { sx: sx1, sy: sy1 } = s2c(p1.x, p1.y);
    const { sx, sy } = s2c(center.x + r * Math.cos(a2), center.y + r * Math.sin(a2));
    const rPx = r * 4;
    return (
      <path d={`M ${sx1} ${sy1} A ${rPx} ${rPx} 0 ${la} 0 ${sx} ${sy}`}
        stroke={COLORS.preview} strokeWidth={1.5} fill="none" strokeDasharray="4 3" />
    );
  }

  if (drawState.mode === 'circle_rim') {
    const center = sketch.points[drawState.center];
    if (!center) return null;
    const { sx: ccx, sy: ccy } = s2c(center.x, center.y);
    const r = Math.hypot(cx2 - ccx, cy2 - ccy);
    return <circle cx={ccx} cy={ccy} r={r} stroke={COLORS.preview} strokeWidth={1.5} fill="none" strokeDasharray="4 3" />;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Grid builder
// ---------------------------------------------------------------------------

function buildGrid(
  cx: number, cy: number, zoom: number, w: number, h: number,
): React.ReactNode[] {
  // Minor grid: every 10 mm, major every 50 mm
  const step = zoom >= 8 ? 10 : zoom >= 3 ? 20 : 50;
  const lines: React.ReactNode[] = [];

  const left = -cx / zoom, right = (w - cx) / zoom;
  const bottom = -cy / zoom, top = (h - cy) / zoom; // SVG top < bottom

  const x0 = Math.ceil(left / step) * step;
  const x1 = Math.floor(right / step) * step;
  const y0 = Math.ceil(bottom / step) * step;
  const y1 = Math.floor(top / step) * step; // using SVG coords

  for (let x = x0; x <= x1; x += step) {
    const sx = cx + x * zoom;
    const major = x % (step * 5) === 0;
    lines.push(
      <line key={`vx${x}`} x1={sx} y1={0} x2={sx} y2={h}
        stroke={major ? COLORS.axis : COLORS.grid} strokeWidth={major ? 0.5 : 0.3} />,
    );
  }
  for (let y = y0; y <= y1; y += step) {
    const sy = cy - y * zoom;
    const major = y % (step * 5) === 0;
    lines.push(
      <line key={`hy${y}`} x1={0} y1={sy} x2={w} y2={sy}
        stroke={major ? COLORS.axis : COLORS.grid} strokeWidth={major ? 0.5 : 0.3} />,
    );
  }

  // Axes
  lines.push(
    <line key="ax" x1={0} y1={cy} x2={w} y2={cy} stroke="#555" strokeWidth={0.8} />,
    <line key="ay" x1={cx} y1={0} x2={cx} y2={h} stroke="#555" strokeWidth={0.8} />,
  );

  return lines;
}

// ---------------------------------------------------------------------------
// Hit testing
// ---------------------------------------------------------------------------

function hitEntity(
  x: number, y: number, sketch: SketchData, zoom: number,
): EntityId | null {
  const PX_THRESH = 6 / zoom; // 6 pixels in sketch units
  for (const e of Object.values(sketch.entities)) {
    if (e.type === 'line') {
      const p1 = sketch.points[e.p1], p2 = sketch.points[e.p2];
      if (!p1 || !p2) continue;
      const d = distToSegment(x, y, p1.x, p1.y, p2.x, p2.y);
      if (d < PX_THRESH) return e.id;
    } else if (e.type === 'circle') {
      const c = sketch.points[e.center], r = sketch.points[e.rim];
      if (!c || !r) continue;
      const radius = Math.hypot(r.x - c.x, r.y - c.y);
      const dist = Math.abs(Math.hypot(x - c.x, y - c.y) - radius);
      if (dist < PX_THRESH) return e.id;
    } else if (e.type === 'arc') {
      const c = sketch.points[e.center], p1 = sketch.points[e.p1], p2 = sketch.points[e.p2];
      if (!c || !p1 || !p2) continue;
      const r = Math.hypot(p1.x - c.x, p1.y - c.y);
      const dist = Math.abs(Math.hypot(x - c.x, y - c.y) - r);
      if (dist < PX_THRESH) {
        const a1 = Math.atan2(p1.y - c.y, p1.x - c.x);
        const a2 = Math.atan2(p2.y - c.y, p2.x - c.x);
        const ap = Math.atan2(y - c.y, x - c.x);
        const da = ((a2 - a1) + 2 * Math.PI) % (2 * Math.PI);
        const dp = ((ap - a1) + 2 * Math.PI) % (2 * Math.PI);
        if (dp <= da) return e.id;
      }
    } else if (e.type === 'bezier') {
      const p1 = sketch.points[e.p1], cp1 = sketch.points[e.cp1];
      const cp2 = sketch.points[e.cp2], p2 = sketch.points[e.p2];
      if (!p1 || !cp1 || !cp2 || !p2) continue;
      // Sample 24 points along the cubic
      for (let i = 0; i <= 24; i++) {
        const t = i / 24, mt = 1 - t;
        const bx = mt*mt*mt*p1.x + 3*mt*mt*t*cp1.x + 3*mt*t*t*cp2.x + t*t*t*p2.x;
        const by = mt*mt*mt*p1.y + 3*mt*mt*t*cp1.y + 3*mt*t*t*cp2.y + t*t*t*p2.y;
        if (Math.hypot(bx - x, by - y) < PX_THRESH) return e.id;
      }
    }
  }
  return null;
}

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-10) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

// ---------------------------------------------------------------------------
// Sketch mutation helpers
// ---------------------------------------------------------------------------

function addPoint(
  sketch: SketchData, x: number, y: number,
): { id: PointId; sketch: SketchData } {
  const id = newId('p');
  return {
    id,
    sketch: { ...sketch, points: { ...sketch.points, [id]: { id, x, y } } },
  };
}

function addLine(sketch: SketchData, p1: PointId, p2: PointId): SketchData {
  const id = newId('l');
  return {
    ...sketch,
    entities: { ...sketch.entities, [id]: { id, type: 'line', p1, p2 } },
  };
}

function addArc(sketch: SketchData, center: PointId, p1: PointId, p2: PointId): SketchData {
  const id = newId('a');
  return {
    ...sketch,
    entities: { ...sketch.entities, [id]: { id, type: 'arc', center, p1, p2 } },
  };
}

function addCircle(sketch: SketchData, center: PointId, rim: PointId): SketchData {
  const id = newId('c');
  return {
    ...sketch,
    entities: { ...sketch.entities, [id]: { id, type: 'circle', center, rim } },
  };
}

function movePoint(sketch: SketchData, pid: PointId, x: number, y: number): SketchData {
  return {
    ...sketch,
    points: {
      ...sketch.points,
      [pid]: { ...sketch.points[pid], x, y },
    },
  };
}

function deleteSelected(sketch: SketchData, selected: Set<string>): SketchData {
  const newPoints = { ...sketch.points };
  const newEntities = { ...sketch.entities };
  const newConstraints = { ...sketch.constraints };

  for (const id of selected) {
    delete newPoints[id];
    delete newEntities[id];
  }

  // Remove constraints that reference deleted entities/points
  for (const [cid, c] of Object.entries(newConstraints)) {
    const refs = getConstraintRefs(c);
    if (refs.some((r) => selected.has(r))) delete newConstraints[cid];
  }

  // Remove entities that reference deleted points
  for (const [eid, e] of Object.entries(newEntities)) {
    if (entityPointIds(e).some((pid) => !newPoints[pid])) delete newEntities[eid];
  }

  return { points: newPoints, entities: newEntities, constraints: newConstraints };
}

function getConstraintRefs(c: SketchConstraint): string[] {
  switch (c.type) {
    case 'coincident': return [c.p1, c.p2];
    case 'fixed': return [c.point];
    case 'horizontal': case 'vertical': case 'length': case 'radius': return [c.entity];
    case 'parallel': case 'perpendicular': case 'equal': case 'tangent': case 'concentric': case 'angle': return [c.e1, c.e2];
    case 'distance': return [c.p1, c.p2];
    case 'midpoint': return [c.point, c.entity];
    case 'symmetric': return [c.p1, c.p2, c.axis];
  }
}

// ---------------------------------------------------------------------------
// Constraint candidate logic
// ---------------------------------------------------------------------------

function entityLineEndpoints(e: SketchEntity): PointId[] {
  if (e.type === 'line' || e.type === 'arc' || e.type === 'bezier') return [e.p1, e.p2];
  return [];
}

function entitiesShareEndpoint(e1: SketchEntity, e2: SketchEntity, sketch: SketchData): boolean {
  const eps1 = entityLineEndpoints(e1);
  const eps2 = entityLineEndpoints(e2);
  for (const p of eps1) if (eps2.includes(p)) return true;
  for (const c of Object.values(sketch.constraints)) {
    if (c.type !== 'coincident') continue;
    for (const pa of eps1) for (const pb of eps2) {
      if ((c.p1 === pa && c.p2 === pb) || (c.p1 === pb && c.p2 === pa)) return true;
    }
  }
  return false;
}

function getConstraintCandidates(
  selected: Set<string>,
  sketch: SketchData,
): ConstraintCandidate[] {
  const ids = [...selected];
  if (ids.length === 0) return [];

  const pointIds = ids.filter((id) => sketch.points[id]);
  const entityIds = ids.filter((id) => sketch.entities[id]);

  if (pointIds.length === 2 && entityIds.length === 0) {
    return [
      { type: 'coincident', label: 'Deckungsgleich (Koinzident)' },
      { type: 'distance', label: 'Abstand' },
    ];
  }
  if (pointIds.length === 1 && entityIds.length === 0) {
    return [{ type: 'fixed', label: 'Fixiert' }];
  }
  if (entityIds.length === 1 && pointIds.length === 0) {
    const e = sketch.entities[entityIds[0]];
    if (!e) return [];
    if (e.type === 'line') {
      return [
        { type: 'horizontal', label: 'Horizontal' },
        { type: 'vertical', label: 'Vertikal' },
        { type: 'length', label: 'Länge' },
      ];
    }
    if (e.type === 'arc' || e.type === 'circle') {
      return [{ type: 'radius', label: 'Radius' }];
    }
  }
  if (entityIds.length === 2 && pointIds.length === 0) {
    const e1 = sketch.entities[entityIds[0]];
    const e2 = sketch.entities[entityIds[1]];
    if (!e1 || !e2) return [];
    const cands: ConstraintCandidate[] = [{ type: 'equal', label: 'Gleich' }];
    if (e1.type === 'line' && e2.type === 'line') {
      cands.push(
        { type: 'parallel', label: 'Parallel' },
        { type: 'perpendicular', label: 'Senkrecht' },
        { type: 'angle', label: 'Winkel' },
      );
    }
    if ((e1.type === 'arc' || e1.type === 'circle') && (e2.type === 'arc' || e2.type === 'circle')) {
      cands.push({ type: 'concentric', label: 'Konzentrisch' });
    }
    // Tangential: either geometric (line+circle) or endpoint G1 (any two entities sharing a point)
    const hasCircle = e1.type !== 'line' || e2.type !== 'line';
    const hasLine = e1.type === 'line' || e2.type === 'line';
    if (hasCircle && hasLine) {
      cands.push({ type: 'tangent', label: 'Tangential' });
    }
    // G1 continuity: any two endpoint-sharing or bezier entities
    if (!cands.find(c => c.type === 'tangent') || e1.type === 'bezier' || e2.type === 'bezier') {
      if (entitiesShareEndpoint(e1, e2, sketch)) {
        cands.push({ type: 'tangent', label: 'Tangentenstetigkeit (G1)' });
      }
    }
    return cands;
  }
  if (entityIds.length === 1 && pointIds.length === 1) {
    const e = sketch.entities[entityIds[0]];
    if (e?.type === 'line') return [{ type: 'midpoint', label: 'Mittelpunkt' }];
  }
  return [];
}

function buildConstraint(
  type: SketchConstraint['type'],
  selected: Set<string>,
  sketch: SketchData,
): SketchConstraint | null {
  const ids = [...selected];
  const pointIds = ids.filter((id) => sketch.points[id]);
  const entityIds = ids.filter((id) => sketch.entities[id]);
  const id = newId('con');

  switch (type) {
    case 'coincident': {
      if (pointIds.length < 2) return null;
      return { id, type, p1: pointIds[0], p2: pointIds[1] };
    }
    case 'fixed': {
      const pid = pointIds[0] ?? entityIds[0];
      const p = sketch.points[pid];
      if (!p) return null;
      return { id, type, point: pid, x: p.x, y: p.y };
    }
    case 'horizontal': case 'vertical': {
      if (!entityIds[0]) return null;
      return { id, type, entity: entityIds[0] } as SketchConstraint;
    }
    case 'length': {
      const eid = entityIds[0]; if (!eid) return null;
      const e = sketch.entities[eid]; if (!e || e.type !== 'line') return null;
      const p1 = sketch.points[e.p1], p2 = sketch.points[e.p2];
      if (!p1 || !p2) return null;
      const len = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      const v = parseFloat(prompt('Länge (mm):', len.toFixed(2)) ?? '');
      if (!Number.isFinite(v) || v <= 0) return null;
      return { id, type, entity: eid, value: v };
    }
    case 'radius': {
      const eid = entityIds[0]; if (!eid) return null;
      const e = sketch.entities[eid]; if (!e || e.type === 'line') return null;
      const c = sketch.points[(e as { center: string }).center];
      const rp = sketch.points[(e as { rim?: string; p1?: string }).rim ?? (e as { p1: string }).p1];
      if (!c || !rp) return null;
      const r = Math.hypot(rp.x - c.x, rp.y - c.y);
      const v = parseFloat(prompt('Radius (mm):', r.toFixed(2)) ?? '');
      if (!Number.isFinite(v) || v <= 0) return null;
      return { id, type, entity: eid, value: v };
    }
    case 'distance': {
      if (pointIds.length < 2) return null;
      const p1 = sketch.points[pointIds[0]], p2 = sketch.points[pointIds[1]];
      if (!p1 || !p2) return null;
      const d = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      const v = parseFloat(prompt('Abstand (mm):', d.toFixed(2)) ?? '');
      if (!Number.isFinite(v) || v <= 0) return null;
      return { id, type, p1: pointIds[0], p2: pointIds[1], value: v };
    }
    case 'angle': {
      if (entityIds.length < 2) return null;
      const v = parseFloat(prompt('Winkel (°):', '90') ?? '');
      if (!Number.isFinite(v)) return null;
      return { id, type, e1: entityIds[0], e2: entityIds[1], value: v };
    }
    case 'parallel': case 'perpendicular': case 'equal': case 'tangent': case 'concentric': {
      if (entityIds.length < 2) return null;
      return { id, type, e1: entityIds[0], e2: entityIds[1] } as SketchConstraint;
    }
    case 'midpoint': {
      const pid = pointIds[0], eid = entityIds[0];
      if (!pid || !eid) return null;
      return { id, type, point: pid, entity: eid };
    }
    default: return null;
  }
}
