// src/graph/graphTypes.ts

export type SocketDataType = 'number' | 'vector3' | 'boolean' | 'shape' | 'string';

export interface NodeSocket {
  id: string;
  label: string;
  dataType: SocketDataType;
  default?: unknown;
}

export interface NodeParamSchema {
  key: string;
  label: string;
  kind: 'number' | 'slider' | 'string' | 'boolean' | 'select' | 'edgeList' | 'color' | 'sketch';
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  options?: { value: string; label: string }[];
  default: unknown;
}

export interface NodeSpec {
  type: string;
  category: 'parameter' | 'primitive' | 'operation' | 'feature' | 'transform' | 'render' | 'io';
  label: string;
  inputs: NodeSocket[];
  outputs: NodeSocket[];
  params: NodeParamSchema[];
  /** Color in UI - leer = aus category abgeleitet */
  accent?: string;
}

export interface GraphNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  params: Record<string, unknown>;
  /** Runtime nur - nicht serialisiert. */
  status?: 'idle' | 'computing' | 'ok' | 'warn' | 'error';
  error?: string;
  durationMs?: number;
}

export interface GraphEdge {
  id: string;
  source: string;
  sourceHandle: string;
  target: string;
  targetHandle: string;
}

/**
 * Ein im Konfigurator-Modus angezeigter Parameter.
 * Verweist auf einen konkreten Node + Param-Key. Der Wert lebt weiter im Node,
 * dieser Eintrag ist nur die "Publikations-Maske" (Label + erlaubter Bereich).
 */
export interface PublishedParam {
  /** Stabile ID dieser Veroeffentlichung. */
  id: string;
  /** Auf welchen Node der Param zeigt. */
  nodeId: string;
  /** Welcher Param-Key im Node. */
  paramKey: string;
  /** Wie der Param im Konfigurator angezeigt wird (kann sich vom internen Label unterscheiden). */
  label: string;
  /** Gruppe / Kategorie fuer die Konfigurator-UI (z.B. "Abmessungen", "Bohrungen"). */
  group?: string;
  /** Erlaubter Wertebereich im Konfigurator. */
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  /** Beschreibung / Tooltip fuer Endnutzer. */
  description?: string;
  /** Sortierreihenfolge. */
  order: number;
}

export interface GraphDocument {
  version: 1;
  units: 'mm';
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Veroeffentlichte Parameter fuer den Konfigurator-Modus. */
  publishedParams?: PublishedParam[];
  meta?: { name?: string; createdAt?: string; updatedAt?: string };
}

export function emptyGraph(): GraphDocument {
  return { version: 1, units: 'mm', nodes: [], edges: [], publishedParams: [] };
}
