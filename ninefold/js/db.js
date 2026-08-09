// db.js — tiny promise wrapper around IndexedDB. No dependency, fully offline.
// All workout data lives here (requirements §2: never localStorage for data).

const DB_NAME = "fittrack";
const DB_VERSION = 1;
let _dbPromise = null;

export function openDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      if (!db.objectStoreNames.contains("programs")) {
        db.createObjectStore("programs", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("sessions")) {
        const s = db.createObjectStore("sessions", { keyPath: "id" });
        s.createIndex("by-program", "programId", { unique: false });
        s.createIndex("by-date", "date", { unique: false });
        s.createIndex("by-program-weekday", ["programId", "weekday"], { unique: false });
      }
      if (!db.objectStoreNames.contains("prefs")) {
        db.createObjectStore("prefs", { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
}

function tx(store, mode) {
  return openDB().then((db) => db.transaction(store, mode).objectStore(store));
}

function wrap(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export const get = (store, key) => tx(store, "readonly").then((s) => wrap(s.get(key)));
export const getAll = (store) => tx(store, "readonly").then((s) => wrap(s.getAll()));
export const put = (store, value) => tx(store, "readwrite").then((s) => wrap(s.put(value)));
export const del = (store, key) => tx(store, "readwrite").then((s) => wrap(s.delete(key)));
export const clear = (store) => tx(store, "readwrite").then((s) => wrap(s.clear()));

export function getAllByIndex(store, index, query) {
  return tx(store, "readonly").then((s) => wrap(s.index(index).getAll(query)));
}

// Bulk put in one transaction.
export function putAll(store, values) {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(store, "readwrite");
        const os = t.objectStore(store);
        values.forEach((v) => os.put(v));
        t.oncomplete = () => resolve(values.length);
        t.onerror = () => reject(t.error);
      })
  );
}

// --- prefs (trivial key/value; NOT workout data) -------------------------
export const getPref = (key) => get("prefs", key).then((r) => (r ? r.value : undefined));
export const setPref = (key, value) => put("prefs", { key, value });

// --- destructive: wipe everything -----------------------------------------
// Deletes the whole database, for the "delete all my data" control. Closes the
// open connection first — an outstanding handle makes deleteDatabase block
// indefinitely rather than fail, which looks to the user like a hung button.
// Resolves true on success, false if something else (another tab) held it open.
export function deleteEverything({ timeoutMs = 4000 } = {}) {
  return openDB().then((db) => {
    db.close();
    _dbPromise = null;
    return new Promise((resolve) => {
      let settled = false;
      const finish = (v) => { if (!settled) { settled = true; resolve(v); } };
      // Another open connection (a second tab, or a stale module instance) makes
      // deleteDatabase fire `blocked` — and in some engines it fires late or not
      // at all, leaving the promise pending forever. A button that hangs with no
      // feedback is worse than one that reports failure, so this always settles.
      const timer = setTimeout(() => finish(false), timeoutMs);
      const req = indexedDB.deleteDatabase(DB_NAME);
      req.onsuccess = () => { clearTimeout(timer); finish(true); };
      req.onerror = () => { clearTimeout(timer); finish(false); };
      req.onblocked = () => { clearTimeout(timer); finish(false); };
    });
  });
}
