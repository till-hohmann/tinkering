// home.js — the Today launch screen: this-week readiness strip + today's
// workout hero with a single dominant Start CTA. Secondary nav lives in the tab bar.

import { getActiveProgram, getAllPrograms, resolveDay, getSessionOnDate, getSessionsForProgram,
  getNutrition, getBodyweight, getProteinPerKg, getDeficitTarget, getDraft, getVO2maxLog, getDexaLog,
  mobilityDoneOn, getMobilityLog, yogaOn } from "../store.js";
import { isMobilityDay, sessionFor, MOBILITY_TITLE, MOBILITY_MINUTES, MOBILITY_DAYS } from "../mobility.js";
import { intentById } from "../yoga/intents.js";
import { LEVELS } from "../yoga/levels.js";
import { runKindLabel } from "../cardio-intel.js";
import { todayISO, WEEKDAYS } from "../model.js";
import * as M from "../model.js";
import { el, mount, go, countUp, setChildren } from "../ui.js";
import { illustration, workoutFigure } from "../illustrations.js";
import { ringStat } from "../components/charts.js";
import { orbEl } from "../components/orb.js";
import { recoveryToday, sleepFor, burnFor, provider, has, CAP } from "../health/index.js";
import { getProfile } from "../profile.js";
import { isLegDay, isLegSession } from "../volume.js";

const recoveryColor = (p) => (p == null ? "var(--text-dim)" : p >= 67 ? "var(--accent)" : p >= 34 ? "var(--amber)" : "var(--coral)");

// The living readiness ORB is the hero of the Today screen. It leads with week
// progress (works offline / before WHOOP), then upgrades in place to the WHOOP
// recovery score + coach verdict + HRV/RHR/sleep once that data loads.
function readinessVerdict(pct) {
  if (pct >= 67) return { t: "Primed", s: "Recovered — go after your top sets today.", cls: "" };
  if (pct >= 34) return { t: "Steady", s: "Train as planned; let RPE pick the load.", cls: "amber" };
  return { t: "Drained", s: "Low recovery — ease the load and just bank the session.", cls: "coral" };
}
// Render the orb hero from a state object. contributors = optional glass stat
// tiles. makeMini = factory for the small overlapping M&S ring (a fresh node
// per render, since the readiness fill rebuilds the hero in place).
function buildOrbHero(host, kicker, st, makeMini) {
  host.className = "orbhero";
  const orb = orbEl({ pct: st.pct, value: st.value, unit: st.unit, label: st.label });
  if (makeMini) orb.appendChild(makeMini());
  setChildren(host, ...[
    el("div.label.orbkick", { text: kicker }),
    orb,
    el("div.orb-verdict" + (st.verdictCls ? "." + st.verdictCls : ""), { text: st.verdict }),
    st.vsub ? el("div.orb-vsub", { text: st.vsub }) : null,
    st.contributors ? el("div.statgrid.three", { style: "margin-top:18px" }, st.contributors) : null,
  ].filter(Boolean));
}
const gtile = (label, val) => el("div.gtile", {}, [
  el("div", { style: "font-family:var(--font-display);font-weight:800;font-size:1.18rem;font-variant-numeric:tabular-nums", text: val }),
  el("div.label", { style: "margin-top:4px", text: label }),
]);
async function fillReadinessHero(host, kicker, fallback, makeMini) {
  try {
    if (!(await has(CAP.recovery))) { if (fallback) buildOrbHero(host, kicker, fallback, makeMini); return; }
    const [r, sl] = await Promise.all([recoveryToday(), sleepFor()]);
    // No reading (not connected, offline, or the bridge hasn't pushed yet) →
    // fall back to the week-progress hero rather than an empty ring.
    if (!r || r.recoveryPct == null) { if (fallback) buildOrbHero(host, kicker, fallback, makeMini); return; }
    const pct = r.recoveryPct, v = readinessVerdict(pct);
    buildOrbHero(host, kicker, {
      pct, value: String(pct), unit: "%",
      // A vendor score and a score this app derived from HRV/RHR/sleep are not
      // the same claim, so the label says which one you're looking at.
      label: r.derived ? "READINESS · EST." : "RECOVERY",
      verdict: v.t, verdictCls: v.cls, vsub: r.derived ? (r.basis || "estimated from your own baseline") : v.s,
      contributors: [
        gtile("HRV", r.hrv != null ? String(r.hrv) : "–"),
        gtile("RHR", r.restingHR != null ? String(r.restingHR) : "–"),
        gtile("Sleep", sl && sl.hours != null ? sl.hours + "h" : "–"),
      ],
    }, makeMini);
  } catch { if (fallback) buildOrbHero(host, kicker, fallback, makeMini); }   // offline → fall back
}

// Today's fuel: calories in (logged) vs WHOOP burn (out) + protein vs target.
async function fillFuelToday(card, iso) {
  const [entry, bodyweight, perKg, deficitTarget] = await Promise.all([getNutrition(iso), getBodyweight(), getProteinPerKg(), getDeficitTarget()]);
  const proteinTarget = bodyweight ? Math.round(perKg * bodyweight) : null;
  let burn = null;
  try { burn = await burnFor(iso); } catch {}
  const kcalIn = entry && entry.kcal != null ? entry.kcal : null;
  const protein = entry && entry.protein != null ? entry.protein : null;
  const balance = burn != null && kcalIn != null ? kcalIn - burn : null;
  const verdict = M.energyBalanceVerdict(balance, deficitTarget);
  const logged = kcalIn != null || protein != null;
  const stat = (label, value, color) => el("div", {}, [
    el("div.metric.sm", { style: color ? "color:" + color : "", text: value }),
    el("div.label", { style: "margin-top:5px", text: label }),
  ]);
  card.replaceChildren(
    el("div.row", {}, [el("div.label", { text: "Fuel today" }),
      verdict ? el("span.badge", { style: `margin-left:9px;color:${verdict.color};border-color:${verdict.color}55`, text: verdict.label }) : null,
      el("span.spacer"),
      el("button.btn", { style: "padding:6px 14px", onclick: () => go("#/nutrition") }, logged ? "Edit" : "Log food")]),
    el("div.statgrid.three", { style: "margin-top:14px" }, [
      stat("In", kcalIn != null ? String(Math.round(kcalIn)) : "–"),
      stat("Out", burn != null ? String(burn) : "–"),
      stat("Balance", balance != null ? (balance > 0 ? "+" : "") + Math.round(balance) : "–",
        verdict ? verdict.color : null),
    ]),
    proteinTarget != null
      ? el("div.note", { style: "margin-top:12px", text: `Protein ${protein != null ? Math.round(protein) : 0} / ${proteinTarget} g` + (protein != null && protein >= proteinTarget ? " ✓" : "") })
      : (logged ? null : el("div.note", { style: "margin-top:12px", text: "Copy your daily totals from MyFitnessPal." })),
  );
  card.style.display = "";
}

const hasContent = (s) => (s && ((s.strengthResult && s.strengthResult.length) || s.cardioResult));

/**
 * A completed practice, as a session summary rather than a footnote.
 *
 * Same weight on the screen as a logged workout: what it was, how long, what the
 * peak was, and — the part that matters — what it stood in for. A practice that
 * replaced the lifting day says so here, so the two cards tell one story instead
 * of two contradictory ones.
 */
function yogaSummaryCard(e) {
  const label = (intentById(e.intent) || {}).label || e.intent;
  const stat = (v, l) => el("div", {}, [
    el("div.metric.sm", { text: v }),
    el("div.label", { style: "margin-top:5px", text: l }),
  ]);
  const stoodIn = e.substitutes === "strength" ? "Replaced today's session"
    : e.substitutes === "mobility" ? "Replaced today's mobility & stability"
    : null;
  // TAPPABLE. This card is where you look at a practice you have just finished,
  // so it is where you notice that it stood in for a session you went on to
  // train anyway — and until v177 there was nowhere to go from here.
  return el("button.card.tight.yogadone", {
    style: "display:block;width:100%;text-align:left",
    onclick: () => go(`#/ysummary/${encodeURIComponent(e.at)}`),
  }, [
    el("div.row", {}, [
      el("div", { style: "flex:1;min-width:0" }, [
        el("div.label", { text: "Yoga · " + label }),
        el("div.note", { style: "margin-top:3px",
          text: (LEVELS[e.level] ? LEVELS[e.level].label + " · " : "") +
            (e.peakName ? "peak: " + e.peakName : (e.style || "")) }),
      ]),
      el("span.badge.accent", { text: "✓ Done" }),
    ]),
    el("div.statgrid.three", { style: "margin-top:14px" }, [
      stat(String(e.minutes), "minutes"),
      stat(String(e.poses || "–"), "poses"),
      stat("0", "hard sets"),
    ]),
    el("div.row", { style: "margin-top:12px;align-items:baseline" }, [
      stoodIn ? el("div.note", { style: "flex:1", text: stoodIn }) : el("div", { style: "flex:1" }),
      el("span.note.faint", { text: "View →" }),
    ]),
  ]);
}

function prettyDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
}
function addDays(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d + n);
  const p = (x) => String(x).padStart(2, "0");
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}
function daysBetween(a, b) {
  return Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 86400000);
}

// Sunday reprogram nudge: as a block comes to an end (blocks are reprogrammed
// at its handoff off fresh data), remind on the rest-day Sunday to design the next
// block from the H2 macrocycle note. Keyed off the last REAL block (draft "shell"
// blocks 3-5 don't count as runway) — so it fires ~3 weeks before the last built
// plan ends, prompting the next real block. Once that's built it re-bases to the
// new last block, chaining through the macrocycle.
async function reprogramReminder(iso) {
  if (M.weekdayOf(iso) !== "Sun") return null;
  const built = (await getAllPrograms()).filter((p) => p.startDate && p.lengthWeeks && !p.draft);
  if (!built.length) return null;
  const last = built.slice().sort((a, b) => (a.startDate < b.startDate ? -1 : 1)).pop();
  const end = addDays(last.startDate, last.lengthWeeks * 7 - 1);
  const days = daysBetween(iso, end);
  if (days > 21) return null;   // still have a real programmed block ahead
  return el("div.card", { style: "border-color:var(--amber);background:rgba(251,191,36,.08)" }, [
    el("div.row", {}, [el("span.badge", { style: "color:var(--amber);border-color:rgba(251,191,36,.4)", text: "⟳ Reprogram" }), el("span.spacer")]),
    el("h2", { style: "margin:8px 0 4px", text: "Time to plan the next block" }),
    el("p.dim", { style: "margin:0;font-size:.9rem;line-height:1.45",
      text: `${last.name} ${days < 0 ? "ended" : "ends"} ${prettyDate(end).replace(/^\w+, /, "")}. Design the next block from your H2 macrocycle note, off this block's fresh test data — ask me to build it.` }),
    el("button.btn.block", { style: "margin-top:12px", onclick: () => go(`#/week/${last.id}/${last.lengthWeeks}`) }, "Review the current block →"),
  ]);
}

// DEXA retest nudge — fires when the 12-week retest is within ~3 weeks (or overdue),
// mirroring the reprogram nudge. Closes the loop the DEXA card's countdown opens.
async function dexaReminder(iso) {
  let log; try { log = await getDexaLog(); } catch { return null; }
  if (!log || !log.length) return null;
  const last = log[log.length - 1];
  const due = addDays(last.date, 84);          // 12 weeks
  const days = daysBetween(iso, due);
  if (days > 21) return null;                  // not due for a while yet
  const overdue = days < 0;
  return el("div.card", { style: "border-color:var(--cyan);background:rgba(56,189,248,.08)" }, [
    el("div.row", {}, [el("span.badge", { style: "color:var(--cyan);border-color:rgba(56,189,248,.4)", text: "◎ DEXA" }), el("span.spacer")]),
    el("h2", { style: "margin:8px 0 4px", text: overdue ? "DEXA retest overdue" : "DEXA retest coming up" }),
    el("p.dim", { style: "margin:0;font-size:.9rem;line-height:1.45",
      text: `Your last scan was ${prettyDate(last.date).replace(/^\w+, /, "")}. ${overdue ? "The 12-week retest is past due" : `Book the 12-week retest (~${prettyDate(due).replace(/^\w+, /, "")})`} so you can see fat vs lean change — the real recomp signal.` }),
    el("button.btn.block", { style: "margin-top:12px", onclick: () => go("#/body") }, "See your composition →"),
  ]);
}

function estimateMinutes(day) {
  if (!day) return null;
  if (day.type === "cardio") {
    const mins = (day.prescription || "").match(/(\d+)\s*min/);
    return mins ? Number(mins[1]) + 12 : 45;
  }
  if (day.type === "strength") {
    const sets = (day.exercises || []).reduce((n, e) => n + (e.prescribedSets || 3), 0);
    return Math.round(sets * 2.2 + 16);
  }
  return null;
}
function summaryLine(day) {
  if (!day || day.type === "rest") return "Rest day";
  if (day.type === "cardio") return day.prescription || "Cardio";
  const n = (day.exercises || []).length;
  return `${n} exercise${n === 1 ? "" : "s"}`;
}

// Cardio/strength sequencing guidance (programming audit Gap B: interference).
// Lift before cardio same-day; don't run hard right before legs; prefer low-impact
// (bike/elliptical) on a cardio day that abuts a leg day. Returns one tip or null.
// Final-week nudge (programming audit): refresh the Whoop VO₂max reading at the
// block boundary so every block gets a clean before/after. Shows through the
// program's last week until a reading dated inside that week exists.
async function vo2RetestTip(program, week) {
  if (!week || !program.lengthWeeks || week.weekNumber !== program.lengthWeeks) return null;
  try {
    const log = await getVO2maxLog();
    const latest = log.length ? log[log.length - 1].date : null;
    if (latest && week.startDate && latest >= week.startDate) return null;   // already refreshed
    return "Final week of the block — when Whoop refreshes your VO₂max, log it in Profile so the block's before/after stays clean.";
  } catch { return null; }
}

function sequencingTip(program, iso, day) {
  if (!day) return null;
  const tomorrow = resolveDay(program, addDays(iso, 1)).day;
  const yesterday = resolveDay(program, addDays(iso, -1)).day;
  const hardRun = (d) => d && d.type === "cardio" && /interval|hard|4x4|tempo|sprint/i.test(d.prescription || "");
  if (day.type === "cardio" && isLegDay(tomorrow)) {
    return hardRun(day)
      ? "Legs tomorrow — keep these intervals controlled, or use the bike/elliptical, so tomorrow's leg session isn't cooked."
      : "Legs tomorrow — keep this Zone 2 easy and low-impact (bike/elliptical protects the legs more than pavement).";
  }
  if (isLegDay(day) && hardRun(yesterday)) {
    return "You ran hard yesterday. If your legs feel flat, trust the readiness easing and leave a rep in reserve — don't grind.";
  }
  return null;
}

// consecutive completed planned-training days ending today (rest days don't break it)
function computeStreak(program, doneDates, iso) {
  let streak = 0;
  for (let i = 0; i < 70; i++) {
    const d = addDays(iso, -i);
    if (program.startDate && d < program.startDate) break;
    const { day } = resolveDay(program, d);
    const type = day ? day.type : "rest";
    if (type === "rest") continue;
    if (doneDates.has(d)) streak++;
    else if (d === iso) continue; // today not done yet — doesn't break the streak
    else break;
  }
  return streak;
}

export async function renderHome() {
  const program = await getActiveProgram();
  // "What you track" is a promise: a feature switched off must actually stop
  // appearing, not just lose a Settings card. `showMobility` gates both the orb's
  // M&S ring and the day's routine card.
  const homeProfile = await getProfile().catch(() => null);
  const showMobility = !homeProfile || homeProfile.features.mobility !== false;
  if (!program) {
    // Building is now the primary path — importing someone else's JSON is the
    // fallback, not the entry point.
    return mount([el("div.card", {}, [
      el("h2", { style: "margin:0 0 6px", text: "Let's build your first block" }),
      el("p.dim", { style: "margin-top:0", text:
        "A few questions about what you're training for and when you can train, and the app writes the plan — then runs it with you, session by session." }),
      el("button.btn.block.primary", { style: "margin-top:16px", onclick: () => go("#/build") }, "Start"),
      el("button.btn.block", { style: "margin-top:8px", onclick: () => go("#/settings") }, "Import a program instead"),
    ]),
    // YOGA DOES NOT WAIT FOR A TRAINING BLOCK. It substitutes a session, replaces
    // the mobility work, or goes on top — and only the first of those needs a
    // plan to exist. Someone who hasn't built a block yet is exactly the person
    // who might practise today, so hiding it behind the builder gets the
    // dependency backwards. Found by rendering this screen with a yoga log and
    // no program, which is a state nothing had exercised.
    (!homeProfile || homeProfile.features.yoga !== false) ? el("div.card.tight", {}, [
      el("div.label", { text: "Yoga" }),
      el("div.note", { style: "margin-top:3px", text: "You don't need a block for this one. Pick what you want from a practice and how long you have." }),
      el("button.btn.block", { style: "margin-top:11px", onclick: () => go("#/yoga") }, "Compose a practice"),
    ]) : null,
    ].filter(Boolean));
  }

  const iso = todayISO();
  // Today's practices, read once: the labels below and the summary cards both
  // need them, and a practice can replace a session it appears above.
  const doneYoga = (!homeProfile || homeProfile.features.yoga !== false) ? await yogaOn(iso) : [];
  const replacedByYoga = (kind) => doneYoga.find((y) => y.substitutes === kind) || null;
  const { weekNumber, weekday, week, day, template } = resolveDay(program, iso);
  const onWeekday = (s) => (template ? s.weekday === weekday : true);
  const existing = await getSessionOnDate(program.id, iso);
  const done = existing.filter(onWeekday).find(hasContent) || existing.find(onWeekday);
  // an interrupted-but-not-saved workout for today → offer to resume
  const draft = await getDraft();
  // an interrupted-but-unsaved workout dated today (any weekday — a "train another
  // day" session logs under today with the picked day's weekday) → offer to resume
  const resumable = !done && draft && draft.date === iso && !draft.completedAt &&
    ((draft.strengthResult && draft.strengthResult.length) || draft.cardioResult || (draft._exIndex | 0) > 0);
  const resumeHref = resumable ? `#/do/${draft.programId}/${draft.weekNumber}/${draft.weekday}` : "#/";

  const dayType = day ? day.type : "rest";
  // Title from the actual prescription for cardio days (the program's slot name can
  // say "intervals" on a week that's really a tempo run) — see runKindLabel.
  const label = dayType === "cardio" ? `Cardio (${runKindLabel(day.prescription || "")})`
    : template ? template.label : "Rest";

  // --- this-week roll-up ---
  const allSessions = await getSessionsForProgram(program.id);
  const doneDates = new Set(allSessions.filter(hasContent).map((s) => s.date));
  let planned = 0, completed = 0;
  const weekDots = WEEKDAYS.map((wd, i) => {
    const dIso = week ? addDays(week.startDate, i) : null;
    const r = dIso ? resolveDay(program, dIso) : { day: null };
    const t = r.day ? r.day.type : "rest";
    const isToday = dIso === iso;
    const isDone = dIso && doneDates.has(dIso);
    if (t !== "rest") { planned++; if (isDone) completed++; }
    return { wd: wd[0], t, isToday, isDone };
  });
  const streak = computeStreak(program, doneDates, iso);
  const STREAK_MILES = [100, 75, 50, 30, 21, 14, 7];
  const atMilestone = STREAK_MILES.includes(streak);   // landed exactly on a milestone

  // --- leg-frequency check (programming audit Gap A: legs want ≥2×/week) ---
  const inWeek = (d) => week && d >= week.startDate && d < addDays(week.startDate, 7);
  const weekDone = allSessions.filter((s) => hasContent(s) && inWeek(s.date));
  const legDone = weekDone.filter((s) => s.type === "strength" && isLegSession(s.strengthResult)).length;
  let legPlanned = 0;
  WEEKDAYS.forEach((wd, i) => {
    const dIso = week ? addDays(week.startDate, i) : null;
    if (dIso && isLegDay(resolveDay(program, dIso).day)) legPlanned++;
  });
  const todayIdx = WEEKDAYS.indexOf(weekday);
  // amber once it's Thursday-or-later and the 2nd leg day still isn't in the bank
  const legShort = legPlanned >= 2 && legDone < 2;
  const legAmber = legShort && todayIdx >= 3;

  // ===== the living readiness orb — hero of the screen =====
  // Leads with RECOVERY while today's workout is still pending (so you see your
  // readiness before training), then flips to the week-progress count once the
  // session is done. Rest days have no workout to finish → show recovery too.
  const kicker = week ? `Week ${weekNumber} · ${week.phaseName}` : "Today";
  const orbHero = el("div.orbhero");
  // Small overlapping ring on the orb: mobility & stability sessions this week
  // (4 planned — Mon/Wed/Fri/Sun; done-on-another-day still counts for the week).
  const wkDateSet = week ? new Set(WEEKDAYS.map((_, i) => addDays(week.startDate, i))) : new Set();
  const mobWk = (await getMobilityLog()).filter((e) => wkDateSet.has(e.date)).length;
  const makeMini = !showMobility ? null : () => {
    const w = el("div.orbmini", { title: "Mobility & stability this week" });
    // Target = however many mobility sessions the ACTIVE program actually has.
    // This was hardcoded to 4, which was right for the routine it was written
    // against and wrong for every other one — the generic program has three, so
    // a perfect week read as 3/4 and could never be closed.
    const mobTarget = MOBILITY_DAYS.size || 1;
    w.appendChild(ringStat({ pct: Math.min(1, mobWk / mobTarget), value: `${mobWk}/${mobTarget}`, sub: "M&S", size: 62, stroke: 6 }));
    return w;
  };
  const weekProgress = {
    pct: planned ? (completed / planned) * 100 : 0,
    value: String(completed), unit: "/" + planned, label: "SESSIONS THIS WEEK",
    verdict: completed >= planned && planned ? "Week complete" : "Workout done",
    vsub: completed >= planned && planned ? "Every session in the bank." : `${completed} of ${planned} this week — nice.`,
  };
  // fallback for the pending state when the tracker isn't reachable
  const weekFallback = { ...weekProgress, verdict: "This week", vsub: `${completed} of ${planned} sessions done.` };
  if (done) {
    buildOrbHero(orbHero, kicker, weekProgress, makeMini);                  // accomplished → week progress
  } else {
    buildOrbHero(orbHero, kicker, { pct: 0, value: "—", unit: "", label: "RECOVERY",   // pending → recovery (placeholder)
      verdict: "Readiness", vsub: "Checking your recovery…" });
  }
  const children = [orbHero];

  // ===== backup is broken =====
  // FIRST, above everything, and the only card here that isn't about training.
  // A backup that has stopped working is invisible by nature — the app carries on
  // perfectly, and you find out on the day the phone is wiped, which is the one
  // day it cannot be fixed. Three consecutive failures is the threshold: a single
  // miss is a tunnel, a run of them is a broken link.
  const backupWarning = await backupAlert();
  if (backupWarning) children.push(backupWarning);

  // ===== what changed since you last opened it =====
  // BELOW the backup warning: a broken backup is urgent, release notes are not.
  // A quiet dismissible card rather than a dialog on open — the app updates
  // itself silently and correctly, so this is news, not an interruption, and a
  // notice that blocks the screen every release stops being read.
  const whatsNew = await releaseNotes();
  if (whatsNew) children.push(whatsNew);

  // ===== reprogram nudge (Sundays, as a block winds down) =====
  const reprog = await reprogramReminder(iso);
  if (reprog) children.push(reprog);

  // ===== DEXA retest nudge (as the 12-week retest approaches) =====
  const dexaNudge = await dexaReminder(iso);
  if (dexaNudge) children.push(dexaNudge);

  // ===== streak strip =====
  const dotsRow = el("div.row", { style: "gap:9px;margin-top:2px" }, weekDots.map((d) =>
    el("div", { style: "text-align:center;flex:1" }, [
      el("div", { style:
        `height:9px;width:9px;border-radius:50%;margin:0 auto 5px;` +
        (d.isDone ? "background:var(--accent)"
          : d.isToday ? "background:transparent;box-shadow:inset 0 0 0 2px var(--accent)"
          : d.t === "rest" ? "background:var(--bg-elev3)"
          : "background:var(--text-faint)") },
        []),
      el("div", { style: `font-size:.66rem;font-weight:700;color:${d.isToday ? "var(--accent)" : "var(--text-faint)"}`, text: d.wd }),
    ])));
  const streakVal = el("div", { style: "font-size:1.5rem;font-weight:800;letter-spacing:-.02em;font-variant-numeric:tabular-nums", text: "0" });
  countUp(streakVal, streak, { fmt: (v) => String(Math.round(v)) });
  children.push(el("div.card", {}, [
    el("div.row.top", { style: "gap:18px" }, [
      el("div", { style: "flex:1" }, [
        el("div.label", { text: "Streak" }),
        el("div.row", { style: "gap:6px;align-items:baseline;margin-top:5px" }, [
          streak > 0 ? el("span", { style: "font-size:1.25rem;line-height:1", text: "🔥" }) : null,
          streakVal, el("span.dim", { style: "font-size:.85rem", text: streak === 1 ? "day" : "days" }),
          atMilestone ? el("span.badge.accent", { style: "margin-left:4px", text: `${streak}-day milestone!` }) : null,
        ]),
        el("div.note", { style: "margin-top:4px", text: `${allSessions.filter(hasContent).length} sessions logged` }),
        legPlanned >= 2
          ? el("div.note", { style: "margin-top:4px" + (legAmber ? ";color:var(--amber);font-weight:700" : ""),
              text: `Legs ${legDone}× this week` + (legShort ? (legAmber ? " · get the 2nd in" : " · 2 planned") : " ✓") })
          : null,
      ]),
    ]),
    el("div.divider", { style: "margin:16px 0 12px" }),
    dotsRow,
  ]));

  // ===== Fuel today (calories in/out + protein) — filled after mount =====
  const fuelToday = el("div.card", { style: "display:none" });
  children.push(fuelToday);

  // ===== today hero =====
  if (dayType === "rest") {
    children.push(el("div.hero.rest", {}, [
      el("div.htop", {}, [
        el("div.hillo.illotile", { style: "padding:0" }, [illustration(workoutFigure(template, day))]),
        el("div", {}, [el("div.label", { text: "Today" }), el("h2.htitle", { style: "margin-top:4px", text: "Rest day" })]),
      ]),
      el("p.hfocus", { text: "Full recovery. A walk and some mobility is plenty — let the work land." }),
    ]));
    // an interrupted "train another day" session started on this rest day
    if (resumable) {
      const n = (draft.strengthResult || []).length;
      children.push(el("div.card.tight", {}, [
        el("div.row", {}, [
          el("span.badge", { style: "color:var(--accent);background:var(--accent-ghost);border-color:rgba(47,230,166,.3)", text: "● In progress" }),
          el("span.spacer"),
          el("span.note", { text: n ? `${n} exercise${n === 1 ? "" : "s"} logged` : "started" }),
        ]),
        el("button.btn.primary.big.block", { style: "margin-top:11px", onclick: () => go(resumeHref) }, "Resume session"),
      ]));
    }
    children.push(el("button.btn.block", { style: "margin-top:4px", onclick: () => go("#/calendar") }, "Train another day instead"));
  } else {
    const est = estimateMinutes(day);
    const seqTip = sequencingTip(program, iso, day);
    const vo2Tip = await vo2RetestTip(program, week);
    const heroClass = dayType === "cardio" ? ".cardio" : ".strength";
    children.push(el("div.hero" + heroClass, {}, [
      el("div.htop", {}, [
        el("div.hillo.illotile", { style: "padding:0" }, [illustration(workoutFigure(template, day))]),
        el("div", { style: "flex:1;min-width:0" }, [
          el("div.label", { text: "Today's session" }),
          el("h2.htitle", { style: "margin-top:5px", text: label }),
          el("div.hsub", { text: summaryLine(day) }),
        ]),
      ]),
      week && week.focus ? el("p.hfocus", { text: week.focus }) : null,
      el("div.hstats", {}, [
        el("div.hstat", {}, [el("div.label", { text: "Location" }), el("div.v", { text: template.location || "—" })]),
        est ? el("div.hstat", {}, [el("div.label", { text: "Est. time" }), el("div.v", {}, [String(est), el("span", { style: "font-size:.8rem;color:var(--text-dim);font-weight:700", text: " min" })])]) : null,
        dayType === "strength" ? el("div.hstat", {}, [el("div.label", { text: "Exercises" }), el("div.v", { text: String((day.exercises || []).length) })]) : null,
      ]),
      seqTip ? el("div.seqtip", {}, [el("span.seqtip-i", { text: "↯" }), el("span", { text: seqTip })]) : null,
      vo2Tip ? el("div.seqtip", {}, [el("span.seqtip-i", { text: "◎" }), el("span", { text: vo2Tip })]) : null,
      // A practice that stood in for this session says so ON the session, not
      // only on its own card. Two cards telling different stories about the same
      // day is how a log stops being trusted.
      replacedByYoga("strength") ? el("div.seqtip", {}, [
        el("span.seqtip-i", { text: "☯" }),
        el("span", { text: `Replaced by yoga today — ${(intentById(replacedByYoga("strength").intent) || {}).label || "a practice"}, ${replacedByYoga("strength").minutes} min. No hard sets, so this session's volume is still outstanding.` }),
      ]) : null,
    ]));

    if (done) {
      children.push(el("div.card.tight", {}, [
        el("div.row", {}, [
          el("span.badge.accent", { text: "✓ Completed today" }), el("span.spacer"),
        ]),
        el("div.btn-row", { style: "margin-top:11px" }, [
          el("button.btn.primary", { onclick: () => go(`#/summary/${done.id}`) }, "View summary"),
          el("button.btn", { onclick: () => go(`#/session/${iso}`) }, "Redo / edit"),
        ]),
      ]));
    } else if (resumable) {
      const n = (draft.strengthResult || []).length;
      children.push(el("div.card.tight", {}, [
        el("div.row", {}, [
          el("span.badge", { style: "color:var(--accent);background:var(--accent-ghost);border-color:rgba(47,230,166,.3)", text: "● In progress" }),
          el("span.spacer"),
          el("span.note", { text: n ? `${n} exercise${n === 1 ? "" : "s"} logged` : "started" }),
        ]),
        el("button.btn.primary.big.block", { style: "margin-top:11px", onclick: () => go(resumeHref) }, "Resume session"),
      ]));
    } else {
      children.push(el("button.btn.primary.big.block", { style: "margin-top:6px", onclick: () => go(`#/session/${iso}`) },
        dayType === "cardio" ? "Start run" : "Start session"));
    }
  }

  // ===== supplemental mobility & stability (Wed/Fri/Sun) =====
  // The 10-min support routine for the knee / SI / core work — separate from the
  // main session, logged to its own cloud-synced list. Shows ✓ once done today.
  if (showMobility && isMobilityDay(weekday)) {
    const mobDone = await mobilityDoneOn(iso);
    const mobReplaced = replacedByYoga("mobility");
    const sess = sessionFor(weekday);
    children.push(el("div.card.tight", {}, [
      el("div.row", {}, [
        el("div", { style: "flex:1;min-width:0" }, [
          el("div.label", { text: `${MOBILITY_TITLE} · ${sess.key}` }),
          el("div.note", { style: "margin-top:3px", text: `${sess.title} — ${sess.focus} · ~${MOBILITY_MINUTES} min` }),
        ]),
        mobDone ? el("span.badge.accent", { text: "✓ Done" })
          : mobReplaced ? el("span.badge.accent", { text: "Replaced by yoga" }) : null,
      ]),
      mobReplaced && !mobDone
        ? el("p.note", { style: "margin:10px 0 0",
            text: `${(intentById(mobReplaced.intent) || {}).label || "A practice"}, ${mobReplaced.minutes} min, did this job today.` })
        : mobDone
        ? el("div.btn-row", { style: "margin-top:11px" }, [
            el("button.btn", { onclick: () => go(`#/msummary/${iso}`) }, "View summary"),
            el("button.btn", { onclick: () => go(`#/msummary/${iso}`) }, "Redo"),
          ])
        : el("button.btn.block", { style: "margin-top:11px", onclick: () => go("#/mobility") }, `Start ${sess.title.toLowerCase()}`),
    ]));
  }

  // ===== yoga =====
  // Always available rather than scheduled — that is the point of it. Yoga
  // substitutes a session, replaces the mobility work, or goes on top, and which
  // of the three is a decision made on the day, not one the plan can hold.
  if (!homeProfile || homeProfile.features.yoga !== false) {
    // EVERY COMPLETED PRACTICE GETS A SUMMARY, the same as a workout does. A
    // one-line note under a card was the practice being treated as an accessory
    // to the "real" training, which is exactly the framing the whole feature is
    // meant to avoid.
    for (const e of doneYoga) children.push(yogaSummaryCard(e));
    children.push(el("div.card.tight", {}, [
      el("div.row", {}, [
        el("div", { style: "flex:1;min-width:0" }, [
          el("div.label", { text: "Yoga" }),
          el("div.note", { style: "margin-top:3px", text: doneYoga.length
            ? "Another one is always allowed."
            : "Instead of today's session, instead of the mobility work, or on top." }),
        ]),
      ]),
      el("button.btn.block", { style: "margin-top:11px", onclick: () => go("#/yoga") },
        doneYoga.length ? "Practise again" : "Compose a practice"),
    ]));
  }

  mount(children);
  if (!done) fillReadinessHero(orbHero, kicker, weekFallback, makeMini);   // pending workout → load WHOOP recovery (fall back to week progress if unavailable)
  fillFuelToday(fuelToday, iso);
}

// A dead backup, said out loud. Deliberately narrow: only when a backup is
// actually configured (an install with none is local-only BY CHOICE and must
// never be nagged), and only once failures look like a pattern rather than a
// phone in a lift.
async function backupAlert() {
  try {
    const { getCloudHealth } = await import("../cloudsync.js");
    const h = await getCloudHealth();
    if (!h || h.ok) return null;
    const hard = h.reason === "unauthorized" || h.reason === "too_large";
    if (!hard && (h.consecutiveFailures || 0) < 3) return null;
    const detail = h.reason === "unauthorized"
      ? "Your backup token was rejected. Re-enter it in Profile."
      : h.reason === "too_large" ? "Your backup is too large for the Worker to accept."
      : "Your training data hasn't reached the backup recently.";
    const since = h.lastOkAt
      ? `Last successful backup: ${new Date(h.lastOkAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}.`
      : "Nothing has ever backed up successfully.";
    return el("div.card", { style: "border-color:var(--red)" }, [
      el("div.label", { style: "color:var(--red)", text: "Backup not working" }),
      el("p.note", { style: "margin-top:6px", text: `${detail} ${since} Everything on this device is fine — but a wipe would lose it.` }),
      el("button.btn.block", { style: "margin-top:10px", onclick: () => go("#/settings") }, "Open backup settings"),
    ]);
  } catch (_) { return null; }
}


// The version notice. Renders nothing at all unless this device has actually
// missed something worth telling it about — most releases have no entry, and a
// card that appears every time anything ships teaches people to dismiss it
// unread.
async function releaseNotes() {
  try {
    const { APP_VERSION } = await import("../version.js");
    const { unseenNotes, markNotesSeen } = await import("../store.js");
    const notes = await unseenNotes(APP_VERSION);
    if (!notes.length) return null;
    const card = el("div.card", { style: "border-color:var(--accent)" }, [
      el("div.row", { style: "align-items:baseline" }, [
        el("div.label", { style: "color:var(--accent)", text: "What’s new" }),
        el("span.spacer"),
        el("span.faint", { style: "font-size:.72rem", text: APP_VERSION }),
      ]),
      el("ul", { style: "margin:10px 0 0;padding-left:1.1rem" },
        notes.map((n) => el("li", { style: "margin-bottom:6px;font-size:.92rem;line-height:1.5", text: n }))),
      el("button.btn.block", { style: "margin-top:12px", onclick: async () => {
        await markNotesSeen(APP_VERSION);
        card.remove();
      } }, "Got it"),
    ]);
    return card;
  } catch (_) { return null; }   // never let a nicety break the home screen
}
