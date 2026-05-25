// src/state/statusStore.ts
import { create } from 'zustand';
import type { ValidationIssue } from '../graph/graphValidation';
import type { GraphNode } from '../graph/graphTypes';

export type KernelState = 'uninitialized' | 'initializing' | 'ready' | 'error';
export type ComputeState = 'idle' | 'computing' | 'success' | 'error';

export interface LogEntry {
  id: number;
  ts: number;
  level: 'info' | 'warn' | 'error';
  message: string;
}

export interface NodeDiagnostics {
  durations: Map<string, number>;
  errors: Map<string, string>;
  statusByNode: Map<string, GraphNode['status']>;
}

interface StatusState {
  kernel: KernelState;
  kernelError?: string;
  compute: ComputeState;
  computeError?: string;
  lastComputeMs?: number;
  logs: LogEntry[];
  validationIssues: ValidationIssue[];
  nodeDiagnostics: NodeDiagnostics;

  setKernel: (s: KernelState, err?: string) => void;
  setCompute: (s: ComputeState, opts?: { error?: string; ms?: number }) => void;
  setValidation: (issues: ValidationIssue[]) => void;
  setNodeDiagnostics: (d: NodeDiagnostics) => void;

  log: (level: LogEntry['level'], message: string) => void;
  clearLogs: () => void;
}

let nextId = 1;
const EMPTY_DIAG: NodeDiagnostics = { durations: new Map(), errors: new Map(), statusByNode: new Map() };

export const useStatusStore = create<StatusState>((set) => ({
  kernel: 'uninitialized',
  compute: 'idle',
  logs: [],
  validationIssues: [],
  nodeDiagnostics: EMPTY_DIAG,

  setKernel: (s, err) => set({ kernel: s, kernelError: err }),
  setCompute: (s, opts) => set({ compute: s, computeError: opts?.error, lastComputeMs: opts?.ms }),
  setValidation: (issues) => set({ validationIssues: issues }),
  setNodeDiagnostics: (d) => set({ nodeDiagnostics: d }),

  log: (level, message) =>
    set((st) => ({
      logs: [...st.logs.slice(-199), { id: nextId++, ts: Date.now(), level, message }],
    })),
  clearLogs: () => set({ logs: [] }),
}));
