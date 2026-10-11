// fake-idb.mjs — just enough IndexedDB for js/db.js to run under node.
//
// The storage and sync paths were untestable without a browser, and that is
// where the worst bugs of the last audit lived (boot push over a failed pull,
// log entries lost in a merge). This covers exactly the surface db.js touches:
// open + upgrade, object stores keyed by keyPath, get/getAll/put/delete/clear,
// index getAll (exact match, array keys included) and transaction oncomplete.
// Values are structured-cloned on the way in and out, like the real thing.
//
//   import { installFakeIDB } from "./fake-idb.mjs";
//   const idb = installFakeIDB();   // sets globalThis.indexedDB
//   idb.reset();                    // empty every store between cases

const later = (f) => queueMicrotask(f);
const keyOf = (v, path) => Array.isArray(path) ? path.map((p) => v[p]) : v[path];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function request(run) {
  const req = { result: undefined, error: null, onsuccess: null, onerror: null };
  later(() => {
    try { req.result = run(); if (req.onsuccess) req.onsuccess({ target: req }); }
    catch (e) { req.error = e; if (req.onerror) req.onerror({ target: req }); }
  });
  return req;
}

class Store {
  constructor(keyPath) { this.keyPath = keyPath; this.rows = new Map(); this.indexes = new Map(); }
}

function objectStore(store, onWrite) {
  return {
    get: (k) => request(() => { const v = store.rows.get(JSON.stringify(k)); return v === undefined ? undefined : structuredClone(v); }),
    getAll: () => request(() => [...store.rows.values()].map((v) => structuredClone(v))),
    put: (v) => { onWrite(); return request(() => { store.rows.set(JSON.stringify(keyOf(v, store.keyPath)), structuredClone(v)); return keyOf(v, store.keyPath); }); },
    delete: (k) => { onWrite(); return request(() => { store.rows.delete(JSON.stringify(k)); }); },
    clear: () => { onWrite(); return request(() => { store.rows.clear(); }); },
    index: (name) => ({
      getAll: (q) => request(() => {
        const path = store.indexes.get(name);
        return [...store.rows.values()].filter((v) => {
          const k = keyOf(v, path);
          // IndexedDB never indexes a row whose key is missing or null.
          if (k == null || (Array.isArray(k) && k.some((x) => x == null))) return false;
          return q === undefined || same(k, q);
        }).map((v) => structuredClone(v));
      }),
    }),
  };
}

export function installFakeIDB() {
  const stores = new Map();
  let created = false;
  const db = {
    objectStoreNames: { contains: (n) => stores.has(n) },
    createObjectStore(name, { keyPath }) {
      const s = new Store(keyPath); stores.set(name, s);
      return { createIndex: (iname, path) => s.indexes.set(iname, path) };
    },
    transaction(name) {
      const t = { oncomplete: null, onerror: null, error: null };
      // Complete once every request queued in this tick has settled.
      let scheduled = false;
      const onWrite = () => {
        if (scheduled) return; scheduled = true;
        later(() => later(() => { if (t.oncomplete) t.oncomplete(); }));
      };
      t.objectStore = (n) => objectStore(stores.get(n), onWrite);
      return t;
    },
    close() {},
  };
  globalThis.indexedDB = {
    open() {
      const req = { result: db, onupgradeneeded: null, onsuccess: null, onerror: null };
      later(() => {
        if (!created) { created = true; if (req.onupgradeneeded) req.onupgradeneeded({ target: req }); }
        if (req.onsuccess) req.onsuccess({ target: req });
      });
      return req;
    },
    deleteDatabase() { const r = request(() => { for (const s of stores.values()) s.rows.clear(); }); return r; },
  };
  return {
    reset() { for (const s of stores.values()) s.rows.clear(); },
    dump(name) { const s = stores.get(name); return s ? [...s.rows.values()] : []; },
  };
}
