// src/graph/graphExecution.ts
// Fuehrt einen Graph aus: topologisch sortieren, Inputs sammeln, Node-Handler
// aufrufen, Outputs cachen. Bei Slider-Aenderungen wird nur das Notwendige neu gerechnet.

import { getKernel } from '../cad/CadKernelService';
import { useViewerStore } from '../state/viewerStore';
import { useStatusStore } from '../state/statusStore';
import { useAssetStore } from '../state/assetStore';
import { useSelectionStore } from '../state/selectionStore';
import { MATERIAL_PRESETS, type MaterialDefinition, type MaterialPreset } from '../cad/materials';
import type { ShapeHandle, MeshOptions, EdgeData } from '../cad/types';
import { collectNodeInputs, validateGraph } from './graphValidation';
import { hashNode } from './hashing';
import type { GraphDocument, GraphNode } from './graphTypes';

interface NodeOutput {
  /** Hash des Inputs, mit dem das hier gerechnet wurde. */
  hash: string;
  /** Pro Output-Socket der Wert. Bei Shape-Outputs ein ShapeHandle. */
  values: Record<string, unknown>;
  /** Wenn dieser Node ein Shape produziert hat, speichern wir den Handle hier
   *  damit der Cache ihn beim Invalidieren freigeben kann. */
  ownsShape?: ShapeHandle;
}

const cache = new Map<string, NodeOutput>();
// nodeId -> letzter Hash. Brauchen wir um bei Aenderung den alten Cache zu finden.
const lastHashPerNode = new Map<string, string>();

export function clearGraphCache(): void {
  // Auch alle gehaltenen Shapes freigeben
  const kernel = getKernel();
  for (const out of cache.values()) {
    if (out.ownsShape) {
      kernel.releaseShape(out.ownsShape).catch(() => { /* ignore */ });
    }
  }
  cache.clear();
  lastHashPerNode.clear();
}

/**
 * Liefert das aktuell gecachte Shape-Handle eines Nodes, falls vorhanden.
 * Wird vom Export-Workflow genutzt, um das "aktive" Shape zu finden.
 *
 * Bei Preview-Nodes liefern wir das Shape, das dem Preview als Input dient -
 * Preview selbst hat kein eigenes Shape-Output.
 */
export function getLastShapeForNode(nodeId: string): ShapeHandle | null {
  const hash = lastHashPerNode.get(nodeId);
  if (!hash) return null;
  const entry = cache.get(hash);
  if (!entry) return null;
  // Bevorzugt eigenes Shape (alle Shape-produzierenden Nodes)
  if (entry.ownsShape) return entry.ownsShape;
  // Sonst durchsuche die values - z.B. bei Preview ist 'shape' im values als input weiterleitung
  const shape = entry.values.shape;
  if (typeof shape === 'string') return shape as ShapeHandle;
  return null;
}

export interface ExecutionResult {
  ok: boolean;
  errors: Map<string, string>;
  durations: Map<string, number>;
}

let runToken = 0;

/**
 * Fuehrt den Graph aus. Mehrere parallele Calls werden durch ein Token
 * geserialisiert - nur das letzte gewinnt. So vermeiden wir Race-Conditions
 * bei Slider-Bewegung.
 */
export async function executeGraph(doc: GraphDocument): Promise<ExecutionResult> {
  const myToken = ++runToken;
  const status = useStatusStore.getState();
  const errors = new Map<string, string>();
  const durations = new Map<string, number>();
  const outputs = new Map<string, Record<string, unknown>>();
  const newHashes = new Map<string, string>();
  const newCacheEntries = new Map<string, NodeOutput>();

  const validation = validateGraph(doc);
  if (!validation.ok || !validation.order) {
    for (const issue of validation.issues) {
      if (issue.level === 'error') {
        const key = issue.nodeId ?? issue.edgeId ?? '_';
        errors.set(key, issue.message);
      }
    }
    status.setValidation(validation.issues);
    return { ok: false, errors, durations };
  }
  status.setValidation(validation.issues);

  const kernel = getKernel();
  const t0 = performance.now();
  status.setCompute('computing');

  try {
    for (const node of validation.order) {
      // Wenn ein neuerer Run laeuft - hier abbrechen.
      if (myToken !== runToken) return { ok: false, errors, durations };

      const upstreamHashes: string[] = [];
      for (const e of doc.edges) {
        if (e.target === node.id) {
          const h = newHashes.get(e.source);
          if (h) upstreamHashes.push(`${h}#${e.sourceHandle}`);
        }
      }
      const h = hashNode(node, upstreamHashes);
      newHashes.set(node.id, h);

      // Cache-Hit?
      const cached = cache.get(h);
      if (cached) {
        outputs.set(node.id, cached.values);
        newCacheEntries.set(h, cached);
        durations.set(node.id, 0);
        continue;
      }

      // Ausfuehren
      const tn = performance.now();
      try {
        const inputs = collectNodeInputs(node, doc, outputs);
        const result = await executeNode(node, inputs, doc);
        outputs.set(node.id, result.values);
        newCacheEntries.set(h, { hash: h, values: result.values, ownsShape: result.ownsShape });
      } catch (err) {
        const msg = describeError(err);
        errors.set(node.id, msg);
        // Pseudo-Output, damit downstream Nodes "soft" weiterlaufen
        outputs.set(node.id, {});
      }
      durations.set(node.id, performance.now() - tn);
    }

    // Cache aktualisieren: alte Eintraege freigeben, neue uebernehmen
    const oldCache = cache;
    for (const [oldH, oldEntry] of oldCache) {
      if (!newCacheEntries.has(oldH) && oldEntry.ownsShape) {
        kernel.releaseShape(oldEntry.ownsShape).catch(() => { /* ignore */ });
      }
    }
    cache.clear();
    for (const [h, e] of newCacheEntries) cache.set(h, e);
    lastHashPerNode.clear();
    for (const [id, h] of newHashes) lastHashPerNode.set(id, h);

    // Aufraeumen: Meshes von Preview-Nodes, die NICHT mehr im Graph sind
    // (z.B. weil der Node geloescht wurde), aus dem Viewer entfernen.
    const currentPreviewIds = new Set(
      doc.nodes.filter((n) => n.type === 'preview').map((n) => n.id),
    );
    const viewerMeshes = useViewerStore.getState().meshes;
    for (const meshId of viewerMeshes.keys()) {
      if (!currentPreviewIds.has(meshId)) {
        useViewerStore.getState().removeMesh(meshId);
      }
    }

    const totalMs = performance.now() - t0;
    if (errors.size === 0) {
      status.setCompute('success', { ms: totalMs });
    } else {
      const first = [...errors.values()][0];
      status.setCompute('error', { ms: totalMs, error: `${errors.size} Fehler – z.B. "${first}"` });
    }
    status.setNodeDiagnostics({
      durations,
      errors,
      statusByNode: buildStatusMap(validation.order, errors),
    });
    return { ok: errors.size === 0, errors, durations };
  } catch (e) {
    status.setCompute('error', { error: (e as Error)?.message ?? String(e) });
    throw e;
  }
}

function buildStatusMap(order: GraphNode[], errors: Map<string, string>) {
  const m = new Map<string, GraphNode['status']>();
  for (const n of order) m.set(n.id, errors.has(n.id) ? 'error' : 'ok');
  return m;
}

// ============================================================================
// Node-Handlers
// ============================================================================

interface NodeRunResult {
  values: Record<string, unknown>;
  ownsShape?: ShapeHandle;
}

async function executeNode(node: GraphNode, inputs: Record<string, unknown>, doc: GraphDocument): Promise<NodeRunResult> {
  const kernel = getKernel();

  switch (node.type) {
    case 'number':
    case 'slider':
      return { values: { out: num(inputs.value, 0) } };

    case 'box': {
      const h = await kernel.createBox({
        width: num(inputs.width, 50),
        depth: num(inputs.depth, 50),
        height: num(inputs.height, 20),
        x: num(inputs.x, 0),
        y: num(inputs.y, 0),
        z: num(inputs.z, 0),
      });
      return { values: { shape: h }, ownsShape: h };
    }

    case 'cylinder': {
      const h = await kernel.createCylinder({
        radius: num(inputs.radius, 10),
        height: num(inputs.height, 30),
        x: num(inputs.x, 0),
        y: num(inputs.y, 0),
        z: num(inputs.z, 0),
        axis: (inputs.axis as 'x' | 'y' | 'z') ?? 'z',
      });
      return { values: { shape: h }, ownsShape: h };
    }

    case 'sphere': {
      const h = await kernel.createSphere({
        radius: num(inputs.radius, 15),
        x: num(inputs.x, 0),
        y: num(inputs.y, 0),
        z: num(inputs.z, 0),
      });
      return { values: { shape: h }, ownsShape: h };
    }

    case 'cone': {
      const h = await kernel.createCone({
        radius1: num(inputs.radius1, 15),
        radius2: num(inputs.radius2, 0),
        height: num(inputs.height, 30),
        x: num(inputs.x, 0),
        y: num(inputs.y, 0),
        z: num(inputs.z, 0),
        axis: (inputs.axis as 'x' | 'y' | 'z') ?? 'z',
      });
      return { values: { shape: h }, ownsShape: h };
    }

    case 'plate': {
      // Plate ist eine Box mit semantischen Achsen: length=X, width=Y, thickness=Z
      const h = await kernel.createBox({
        width: num(inputs.length, 600),
        depth: num(inputs.width, 400),
        height: num(inputs.thickness, 19),
        x: num(inputs.x, 0),
        y: num(inputs.y, 0),
        z: num(inputs.z, 0),
      });
      return { values: { shape: h }, ownsShape: h };
    }

    case 'sketch': {
      const sketchJson = (node.params.sketchJson as string) ?? '';
      if (!sketchJson) throw new Error('sketch: keine Skizze vorhanden — bitte erst im Properties-Panel zeichnen');

      // Apply constraint-value overrides stored as node.params[constraintId]
      let effectiveJson = sketchJson;
      try {
        const sk = JSON.parse(sketchJson) as { constraints: Record<string, Record<string, unknown>> };
        let modified = false;
        for (const [cid, c] of Object.entries(sk.constraints ?? {})) {
          const type = c.type as string;
          if (type === 'length' || type === 'radius' || type === 'angle' || type === 'distance') {
            const ov = node.params[cid];
            if (typeof ov === 'number') { sk.constraints[cid] = { ...c, value: ov }; modified = true; }
          } else if (type === 'fixed') {
            const ox = node.params[cid + '_x'];
            const oy = node.params[cid + '_y'];
            if (typeof ox === 'number' || typeof oy === 'number') {
              sk.constraints[cid] = {
                ...c,
                x: typeof ox === 'number' ? ox : c.x,
                y: typeof oy === 'number' ? oy : c.y,
              };
              modified = true;
            }
          }
        }
        if (modified) effectiveJson = JSON.stringify(sk);
      } catch { /* keep original */ }

      const h = await kernel.sketchExtrude({
        sketchJson: effectiveJson,
        height: num(inputs.height ?? node.params.height, 20),
        baseZ: num(node.params.baseZ, 0),
        direction: (node.params.direction as 'x' | 'y' | 'z') ?? 'z',
      });
      return { values: { shape: h }, ownsShape: h };
    }

    case 'extrudePolygon': {
      const json = (inputs.pointsJson as string) ?? '[]';
      let points: number[];
      try {
        const parsed = JSON.parse(json);
        if (!Array.isArray(parsed) || parsed.length < 6 || parsed.length % 2 !== 0) {
          throw new Error('Punkte muessen ein flaches Array gerader Laenge sein, mind. 6 Werte (= 3 Punkte)');
        }
        points = parsed.map(Number);
        if (points.some((n) => !Number.isFinite(n))) throw new Error('Punkte enthalten ungueltige Werte');
      } catch (e) {
        throw new Error(`extrudePolygon: pointsJson nicht parsbar - ${(e as Error).message}`);
      }
      const h = await kernel.extrudePolygon({
        points,
        height: num(inputs.height, 20),
        baseZ: num(inputs.baseZ, 0),
        direction: (inputs.direction as 'x' | 'y' | 'z') ?? 'z',
      });
      return { values: { shape: h }, ownsShape: h };
    }

    case 'holePattern': {
      const base = requireShape(inputs.base, 'holePattern.base');
      const h = await kernel.holePattern(base, {
        diameter: num(inputs.diameter, 5),
        depth: num(inputs.depth, 15),
        through: inputs.through === true,
        countX: Math.max(1, Math.round(num(inputs.countX, 3))),
        countY: Math.max(1, Math.round(num(inputs.countY, 2))),
        spacingX: num(inputs.spacingX, 32),
        spacingY: num(inputs.spacingY, 32),
        originX: num(inputs.originX, 20),
        originY: num(inputs.originY, 20),
        originZ: num(inputs.originZ, 0),
        axis: (inputs.axis as 'x' | 'y' | 'z') ?? 'z',
      });
      return { values: { shape: h }, ownsShape: h };
    }

    case 'difference': {
      const base = requireShape(inputs.base, 'difference.base');
      const tool = requireShape(inputs.tool, 'difference.tool');
      const h = await kernel.booleanDifference(base, tool);
      return { values: { shape: h }, ownsShape: h };
    }

    case 'union': {
      const a = requireShape(inputs.a, 'union.a');
      const b = requireShape(inputs.b, 'union.b');
      const h = await kernel.booleanUnion(a, b);
      return { values: { shape: h }, ownsShape: h };
    }

    case 'intersection': {
      const a = requireShape(inputs.a, 'intersection.a');
      const b = requireShape(inputs.b, 'intersection.b');
      const h = await kernel.booleanIntersection(a, b);
      return { values: { shape: h }, ownsShape: h };
    }

    case 'fillet': {
      const shape = requireShape(inputs.shape, 'fillet.shape');
      const h = await kernel.filletAll(shape, num(inputs.radius, 1));
      return { values: { shape: h }, ownsShape: h };
    }

    case 'chamfer': {
      const shape = requireShape(inputs.shape, 'chamfer.shape');
      const h = await kernel.chamferAll(shape, num(inputs.distance, 1));
      return { values: { shape: h }, ownsShape: h };
    }

    case 'hole': {
      const base = requireShape(inputs.base, 'hole.base');
      const h = await kernel.hole(base, {
        radius: num(inputs.radius, 4),
        depth: num(inputs.depth, 20),
        x: num(inputs.x, 0),
        y: num(inputs.y, 0),
        z: num(inputs.z, 0),
        axis: (inputs.axis as 'x' | 'y' | 'z') ?? 'z',
        through: inputs.through === true,
      });
      return { values: { shape: h }, ownsShape: h };
    }

    case 'mirror': {
      const shape = requireShape(inputs.shape, 'mirror.shape');
      const h = await kernel.mirror(shape, {
        plane: (inputs.plane as 'XY' | 'XZ' | 'YZ') ?? 'XZ',
        originX: num(inputs.originX, 0),
        originY: num(inputs.originY, 0),
        originZ: num(inputs.originZ, 0),
        keepOriginal: inputs.keepOriginal === true,
      });
      return { values: { shape: h }, ownsShape: h };
    }

    case 'linearArray': {
      const shape = requireShape(inputs.shape, 'linearArray.shape');
      const h = await kernel.linearArray(shape, {
        count: Math.max(1, Math.round(num(inputs.count, 3))),
        dx: num(inputs.dx, 60),
        dy: num(inputs.dy, 0),
        dz: num(inputs.dz, 0),
      });
      return { values: { shape: h }, ownsShape: h };
    }

    case 'translate': {
      const shape = requireShape(inputs.shape, 'translate.shape');
      const h = await kernel.translate(shape, {
        dx: num(inputs.dx, 0),
        dy: num(inputs.dy, 0),
        dz: num(inputs.dz, 0),
      });
      return { values: { shape: h }, ownsShape: h };
    }

    case 'rotate': {
      const shape = requireShape(inputs.shape, 'rotate.shape');
      const h = await kernel.rotate(shape, {
        axis: (inputs.axis as 'x' | 'y' | 'z') ?? 'z',
        angleDeg: num(inputs.angle, 0),
        px: num(inputs.px, 0),
        py: num(inputs.py, 0),
        pz: num(inputs.pz, 0),
      });
      return { values: { shape: h }, ownsShape: h };
    }

    case 'scale': {
      const shape = requireShape(inputs.shape, 'scale.shape');
      const h = await kernel.scale(shape, {
        factor: num(inputs.factor, 1),
        px: num(inputs.px, 0),
        py: num(inputs.py, 0),
        pz: num(inputs.pz, 0),
      });
      return { values: { shape: h }, ownsShape: h };
    }

    case 'importedStep': {
      const assetId = (inputs.assetId as string) ?? '';
      if (!assetId) throw new Error('importedStep: kein Asset zugewiesen');
      const bytes = await useAssetStore.getState().getBytes(assetId);
      if (!bytes) throw new Error(`importedStep: Asset ${assetId} nicht gefunden`);
      const h = await kernel.importStep(bytes);

      // Bounding Box + Topology als Diagnose loggen
      try {
        const meta = await kernel.getMeta(h);
        const { bbox, facesCount, edgesCount } = meta;
        const sx = (bbox.max[0] - bbox.min[0]).toFixed(1);
        const sy = (bbox.max[1] - bbox.min[1]).toFixed(1);
        const sz = (bbox.max[2] - bbox.min[2]).toFixed(1);
        const cx = ((bbox.min[0] + bbox.max[0]) / 2).toFixed(1);
        const cy = ((bbox.min[1] + bbox.max[1]) / 2).toFixed(1);
        const cz = ((bbox.min[2] + bbox.max[2]) / 2).toFixed(1);
        useStatusStore.getState().log(
          'info',
          `STEP geladen: ${facesCount} Flächen, ${edgesCount} Kanten · ` +
          `Größe ${sx}×${sy}×${sz} · Mittelpunkt (${cx}, ${cy}, ${cz})`,
        );
      } catch { /* Meta-Fehler nicht propagieren */ }

      return { values: { shape: h }, ownsShape: h };
    }

    case 'filletEdges': {
      const shape = requireShape(inputs.shape, 'filletEdges.shape');
      const edgeIds = Array.isArray(inputs.edgeIds) ? (inputs.edgeIds as string[]) : [];
      if (edgeIds.length === 0) {
        // Mit leerer Auswahl: shape unveraendert durchreichen
        return { values: { shape } };
      }
      const h = await kernel.filletEdges(shape, edgeIds, num(inputs.radius, 1));
      return { values: { shape: h }, ownsShape: h };
    }

    case 'chamferEdges': {
      const shape = requireShape(inputs.shape, 'chamferEdges.shape');
      const edgeIds = Array.isArray(inputs.edgeIds) ? (inputs.edgeIds as string[]) : [];
      if (edgeIds.length === 0) {
        return { values: { shape } };
      }
      const h = await kernel.chamferEdges(shape, edgeIds, num(inputs.distance, 1));
      return { values: { shape: h }, ownsShape: h };
    }

    case 'material': {
      const shape = inputs.shape as ShapeHandle | undefined;
      if (!shape) return { values: {} };

      // Material aus Preset bauen, dann Overrides aus dem Node anwenden.
      const presetKey = (inputs.preset as MaterialPreset) ?? 'wood-oak';
      const preset = MATERIAL_PRESETS[presetKey] ?? MATERIAL_PRESETS.custom;
      const overrideColor = inputs.overrideColor === true;

      const material: MaterialDefinition = {
        ...preset,
        // Wenn der User die Farbe explizit ueberschreibt: nehmen.
        // Sonst: Preset-Farbe behalten.
        color: overrideColor ? (inputs.color as string) ?? preset.color : preset.color,
        // Andere Eigenschaften kann der User immer angleichen
        metalness: num(inputs.metalness, preset.metalness),
        roughness: num(inputs.roughness, preset.roughness),
        opacity: num(inputs.opacity, preset.opacity ?? 1.0),
      };

      // Shape wird unveraendert durchgereicht - Material reist als zusaetzlicher value
      return { values: { shape, material } };
    }

    case 'preview': {
      const shape = inputs.shape as ShapeHandle | undefined;
      if (!shape) {
        useViewerStore.getState().removeMesh(node.id);
        return { values: {} };
      }
      const quality = (inputs.quality as string) ?? 'normal';
      const opt: MeshOptions = {
        draft: { linearDeflection: 0.5, angularDeflection: 0.8 },
        normal: { linearDeflection: 0.15, angularDeflection: 0.5 },
        high: { linearDeflection: 0.03, angularDeflection: 0.3 },
      }[quality] ?? { linearDeflection: 0.15 };
      const mesh = await kernel.triangulate(shape, opt);

      let edges: EdgeData[] | undefined;
      if (graphNeedsEdges(doc)) {
        try {
          const payload = await kernel.extractEdges(shape);
          edges = payload.edges;
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn('[preview] extractEdges failed', e);
        }
      }

      // Material aus dem Upstream-Flow (von einem material-Node) - hat Vorrang
      // vor der einfachen 'color'-Property des Preview-Nodes
      const material = inputs.material as MaterialDefinition | undefined;

      useViewerStore.getState().setMesh({
        id: node.id,
        data: mesh,
        edges,
        material,
        color: (inputs.color as string) ?? '#b8c4d0',
      });
      return { values: { shape, material } };
    }

    default:
      throw new Error(`Unbekannter Node-Typ: ${node.type}`);
  }
}

/** Pruefen ob der aktuelle Graph Kanten-Daten braucht. */
function graphNeedsEdges(doc: GraphDocument): boolean {
  if (useSelectionStore.getState().pickingNodeId) return true;
  return doc.nodes.some((n) => n.type === 'filletEdges' || n.type === 'chamferEdges');
}

/**
 * Wandelt beliebige Caught-Values in lesbare Fehlermeldungen um.
 * In Emscripten-Builds wirft OCCT manchmal eine rohe C++-Exception-Adresse
 * (Ganzzahl) anstelle eines JS-Error-Objekts. Wir erkennen das und geben
 * eine sprechende Meldung zurueck.
 */
function describeError(e: unknown): string {
  if (e == null) return 'Unbekannter Fehler (null)';
  if (typeof e === 'number') {
    return `OCCT-Fehler (C++-Exception, ptr=0x${e.toString(16)})`;
  }
  return (e as Error)?.message ?? String(e);
}

function num(v: unknown, dflt: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : dflt;
}

function requireShape(v: unknown, label: string): ShapeHandle {
  if (typeof v !== 'string' || !v) throw new Error(`${label}: shape input fehlt`);
  return v as ShapeHandle;
}
