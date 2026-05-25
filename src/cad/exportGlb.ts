// src/cad/exportGlb.ts
// Single-Mesh GLB-Export. GLB ist binary glTF 2.0 - ein gut definiertes Format,
// das in Blender, Browser-Viewer, Three.js, Unity etc. korrekt geladen wird.
//
// Wir erzeugen einen minimalen Scene-Graph:
//   scene -> node -> mesh -> primitive (positions, normals, indices, material)
//
// Spec: https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html

import type { MeshArrays } from './types';

interface ExportOpts {
  color?: [number, number, number, number]; // RGBA 0..1
  metallic?: number;
  roughness?: number;
  nodeName?: string;
}

export function meshToGlb(mesh: MeshArrays, opts: ExportOpts = {}): Uint8Array {
  const color = opts.color ?? [0.72, 0.77, 0.82, 1.0];
  const metallic = opts.metallic ?? 0.1;
  const roughness = opts.roughness ?? 0.55;
  const nodeName = opts.nodeName ?? 'CadMesh';

  // Bounding box fuer accessor.min/max - glTF verlangt das fuer POSITION
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < mesh.positions.length; i += 3) {
    const x = mesh.positions[i], y = mesh.positions[i + 1], z = mesh.positions[i + 2];
    if (x < minX) minX = x; if (y < minY) minY = y; if (z < minZ) minZ = z;
    if (x > maxX) maxX = x; if (y > maxY) maxY = y; if (z > maxZ) maxZ = z;
  }

  // --- Binary Chunk Layout (4-byte aligned) ---
  // Wir packen positions, normals, indices hintereinander.
  // glTF erlaubt verschiedene componentTypes; wir nutzen:
  //   - POSITION: FLOAT (5126)
  //   - NORMAL:   FLOAT (5126)
  //   - INDICES:  UNSIGNED_INT (5125)
  const positionsBytes = mesh.positions.byteLength;
  const normalsBytes = mesh.normals.byteLength;
  const indicesBytes = mesh.indices.byteLength;

  const positionsOffset = 0;
  const normalsOffset = align4(positionsOffset + positionsBytes);
  const indicesOffset = align4(normalsOffset + normalsBytes);
  const binTotal = align4(indicesOffset + indicesBytes);

  const bin = new ArrayBuffer(binTotal);
  new Uint8Array(bin, positionsOffset, positionsBytes).set(new Uint8Array(mesh.positions.buffer, mesh.positions.byteOffset, positionsBytes));
  new Uint8Array(bin, normalsOffset, normalsBytes).set(new Uint8Array(mesh.normals.buffer, mesh.normals.byteOffset, normalsBytes));
  new Uint8Array(bin, indicesOffset, indicesBytes).set(new Uint8Array(mesh.indices.buffer, mesh.indices.byteOffset, indicesBytes));

  // --- JSON Manifest ---
  const json = {
    asset: { version: '2.0', generator: 'cad-konfigurator' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: nodeName }],
    meshes: [{
      primitives: [{
        attributes: { POSITION: 0, NORMAL: 1 },
        indices: 2,
        material: 0,
        mode: 4, // TRIANGLES
      }],
    }],
    materials: [{
      pbrMetallicRoughness: {
        baseColorFactor: color,
        metallicFactor: metallic,
        roughnessFactor: roughness,
      },
      doubleSided: false,
    }],
    buffers: [{ byteLength: binTotal }],
    bufferViews: [
      { buffer: 0, byteOffset: positionsOffset, byteLength: positionsBytes, target: 34962 /* ARRAY_BUFFER */ },
      { buffer: 0, byteOffset: normalsOffset,   byteLength: normalsBytes,   target: 34962 },
      { buffer: 0, byteOffset: indicesOffset,   byteLength: indicesBytes,   target: 34963 /* ELEMENT_ARRAY_BUFFER */ },
    ],
    accessors: [
      {
        bufferView: 0, componentType: 5126 /* FLOAT */, count: mesh.positions.length / 3,
        type: 'VEC3', min: [minX, minY, minZ], max: [maxX, maxY, maxZ],
      },
      {
        bufferView: 1, componentType: 5126, count: mesh.normals.length / 3, type: 'VEC3',
      },
      {
        bufferView: 2, componentType: 5125 /* UNSIGNED_INT */, count: mesh.indices.length, type: 'SCALAR',
      },
    ],
  };

  const jsonStr = JSON.stringify(json);
  // JSON-Chunk muss 4-byte aligned sein, gepadded mit Space (0x20)
  const jsonBytes = new TextEncoder().encode(jsonStr);
  const jsonPadded = padTo4(jsonBytes, 0x20);

  // --- GLB Container ---
  const HEADER = 12;
  const JSON_CHUNK_HEADER = 8;
  const BIN_CHUNK_HEADER = 8;
  const total = HEADER + JSON_CHUNK_HEADER + jsonPadded.byteLength + BIN_CHUNK_HEADER + binTotal;

  const out = new ArrayBuffer(total);
  const dv = new DataView(out);
  const u8 = new Uint8Array(out);

  // GLB Header
  dv.setUint32(0, 0x46546c67, true);    // "glTF"
  dv.setUint32(4, 2, true);             // version
  dv.setUint32(8, total, true);         // total length

  // JSON Chunk
  let off = HEADER;
  dv.setUint32(off, jsonPadded.byteLength, true);   off += 4;
  dv.setUint32(off, 0x4e4f534a, true);              off += 4;  // "JSON"
  u8.set(jsonPadded, off);                           off += jsonPadded.byteLength;

  // BIN Chunk
  dv.setUint32(off, binTotal, true);                 off += 4;
  dv.setUint32(off, 0x004e4942, true);               off += 4;  // "BIN\0"
  u8.set(new Uint8Array(bin), off);

  return u8;
}

function align4(n: number): number {
  return (n + 3) & ~3;
}

function padTo4(bytes: Uint8Array, padByte: number): Uint8Array {
  const padded = align4(bytes.byteLength);
  if (padded === bytes.byteLength) return bytes;
  const out = new Uint8Array(padded);
  out.set(bytes);
  for (let i = bytes.byteLength; i < padded; i++) out[i] = padByte;
  return out;
}
