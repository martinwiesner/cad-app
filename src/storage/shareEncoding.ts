// src/storage/shareEncoding.ts
// Kodiert ein Projekt-Document fuer den Versand via URL.
//
// Strategie:
//   1. Document inkl. Assets (Base64-eingebettete STEP-Bytes) zu JSON
//   2. JSON -> UTF-8 -> gzip (CompressionStream)
//   3. gzip -> base64url
//
// Dekodierung in der umgekehrten Reihenfolge.
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

/** Wenn das Projekt diese Assets benoetigt - mit Bytes eingebettet. */
export interface SharedAsset {
  id: string;
  filename: string;
  mime: string;
  base64: string;
}

export interface SharedDocument {
  doc: GraphDocument;
  assets: SharedAsset[];
  /** Konfigurator-Modus beim Empfaenger? */
  openInConfigurator: boolean;
  /** Erstellungszeit (fuer Diagnose). */
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

  // Asset-Bytes aus IndexedDB holen + base64 encoden
  const assetStore = useAssetStore.getState();
  const assets: SharedAsset[] = [];
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
    assets.push({
      id,
      filename: meta.filename,
      mime: meta.mime,
      base64: bytesToBase64(bytes),
    });
  }

  const payload: SharedDocument = {
    doc,
    assets,
    openInConfigurator: !!options.openInConfigurator,
    createdAt: new Date().toISOString(),
  };

  const json = JSON.stringify(payload);
  const compressed = await gzipCompress(new TextEncoder().encode(json));
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
 */
export async function decodeShareUrl(encoded: string): Promise<SharedDocument> {
  const compressed = base64UrlToBytes(encoded);
  const decompressed = await gzipDecompress(compressed);
  const json = new TextDecoder().decode(decompressed);
  const payload = JSON.parse(json) as SharedDocument;
  return payload;
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
    const bytes = base64ToBytes(a.base64);
    const newId = await assetStore.addAsset(a.filename, bytes, a.mime);
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

function bytesToBase64(bytes: Uint8Array): string {
  // btoa erwartet binary string. Bei sehr grossen Inputs in chunks arbeiten,
  // sonst Stack-Overflow auf Safari.
  let binary = '';
  const CHUNK = 32768;
  for (let i = 0; i < bytes.byteLength; i += CHUNK) {
    const slice = bytes.subarray(i, Math.min(i + CHUNK, bytes.byteLength));
    binary += String.fromCharCode.apply(null, slice as any);
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes)
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
