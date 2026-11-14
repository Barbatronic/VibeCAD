/**
 * Cache des formes, dans le navigateur (IndexedDB, lu et écrit par le worker de calcul) : un
 * instantané par pièce (voir `PartSnapshot` dans features/engine.ts), retrouvé par l'empreinte
 * de tout son historique. Rouvrir un projet reprend ses pièces lourdes sans rejouer leurs étapes.
 *
 * Le cache ne fait jamais autorité : une entrée absente, illisible ou effacée se recalcule. Les
 * entrées les moins récemment utilisées partent au-delà de `MAX_BYTES`.
 */
import type { PartSnapshot } from '../features/engine';

const DB_NAME = 'vibecad-shape-cache';
const STORE = 'parts';
const MAX_BYTES = 256 * 1024 * 1024;

interface Entry {
  key: string;
  usedAt: number;
  bytes: number;
  snap: PartSnapshot;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  dbPromise ??= new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null);
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const store = req.result.createObjectStore(STORE, { keyPath: 'key' });
        store.createIndex('usedAt', 'usedAt');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

const done = (tx: IDBTransaction) =>
  new Promise<void>((resolve) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
    tx.onabort = () => resolve();
  });

function sizeOf(snap: PartSnapshot): number {
  const mesh = snap.mesh?.data;
  const meshBytes = mesh ? Object.values(mesh).reduce((n: number, v) => n + ((v as { byteLength?: number })?.byteLength ?? 0), 0) : 0;
  return (snap.shape?.brep.length ?? 0) + JSON.stringify(snap.shape?.tags ?? []).length + JSON.stringify(snap.sketches).length + meshBytes;
}

/** Instantanés trouvés pour ces clés (les autres sont simplement absents). */
export async function getSnapshots(keys: string[]): Promise<[string, PartSnapshot][]> {
  const db = keys.length ? await open() : null;
  if (!db) return [];
  const tx = db.transaction(STORE, 'readwrite');
  const store = tx.objectStore(STORE);
  const found: [string, PartSnapshot][] = [];
  await Promise.all(
    keys.map(
      (key) =>
        new Promise<void>((resolve) => {
          const req = store.get(key);
          req.onsuccess = () => {
            const e = req.result as Entry | undefined;
            if (e) {
              found.push([key, e.snap]);
              store.put({ ...e, usedAt: Date.now() });
            }
            resolve();
          };
          req.onerror = () => resolve();
        }),
    ),
  );
  await done(tx);
  return found;
}

/** Enregistre des instantanés, puis retire les plus anciens au-delà de la taille permise. */
export async function putSnapshots(entries: { key: string; snap: PartSnapshot }[]): Promise<void> {
  const db = entries.length ? await open() : null;
  if (!db) return;
  const tx = db.transaction(STORE, 'readwrite');
  const store = tx.objectStore(STORE);
  for (const { key, snap } of entries) store.put({ key, usedAt: Date.now(), bytes: sizeOf(snap), snap } satisfies Entry);
  await done(tx);
  await prune(db);
}

async function prune(db: IDBDatabase): Promise<void> {
  const tx = db.transaction(STORE, 'readwrite');
  const store = tx.objectStore(STORE);
  const sizes: { key: string; usedAt: number; bytes: number }[] = [];
  await new Promise<void>((resolve) => {
    const req = store.openCursor();
    req.onsuccess = () => {
      const c = req.result;
      if (!c) return resolve();
      const e = c.value as Entry;
      sizes.push({ key: e.key, usedAt: e.usedAt, bytes: e.bytes });
      c.continue();
    };
    req.onerror = () => resolve();
  });
  let total = sizes.reduce((n, e) => n + e.bytes, 0);
  for (const e of sizes.sort((a, b) => a.usedAt - b.usedAt)) {
    if (total <= MAX_BYTES) break;
    store.delete(e.key);
    total -= e.bytes;
  }
  await done(tx);
}

/** Taille du cache : nombre de pièces et octets (estimés). */
export async function cacheStats(): Promise<{ count: number; bytes: number }> {
  const db = await open();
  if (!db) return { count: 0, bytes: 0 };
  const tx = db.transaction(STORE, 'readonly');
  const store = tx.objectStore(STORE);
  let count = 0;
  let bytes = 0;
  await new Promise<void>((resolve) => {
    const req = store.openCursor();
    req.onsuccess = () => {
      const c = req.result;
      if (!c) return resolve();
      count++;
      bytes += (c.value as Entry).bytes;
      c.continue();
    };
    req.onerror = () => resolve();
  });
  return { count, bytes };
}

export async function clearCache(): Promise<void> {
  const db = await open();
  if (!db) return;
  const tx = db.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).clear();
  await done(tx);
}
