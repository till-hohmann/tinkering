// sync.js — how two devices agree about one row. Pure: no DOM, no storage.
//
// THE BACKUP IS A WHOLE-STATE SNAPSHOT, and three different merge rules grew on
// top of it: programs by `updatedAt`, sessions by "add if the id is missing",
// prefs by "add if the key is missing". Two of those three cannot express a
// change. Correcting Tuesday's reps on the phone left the laptop wrong for ever,
// deleting a session let the other device put it back, and a day's yoga entry
// could vanish because one device pushed its older copy of the WHOLE log.
//
// One rule, applied per row: the newer copy wins, and a deletion is a row too.
//
// ⚠ AN UNSTAMPED ROW IS OLDER THAN ANY STAMPED ONE, AND NEVER BEATS A LOCAL COPY.
// Every row written before this existed has no `updatedAt`, so "unknown age"
// has to lose — otherwise a device that has been offline for a month could
// overwrite today's edits with last month's copies of the same rows. It keeps
// this change backwards-compatible: nothing is migrated, and rows stamp
// themselves as they are next written.

// 400, not 90. A device left in a drawer for longer than the window still holds
// the deleted rows, and once every tombstone had been pruned its next push put
// them back — and every other device then adopted them as missing rows.
export const TOMBSTONE_DAYS = 400;

/** ms since epoch for a row's stamp; 0 when it has none. */
export const rowAge = (row) => {
  const t = row && row.updatedAt ? Date.parse(row.updatedAt) : NaN;
  return Number.isFinite(t) ? t : 0;
};

/** Does `incoming` replace `stored`? Strictly newer wins; ties keep what is here. */
export function shouldAdoptRow(incoming, stored) {
  if (!incoming) return false;
  if (!stored) return true;
  return rowAge(incoming) > rowAge(stored);
}

/**
 * What to do with one incoming row, given what is stored and any tombstone.
 * Returns "adopt" | "keep" | "drop" ("drop" = the row was deleted here, and the
 * deletion is newer than the copy being offered).
 */
export function rowDecision(incoming, stored, deletedAt) {
  const gone = deletedAt ? Date.parse(deletedAt) || 0 : 0;
  if (gone && gone >= rowAge(incoming)) return stored ? "drop" : "keep";
  if (!stored) return "adopt";
  return shouldAdoptRow(incoming, stored) ? "adopt" : "keep";
}

/**
 * Tombstones: { [id]: ISO }. Deletions have to travel, or the other device's
 * next push simply puts the row back — and then the boot merge brings it home.
 * They are pruned after TOMBSTONE_DAYS: by then every device has seen it, and
 * keeping them for ever would grow the snapshot without bound.
 */
export function addTombstone(map, id, iso) {
  if (!id) return { ...(map || {}) };
  return { ...(map || {}), [id]: iso };
}
export function mergeTombstones(a, b) {
  const out = { ...(a || {}) };
  for (const [id, iso] of Object.entries(b || {})) {
    if (!out[id] || Date.parse(iso) > Date.parse(out[id])) out[id] = iso;
  }
  return out;
}
/**
 * Tombstones are kept per KIND — { sessions: { id: ISO }, programs: { … } } —
 * because the ids only have to be unique within their store. Merging the whole
 * thing with the flat merger silently kept one side: `Date.parse` of an object
 * is NaN, so every incoming kind lost to the local one and a deletion made on
 * the other device never arrived.
 */
export function mergeTombstoneSets(a, b) {
  const kinds = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  const out = {};
  for (const kind of kinds) out[kind] = mergeTombstones((a || {})[kind], (b || {})[kind]);
  return out;
}

export function pruneTombstones(map, nowISO, days = TOMBSTONE_DAYS) {
  const cutoff = Date.parse(nowISO) - days * 86400000;
  const out = {};
  for (const [id, iso] of Object.entries(map || {})) {
    if ((Date.parse(iso) || 0) >= cutoff) out[id] = iso;
  }
  return out;
}

/**
 * THE LOGS THAT LIVE IN PREFS — weight, yoga, mobility, nutrition, measurements,
 * DEXA, VO2max — are whole values in the backup, so the old add-if-missing rule
 * applied to the WHOLE log: a device that had one kept its own and pushed it,
 * and the other device's entries were gone. They merge per entry instead.
 *
 * `key` names the field that identifies an entry (a date, or a completion
 * timestamp for yoga, where several a day are allowed). Arrays and
 * date-keyed objects (nutrition) are both handled.
 *
 * Deletions are NOT tracked here: removing a past weigh-in is rare, and the
 * failure worth fixing is losing entries, not resurrecting one.
 */
export function mergeLogEntries(local, incoming, { key = "date" } = {}) {
  if (incoming == null) return local;
  if (local == null) return incoming;
  const isArray = Array.isArray(local) || Array.isArray(incoming);
  if (!isArray) {
    // A map keyed by date: the key IS the identity.
    const out = { ...(incoming || {}), ...(local || {}) };
    for (const [k, v] of Object.entries(incoming || {})) {
      if (local[k] && shouldAdoptRow(v, local[k])) out[k] = v;
    }
    return out;
  }
  const keyOf = entryKey(key);
  const byKey = new Map();
  for (const e of local || []) if (e) byKey.set(keyOf(e), e);
  for (const e of incoming || []) {
    if (!e) continue;
    const k = keyOf(e);
    const mine = byKey.get(k);
    if (!mine || shouldAdoptRow(e, mine)) byKey.set(k, e);
  }
  return sortedEntries([...byKey.values()], keyOf);
}

// ⚠ THE OLDEST mobilityLog ENTRIES ARE BARE DATE STRINGS, not { date }. Keyed by
// e[key], every string landed under the one key `undefined`, so a merge kept a
// single old session and dropped the rest — then pushed that. A string is its
// own key.
const entryKey = (key) => (e) => (typeof e === "string" ? e : e[key]);
// Ordered by the identifying field, which is a date in every log that uses
// this — the screens read them in order and a merge must not shuffle them.
const sortedEntries = (list, keyOf) => list.sort((a, b) => (String(keyOf(a)) < String(keyOf(b)) ? -1 : 1));

/**
 * An EXPLICIT restore of a log: the file's entry wins wherever both sides have
 * one, and entries only this device has are kept. Restoring an older backup file
 * used to replace each log wholesale, deleting every weigh-in, practice and
 * mobility session logged since that export — and the next push deleted them
 * from the cloud too. Sessions were only ever upserted, so they survived.
 */
export function restoreLogEntries(local, incoming, { key = "date" } = {}) {
  if (incoming == null) return local;
  if (local == null) return incoming;
  if (!Array.isArray(local) && !Array.isArray(incoming)) return { ...local, ...incoming };
  const keyOf = entryKey(key);
  const byKey = new Map();
  for (const e of local || []) if (e) byKey.set(keyOf(e), e);
  for (const e of incoming || []) if (e) byKey.set(keyOf(e), e);
  return sortedEntries([...byKey.values()], keyOf);
}

/** Which synced prefs are logs, and what identifies one of their entries. */
export const LOG_PREFS = {
  weightLog: { key: "date" },
  vo2maxLog: { key: "date" },
  measurementsLog: { key: "date" },
  dexaLog: { key: "date" },
  mobilityLog: { key: "date" },
  nutritionLog: { key: "date" },      // a map keyed by date
  yogaLog: { key: "at" },             // several practices a day, so the timestamp
  // Not a log, but it has a log's sync problem: a pair added on one device and
  // a limit edited on the other must both survive. Each pair is an entry keyed
  // by its id, stamped on every edit, and the newer edit wins.
  shoes: { key: "id" },
};

/**
 * The stamp for a write that replaces something stamped `prevISO`: now, or just
 * after the previous stamp if that is later. Wall clocks disagree — a phone a day
 * fast stamps its rows tomorrow, and an honest edit made on top of one of them
 * then lost to the very copy it was correcting. A new stamp is never older than
 * the thing it replaces.
 */
export function nextStamp(prevISO, nowISO = new Date().toISOString()) {
  const prev = prevISO ? Date.parse(prevISO) : NaN;
  const now = Date.parse(nowISO);
  return Number.isFinite(prev) && prev >= now ? new Date(prev + 1).toISOString() : nowISO;
}

/** Stamp an entry as written now, so the other device can tell which is newer. */
export const stampRow = (row, nowISO = new Date().toISOString()) =>
  ({ ...row, updatedAt: nextStamp(row && row.updatedAt, nowISO) });

// --- settings ----------------------------------------------------------------
// ⚠ A SETTING NEVER TRAVELLED. Settings are whole values (the profile, zones,
// the routine), merged add-if-missing so one device could not clobber another's
// choice — which meant a change made on one device never reached the other,
// while the cloud copy flipped to whichever device pushed last.
//
// Each setting now carries a stamp, and the newer one wins, like a row. The
// stamp is taken by NOTICING a change (a hash of the value differs from the last
// one seen) rather than at the ~40 places that write settings. A value seen for
// the first time is recorded with NO stamp (age 0): every install that existed
// before this would otherwise stamp all its settings "now" on first boot, and
// whichever device updated second would overwrite the other's real settings.

/** A short, stable fingerprint of a JSON-able value. */
export function hashValue(v) {
  const s = JSON.stringify(v === undefined ? null : v);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36) + ":" + s.length;
}

/**
 * Bring setting stamps up to date with the values as they are now.
 * Returns { hashes, stamps, changed }.
 */
export function refreshStamps(values, hashes = {}, stamps = {}, nowISO = new Date().toISOString()) {
  const h = { ...hashes }, st = { ...stamps };
  let changed = false;
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined) continue;
    const now = hashValue(v);
    if (h[k] === undefined) { h[k] = now; changed = true; continue; }       // first sight: no stamp
    if (h[k] !== now) { h[k] = now; st[k] = nextStamp(st[k], nowISO); changed = true; }
  }
  return { hashes: h, stamps: st, changed };
}

/** Does an incoming setting replace the one here? Strictly newer stamp wins. */
export function shouldAdoptSetting(incomingStamp, localStamp) {
  const a = incomingStamp ? Date.parse(incomingStamp) || 0 : 0;
  const b = localStamp ? Date.parse(localStamp) || 0 : 0;
  return a > b;
}
