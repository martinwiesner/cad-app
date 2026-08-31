// src/storage/shareEncoding.ts
// Kodiert ein Projekt-Document fuer den Versand via URL.
//
// Strategie (v2, aktuell):
//   1. Header (Document + Asset-Metadaten) -> JSON -> UTF-8
//   2. Container = [0x01][4B Header-Laenge LE][Header-Bytes][Asset1-Rohbytes][Asset2-Rohbytes]...
//   3. Container (roh, KEIN Base64!) -> gzip (CompressionStream)
//   4. gzip -> base64url
//
// Frueher wurden Asset-Bytes vor dem Zusammenbau zusaetzlich einzeln base64-kodiert
// und erst dann das gesamte JSON gezippt. Das kostete doppelt: Base64 blaeht Binaerdaten
// um ~33% auf, *bevor* gzip drankommt, und gzip komprimiert Base64-Text (wirkt fast wie
// Zufallsdaten) deutlich schlechter als dieselben Bytes in Rohform. Jetzt werden die
// Asset-Rohbytes direkt in den Container gepackt und genau einmal (das gesamte Ergebnis)
// base64url-kodiert.
//
// Abwaertskompatibilitaet: alte Shares (reines JSON mit base64-eingebetteten Assets,
// kein Format-Marker) werden weiterhin erkannt und dekodiert (siehe decodeLegacyJson).
//
// Praktische Grenzen:
//   - URL-Fragment (#) kommt nicht zum Server, also kein Server-Logging
//   - Browser unterstuetzen bis ~64KB Fragment problemlos, einige bis MBs
//   - Wir warnen ab 16KB encoded length (sehr lange URL = nicht teilbar via Chat)

import type { GraphDocument } from '../graph/graphTypes';
import { useAssetStore } from '../state/assetStore';

/** Wert in Bytes ab dem wir eine Warnung beim Export geben. */
export const SHARE_SIZE_WARN = 16 * 1024;
/** Harte Grenze - wir liefern trotzdem, aber sehr lange URLs koennen in Chats abgeschnitten werden. */
export const SHARE_SIZE_LIMIT = 1 * 1024 * 1024;

/** Erster Byte des unkomprimierten Containers bei neuem (v2) Format.
 *  JSON-Text (altes Format) kann nie mit diesem Byte beginnen (JSON startet immer mit
 *  einem druckbaren ASCII-Zeichen wie '{', '[', '"', einer Ziffer, oder Whitespace). */
const FORMAT_MARKER_V2 = 0x01;

/** Ein Asset nach dem Dekodieren - Rohbytes, kein Base64-Umweg mehr noetig. */
export interface SharedAsset {
  id: string;
  filename: string;
  mime: string;
  bytes: Uint8Array;
}

export interface SharedDocument {
  doc: GraphDocument;
  assets: SharedAsset[];
  /** Konfigurator-Modus beim Empfaenger? */
  openInConfigurator: boolean;
  /** Erstellungszeit (fuer Diagnose). */
  createdAt: string;
}

/** Nur Metadaten - landen im Header, die Rohbytes folgen dahinter im Container. */
interface AssetMeta {
  id: string;
  filename: string;
  mime: string;
  length: number;
}

interface HeaderV2 {
  doc: GraphDocument;
  assets: AssetMeta[];
  openInConfigurator: boolean;
  createdAt: string;
}

/** Altes Wire-Format (vor v2): Assets als Base64-String direkt im JSON. */
interface LegacySharedAsset {
  id: string;
  filename: string;
  mime: string;
  base64: string;
}
interface LegacySharedDocument {
  doc: GraphDocument;
  assets: LegacySharedAsset[];
  openInConfigurator: boolean;
  createdAt: string;
}

/**
 * Sammelt alle vom Document referenzierten Assets und kodiert das Ganze.
 */
export async function encodeShareUrl(
  doc: GraphDocument,
  options: { openInConfigurator?: boolean } = {},
): Promise<{ encoded: string; sizeBytes: number; warning?: string }> {
  // Asset-IDs aus dem Doc sammeln (importedStep-Nodes referenzieren assetId)
  const usedAssetIds = new Set<string>();
  for (const node of doc.nodes) {
    if (node.type === 'importedStep') {
      const id = node.params.assetId as string | undefined;
      if (id) usedAssetIds.add(id);
    }
  }

  // Asset-Rohbytes aus IndexedDB holen - KEIN Base64 hier, das kostet nur Groesse.
  const assetStore = useAssetStore.getState();
  const rawAssets: { id: string; filename: string; mime: string; bytes: Uint8Array }[] = [];
  for (const id of usedAssetIds) {
    const meta = assetStore.assets.get(id);
    const bytes = await assetStore.getBytes(id);
    if (!meta || !bytes) {
      // Asset fehlt - der Empfaenger bekommt einen leeren importedStep-Node.
      // Wir koennten hier abbrechen, aber das Projekt zu teilen ist trotzdem nuetzlich.
      // eslint-disable-next-line no-console
      console.warn(`[share] Asset ${id} nicht verfuegbar - wird im Share weggelassen`);
      continue;
    }
    rawAssets.push({ id, filename: meta.filename, mime: meta.mime, bytes });
  }

  const header: HeaderV2 = {
    doc,
    assets: rawAssets.map((a) => ({ id: a.id, filename: a.filename, mime: a.mime, length: a.bytes.byteLength })),
    openInConfigurator: !!options.openInConfigurator,
    createdAt: new Date().toISOString(),
  };

  const headerBytes = new TextEncoder().encode(JSON.stringify(header));
  const totalAssetBytes = rawAssets.reduce((sum, a) => sum + a.bytes.byteLength, 0);

  const container = new Uint8Array(1 + 4 + headerBytes.byteLength + totalAssetBytes);
  let offset = 0;
  container[offset] = FORMAT_MARKER_V2;
  offset += 1;
  new DataView(container.buffer).setUint32(offset, headerBytes.byteLength, true);
  offset += 4;
  container.set(headerBytes, offset);
  offset += headerBytes.byteLength;
  for (const a of rawAssets) {
    container.set(a.bytes, offset);
    offset += a.bytes.byteLength;
  }

  const compressed = await gzipCompress(container);
  const encoded = bytesToBase64Url(compressed);

  const sizeBytes = encoded.length;
  let warning: string | undefined;
  if (sizeBytes > SHARE_SIZE_LIMIT) {
    warning = `URL sehr lang (${formatKB(sizeBytes)}) - in Messengern wird sie evtl. abgeschnitten. Erwaege STL-Export stattdessen.`;
  } else if (sizeBytes > SHARE_SIZE_WARN) {
    warning = `URL ist ${formatKB(sizeBytes)} lang - funktioniert in den meisten Browsern, manche Chat-Apps koennen Probleme haben.`;
  }

  return { encoded, sizeBytes, warning };
}

/**
 * Liest ein Share-Payload aus dem URL-Fragment und stellt es wieder her.
 * Erkennt sowohl das aktuelle Binaer-Containerformat (v2) als auch alte,
 * rein JSON-basierte Shares mit base64-eingebetteten Assets.
 */
export async function decodeShareUrl(encoded: string): Promise<SharedDocument> {
  const compressed = base64UrlToBytes(encoded);
  const decompressed = await gzipDecompress(compressed);

  if (decompressed.length > 0 && decompressed[0] === FORMAT_MARKER_V2) {
    return decodeV2Container(decompressed);
  }
  return decodeLegacyJson(decompressed);
}

function decodeV2Container(bytes: Uint8Array): SharedDocument {
  let offset = 1;
  const headerLen = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true);
  offset += 4;
  const headerBytes = bytes.subarray(offset, offset + headerLen);
  offset += headerLen;
  const header = JSON.parse(new TextDecoder().decode(headerBytes)) as HeaderV2;

  const assets: SharedAsset[] = [];
  for (const meta of header.assets) {
    const assetBytes = bytes.subarray(offset, offset + meta.length);
    offset += meta.length;
    assets.push({ id: meta.id, filename: meta.filename, mime: meta.mime, bytes: assetBytes });
  }

  return {
    doc: header.doc,
    assets,
    openInConfigurator: header.openInConfigurator,
    createdAt: header.createdAt,
  };
}

function decodeLegacyJson(bytes: Uint8Array): SharedDocument {
  const json = new TextDecoder().decode(bytes);
  const payload = JSON.parse(json) as LegacySharedDocument;
  return {
    doc: payload.doc,
    assets: payload.assets.map((a) => ({ id: a.id, filename: a.filename, mime: a.mime, bytes: base64ToBytes(a.base64) })),
    openInConfigurator: payload.openInConfigurator,
    createdAt: payload.createdAt,
  };
}

/**
 * Importiert ein dekodiertes Share-Document: speichert Assets in IndexedDB
 * und liefert das Document zurueck. Die importedStep-Nodes referenzieren danach
 * die echten Asset-IDs.
 */
export async function applySharedDocument(shared: SharedDocument): Promise<GraphDocument> {
  const assetStore = useAssetStore.getState();

  // Asset-ID-Mapping: falls bereits ein Asset mit gleichem Hash existiert,
  // wird die alte ID wiederverwendet. addAsset kuemmert sich um Deduplizierung
  // via SHA-256 Hash.
  // Wichtig: die referenzierten IDs in importedStep-Nodes muessen ggf. umgeschrieben werden.
  const idMapping = new Map<string, string>();
  for (const a of shared.assets) {
    const newId = await assetStore.addAsset(a.filename, a.bytes, a.mime);
    idMapping.set(a.id, newId);
  }

  // Doc-Nodes anpassen wenn IDs sich geaendert haben
  const doc: GraphDocument = {
    ...shared.doc,
    nodes: shared.doc.nodes.map((n) => {
      if (n.type === 'importedStep' && typeof n.params.assetId === 'string') {
        const mapped = idMapping.get(n.params.assetId as string);
        if (mapped && mapped !== n.params.assetId) {
          return { ...n, params: { ...n.params, assetId: mapped } };
        }
      }
      return n;
    }),
  };

  return doc;
}

// ===========================================================================
//   Low-level helpers
// ===========================================================================

async function gzipCompress(bytes: Uint8Array): Promise<Uint8Array> {
  // CompressionStream ist in allen modernen Browsern verfuegbar
  if (typeof CompressionStream === 'undefined') {
    // Fallback: ohne Kompression (groessere URL, aber funktioniert)
    return bytes;
  }
  const cs = new CompressionStream('gzip');
  const writer = cs.writable.getWriter();
  writer.write(bytes as Uint8Array<ArrayBuffer>);
  writer.close();
  const chunks: Uint8Array[] = [];
  const reader = cs.readable.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  return concatBytes(chunks);
}

async function gzipDecompress(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    return bytes;
  }
  const ds = new DecompressionStream('gzip');
  const writer = ds.writable.getWriter();
  writer.write(bytes as Uint8Array<ArrayBuffer>);
  writer.close();
  const chunks: Uint8Array[] = [];
  const reader = ds.readable.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  return concatBytes(chunks);
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const c of chunks) total += c.byteLength;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  // btoa erwartet binary string. Bei sehr grossen Inputs in chunks arbeiten,
  // sonst Stack-Overflow auf Safari.
  let binary = '';
  const CHUNK = 32768;
  for (let i = 0; i < bytes.byteLength; i += CHUNK) {
    const slice = bytes.subarray(i, Math.min(i + CHUNK, bytes.byteLength));
    binary += String.fromCharCode.apply(null, slice as unknown as number[]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64UrlToBytes(b64url: string): Uint8Array {
  let b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  // Padding wieder anhaengen
  while (b64.length % 4) b64 += '=';
  return base64ToBytes(b64);
}

function formatKB(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
