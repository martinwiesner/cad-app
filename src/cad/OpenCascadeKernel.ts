// src/cad/OpenCascadeKernel.ts
import { ShapeRegistry } from './shapeRegistry';
import { createBox } from './operations/createBox';
import { createCylinder } from './operations/createCylinder';
import { createSphere } from './operations/createSphere';
import { createCone } from './operations/createCone';
import { extrudePolygon } from './operations/extrudePolygon';
import { applyHolePattern } from './operations/holePattern';
import { booleanDifference, booleanUnion, booleanIntersection } from './operations/booleanOps';
import { filletAllEdges } from './operations/fillet';
import { chamferAllEdges } from './operations/chamfer';
import { filletSelectedEdges, chamferSelectedEdges } from './operations/filletEdges';
import { extractEdges } from './edgeExtraction';
import {
  translateShape as opTranslate,
  rotateShape as opRotate,
  scaleShape as opScale,
} from './operations/transform';
import { mirrorShape as opMirror } from './operations/mirror';
import { linearArray as opLinearArray } from './operations/linearArray';
import { sketchExtrude as opSketchExtrude } from './operations/sketchExtrude';
import { triangulateShape } from './meshConversion';
import { meshToStlBinary } from './exportStl';
import { meshToGlb } from './exportGlb';
import { exportStepBytes } from './exportStep';
import { importStepBytes } from './stepImport';
import { importStlBytes } from './stlImport';
import {
  CadError,
  type BoxParams,
  type ConeParams,
  type CylinderParams,
  type EdgesPayload,
  type ExtrudePolygonParams,
  type HolePatternParams,
  type HoleParams,
  type ICadKernel,
  type LinearArrayParams,
  type SketchExtrudeParams,
  type MeshArrays,
  type MeshOptions,
  type MirrorParams,
  type RotateParams,
  type ScaleParams,
  type ShapeHandle,
  type ShapeMeta,
  type SphereParams,
  type TranslateParams,
} from './types';

type OCInstance = any;

export class OpenCascadeKernel implements ICadKernel {
  private oc: OCInstance | null = null;
  private readyPromise: Promise<void> | null = null;
  private readonly registry = new ShapeRegistry();

  async init(): Promise<void> {
    if (this.readyPromise) return this.readyPromise;
    this.readyPromise = (async () => {
      const mod: any = await import('opencascade.js');
      const initOpenCascade: any = mod.default ?? mod;
      this.oc = await initOpenCascade();
    })();
    return this.readyPromise;
  }

  async isReady(): Promise<boolean> { return this.oc !== null; }

  private requireOc(): OCInstance {
    if (!this.oc) throw new CadError({ code: 'kernel_not_ready', message: 'Kernel not initialized' });
    return this.oc;
  }

  private requireShape(h: ShapeHandle, label: string): any {
    const s = this.registry.get(h);
    if (!s) throw new CadError({ code: 'unknown_shape_handle', message: `${label}: unknown handle ${h}` });
    return s;
  }

  // ----- Primitives -----------------------------------------------------------
  async createBox(p: BoxParams): Promise<ShapeHandle> {
    return this.registry.add(createBox(this.requireOc(), p));
  }
  async createCylinder(p: CylinderParams): Promise<ShapeHandle> {
    return this.registry.add(createCylinder(this.requireOc(), p));
  }

  async createSphere(p: SphereParams): Promise<ShapeHandle> {
    return this.registry.add(createSphere(this.requireOc(), p));
  }

  async createCone(p: ConeParams): Promise<ShapeHandle> {
    return this.registry.add(createCone(this.requireOc(), p));
  }

  async extrudePolygon(p: ExtrudePolygonParams): Promise<ShapeHandle> {
    return this.registry.add(extrudePolygon(this.requireOc(), p));
  }

  async holePattern(base: ShapeHandle, p: HolePatternParams): Promise<ShapeHandle> {
    const shape = applyHolePattern(this.requireOc(), this.requireShape(base, 'holePattern'), p);
    return this.registry.add(shape);
  }

  // ----- Booleans -------------------------------------------------------------
  async booleanDifference(baseH: ShapeHandle, toolH: ShapeHandle): Promise<ShapeHandle> {
    return this.registry.add(booleanDifference(
      this.requireOc(),
      this.requireShape(baseH, 'difference.base'),
      this.requireShape(toolH, 'difference.tool'),
    ));
  }
  async booleanUnion(a: ShapeHandle, b: ShapeHandle): Promise<ShapeHandle> {
    return this.registry.add(booleanUnion(
      this.requireOc(),
      this.requireShape(a, 'union.a'),
      this.requireShape(b, 'union.b'),
    ));
  }
  async booleanIntersection(a: ShapeHandle, b: ShapeHandle): Promise<ShapeHandle> {
    return this.registry.add(booleanIntersection(
      this.requireOc(),
      this.requireShape(a, 'intersection.a'),
      this.requireShape(b, 'intersection.b'),
    ));
  }

  // ----- Features -------------------------------------------------------------
  async filletAll(h: ShapeHandle, radius: number): Promise<ShapeHandle> {
    return this.registry.add(filletAllEdges(this.requireOc(), this.requireShape(h, 'fillet'), radius));
  }
  async chamferAll(h: ShapeHandle, distance: number): Promise<ShapeHandle> {
    return this.registry.add(chamferAllEdges(this.requireOc(), this.requireShape(h, 'chamfer'), distance));
  }

  async filletEdges(h: ShapeHandle, edgeIds: string[], radius: number): Promise<ShapeHandle> {
    const r = filletSelectedEdges(this.requireOc(), this.requireShape(h, 'fillet'), edgeIds, radius);
    if (r.missingIds.length > 0) {
      // eslint-disable-next-line no-console
      console.warn(`[filletEdges] ${r.missingIds.length} von ${edgeIds.length} edgeIds nicht gefunden`);
    }
    return this.registry.add(r.shape);
  }
  async chamferEdges(h: ShapeHandle, edgeIds: string[], distance: number): Promise<ShapeHandle> {
    const r = chamferSelectedEdges(this.requireOc(), this.requireShape(h, 'chamfer'), edgeIds, distance);
    if (r.missingIds.length > 0) {
      // eslint-disable-next-line no-console
      console.warn(`[chamferEdges] ${r.missingIds.length} von ${edgeIds.length} edgeIds nicht gefunden`);
    }
    return this.registry.add(r.shape);
  }

  async extractEdges(h: ShapeHandle): Promise<EdgesPayload> {
    return extractEdges(this.requireOc(), this.requireShape(h, 'extractEdges'));
  }

  /**
   * Bohrung = Zylinder erzeugen + von Base abziehen, intern atomar.
   * Bei through=true wird die Bohrtiefe so gross gewaehlt, dass sie sicher durchschlaegt.
   */
  async hole(baseH: ShapeHandle, p: HoleParams): Promise<ShapeHandle> {
    const oc = this.requireOc();
    const base = this.requireShape(baseH, 'hole.base');

    // Tiefe bestimmen
    let depth = p.depth;
    let z = p.z;
    if (p.through) {
      // Bounding-Box anschauen und Zylinder gross genug + leicht versetzt platzieren
      const meta = await this.getMeta(baseH);
      const extent = Math.max(
        meta.bbox.max[0] - meta.bbox.min[0],
        meta.bbox.max[1] - meta.bbox.min[1],
        meta.bbox.max[2] - meta.bbox.min[2],
      );
      depth = extent * 2.2;
      z = p.z - extent * 0.6;
    }

    // Zylinder als Tool erzeugen - direkt im OCCT, ohne Registry-Eintrag
    const tool = createCylinder(oc, {
      radius: p.radius,
      height: depth,
      x: p.x, y: p.y, z,
      axis: p.axis ?? 'z',
    });

    try {
      const result = booleanDifference(oc, base, tool);
      return this.registry.add(result);
    } finally {
      try { tool.delete(); } catch { /* ignore */ }
    }
  }

  // ----- Transform ------------------------------------------------------------
  async translate(h: ShapeHandle, p: TranslateParams): Promise<ShapeHandle> {
    return this.registry.add(opTranslate(this.requireOc(), this.requireShape(h, 'translate'), p));
  }
  async rotate(h: ShapeHandle, p: RotateParams): Promise<ShapeHandle> {
    return this.registry.add(opRotate(this.requireOc(), this.requireShape(h, 'rotate'), p));
  }
  async scale(h: ShapeHandle, p: ScaleParams): Promise<ShapeHandle> {
    return this.registry.add(opScale(this.requireOc(), this.requireShape(h, 'scale'), p));
  }
  async mirror(h: ShapeHandle, p: MirrorParams): Promise<ShapeHandle> {
    return this.registry.add(opMirror(this.requireOc(), this.requireShape(h, 'mirror'), p));
  }
  async linearArray(h: ShapeHandle, p: LinearArrayParams): Promise<ShapeHandle> {
    return this.registry.add(opLinearArray(this.requireOc(), this.requireShape(h, 'linearArray'), p));
  }

  async sketchExtrude(p: SketchExtrudeParams): Promise<ShapeHandle> {
    const { sketchJson, height, baseZ, direction } = p;
    const sketch = JSON.parse(sketchJson);
    return this.registry.add(opSketchExtrude(this.requireOc(), { sketch, height, baseZ, direction }));
  }

  // ----- IO -------------------------------------------------------------------
  async importStep(bytes: Uint8Array): Promise<ShapeHandle> {
    return this.registry.add(importStepBytes(this.requireOc(), bytes));
  }

  async importStl(bytes: Uint8Array): Promise<ShapeHandle> {
    return this.registry.add(importStlBytes(this.requireOc(), bytes));
  }

  /** Trianguliert in hoher Qualitaet und liefert binaere STL-Bytes. */
  async exportStl(h: ShapeHandle, opt: MeshOptions = {}): Promise<Uint8Array> {
    const mesh = triangulateShape(
      this.requireOc(),
      this.requireShape(h, 'exportStl'),
      { linearDeflection: 0.05, angularDeflection: 0.3, ...opt },
    );
    return meshToStlBinary(mesh);
  }

  /** Trianguliert in normaler Qualitaet und liefert GLB-Bytes (binary glTF). */
  async exportGlb(h: ShapeHandle, opt: MeshOptions = {}): Promise<Uint8Array> {
    const mesh = triangulateShape(
      this.requireOc(),
      this.requireShape(h, 'exportGlb'),
      { linearDeflection: 0.1, angularDeflection: 0.5, ...opt },
    );
    return meshToGlb(mesh);
  }

  /** STEP-Bytes mit voller CAD-Semantik (B-Rep). */
  async exportStep(h: ShapeHandle): Promise<Uint8Array> {
    return exportStepBytes(this.requireOc(), this.requireShape(h, 'exportStep'));
  }

  // ----- Meshing --------------------------------------------------------------
  async triangulate(h: ShapeHandle, opt: MeshOptions = {}): Promise<MeshArrays> {
    return triangulateShape(this.requireOc(), this.requireShape(h, 'triangulate'), opt);
  }

  async getMeta(handle: ShapeHandle): Promise<ShapeMeta> {
    const oc = this.requireOc();
    const shape = this.requireShape(handle, 'getMeta');

    let bbox: ShapeMeta['bbox'] = { min: [0, 0, 0], max: [0, 0, 0] };
    try {
      const box = new oc.Bnd_Box_1();
      oc.BRepBndLib.Add(shape, box, false);
      const cMin = box.CornerMin();
      const cMax = box.CornerMax();
      bbox = {
        min: [cMin.X(), cMin.Y(), cMin.Z()],
        max: [cMax.X(), cMax.Y(), cMax.Z()],
      };
      try { cMin.delete(); cMax.delete(); } catch { /* ignore */ }
      box.delete();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[getMeta] bbox failed', e);
    }

    let facesCount = 0, edgesCount = 0;
    try {
      const fexp = new oc.TopExp_Explorer_2(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
      while (fexp.More()) { facesCount++; fexp.Next(); }
      fexp.delete();
      const eexp = new oc.TopExp_Explorer_2(shape, oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
      while (eexp.More()) { edgesCount++; eexp.Next(); }
      eexp.delete();
    } catch { /* ignore */ }

    return { handle, bbox, facesCount, edgesCount };
  }

  // ----- Lifecycle ------------------------------------------------------------
  async releaseShape(h: ShapeHandle): Promise<void> { this.registry.release(h); }
  async releaseAll(): Promise<void> { this.registry.releaseAll(); }

  // ----- Inspection ----------------------------------------------------------
  async inspectApi(prefixes: string[]): Promise<Record<string, string[]>> {
    const oc = this.requireOc();
    const out: Record<string, string[]> = {};
    const keys = Object.keys(oc);
    for (const p of prefixes) out[p] = keys.filter((k) => k.startsWith(p)).sort();
    return out;
  }
}
