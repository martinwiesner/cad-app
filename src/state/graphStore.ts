// src/state/graphStore.ts
import { create } from 'zustand';
import type { GraphDocument, GraphEdge, GraphNode, PublishedParam } from '../graph/graphTypes';
import { emptyGraph } from '../graph/graphTypes';
import { getNodeSpec } from '../graph/nodeRegistry';
import { executeGraph } from '../graph/graphExecution';

interface GraphState {
  doc: GraphDocument;
  selectedNodeId: string | null;

  // Undo/Redo
  history: GraphDocument[];
  future: GraphDocument[];
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  setDoc: (doc: GraphDocument) => void;
  reset: () => void;

  addNode: (type: string, position: { x: number; y: number }, initialParams?: Record<string, unknown>) => string;
  removeNode: (id: string) => void;
  updateNodePosition: (id: string, pos: { x: number; y: number }) => void;
  updateNodeParam: (id: string, key: string, value: unknown) => void;
  setSelectedNode: (id: string | null) => void;

  addEdge: (e: Omit<GraphEdge, 'id'>) => void;
  removeEdge: (id: string) => void;

  // Veroeffentlichte Parameter
  publishParam: (p: Omit<PublishedParam, 'id' | 'order'>) => string;
  unpublishParam: (id: string) => void;
  updatePublishedParam: (id: string, patch: Partial<PublishedParam>) => void;
  reorderPublishedParam: (id: string, newIndex: number) => void;
  isPublished: (nodeId: string, paramKey: string) => PublishedParam | undefined;

  run: () => Promise<void>;
  runDebounced: () => void;
}

let nodeCounter = 0;
let edgeCounter = 0;
let pubCounter = 0;

function nid(type: string): string {
  return `n_${type}_${++nodeCounter}_${Date.now().toString(36)}`;
}
function eid(): string {
  return `e_${++edgeCounter}_${Date.now().toString(36)}`;
}
function pid(): string {
  return `p_${++pubCounter}_${Date.now().toString(36)}`;
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

const MAX_HISTORY = 50;

export const useGraphStore = create<GraphState>((set, get) => ({
  doc: emptyGraph(),
  selectedNodeId: null,
  history: [],
  future: [],

  canUndo: () => get().history.length > 0,
  canRedo: () => get().future.length > 0,

  undo: () => {
    const { history, doc, future } = get();
    if (history.length === 0) return;
    const prev = history[history.length - 1];
    set({
      doc: prev,
      history: history.slice(0, -1),
      future: [doc, ...future].slice(0, MAX_HISTORY),
      selectedNodeId: null,
    });
    queueMicrotask(() => get().runDebounced());
  },

  redo: () => {
    const { future, doc, history } = get();
    if (future.length === 0) return;
    const next = future[0];
    set({
      doc: next,
      future: future.slice(1),
      history: [...history, doc].slice(-MAX_HISTORY),
      selectedNodeId: null,
    });
    queueMicrotask(() => get().runDebounced());
  },

  setDoc: (doc) => {
    const { doc: current, history } = get();
    const safe: GraphDocument = { ...doc, publishedParams: doc.publishedParams ?? [] };
    set({
      doc: safe,
      history: [...history, current].slice(-MAX_HISTORY),
      future: [],
    });
  },
  reset: () => {
    const { doc, history } = get();
    set({
      doc: emptyGraph(),
      selectedNodeId: null,
      history: [...history, doc].slice(-MAX_HISTORY),
      future: [],
    });
  },

  addNode: (type, position, initialParams) => {
    const spec = getNodeSpec(type);
    if (!spec) throw new Error(`Unbekannter Node-Typ: ${type}`);
    const id = nid(type);
    const params: Record<string, unknown> = {};
    for (const p of spec.params) params[p.key] = p.default;
    if (initialParams) Object.assign(params, initialParams);
    const node: GraphNode = { id, type, position, params };
    set((s) => ({
      doc: { ...s.doc, nodes: [...s.doc.nodes, node] },
      history: [...s.history, s.doc].slice(-MAX_HISTORY),
      future: [],
    }));
    get().runDebounced();
    return id;
  },

  removeNode: (id) =>
    set((s) => {
      const nodes = s.doc.nodes.filter((n) => n.id !== id);
      const edges = s.doc.edges.filter((e) => e.source !== id && e.target !== id);
      const pubs = (s.doc.publishedParams ?? []).filter((p) => p.nodeId !== id);
      queueMicrotask(() => get().runDebounced());
      return {
        doc: { ...s.doc, nodes, edges, publishedParams: pubs },
        selectedNodeId: s.selectedNodeId === id ? null : s.selectedNodeId,
        history: [...s.history, s.doc].slice(-MAX_HISTORY),
        future: [],
      };
    }),

  updateNodePosition: (id, pos) =>
    set((s) => ({
      doc: {
        ...s.doc,
        nodes: s.doc.nodes.map((n) => (n.id === id ? { ...n, position: pos } : n)),
      },
      // Position-Aenderungen landen NICHT in der History (zu viele Eintraege)
    })),

  updateNodeParam: (id, key, value) => {
    set((s) => ({
      doc: {
        ...s.doc,
        nodes: s.doc.nodes.map((n) =>
          n.id === id ? { ...n, params: { ...n.params, [key]: value } } : n,
        ),
      },
      history: [...s.history, s.doc].slice(-MAX_HISTORY),
      future: [],
    }));
    get().runDebounced();
  },

  setSelectedNode: (id) => set({ selectedNodeId: id }),

  addEdge: (e) => {
    const edge: GraphEdge = { id: eid(), ...e };
    set((s) => ({
      doc: { ...s.doc, edges: [...s.doc.edges, edge] },
      history: [...s.history, s.doc].slice(-MAX_HISTORY),
      future: [],
    }));
    get().runDebounced();
  },

  removeEdge: (id) => {
    set((s) => ({
      doc: { ...s.doc, edges: s.doc.edges.filter((e) => e.id !== id) },
      history: [...s.history, s.doc].slice(-MAX_HISTORY),
      future: [],
    }));
    get().runDebounced();
  },

  // ---- Published Params -----------------------------------------------------

  publishParam: (input) => {
    const id = pid();
    set((s) => {
      const existing = s.doc.publishedParams ?? [];
      const order = existing.length;
      const pub: PublishedParam = { id, order, ...input };
      return { doc: { ...s.doc, publishedParams: [...existing, pub] } };
    });
    return id;
  },

  unpublishParam: (id) => {
    set((s) => {
      const filtered = (s.doc.publishedParams ?? []).filter((p) => p.id !== id);
      // Order neu durchnummerieren, damit Lueckenfrei
      const renumbered = filtered.map((p, i) => ({ ...p, order: i }));
      return { doc: { ...s.doc, publishedParams: renumbered } };
    });
  },

  updatePublishedParam: (id, patch) => {
    set((s) => ({
      doc: {
        ...s.doc,
        publishedParams: (s.doc.publishedParams ?? []).map((p) =>
          p.id === id ? { ...p, ...patch } : p,
        ),
      },
    }));
  },

  reorderPublishedParam: (id, newIndex) => {
    set((s) => {
      const list = [...(s.doc.publishedParams ?? [])].sort((a, b) => a.order - b.order);
      const idx = list.findIndex((p) => p.id === id);
      if (idx < 0) return s;
      const [moved] = list.splice(idx, 1);
      list.splice(Math.max(0, Math.min(newIndex, list.length)), 0, moved);
      const renumbered = list.map((p, i) => ({ ...p, order: i }));
      return { doc: { ...s.doc, publishedParams: renumbered } };
    });
  },

  isPublished: (nodeId, paramKey) => {
    return (get().doc.publishedParams ?? []).find(
      (p) => p.nodeId === nodeId && p.paramKey === paramKey,
    );
  },

  run: async () => {
    await executeGraph(get().doc);
  },

  runDebounced: () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      executeGraph(get().doc).catch((e) => {
        // eslint-disable-next-line no-console
        console.error('[graphStore] run failed', e);
      });
    }, 150);
  },
}));
