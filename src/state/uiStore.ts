// src/state/uiStore.ts
// App-weite UI-Zustaende: Editor- vs Konfigurator-Modus.

import { create } from 'zustand';

export type AppMode = 'editor' | 'configurator';

interface UiState {
  mode: AppMode;
  setMode: (m: AppMode) => void;
  toggleMode: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  mode: 'editor',
  setMode: (mode) => set({ mode }),
  toggleMode: () => set((s) => ({ mode: s.mode === 'editor' ? 'configurator' : 'editor' })),
}));
