// src/state/assetStore.ts
// Assets (importierte STEP-Bytes etc.) werden in IndexedDB persistiert,
// damit ein Projekt-Reload die referenzierten Dateien wiederfindet.
// In-Memory Bytes-Cache haelt die Bytes fuer die Worker-Aufrufe bereit.

import { create } from 'zustand';
import {
  idbPutAsset, idbGetAsset, idbListAssets, idbDeleteAsset,
  type StoredAsset,
} from '../storage/indexedDb';

export interface Asset {
  id: string;
  filename: string;
  size: number;
  hash: string;
  mime: string;
}

interface AssetState {
  assets: Map<string, Asset>;
  hydrated: boolean;

  hydrate: () => Promise<void>;
  addAsset: (filename: string, bytes: Uint8Array, mime?: string) => Promise<string>;
  getBytes: (id: string) => Promise<Uint8Array | null>;
  list: () => Asset[];
  remove: (id: string) => Promise<void>;
}

const bytesCache = new Map<string, Uint8Array>();

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const hashBuf = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(hashBuf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const useAssetStore = create<AssetState>((set, get) => ({
  assets: new Map(),
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return;
    try {
      const all = await idbListAssets();
      const m = new Map<string, Asset>();
      for (const a of all) {
        m.set(a.id, { id: a.id, filename: a.filename, size: a.size, hash: a.hash, mime: a.mime });
        bytesCache.set(a.id, a.bytes);
      }
      set({ assets: m, hydrated: true });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[assetStore] hydrate failed', e);
      set({ hydrated: true });
    }
  },

  addAsset: async (filename, bytes, mime = 'application/STEP') => {
    const hash = await sha256Hex(bytes);
    // Wenn schon vorhanden (gleicher Hash), wiederverwenden
    for (const a of get().assets.values()) {
      if (a.hash === hash) {
        // Sicherstellen, dass Bytes im Cache sind
        bytesCache.set(a.id, bytes);
        return a.id;
      }
    }
    const id = `asset_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const stored: StoredAsset = {
      id, filename, size: bytes.byteLength, hash, mime, bytes,
      createdAt: Date.now(),
    };
    try {
      await idbPutAsset(stored);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[assetStore] persist failed (in-memory only)', e);
    }
    bytesCache.set(id, bytes);
    set((s) => {
      const next = new Map(s.assets);
      next.set(id, { id, filename, size: bytes.byteLength, hash, mime });
      return { assets: next };
    });
    return id;
  },

  getBytes: async (id) => {
    const cached = bytesCache.get(id);
    if (cached) return cached;
    try {
      const a = await idbGetAsset(id);
      if (a) {
        bytesCache.set(id, a.bytes);
        return a.bytes;
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[assetStore] getBytes failed', e);
    }
    return null;
  },

  list: () => [...get().assets.values()],

  remove: async (id) => {
    bytesCache.delete(id);
    try { await idbDeleteAsset(id); } catch { /* ignore */ }
    set((s) => {
      const next = new Map(s.assets);
      next.delete(id);
      return { assets: next };
    });
  },
}));
