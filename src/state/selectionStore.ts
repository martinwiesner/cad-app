// src/state/selectionStore.ts
// Aktueller Pick-Modus + Hover-Zustand fuer Edge-Auswahl.

import { create } from 'zustand';

interface SelectionState {
  /** Wenn != null, ist der Viewer im Pick-Mode fuer diesen Node. */
  pickingNodeId: string | null;
  /** Aktuell gehoverte Edge-ID (fuer Highlight). */
  hoveredEdgeId: string | null;

  startPicking: (nodeId: string) => void;
  stopPicking: () => void;
  setHover: (edgeId: string | null) => void;
}

export const useSelectionStore = create<SelectionState>((set, get) => ({
  pickingNodeId: null,
  hoveredEdgeId: null,

  startPicking: (nodeId) => {
    set({ pickingNodeId: nodeId, hoveredEdgeId: null });
    // Recompute triggern, damit Edge-Daten extrahiert werden.
    // Lazy dyn import um Zirkularitaet zu vermeiden:
    import('./graphStore').then((m) => m.useGraphStore.getState().run().catch(() => { /* ignore */ }));
  },
  stopPicking: () => set({ pickingNodeId: null, hoveredEdgeId: null }),
  setHover: (edgeId) => set({ hoveredEdgeId: edgeId }),
}));
