// dates.js — the calendar day, done once. No imports, no DOM, no storage.
//
// ⚠ EVERY DATE IN THIS APP IS A LOCAL CALENDAR DAY, never an instant. A session
// logged at 23:30 on Tuesday belongs to Tuesday, and a block's week 2 starts on
// the Monday the athlete wakes up to — neither has anything to do with UTC.
//
// This module exists because the same four-line helper was copied into ten
// files and one copy did it differently: `plan-csv.js` built the date locally
// and then read it back with `toISOString()`, which converts to UTC. At any
// positive offset that lands a day early, so importing a plan moved every
// week's start date back by one — "week 2" began on the Sunday.
// The identical mistake was in the Apple Health bridge's "yesterday" (two days
// back, not one) and in two "today" stamps taken after midnight.
//
// So: one implementation, and a test that fails the build if a module grows its
// own. If you need a new date operation, add it here.

const pad = (n) => String(n).padStart(2, "0");

/** The local calendar day of a Date (default: now), as YYYY-MM-DD. */
export function todayISO(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Parse YYYY-MM-DD as LOCAL midnight. */
export function parseISO(iso) {
  const [y, m, d] = String(iso).split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

/** YYYY-MM-DD, n days later (n may be negative). Month and year roll over. */
export function addDaysISO(iso, n) {
  if (!iso) return null;
  const dt = parseISO(iso);
  dt.setDate(dt.getDate() + (n || 0));
  return todayISO(dt);
}

/** The day before `iso`. */
export const prevISO = (iso) => addDaysISO(iso, -1);

/** Whole days from a to b (b − a). Positive when b is later. */
export function daysBetweenISO(a, b) {
  // Compared at local midnight on both ends, so a clock change inside the span
  // (DST) cannot round the answer to something like 6.96 days.
  const ms = parseISO(b).getTime() - parseISO(a).getTime();
  return Math.round(ms / 86400000);
}
