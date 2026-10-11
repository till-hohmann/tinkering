// slots.js — keeping logged sets attached to the lift they were lifted on.
//
// The strength logger keys each committed result by its SLOT (`_i`), because a
// day can hold the same lift twice and a superset commits on every hand-over.
// The slot list is not fixed, though: "Later" moves the current lift to the end,
// "Add" inserts one after it, "Swap" replaces it. None of them moved the results,
// so after a reorder a slot read another lift's sets as its own. In a superset:
// log B, log C, tap Later on B, and C opened showing B's set as done — then
// committing C deleted B's entry and saved B's set under C.
//
// Every reorder now goes through one of these, which return the new results.

/** Slot `i` of `n` moved to the end; everything after it shifts down by one. */
export function laterMap(i, n) {
  return (j) => (j === i ? n - 1 : j > i ? j - 1 : j);
}

/** A new slot inserted at `at`; everything from `at` on shifts up by one. */
export function insertMap(at) {
  return (j) => (j >= at ? j + 1 : j);
}

/** Apply a slot map to every result that is keyed by slot. Mutates in place. */
export function remapResults(results, map) {
  for (const r of results) if (r && r._i != null) r._i = map(r._i);
  return results;
}

/**
 * The lift in slot `i` was swapped for another. Its committed sets are real work
 * on the OLD lift, so they stay in the log under that lift — but no longer belong
 * to the slot, or the new lift would open with them shown as done.
 */
export function detachSlot(results, i) {
  for (const r of results) if (r && r._i === i) r._i = null;
  return results;
}
