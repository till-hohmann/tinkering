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

export const TOMBSTONE_DAYS = 90;

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
  const byKey = new Map();
  for (const e of local || []) if (e) byKey.set(e[key], e);
  for (const e of incoming || []) {
    if (!e) continue;
    const k = e[key];
    const mine = byKey.get(k);
    if (!mine || shouldAdoptRow(e, mine)) byKey.set(k, e);
  }
  const out = [...byKey.values()];
  // Ordered by the identifying field, which is a date in every log that uses
  // this — the screens read them in order and a merge must not shuffle them.
  return out.sort((a, b) => (String(a[key]) < String(b[key]) ? -1 : 1));
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
};

/** Stamp an entry as written now, so the other device can tell which is newer. */
export const stampRow = (row, nowISO = new Date().toISOString()) =>
  ({ ...row, updatedAt: nowISO });
