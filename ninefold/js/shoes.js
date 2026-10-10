// shoes.js — how far each pair of running shoes has gone, and when to replace it.
// Pure: no DOM, no storage.
//
// THE MILEAGE IS NEVER STORED. A session records which pair it was done in
// (`session.shoeId`), and a pair's total is the sum over the sessions that name
// it. A running counter would have to be kept in step with every edit, every
// deletion and every sync from the other device, and would drift the first time
// one path forgot. Deriving it means a corrected run distance, a deleted session
// or a session moved to another pair are all reflected the next time anything
// asks, with nothing to migrate.
//
// What counts:
//   a run (outdoor or treadmill)  the distance actually logged
//   a strength session            STRENGTH_KM, a flat allowance for the warm-up,
//                                 the walking about and the plyometrics
//   anything else                 nothing: bike, rower, elliptical, mobility and
//                                 yoga are not done in running shoes, or not on
//                                 them in a way that wears the midsole.

import { isRunModality } from "./cardio-intel.js";

export const STRENGTH_KM = 0.5;
export const DEFAULT_LIMIT_KM = 600;
// The heads-up comes this far before the limit. A pair is not dead at 599 km and
// fine at 601 — the number is a convention — so the useful signal is "start
// looking", well before "replace".
export const HEADS_UP_KM = 50;

/** A new pair. `id` is stable across renames; the name is free text. */
export function makeShoe(name, nowISO = new Date().toISOString()) {
  const clean = String(name || "").trim();
  return {
    id: "shoe-" + nowISO.replace(/\D/g, "").slice(0, 14) + "-" + Math.random().toString(36).slice(2, 6),
    name: clean,
    limitKm: DEFAULT_LIMIT_KM,
    retired: false,
    addedOn: nowISO.slice(0, 10),
    warnDismissed: false,
    updatedAt: nowISO,
  };
}

/** Does this session put wear on whichever pair it was done in? */
export function countsForShoes(type) {
  return type === "strength" || type === "cardio";
}

/** The kilometres one session adds to its pair. */
export function sessionShoeKm(session) {
  if (!session || !session.shoeId) return 0;
  if (session.type === "strength") return (session.strengthResult || []).length ? STRENGTH_KM : 0;
  if (session.type === "cardio") {
    const c = session.cardioResult;
    if (!c || !isRunModality(c.modality)) return 0;
    const km = Number(c.distanceKm);
    return Number.isFinite(km) && km > 0 ? km : 0;
  }
  return 0;
}

/** Total kilometres per pair: { [shoeId]: km }. */
export function shoeTotals(sessions) {
  const out = {};
  for (const s of sessions || []) {
    const km = sessionShoeKm(s);
    if (km) out[s.shoeId] = (out[s.shoeId] || 0) + km;
  }
  return out;
}

/** "ok" | "soon" | "replace" for a pair at `km`. */
export function shoeStatus(km, limitKm = DEFAULT_LIMIT_KM) {
  const limit = Number(limitKm) > 0 ? Number(limitKm) : DEFAULT_LIMIT_KM;
  if (km >= limit) return "replace";
  if (km >= limit - HEADS_UP_KM) return "soon";
  return "ok";
}

export const activeShoes = (shoes) => (shoes || []).filter((s) => s && !s.retired);

/**
 * Which pair to preselect: the one the most recent shoe-tagged session used, if
 * it is still in the rotation; otherwise the first active pair.
 */
export function defaultShoeId(shoes, sessions) {
  const active = activeShoes(shoes);
  if (!active.length) return null;
  const ids = new Set(active.map((s) => s.id));
  const last = (sessions || [])
    .filter((s) => s && s.shoeId && ids.has(s.shoeId))
    .sort((a, b) => String(b.completedAt || b.date).localeCompare(String(a.completedAt || a.date)))[0];
  return last ? last.shoeId : active[0].id;
}

/** Pairs past their limit whose warning has not been dismissed. */
export function wornOut(shoes, totals) {
  return activeShoes(shoes).filter((s) => !s.warnDismissed && shoeStatus(totals[s.id] || 0, s.limitKm) === "replace");
}
