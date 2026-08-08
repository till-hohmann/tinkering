// views/mobility.js — runs the day's supplemental mobility & stability session
// (A: Hips & ankles / B: Glutes & knees / C: Core & control) through the timed
// routine engine WITH HOLD TRACKING: every timed hold logs the seconds actually
// held ("End hold" for an early stop, full time — incl. Extend — otherwise).
// After a full-effort session the progression engine turns those actuals into
// the next targets (+5 s on an earned streak, harder variant at the cap, honest
// back-off on a clear miss) and a toast reports what changed.
// Block-aware: on a DELOAD week of the active program the holds run at ~70% and
// the session never updates progression state (eased holds prove nothing).

import { el, mount, go } from "../ui.js";
import { addMobilityDone, getActiveProgram, getMobilityProg, setMobilityProg,
  getMobilityLog } from "../store.js";
import { todayISO, weekdayOf, weekNumberFor } from "../model.js";
import { isDeloadWeek } from "../progression.js";
import { mobilityRoutineFor, sessionFor, replayMobilityLog } from "../mobility.js";
import { runRoutine } from "./routine.js";

// brief, self-dismissing toast (body-level, so it survives the navigation home)
function toast(msg) {
  const t = el("div.toast", { text: msg });
  document.body.appendChild(t);
  setTimeout(() => { t.style.opacity = "0"; setTimeout(() => t.remove(), 300); }, 3200);
}

// `wdParam` (from #/mobility/Wed etc.) runs a SPECIFIC session on any day —
// the "do it on a different day" path from the Plan tab. Without it, the day's
// own session runs (deep link on a non-mobility day defaults to Wed's A).
export async function renderMobility(wdParam) {
  const iso = todayISO();
  const weekday = weekdayOf(iso);
  const wd = wdParam || (sessionFor(weekday) ? weekday : "Wed");
  // deload awareness: ease the holds when the active block is deloading
  let deload = false;
  try {
    const program = await getActiveProgram();
    const week = (program.weeks || []).find((w) => w.weekNumber === weekNumberFor(program, iso));
    deload = isDeloadWeek(week);
  } catch { /* no program — run at full effort */ }

  const s = sessionFor(wd);
  const state = await getMobilityProg();
  const { def, items } = mobilityRoutineFor(wd, deload ? 0.7 : 1, state);
  const stage = el("div");
  const head = deload
    ? el("p.note.center", { style: "margin:0 0 6px", text: "Deload week — holds shortened, keep the effort easy. Targets don't move this week." })
    : null;
  mount([head, stage].filter(Boolean));
  runRoutine(stage, def, null, {
    title: s.title,
    trackHolds: true,
    onComplete: async ({ completed, holds }) => {
      if (completed) {
        // log (REPLACING any earlier completion today — redo overwrites), then
        // rebuild the progression state by replaying the whole log: the state is
        // a pure function of the log, so redos and removed entries self-heal.
        await addMobilityDone(todayISO(), s.key, holds, deload);
        const before = state;
        const nextState = replayMobilityLog(await getMobilityLog());
        await setMobilityProg(nextState);
        const changes = [];
        for (const it of items) {
          if (it.mode !== "timed") continue;
          const b = (before[it.id] || {}).targetSec, a = (nextState[it.id] || {}).targetSec;
          if (a != null && b != null && a !== b) changes.push(`${it.name} ${a > b ? "→" : "↓"} ${a}s`);
        }
        if (changes.length) toast("Next time: " + changes.join(" · "));
      }
      go("#/");
    },
  });
}
