// src/storage/indexedDb.ts
// Minimaler IndexedDB-Wrapper. Wir vermeiden bewusst eine Library wie Dexie -
// die paar Operationen die wir brauchen, sind in ~80 Zeilen erledigt.

const DB_NAME = 'cad-konfigurator';
const DB_VERSION = 1;
const STORE_ASSETS = 'assets';

interface StoredAsset {
  id: string;
  filename: string;
  size: number;
  hash: string;
  mime: string;
  bytes: Uint8Array;
  createdAt: number;
}

let _db: IDBDatabase | null = null;

function openDb(): Promise<IDBDatabase> {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_ASSETS)) {
        db.createObjectStore(STORE_ASSETS, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => { _db = req.result; resolve(req.result); };
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
}

export async function idbPutAsset(asset: StoredAsset): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_ASSETS, 'readwrite');
    tx.objectStore(STORE_ASSETS).put(asset);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB put failed'));
  });
}

export async function idbGetAsset(id: string): Promise<StoredAsset | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_ASSETS, 'readonly');
    const req = tx.objectStore(STORE_ASSETS).get(id);
    req.onsuccess = () => resolve((req.result as StoredAsset | undefined) ?? null);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB get failed'));
  });
}

export async function idbListAssets(): Promise<StoredAsset[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_ASSETS, 'readonly');
    const req = tx.objectStore(STORE_ASSETS).getAll();
    req.onsuccess = () => resolve((req.result as StoredAsset[]) ?? []);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB list failed'));
  });
}

export async function idbDeleteAsset(id: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_ASSETS, 'readwrite');
    tx.objectStore(STORE_ASSETS).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB delete failed'));
  });
}

export type { StoredAsset };
