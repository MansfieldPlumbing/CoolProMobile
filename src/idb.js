// src/idb.js — minimal IndexedDB key/value store (no deps).
// Two stores: "kv" (project JSON) and "blobs" (media File/Blob by id).
const DB = 'nocap', VER = 1;
let _db = null;

function open() {
  if (_db) return Promise.resolve(_db);
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, VER);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs');
    };
    r.onsuccess = () => { _db = r.result; res(_db); };
    r.onerror = () => rej(r.error);
  });
}

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    const req = fn(s);                       // always an IDBRequest
    t.oncomplete = () => res(req ? req.result : undefined);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
}

export const kvGet  = (k)    => tx('kv', 'readonly',  (s) => s.get(k));
export const kvSet  = (k, v) => tx('kv', 'readwrite', (s) => s.put(v, k));
export const blobGet = (id)    => tx('blobs', 'readonly',  (s) => s.get(id));
export const blobSet = (id, b) => tx('blobs', 'readwrite', (s) => s.put(b, id));
export const blobDel = (id)    => tx('blobs', 'readwrite', (s) => s.delete(id));
