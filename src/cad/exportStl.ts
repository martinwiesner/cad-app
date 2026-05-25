// src/cad/exportStl.ts
// STL-Export aus einem MeshArrays. Wir bauen die binaere STL-Form
// selbst, weil das unabhaengig von OCCT-Versionen funktioniert.
// (OCCT hat zwar eigene StlAPI_Writer, aber der erwartet einen
// dateibasierten Workflow im WASM-FS - umstaendlicher.)
//
// Binaeres STL-Format:
//   80 bytes Header (frei)
//   4 bytes uint32 triangle count
//   pro Dreieck:
//     12 bytes normal (3 x float32)
//     36 bytes vertices (9 x float32)
//      2 bytes attribute byte count (0)
//   = 50 bytes pro Dreieck

import type { MeshArrays } from './types';

export function meshToStlBinary(mesh: MeshArrays, headerText = 'cad-konfigurator'): Uint8Array {
  const triCount = mesh.indices.length / 3;
  const totalBytes = 84 + triCount * 50;
  const buffer = new ArrayBuffer(totalBytes);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  // Header (80 bytes)
  const text = headerText.slice(0, 80).padEnd(80, ' ');
  for (let i = 0; i < 80; i++) bytes[i] = text.charCodeAt(i) & 0xff;

  // Triangle count
  view.setUint32(80, triCount, true);

  let offset = 84;
  const positions = mesh.positions;
  const indices = mesh.indices;

  for (let t = 0; t < triCount; t++) {
    const i0 = indices[t * 3] * 3;
    const i1 = indices[t * 3 + 1] * 3;
    const i2 = indices[t * 3 + 2] * 3;

    const ax = positions[i0],     ay = positions[i0 + 1], az = positions[i0 + 2];
    const bx = positions[i1],     by = positions[i1 + 1], bz = positions[i1 + 2];
    const cx = positions[i2],     cy = positions[i2 + 1], cz = positions[i2 + 2];

    // Flaechen-Normale (right-hand)
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;

    view.setFloat32(offset, nx, true);     view.setFloat32(offset + 4, ny, true);  view.setFloat32(offset + 8, nz, true);
    view.setFloat32(offset + 12, ax, true); view.setFloat32(offset + 16, ay, true); view.setFloat32(offset + 20, az, true);
    view.setFloat32(offset + 24, bx, true); view.setFloat32(offset + 28, by, true); view.setFloat32(offset + 32, bz, true);
    view.setFloat32(offset + 36, cx, true); view.setFloat32(offset + 40, cy, true); view.setFloat32(offset + 44, cz, true);
    view.setUint16(offset + 48, 0, true);
    offset += 50;
  }

  return bytes;
}

export function meshToStlAscii(mesh: MeshArrays, name = 'cad-konfigurator'): string {
  const out: string[] = [];
  out.push(`solid ${name}`);
  const positions = mesh.positions;
  const indices = mesh.indices;
  const triCount = indices.length / 3;
  for (let t = 0; t < triCount; t++) {
    const i0 = indices[t * 3] * 3;
    const i1 = indices[t * 3 + 1] * 3;
    const i2 = indices[t * 3 + 2] * 3;
    const ax = positions[i0],     ay = positions[i0 + 1], az = positions[i0 + 2];
    const bx = positions[i1],     by = positions[i1 + 1], bz = positions[i1 + 2];
    const cx = positions[i2],     cy = positions[i2 + 1], cz = positions[i2 + 2];
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    out.push(`  facet normal ${nx} ${ny} ${nz}`);
    out.push('    outer loop');
    out.push(`      vertex ${ax} ${ay} ${az}`);
    out.push(`      vertex ${bx} ${by} ${bz}`);
    out.push(`      vertex ${cx} ${cy} ${cz}`);
    out.push('    endloop');
    out.push('  endfacet');
  }
  out.push(`endsolid ${name}`);
  return out.join('\n');
}
