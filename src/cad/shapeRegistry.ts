// src/cad/shapeRegistry.ts
// Wir senden NIEMALS native WASM-Shape-Objekte ueber die Worker-Grenze.
// Stattdessen vergeben wir String-Handles und halten die echten Shapes im Worker.

import type { ShapeHandle } from './types';

export class ShapeRegistry {
  private map = new Map<ShapeHandle, { shape: any; createdAt: number }>();
  private counter = 0;

  add(shape: any): ShapeHandle {
    const handle = `s_${Date.now().toString(36)}_${(this.counter++).toString(36)}` as ShapeHandle;
    this.map.set(handle, { shape, createdAt: Date.now() });
    return handle;
  }

  get(handle: ShapeHandle): any {
    const entry = this.map.get(handle);
    return entry?.shape ?? null;
  }

  has(handle: ShapeHandle): boolean {
    return this.map.has(handle);
  }

  release(handle: ShapeHandle): boolean {
    const entry = this.map.get(handle);
    if (!entry) return false;
    try {
      entry.shape.delete();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[ShapeRegistry] delete failed for', handle, e);
    }
    this.map.delete(handle);
    return true;
  }

  releaseAll(): void {
    for (const handle of [...this.map.keys()]) this.release(handle);
  }

  size(): number {
    return this.map.size;
  }
}
