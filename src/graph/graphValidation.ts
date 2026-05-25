// src/graph/graphValidation.ts
import type { GraphDocument, GraphEdge, GraphNode } from './graphTypes';
import { getNodeSpec } from './nodeRegistry';

export interface ValidationIssue {
  level: 'error' | 'warn';
  nodeId?: string;
  edgeId?: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
  /** Bei Erfolg topologisch sortiert. */
  order?: GraphNode[];
}

export function validateGraph(doc: GraphDocument): ValidationResult {
  const issues: ValidationIssue[] = [];

  // Index
  const byId = new Map(doc.nodes.map((n) => [n.id, n] as const));

  // ---- Spec-Check ---------------------------------------------------------
  for (const n of doc.nodes) {
    if (!getNodeSpec(n.type)) {
      issues.push({ level: 'error', nodeId: n.id, message: `Unbekannter Node-Typ: ${n.type}` });
    }
  }

  // ---- Edge-Check ---------------------------------------------------------
  for (const e of doc.edges) {
    const s = byId.get(e.source);
    const t = byId.get(e.target);
    if (!s) issues.push({ level: 'error', edgeId: e.id, message: `Edge ${e.id}: Source-Node ${e.source} fehlt` });
    if (!t) issues.push({ level: 'error', edgeId: e.id, message: `Edge ${e.id}: Target-Node ${e.target} fehlt` });
    if (!s || !t) continue;

    const sSpec = getNodeSpec(s.type);
    const tSpec = getNodeSpec(t.type);
    if (!sSpec || !tSpec) continue;

    const sOut = sSpec.outputs.find((o) => o.id === e.sourceHandle);
    const tIn = tSpec.inputs.find((i) => i.id === e.targetHandle);
    if (!sOut) issues.push({ level: 'error', edgeId: e.id, message: `Edge ${e.id}: Output ${e.sourceHandle} nicht in ${s.type}` });
    if (!tIn) issues.push({ level: 'error', edgeId: e.id, message: `Edge ${e.id}: Input ${e.targetHandle} nicht in ${t.type}` });
    if (sOut && tIn && sOut.dataType !== tIn.dataType) {
      issues.push({
        level: 'error',
        edgeId: e.id,
        message: `Edge ${e.id}: Typ-Konflikt ${sOut.dataType} → ${tIn.dataType}`,
      });
    }
  }

  // ---- Zyklus + Topo-Sort -------------------------------------------------
  let order: GraphNode[] | undefined;
  try {
    order = topologicalSort(doc);
  } catch (e) {
    issues.push({ level: 'error', message: `Graph hat einen Zyklus: ${(e as Error).message}` });
  }

  const ok = !issues.some((i) => i.level === 'error');
  return { ok, issues, order: ok ? order : undefined };
}

export function topologicalSort(doc: GraphDocument): GraphNode[] {
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const n of doc.nodes) {
    inDegree.set(n.id, 0);
    adj.set(n.id, []);
  }
  for (const e of doc.edges) {
    if (!inDegree.has(e.target) || !adj.has(e.source)) continue;
    adj.get(e.source)!.push(e.target);
    inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1);
  }
  const queue: string[] = [];
  for (const [id, d] of inDegree) if (d === 0) queue.push(id);

  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const next of adj.get(id) ?? []) {
      const d = (inDegree.get(next) ?? 0) - 1;
      inDegree.set(next, d);
      if (d === 0) queue.push(next);
    }
  }
  if (order.length !== doc.nodes.length) {
    throw new Error('Cycle detected');
  }
  const byId = new Map(doc.nodes.map((n) => [n.id, n] as const));
  return order.map((id) => byId.get(id)!);
}

/** Sammelt fuer einen Node die aktuell anliegenden Inputs (Edge-Werte uebersteuern Params).
 *
 * Material-Sidechannel: Wenn eine Edge ein Shape transportiert UND der Source-Node
 * ein 'material' im Output hat, reisen wir dieses Material automatisch mit. So
 * vererbt sich ein Material durch Booleans, Fillets, Transforms hindurch zum
 * naechsten Preview - ohne dass jeder Node ein eigenes Material-Input braucht. */
export function collectNodeInputs(
  node: GraphNode,
  doc: GraphDocument,
  outputs: Map<string, Record<string, unknown>>,
): Record<string, unknown> {
  const inputs: Record<string, unknown> = { ...node.params };
  // Material aus dem Upstream-Flow sammeln: zuletzt gesehenes Material gewinnt.
  // Bei Konflikten (zwei verschiedene Materialien upstream) nehmen wir das,
  // das am 'shape'-Input anliegt - sonst irgendeines.
  let inheritedMaterial: unknown = undefined;
  let shapeMaterialFound = false;

  for (const e of doc.edges) {
    if (e.target !== node.id) continue;
    const srcOut = outputs.get(e.source);
    if (!srcOut) continue;
    // Wenn Source einen passenden Handle hat, den verwenden
    if (e.sourceHandle in srcOut) {
      inputs[e.targetHandle] = srcOut[e.sourceHandle];
    }
    // Material durchschleifen, falls Source eines mitliefert
    if ('material' in srcOut && srcOut.material) {
      // Bevorzuge das Material, das am 'shape'-Eingang anliegt (= Hauptdatenfluss)
      const isShapeChannel = e.targetHandle === 'shape' || e.targetHandle === 'base' || e.targetHandle === 'a';
      if (isShapeChannel || !shapeMaterialFound) {
        inheritedMaterial = srcOut.material;
        if (isShapeChannel) shapeMaterialFound = true;
      }
    }
  }
  // 'material' im Node-eigenen Params hat Vorrang (z.B. der material-Node selbst
  // bekommt seine Settings nicht ueberschrieben)
  if (inheritedMaterial !== undefined && !('material' in node.params)) {
    inputs.material = inheritedMaterial;
  }
  return inputs;
}
