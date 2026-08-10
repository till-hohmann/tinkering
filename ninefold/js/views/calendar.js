// calendar.js — the Plan tab's month calendar. One month per page, daily
// granularity, anchored to real dates: it resolves each day against whichever
// program block governs that date (Block 1 now, Block 2 from its start date),
// so today (a rest day) shows as rest and you can page months into the future.

import { getAllPrograms, resolveDay, getAllSessions, mobilityDoneDates } from "../store.js";
import { todayISO, WEEKDAYS, programForDate, weekNumberFor, weekdayOf, dayCellRole } from "../model.js";
import { isMobilityDay } from "../mobility.js";
import { el, mount, go } from "../ui.js";

const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];
const pad = (x) => String(x).padStart(2, "0");
const hasContent = (s) => s && ((s.strengthResult && s.strengthResult.length) || s.cardioResult);

const monthKeyOf = (iso) => iso.slice(0, 7);
function parseMonth(key) { const [y, m] = key.split("-").map(Number); return { y, m }; }
function shiftMonth(key, delta) {
  let { y, m } = parseMonth(key); m += delta;
  while (m < 1) { m += 12; y--; } while (m > 12) { m -= 12; y++; }
  return `${y}-${pad(m)}`;
}
function addDays(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d + n);
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

// Shared Plan-tab view toggle (Calendar | Weeks).
export function planToggle(which) {
  const seg = el("div.segmented", { style: "margin-bottom:12px" });
  const mk = (val, label, href) => el("button" + (which === val ? ".on" : ""),
    { onclick: () => go(href) }, label);
  seg.appendChild(mk("calendar", "Calendar", "#/calendar"));
  seg.appendChild(mk("weeks", "Weeks", "#/week"));
  return seg;
}

export async function renderCalendar(monthKey) {
  const programs = await getAllPrograms();
  const today = todayISO();
  const key = /^\d{4}-\d{2}$/.test(monthKey || "") ? monthKey : monthKeyOf(today);
  const { y, m } = parseMonth(key);

  const sessions = await getAllSessions();
  const doneByDate = {};
  for (const s of sessions) if (hasContent(s)) doneByDate[s.date] = s;
  const mobDone = await mobilityDoneDates();

  const firstDow = (new Date(y, m - 1, 1).getDay() + 6) % 7; // 0 = Monday
  const daysInMonth = new Date(y, m, 0).getDate();

  const children = [planToggle("calendar")];

  // month stepper
  children.push(el("div.stepper", {}, [
    el("button.sbtn", { onclick: () => go(`#/calendar/${shiftMonth(key, -1)}`), "aria-label": "Previous month" }, "‹"),
    el("div.smid", {}, [
      el("h1", { style: "margin:0", text: `${MONTHS[m - 1]} ${y}` }),
      el("div.dim", { style: "font-size:.85rem", text: "Tap a workout day for details" }),
    ]),
    el("button.sbtn", { onclick: () => go(`#/calendar/${shiftMonth(key, 1)}`), "aria-label": "Next month" }, "›"),
  ]));

  if (key !== monthKeyOf(today))
    children.push(el("button.btn.block", { style: "margin:0 0 12px", onclick: () => go(`#/calendar/${monthKeyOf(today)}`) }, "Jump to today"));

  // weekday header (Mon-first)
  children.push(el("div.cal-dow", {}, WEEKDAYS.map((d) => el("span", { text: d[0] }))));

  // Build one day cell (or a blank), returning its node + resolved block.
  function dayCell(d) {
    if (d == null) return { node: el("div.cal-cell.blank"), iso: null, prog: null };
    const iso = `${y}-${pad(m)}-${pad(d)}`;
    const prog = programForDate(programs, iso);
    let type = "none", label = "No plan", optional = false, wd = null, weekNumber = null;
    if (prog) {
      const r = resolveDay(prog, iso);
      wd = r.weekday; weekNumber = r.weekNumber;
      type = r.day ? r.day.type : "rest";
      label = r.template ? r.template.label : "Rest";
      optional = !!(r.template && r.template.optional);
    }
    const isToday = iso === today;
    const doneSession = doneByDate[iso] || null;
    const done = !!doneSession;

    // A day you trained outlives the block that planned it — see dayCellRole.
    // An orphaned session opens its own summary, which resolves exercise names
    // through the library rather than the program that is no longer there.
    const { orphanDone, kind, actionable } = dayCellRole(prog, type, doneSession);
    const cls = ".cal-cell"
      + (kind === "cardio" ? ".cardio" : kind === "strength" ? ".strength" : kind === "rest" ? ".rest" : ".empty")
      + (isToday ? ".today" : "") + (optional ? ".opt" : "") + (done ? ".done" : "");
    const inner = [el("span.cal-num", { text: String(d) })];
    if (done) inner.push(el("span.cal-mark", { text: "✓" }));
    else if (optional) inner.push(el("span.cal-mark.opt", { text: "+" }));
    // mobility & stability day marker: violet dot, filled once done that day
    if (isMobilityDay(weekdayOf(iso)))
      inner.push(el("span.cal-mobdot" + (mobDone.has(iso) ? ".on" : "")));
    const aria = `${iso}, ${orphanDone ? (kind === "cardio" ? "run logged" : "session logged") : label}`;
    const node = actionable
      ? el("button" + cls, { "aria-label": aria,
          onclick: () => go(orphanDone ? `#/summary/${doneSession.id}` : `#/day/${prog.id}/${weekNumber}/${wd}`) }, inner)
      : el("div" + cls, { "aria-label": aria }, inner);
    return { node, iso, prog };
  }

  // Chunk the month into Mon-first week rows (with leading/trailing blanks).
  const slots = [];
  for (let i = 0; i < firstDow; i++) slots.push(null);
  for (let d = 1; d <= daysInMonth; d++) slots.push(d);
  while (slots.length % 7) slots.push(null);

  // Each week row overlays ONE spanning block bar across the days it covers — a
  // multi-day "event" (blocks run in whole Mon–Sun weeks, so a row is one block).
  // The name is shown on the block's first row this month; later rows continue it.
  const blockShort = (nm) => nm.replace(/\s*\([^)]*\)\s*/g, " ").trim();
  const labelled = new Set();
  for (let r = 0; r < slots.length; r += 7) {
    const built = slots.slice(r, r + 7).map(dayCell);
    const cols = built.map((b, i) => (b.iso ? i : -1)).filter((i) => i >= 0);
    let barLayer = null;
    const block = cols.length ? built[cols[0]].prog : null;
    if (block && block.startDate && block.lengthWeeks) {
      const startCol = cols[0], endCol = cols[cols.length - 1];
      const bEnd = addDays(block.startDate, block.lengthWeeks * 7 - 1);
      const now = today >= block.startDate && today <= bEnd;
      const capL = block.startDate >= built[startCol].iso;   // block's first day is in this row
      const capR = bEnd <= built[endCol].iso;                // block's last day is in this row
      const label = labelled.has(block.id) ? "" : blockShort(block.name);
      labelled.add(block.id);
      const bar = el("button.cal-span" + (block.draft ? ".draft" : "") + (now ? ".now" : "")
          + (capL ? ".capl" : "") + (capR ? ".capr" : ""),
        { style: `grid-column:${startCol + 1}/${endCol + 2}`, title: block.name,
          onclick: () => go(`#/week/${block.id}/${now ? weekNumberFor(block, today) : 1}`) }, label);
      barLayer = el("div.cal-week-bars", {}, [bar]);
    }
    children.push(el("div.cal-week" + (barLayer ? ".hasbar" : ""), {}, [...built.map((b) => b.node), barLayer].filter(Boolean)));
  }

  // legend
  const lg = (sw, t) => el("span.li", {}, [el("span.sw" + sw), el("span", { text: t })]);
  children.push(el("div.cal-legend", {}, [
    lg(".strength", "Strength"), lg(".cardio", "Cardio"), lg(".rest", "Rest"), lg(".mob", "M&S"),
  ]));

  mount(children);
}
