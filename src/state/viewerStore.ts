// src/state/viewerStore.ts
import { create } from 'zustand';
import type { EdgeData, MeshArrays } from '../cad/types';
import type { MaterialDefinition } from '../cad/materials';

export interface ViewerMesh {
  id: string;
  data: MeshArrays;
  edges?: EdgeData[];   // optional - nur wenn Node Kanten-Picking unterstuetzt
  /** Material-Definition - Vorrang vor color */
  material?: MaterialDefinition;
  /** Legacy: einfache Farbe wenn kein Material gesetzt */
  color?: string;
  visible?: boolean;
}

interface ViewerState {
  meshes: Map<string, ViewerMesh>;
  fitViewRequest: number;
  setMesh: (m: ViewerMesh) => void;
  setMeshEdges: (id: string, edges: EdgeData[]) => void;
  removeMesh: (id: string) => void;
  clear: () => void;
  requestFitView: () => void;
}

export const useViewerStore = create<ViewerState>((set) => ({
  meshes: new Map(),
  fitViewRequest: 0,
  setMesh: (m) =>
    set((s) => {
      const next = new Map(s.meshes);
      next.set(m.id, m);
      return { meshes: next };
    }),
  setMeshEdges: (id, edges) =>
    set((s) => {
      const existing = s.meshes.get(id);
      if (!existing) return s;
      const next = new Map(s.meshes);
      next.set(id, { ...existing, edges });
      return { meshes: next };
    }),
  removeMesh: (id) =>
    set((s) => {
      const next = new Map(s.meshes);
      next.delete(id);
      return { meshes: next };
    }),
  clear: () => set({ meshes: new Map() }),
  requestFitView: () => set((s) => ({ fitViewRequest: s.fitViewRequest + 1 })),
}));
