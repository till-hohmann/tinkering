import { addDaysISO, daysBetweenISO as daysBetween } from "./dates.js";
export { addDaysISO, daysBetweenISO as daysBetween } from "./dates.js";
// dexa.js — when the next DEXA scan is due, and whether to say so today.
// Pure: no DOM, no storage. The Today reminder, the Body card's countdown and
// Settings all read the schedule from here so they cannot disagree.
//
// ⚠ THE REMINDER USED TO BE PERMANENT. It fired whenever the retest was within
// three weeks or overdue, with no way to acknowledge it, so once a scan was due
// the card sat on Today every day until the next scan was logged, including the
// three weeks you already had it booked. It is now shown ONCE: on the first day
// it qualifies (all of that day, so reopening the app does not lose it), and
// never again for that due date. Booking a date counts as having been reminded.
//
// Cadence is three CALENDAR months, not 84 days: scans are booked like
// appointments ("9 October, then early January"), and 12 weeks drifts a
// fortnight earlier each year.

export const DEXA_RETEST_MONTHS = 3;
export const DEXA_REMIND_DAYS = 21;

const parse = (iso) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d); };
const fmt = (dt) => {
  const p = (n) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
};
// Month arithmetic that clamps to the month's last day: 30 Nov + 3 months is
// 28 Feb, never 2 March.
export function addMonthsISO(iso, months) {
  const [y, m, d] = iso.split("-").map(Number);
  const last = new Date(y, m - 1 + months + 1, 0).getDate();
  return fmt(new Date(y, m - 1 + months, Math.min(d, last)));
}

/**
 * The schedule, from the scan log plus two small prefs.
 *   log     [{date, ...}] ascending (getDexaLog)
 *   booked  ISO date of a booked scan, or null. Honoured only while it is LATER
 *           than the last logged scan; once that scan is logged it is spent.
 *   seen    { due, on } — the due date the reminder last showed for, and the day
 *           it showed. `on: null` means acknowledged without being shown
 *           (booking a date, or dismissing).
 * Returns null with no scans at all, else
 *   { lastISO, dueISO, booked: bool, remindFromISO, daysToDue, showReminder }.
 */
export function dexaSchedule({ log, booked = null, seen = null }, todayISO) {
  if (!Array.isArray(log) || !log.length) return null;
  const lastISO = log[log.length - 1].date;
  const bookedLive = typeof booked === "string" && booked > lastISO;
  const dueISO = bookedLive ? booked : addMonthsISO(lastISO, DEXA_RETEST_MONTHS);
  const remindFromISO = addDaysISO(dueISO, -DEXA_REMIND_DAYS);
  const inWindow = todayISO >= remindFromISO;
  const seenThis = !!seen && seen.due === dueISO;
  // Unseen and in the window: show (the caller records today). Seen today: keep
  // showing for the rest of today. Seen on any other day, or acknowledged: done.
  const showReminder = inWindow && (!seenThis || (seen.on != null && seen.on === todayISO));
  return { lastISO, dueISO, booked: bookedLive, remindFromISO, daysToDue: daysBetween(todayISO, dueISO), showReminder };
}
