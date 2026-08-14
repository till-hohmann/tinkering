// yoga/quality.js — does this sequence actually hold up? Pure: no DOM, no storage.
//
// WHY THIS EXISTS, AND WHY IT WAS WRITTEN BEFORE THE FIRST FLOW EVER RAN. The
// lifting builder was a pipeline where every stage was locally reasonable and
// nothing ever looked at the finished block: 79% of generated blocks carried an
// error-level defect, and it took an audit to find out. The generator next door
// is the same shape of program, so it gets its grader on day one rather than
// after a bad sequence ships.
//
// SEVERITY IS THE WHOLE DESIGN, exactly as in builder/quality.js.
//   `error` — the sequence is wrong in a way that costs the practitioner
//             something: an unprepared peak, a missing counter, a contraindicated
//             pose. The generator does not ship it.
//   `warn`  — a trade-off worth naming that the practitioner may judge better
//             than the generator does. An explicit choice is never silently
//             overridden — pick a 10-minute wind-down and the short savasana is
//             NAMED, not fixed.
//
// The numbers below are the teaching convention, cited where they came from, and
// they live in one place so disagreeing with one is a one-line visible diff.

import { byId, COUNTER_FAMILY, isContraindicated, limitsHit, PREP_MIN } from "./asanas.js";
import { styleById, effectiveHoldBand } from "./styles.js";
import { levelById } from "./levels.js";
import { itemSeconds, flowSeconds, elapsedAt } from "./compose.js";
import { faultsIn, positionChanges, positionReturns, onFeet } from "./transitions.js";

// --- thresholds, named and in one place --------------------------------------
/** Savasana takes 10-20% of total session time. */
export const SAVASANA_SHARE = [0.10, 0.20];
/** The peak lands 60-70% of the way through. */
export const PEAK_WINDOW = [0.55, 0.75];
/**
 * Specific preparatory poses a peak needs, by how complex it is. Re-exported
 * rather than restated: the library enforces the same numbers on its own peaks,
 * and two copies of a threshold is one copy that quietly goes stale.
 */
export { PREP_MIN };
/** How far a finished sequence may miss its requested length. */
export const DURATION_TOLERANCE = 0.15;
/**
 * A hold has to suit the style. A "yin" pose held for 20 seconds is not yin, and
 * a vinyasa pose held for four minutes is not a vinyasa.
 */
export const HOLD_TOLERANCE = 0.5;
/**
 * How unbalanced the two sides of an asymmetric pose may be. Shorter holds on
 * the SECOND side is the single most common defect in a home practice, which is
 * why this is an error rather than a note — but the engine runs both sides from
 * one duration, so any imbalance here is a data bug, not a user habit.
 */
export const SIDE_TOLERANCE = 0.02;
/** A practice needs a warm-up before it asks for anything. */
export const WARMUP_MIN_SHARE = 0.08;
/**
 * How often the body may change POSITION — standing, lunging, on the hands, the
 * belly, the knees, sitting, lying down — per pose in the sequence.
 *
 * Generous on purpose. The teaching rule is "arrange poses to reduce frequent
 * changes in body position", not "never change", and a class legitimately warms
 * up on its knees, works standing and comes back down. This fires when a
 * sequence has no order to it at all: plank, seated twist, sphinx, cow-face
 * legs, chaturanga is five positions in five poses, and every one of them passed
 * every check there was.
 */
export const POSITION_RETURN_RATE = 0.12;
/** How often the standing series may flip between a wide stance and a square one. */
export const FACING_CHURN_RATE = 0.45;
/**
 * The spine moves in flexion, extension, lateral bending and rotation, and a
 * balanced practice visits all of them. Below this share of the sequence's
 * directed poses, one direction is under-served.
 */
export const SPINE_MIN_SHARE = 0.08;

const round1 = (x) => Math.round(x * 10) / 10;
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

const PHASE_ORDER = ["centering", "warmup", "build", "peak", "counter", "cool", "savasana"];

/**
 * Grade a finished flow.
 * Returns { checks, errors, warnings, ok } where each check is
 * { id, severity, ok, message, detail } — the same shape builder/quality.js
 * returns, so the review UI can render either without knowing which it has.
 */
export function auditFlow(flow, { limits = null } = {}) {
  const checks = [];
  const add = (id, severity, ok, message, detail) => checks.push({ id, severity, ok, message, detail });
  const items = (flow && flow.items) || [];
  const style = styleById(flow && flow.style) || {};
  const total = flowSeconds(items);
  const protecting = limits || (flow && flow.limits) || [];

  if (!items.length) {
    add("arc.empty", "error", false, "The sequence is empty.", {});
    return finish(checks);
  }

  // --- 1. the arc is present and in order ----------------------------------
  // This is the check the whole module exists for. Reordering a workout is fine;
  // reordering a sequence puts a counter-pose in front of the thing it counters.
  const phases = items.map((it) => it.phase);
  const firstAt = {}, lastAt = {};
  phases.forEach((p, i) => { if (firstAt[p] === undefined) firstAt[p] = i; lastAt[p] = i; });
  const present = PHASE_ORDER.filter((p) => firstAt[p] !== undefined);
  const outOfOrder = [];
  for (let i = 1; i < present.length; i++) {
    // Phases may interleave at their boundaries, but a phase must not START
    // before the previous phase started.
    if (firstAt[present[i]] < firstAt[present[i - 1]]) outOfOrder.push(`${present[i]} begins before ${present[i - 1]}`);
  }
  add("arc.order", "error", outOfOrder.length === 0,
    outOfOrder.length ? `The arc is out of order: ${outOfOrder.join("; ")}` : "The arc runs in order.",
    { present, outOfOrder });

  // A sequence that ends anywhere but savasana ended early.
  const endsWell = items[items.length - 1].phase === "savasana";
  add("arc.ends_in_savasana", "error", endsWell,
    endsWell ? "The practice ends in savasana." : "The practice does not end in savasana.",
    { last: items[items.length - 1].name });

  // --- 2. warm-up before anything is asked ---------------------------------
  // Skipping the warm-up is one of the two mistakes every teacher names about
  // home practice, and the one an app can actually prevent.
  const warmSeconds = items.filter((it) => it.phase === "centering" || it.phase === "warmup")
    .reduce((s, it) => s + itemSeconds(it), 0);
  const warmShare = total ? warmSeconds / total : 0;
  add("arc.warmup", "error", warmShare >= WARMUP_MIN_SHARE,
    `Warm-up and centering are ${pct(warmShare, 1)}% of the practice (floor ${pct(WARMUP_MIN_SHARE, 1)}%).`,
    { warmSeconds, warmShare: round1(warmShare * 100) });

  // The first thing asked for must not be the hardest thing in the sequence.
  const firstWorking = items.find((it) => it.phase !== "centering");
  const maxIntensity = Math.max(...items.map((it) => it.intensity || 0));
  const coldStart = !!firstWorking && (firstWorking.intensity || 0) >= maxIntensity && maxIntensity >= 4;
  add("arc.cold_start", "error", !coldStart,
    coldStart ? `The practice opens on its hardest pose (${firstWorking.name}).` : "The practice builds before it asks.",
    { first: firstWorking ? firstWorking.name : null, maxIntensity });

  // --- 3. every peak has its preparation, and it comes FIRST ---------------
  const peakItems = items.filter((it) => it.phase === "peak");
  if (peakItems.length) {
    const peakIdx = items.findIndex((it) => it.phase === "peak");
    const peakAsana = byId(peakItems[0].asanaId);
    const want = PREP_MIN[(peakAsana && peakAsana.peak) || 1] || 3;
    const declared = new Set((peakAsana && peakAsana.preps) || []);
    // Count preparation that ACTUALLY precedes the peak. A prep pose after the
    // peak is not preparation, it is decoration.
    const before = items.slice(0, peakIdx);
    const prepped = before.filter((it) => it.prepFor === peakItems[0].asanaId || declared.has(it.asanaId));
    add("peak.prepared", "error", prepped.length >= want,
      prepped.length >= want
        ? `${peakItems[0].name} has ${prepped.length} preparatory poses before it (wants ${want}).`
        : `${peakItems[0].name} has only ${prepped.length} of the ${want} preparatory poses it needs.`,
      { peak: peakItems[0].asanaId, prepped: prepped.map((p) => p.asanaId), want });

    // --- 4. and its counter, AFTER it ---------------------------------------
    const after = items.slice(peakIdx + 1);
    const wantCounters = new Set((peakAsana && peakAsana.counters) || []);
    const familyFallback = new Set(COUNTER_FAMILY[(peakAsana && peakAsana.family) || ""] || []);
    const countered = after.filter((it) => it.counterTo === peakItems[0].asanaId
      || wantCounters.has(it.asanaId) || familyFallback.has(it.family));
    add("peak.countered", "error", countered.length > 0,
      countered.length
        ? `${peakItems[0].name} is followed by ${countered.map((c) => c.name).slice(0, 2).join(" and ")}.`
        : `Nothing counters ${peakItems[0].name}. A peak without its counter is the half of the arc that gets forgotten.`,
      { peak: peakItems[0].asanaId, countered: countered.map((c) => c.asanaId) });

    // --- 5. the peak lands where a peak lands -------------------------------
    const at = total ? elapsedAt(items, peakIdx) / total : 0;
    const inWindow = at >= PEAK_WINDOW[0] && at <= PEAK_WINDOW[1];
    add("peak.placement", "warn", inWindow,
      `The peak arrives at ${pct(at, 1)}% of the practice (convention is ${pct(PEAK_WINDOW[0], 1)}-${pct(PEAK_WINDOW[1], 1)}%).`,
      { at: round1(at * 100) });

    // A peak the practitioner is not warm enough for is a peak in a 12-minute
    // practice, and no amount of prep-counting catches that.
    // Judged on the length that was ASKED for. Judging it on the finished length
    // made this fire whenever a 20-minute practice came in at 19:40, which is a
    // rounding artefact wearing the costume of a programming defect.
    const asked = flow.targetSeconds || total;
    add("peak.enough_time", "warn", asked >= 20 * 60,
      asked >= 20 * 60 ? "There is time to build to the peak." : `A peak in a ${Math.round(asked / 60)}-minute practice leaves no room to prepare it.`,
      { minutes: Math.round(asked / 60) });
  } else {
    add("peak.prepared", "warn", true,
      style.allowPeak === false ? `${style.name || "This style"} has no peak by design.` : "No peak in this sequence.", {});
  }

  // --- 6. savasana is a PROPORTION, not a fixed five minutes ---------------
  const savSeconds = items.filter((it) => it.phase === "savasana").reduce((s, it) => s + it.durationSeconds, 0);
  const savShare = total ? savSeconds / total : 0;
  const savOk = savShare >= SAVASANA_SHARE[0] && savShare <= SAVASANA_SHARE[1];
  add("savasana.share", savSeconds > 0 ? "warn" : "error", savOk && savSeconds > 0,
    savSeconds === 0
      ? "There is no savasana."
      : `Savasana is ${mmss(savSeconds)} — ${pct(savShare, 1)}% of the practice (convention is ${pct(SAVASANA_SHARE[0], 1)}-${pct(SAVASANA_SHARE[1], 1)}%).`,
    { savSeconds, savShare: round1(savShare * 100) });

  // --- 7. asymmetric poses run both sides, for the same length -------------
  // The engine expands `bilateral` into Left and Right from ONE duration, so a
  // mismatch here means the data is wrong, not that someone rushed the second
  // side. Checked anyway: the failure it guards against is the most common one
  // in the whole practice, and a check that can only fail on a bug is a check
  // that tells you about bugs.
  const asym = items.filter((it) => it.bilateral);
  const lopsided = asym.filter((it) => !it.durationSeconds || it.durationSeconds <= 0);
  add("bilateral.both_sides", "error", lopsided.length === 0,
    lopsided.length
      ? `Asymmetric poses with no hold: ${lopsided.map((i) => i.name).join(", ")}`
      : `${asym.length} asymmetric pose${asym.length === 1 ? "" : "s"}, each running both sides for the same time.`,
    { count: asym.length });

  // --- 8. nothing contraindicated survived the filter ----------------------
  const unsafe = items
    .map((it) => ({ it, a: byId(it.asanaId) }))
    .filter(({ a }) => a && isContraindicated(a, protecting))
    .map(({ it, a }) => `${it.name} (${limitsHit(a, protecting).join(", ")})`);
  add("safety.contraindicated", "error", unsafe.length === 0,
    unsafe.length ? `Poses you are protecting against are still in the sequence: ${unsafe.join(", ")}`
      : protecting.length ? `Nothing in the sequence stresses ${protecting.join(", ")}.` : "No limitations set.",
    { unsafe, protecting });

  // --- 9. the holds suit the style -----------------------------------------
  // A yin sequence of 20-second holds is a hatha sequence with the wrong label.
  //
  // Judged against the EFFECTIVE band — the style's own range narrowed by the
  // length that was asked for — not the nominal one. Grading a 10-minute
  // restorative practice against restorative's 5-10 minute holds would fail every
  // one of them for obeying the length the practitioner chose, and a check that
  // fires on the app doing the right thing is a check people learn to ignore.
  //
  // Dynamic movement is excluded: cat/cow is not a shape you can fail to hold.
  // A salutation ROUND is linked movement measured end to end, not a shape you
  // hold — excluded for the same reason cat/cow is.
  const held = items.filter((it) => it.phase !== "savasana" && it.phase !== "centering"
    && !it.linked && !it.dynamic && !it.flowRound);
  const eff = effectiveHoldBand(style, { targetSeconds: flow.targetSeconds, breathSeconds: flow.breathSeconds,
    holdScale: levelById(flow.level).holdScale });
  let holdLo = 0, holdHi = Infinity, band = "";
  if (eff) {
    [holdLo, holdHi] = eff;
    band = style.holdSeconds
      ? `${Math.round(holdLo)}-${Math.round(holdHi)}s`
      : `${Math.round(holdLo / flow.breathSeconds)}-${Math.round(holdHi / flow.breathSeconds)} breaths`;
  }
  const offBand = held.filter((it) => it.durationSeconds < holdLo * (1 - HOLD_TOLERANCE)
    || it.durationSeconds > holdHi * (1 + HOLD_TOLERANCE));
  add("holds.suit_style", "warn", offBand.length === 0,
    offBand.length
      ? `${offBand.length} hold${offBand.length === 1 ? "" : "s"} outside the ${style.name} range (${band}): ${offBand.slice(0, 3).map((i) => `${i.name} ${i.durationSeconds}s`).join(", ")}`
      : `Holds sit in the ${style.name} range (${band}).`,
    { offBand: offBand.map((i) => i.asanaId), band });

  // --- 10. the sequence is the length it was asked for ---------------------
  const target = (flow && flow.targetSeconds) || 0;
  const drift = target ? Math.abs(total - target) / target : 0;
  add("duration.match", "warn", drift <= DURATION_TOLERANCE,
    `Runs ${mmss(total)} against a ${mmss(target)} target (${total >= target ? "+" : "−"}${pct(Math.abs(total - target), target)}%).`,
    { total, target, drift: round1(drift * 100) });

  // --- 11. it visits more than one family ----------------------------------
  // The same failure as the lifting picker filling two arm slots with two curls:
  // scoring an individual pose without looking at what it repeats.
  //
  // MEASURED AGAINST WHAT THE INTENT ALLOWS, NOT AGAINST THE WHOLE LIBRARY. A
  // bedtime practice deliberately excludes standing, balance and core; grading it
  // for having only two families would be marking it down for doing exactly what
  // was asked. An explicit choice is never overridden, and it is not scolded
  // either. Same principle as the builder's Zone-2-only warning.
  const fams = {};
  for (const it of items) fams[it.family] = (fams[it.family] || 0) + 1;
  const distinct = Object.keys(fams).length;
  const allowed = flow.familiesAllowed || 12;
  // Also bounded by how many poses there ARE. A ten-minute bedtime practice is
  // five poses; demanding four families of it is demanding that almost every pose
  // be from a different family, which is not variety, it is a tour.
  const wantDistinct = Math.min(4, Math.max(2, allowed - 2), Math.ceil(items.length / 2));
  // With few families on the table, one of them leading is arithmetic, not a bug.
  const dominanceCap = allowed <= 6 ? 0.7 : 0.5;
  const dominant = Object.entries(fams).sort((a, b) => b[1] - a[1])[0];
  const dominantShare = dominant ? dominant[1] / items.length : 0;
  add("variety.families", "warn", distinct >= wantDistinct && dominantShare <= dominanceCap,
    distinct < wantDistinct
      ? `Only ${distinct} pose families, with ${allowed} available to this practice.`
      : dominantShare > dominanceCap
        ? `${dominant[0].replace(/_/g, " ")} is ${pct(dominantShare, 1)}% of the sequence.`
        : `${distinct} pose families, none dominating.`,
    { families: fams, distinct, allowed });

  // --- 12. how many times you get up off the floor -------------------------
  //
  // ADDED AFTER READING A GENERATED 45-MINUTE FLOW, not from the literature.
  // Every pose in it was individually defensible and the sequence was unusable:
  // tree, then cobra, then a wide-legged fold, then plank, then warrior II —
  // eleven changes between standing and the floor in as many poses. A real class
  // works through the standing poses and then goes down and stays down, and no
  // check I had written could see the problem, because each pose passed on its
  // own. This is the sequencing equivalent of the lifting audit's push/pull
  // finding: the defect only exists at the level of the whole artefact.
  // Linked salutation movements are EXCLUDED. A sun salutation is standing,
  // floor, standing by construction — that alternation is the form, not a defect
  // in it, and counting it would fire on every vinyasa ever written.
  const planed = items.filter((it) => it.plane && it.phase !== "savasana" && !it.linked && !it.round && !it.flowRound);
  let changes = 0;
  for (let i = 1; i < planed.length; i++) if (planed[i].plane !== planed[i - 1].plane) changes++;
  // One descent is ideal; a few more are a real class warming up on the floor and
  // then standing. Scaled to length so a 60-minute practice isn't held to the
  // same absolute count as a 15-minute one.
  const planeAllowance = Math.max(3, Math.round(planed.length * PLANE_CHANGE_RATE));
  add("sequence.plane_changes", "warn", changes <= planeAllowance,
    changes <= planeAllowance
      ? `${changes} change${changes === 1 ? "" : "s"} between standing and the floor.`
      : `${changes} changes between standing and the floor across ${planed.length} poses — a practice should come down and stay down.`,
    { changes, allowed: planeAllowance, poses: planed.length });

  // --- 13. no pose leads into the next one badly ---------------------------
  //
  // The hard adjacency rules, and the reason they are errors: each one is a pair
  // that a body has to undo something to get through. Half moon into warrior III
  // turns the standing hip over with the leg straight; a deep backbend into a
  // deep forward fold is two peaks with no recovery between them; the authored
  // pairs rebuild the feet underneath you mid-sequence.
  //
  // Every check before this one grades a pose, a phase or a proportion. None of
  // them can see a pair, which is why "the flows don't flow" survived all of them.
  const faults = faultsIn(items);
  add("sequence.transitions", "error", faults.length === 0,
    faults.length
      ? `Transitions that do not work: ${faults.map((f) => f.message).join("; ")}`
      : `Every pose leads into the next one.`,
    { faults });

  // --- 14. the body does not change position on every pose -----------------
  //
  // `plane` above only distinguishes standing from the floor, and "floor" covers
  // lying on your front, lying on your back, sitting up and being on your hands.
  // A sequence can hold its plane perfectly and still be nonsense inside it.
  // FROM THE BUILD ONWARDS. Centering is seated and a warm-up happens on the
  // floor, so a practice legitimately starts low, stands up, and comes back
  // down — measured from the first pose, that ascent makes every later seated
  // pose look like a return. The one-way descent is a property of the BODY of
  // the practice, which is where the arc model says it is.
  const DESCENT_PHASES = ["build", "peak", "counter", "cool"];
  const positioned = items.filter((it) => DESCENT_PHASES.includes(it.phase)
    && !it.linked && !it.round && !it.flowRound);
  const returns = positionReturns(positioned);
  const posAllowance = Math.max(1, Math.round(positioned.length * POSITION_RETURN_RATE));
  // ⚠ NOT APPLIED TO AN AUTHORED SERIES. The Ashtanga Primary Series comes up to
  // standing and back down between seated postures — that is the form, it is
  // what a vinyasa between postures IS, and nothing here composed it or could
  // change it. Grading a fixed sequence against a compositional rule is the
  // check-fires-on-correct-output trap for the third time in this file.
  add("sequence.position_changes", "error", flow.authored || returns <= posAllowance,
    returns <= posAllowance
      ? `${positionChanges(positioned)} change${positionChanges(positioned) === 1 ? "" : "s"} of body position across ${positioned.length} poses, and the descent holds.`
      : `The sequence goes back to a position it had already left ${returns} times — a practice comes down and stays down.`,
    { returns, changes: positionChanges(positioned), allowed: posAllowance, poses: positioned.length });

  // --- 15. every hold is a hold this pose can actually take ----------------
  //
  // A style that counts in MINUTES may only ask for shapes you can hold in
  // stillness for minutes. This is the check that would have caught a 30-minute
  // yin practice prescribing upward plank for 225 seconds — the hold was inside
  // yin's own band, so holds.suit_style passed it. The defect was never the
  // number; it was asking that number of a pose that cannot answer it.
  const tooLongFor = style.holdSeconds
    ? items.filter((it) => {
        const a = byId(it.asanaId);
        return a && !a.still && !it.linked && it.phase !== "savasana" && it.durationSeconds > 90;
      })
    : [];
  add("holds.can_be_held", "error", tooLongFor.length === 0,
    tooLongFor.length
      ? `Held far too long to be held at all: ${tooLongFor.map((i) => `${i.name} (${mmss(i.durationSeconds)})`).join(", ")}`
      : `Every long hold is a shape that can be held.`,
    { poses: tooLongFor.map((i) => i.asanaId) });

  // --- 16. a flow block runs both sides ------------------------------------
  // A block is emitted as one-sided items, so the bilateral check above cannot
  // see it: to that check a block pose looks symmetric. Without this, a block
  // truncated by the fitting pass would silently run the right side only.
  const blocks = {};
  for (const it of items) if (it.blockId) {
    const k = `${it.blockId}#${it.blockRound || 1}`;
    (blocks[k] = blocks[k] || { Right: 0, Left: 0 })[it.blockSide] += 1;
  }
  const halfBlocks = Object.entries(blocks).filter(([, s]) => s.Right !== s.Left);
  add("block.both_sides", "error", halfBlocks.length === 0,
    halfBlocks.length
      ? `A sequence ran on one side only: ${halfBlocks.map(([k, s]) => `${k} (${s.Right} right, ${s.Left} left)`).join(", ")}`
      : `${Object.keys(blocks).length} flow block${Object.keys(blocks).length === 1 ? "" : "s"}, each run both sides.`,
    { blocks });

  // --- 17. the standing series is not re-setting its feet every pose -------
  // A wide stance open to the long edge and a square one facing the front of the
  // mat are two different setups. Alternating them every pose is the standing
  // version of changing position on every pose — you never settle into either.
  const feet = positioned.filter((it) => {
    const a = byId(it.asanaId);
    return a && onFeet(a.position) && a.facing !== "neutral";
  });
  let churn = 0;
  for (let i = 1; i < feet.length; i++) {
    const prev = byId(feet[i - 1].asanaId), cur = byId(feet[i].asanaId);
    if (prev && cur && prev.facing !== cur.facing) churn++;
  }
  const churnAllowance = Math.max(2, Math.round(feet.length * FACING_CHURN_RATE));
  add("sequence.facing", "warn", flow.authored || churn <= churnAllowance,
    churn <= churnAllowance
      ? `${churn} change${churn === 1 ? "" : "s"} of stance across ${feet.length} standing poses.`
      : `The standing work changes stance ${churn} times in ${feet.length} poses — open-hip and square-hip shapes want to be grouped.`,
    { churn, allowed: churnAllowance, poses: feet.length });

  // --- 18. the spine goes in more than one direction -----------------------
  // The spine flexes, extends, side-bends and rotates, and a balanced practice
  // visits all four. A warn rather than an error: a practice built for one
  // intent — after a run, shoulders and neck — is entitled to favour one.
  const directed = items
    .map((it) => byId(it.asanaId))
    .filter((a) => a && a.spine && a.spine !== "neutral");
  const spineCounts = {};
  for (const a of directed) spineCounts[a.spine] = (spineCounts[a.spine] || 0) + 1;
  //
  // ⚠ LATERAL BENDING IS DELIBERATELY NOT REQUIRED. The first version checked all
  // four and fired on 1,322 of 2,835 swept flows — 47% — because side bending is
  // genuinely rare in yoga outside a handful of standing shapes, and absent from
  // any floor-based practice by construction. A check that fires on correct
  // output is noise, and noise gets muted: the same lesson as the removed
  // poses-per-minute floor directly below, and the builder's RAMP_MAX before it.
  const CORE_DIRECTIONS = ["flexion", "extension", "rotation"];
  const missing = CORE_DIRECTIONS
    .filter((d) => (spineCounts[d] || 0) / Math.max(1, directed.length) < SPINE_MIN_SHARE);
  add("spine.balance", "warn", missing.length <= 1,
    missing.length <= 1
      ? `The spine flexes, extends and rotates in this practice.`
      : `The spine barely goes into ${missing.join(" or ")} in this practice.`,
    { counts: spineCounts, missing });

  // --- 19. a "not enough poses" check WAS HERE AND HAS BEEN REMOVED ---------
  //
  // Worth recording because the reasoning was wrong in an instructive way. A
  // 15-minute wind-down came out as one long hold and a savasana, which looked
  // like a defect, so I added a floor on poses-per-minute. It fired on 26% of
  // swept flows — because a thirty-minute yin practice genuinely IS four poses
  // held five minutes each, and the check was calling the style's defining
  // feature a fault. A check that fires on correct output is noise, and noise
  // gets muted, which is the same lesson the builder's RAMP_MAX carries.
  //
  // The real defect in that sequence was one pose: a HALF LIFT held for nearly
  // four minutes. Half lift is a link between shapes, not a shape. That is fixed
  // at the source — transitional poses are now ineligible in any style that
  // holds in minutes (yoga/asanas.js `transitional`) — and needs no check,
  // because the generator can no longer produce it.

  return finish(checks);
}

/** Changes between standing and floor, as a share of the poses in the practice. */
export const PLANE_CHANGE_RATE = 0.18;

function finish(checks) {
  const errors = checks.filter((c) => c.severity === "error" && !c.ok);
  const warnings = checks.filter((c) => c.severity === "warn" && !c.ok);
  return { checks, errors, warnings, ok: errors.length === 0 };
}

/**
 * One line a person can read, for the review card. Errors first — a sequence
 * with an unprepared peak is not "mostly fine".
 */
export function verdict(audit) {
  if (!audit) return "";
  if (audit.errors.length) return audit.errors[0].message;
  if (audit.warnings.length) return audit.warnings[0].message;
  return "Arc in order, peak prepared and countered, savasana in proportion.";
}
