// src/graph/hashing.ts
// Deterministischer kleiner Hash. djb2 - reicht voellig fuer Node-Cache-Keys.

import type { GraphNode } from './graphTypes';

function djb2(str: string): string {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h) ^ str.charCodeAt(i);
  }
  // Als hex - immer positiv
  return (h >>> 0).toString(16).padStart(8, '0');
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',') + '}';
}

export function hashNode(node: GraphNode, upstreamHashes: string[]): string {
  const payload = {
    t: node.type,
    p: node.params,
    u: upstreamHashes,
  };
  return djb2(stableStringify(payload));
}
