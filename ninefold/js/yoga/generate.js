// yoga/generate.js — composes a sequence. Pure: no DOM, no storage, no clock.
//
// THE ARC IS A HARD DEPENDENCY, NOT A PREFERENCE:
//
//   centering -> warm-up -> build -> PEAK -> COUNTER -> cool-down -> savasana
//
// Preparatory poses MUST precede the peak and counter-poses MUST follow it. This
// is the one place the yoga side genuinely cannot reuse the lifting machinery:
// reordering a workout is fine, reordering a sequence is not. The v167 Swap /
// Later / Add controls are therefore disabled inside a flow (views/yoga.js),
// because a control that moves a pose can move a counter-pose in front of the
// thing it counters.
//
// The proportions are the teaching convention, and they are checkable numbers
// rather than taste: the peak lands at 60-70% of elapsed time, savasana takes
// 10-20% of the session, and a peak gets 3-4 specific preparatory poses if it is
// simple and 6-8 if it is not. quality.js grades a finished flow against exactly
// these, from the start rather than after a bad sequence ships.
//
// THE CONTRAINDICATION FILTER IS AN INPUT, NOT A POLISH PASS. It runs before
// anything is chosen, and what it removed is reported on the flow so the app can
// say which poses are missing and why instead of silently omitting them.

import { ASANAS, byId, isContraindicated, limitsHit, COUNTER_FAMILY, PREP_MIN, FAMILIES } from "./asanas.js";
import { STYLES, styleById, holdSecondsFor, holdBreathsFor, BREATH_SECONDS_DEFAULT,
  MAX_ITEM_SHARE, MAX_TRANSITION_SHARE } from "./styles.js";
import { intentById, emphasisFor, accountingFor } from "./intents.js";
import { primarySeries } from "./ashtanga.js";
import { rng, seedFrom, resolvePose, REPEATABLE, itemSeconds, flowSeconds } from "./compose.js";

// Re-exported so callers that think of these as "the generator's" keep working;
// they live in compose.js because the authored Primary Series needs them too.
export { rng, seedFrom, resolvePose, REPEATABLE, itemSeconds, flowSeconds, SUBSTITUTES } from "./compose.js";

// --- phase plans -------------------------------------------------------------
// Shares of total session time. The peaked plan puts the peak block at 62-68% of
// elapsed, which is the convention and what quality.js checks.
const PLAN_PEAKED = [
  ["centering", 0.05], ["warmup", 0.15], ["build", 0.42],
  ["peak", 0.06], ["counter", 0.07], ["cool", 0.13], ["savasana", 0.12],
];
const PLAN_FLAT = [
  ["centering", 0.06], ["warmup", 0.12], ["build", 0.48], ["cool", 0.19], ["savasana", 0.15],
];
// A SHORT PRACTICE IN A LONG-HOLD STYLE CANNOT AFFORD FIVE PHASES. Every phase
// places at least one pose — a phase with nothing in it is a broken arc — and in
// yin or restorative one pose is minutes long. Five of those is a floor of about
// thirteen minutes whatever was asked for, so below twenty minutes those styles
// fold the warm-up into the build rather than overrunning by a third. The arc
// still runs in order; it just has one fewer station.
const PLAN_SHORT = [
  ["centering", 0.14], ["build", 0.49], ["cool", 0.22], ["savasana", 0.15],
];

// How well a pose's intensity suits a phase. Not a hard filter — a gentle pose in
// the build is fine, a wheel in the warm-up is not (and `phases` already forbids
// that); this only biases the pick.
const PHASE_INTENSITY = { centering: 1, warmup: 2, build: 4, peak: 5, counter: 2, cool: 1.5, savasana: 1 };

// --- sun salutation ----------------------------------------------------------
// A vinyasa's warm-up is not a list of poses, it is a linked sequence run as
// rounds. Surya Namaskar is also the ONLY yoga sequence the energy-cost review
// measured in the moderate-to-vigorous band (7.4 METs against 2.2 for a typical
// asana), so this is where a flow's intensity actually comes from.
const SURYA_A = ["urdhva_hastasana", "uttanasana", "ardha_uttanasana", "chaturanga",
  "urdhva_mukha", "adho_mukha"];
const SURYA_B = ["utkatasana", "uttanasana", "ardha_uttanasana", "chaturanga",
  "urdhva_mukha", "adho_mukha", "virabhadrasana_1", "chaturanga", "urdhva_mukha", "adho_mukha"];

function salutationItems(list, ctx, { holdLast = 5 } = {}) {
  const out = [];
  list.forEach((id, i) => {
    const a = resolvePose(id, ctx);
    if (!a) return;
    const last = i === list.length - 1;
    out.push(makeItem(a, ctx, {
      phase: "warmup",
      breaths: last ? holdLast : 1,
      linked: !last,               // one breath, one movement — no transition pause
    }));
  });
  return out;
}

// --- item construction -------------------------------------------------------
const clamp01 = (x) => Math.max(0, Math.min(1, x));

function makeItem(asana, ctx, { phase, breaths = null, t = 0.5, linked = false } = {}) {
  const style = ctx.style;
  // THE STYLE GOVERNS HOW LONG A HOLD IS; the pose's own `hold` only says WHERE
  // IN THE STYLE'S RANGE it belongs.
  //
  // Reading the pose's hold as the answer was the first version and it was
  // wrong in a way that was invisible one pose at a time: butterfly says ten
  // breaths because butterfly is a long-hold shape, so inside a vinyasa it
  // produced a fifty-second hold in a three-to-five-breath practice. Sixty-three
  // percent of swept flows carried at least one hold outside their own style's
  // band. A style is largely DEFINED by how long it holds things, so the style
  // has to win and the pose gets a preference within it.
  const tt = breaths != null ? t
    : (asana.hold != null ? clamp01((asana.hold - 3) / 12) : t);
  // Dynamic movement is not a hold and is not judged as one — the same
  // distinction routine.js already draws between a stretch you can fail and an
  // easy jog on a fixed clock.
  const dynamicBreaths = asana.dynamic && asana.hold ? asana.hold : null;
  const holdBreaths = holdBreathsFor(style, { t: tt, breaths: breaths != null ? breaths : dynamicBreaths });
  const seconds = asana.id === "savasana"
    ? ctx.savasanaSeconds
    : holdSecondsFor(style, { breathSeconds: ctx.breathSeconds, t: tt,
        breaths: breaths != null ? breaths : dynamicBreaths });
  const floor = ["seated", "supine", "restorative", "hip_opener", "forward_fold"].includes(asana.family);
  // The requested LENGTH is a constraint on every pose in it. See MAX_ITEM_SHARE.
  const capSeconds = ctx.targetSeconds ? ctx.targetSeconds * MAX_ITEM_SHARE : Infinity;
  const capTrans = ctx.targetSeconds ? ctx.targetSeconds * MAX_TRANSITION_SHARE : Infinity;
  const rawTrans = linked ? 0 : (floor ? style.floorTransitionSeconds : style.transitionSeconds);
  return {
    asanaId: asana.id,
    name: asana.name,
    sanskrit: asana.sanskrit,
    family: asana.family,
    phase,
    cue: asana.cue,
    easier: asana.easier,
    props: asana.props,
    art: asana.art,
    bilateral: asana.bilateral,
    intensity: asana.intensity,
    holdBreaths: linked ? 1 : holdBreaths,
    durationSeconds: Math.max(3, Math.round(Math.min(seconds, capSeconds))),
    dynamic: !!asana.dynamic,
    plane: asana.plane,
    // A vinyasa's linked movements have NO transition — that is what "one breath,
    // one movement" means. A change to or from the floor needs real time.
    transitionSeconds: Math.round(Math.min(rawTrans, capTrans)),
    linked,
  };
}

// --- the picker --------------------------------------------------------------
function scoreFor(asana, ctx, phase, used, recentFamilies, allowRepeat = false, state = {}) {
  if (!asana.phases.includes(phase)) return 0;
  // A long practice legitimately revisits a warrior; a short one that repeats
  // triangle six times is padding. So repetition is forbidden on the first pass
  // and merely expensive on the second, which only runs when the pool of unused
  // poses is genuinely exhausted before the phase's time is.
  if (!REPEATABLE.has(asana.id) && used.has(asana.id) && !allowRepeat) return 0;
  if (asana.level > ctx.level) return 0;
  const [lo, hi] = ctx.style.intensityBand;
  if (asana.intensity < lo || asana.intensity > hi) return 0;
  const emph = emphasisFor(ctx.intent, asana.family);
  if (emph === 0) return 0;
  // A pose that is only ever a peak must not be picked as ordinary build work.
  if (asana.peak > 0 && phase !== "peak") return 0;
  // A transitional pose is never a long hold. In a breath-counted style it is
  // fine — a few breaths in a half lift is what a half lift is — but a style that
  // holds in MINUTES must not reach for one.
  if (asana.transitional && ctx.style.holdSeconds) return 0;
  let s = emph;
  // intensity fit: how close the pose sits to what this phase wants
  s *= 1 / (1 + Math.abs(asana.intensity - PHASE_INTENSITY[phase]) * 0.55);
  // spread across families — the same fix as the lifting picker's quality tags,
  // where penalising a repeated EXERCISE but not a repeated MUSCLE reliably
  // produced two curls and no triceps.
  const rep = recentFamilies.filter((f) => f === asana.family).length;
  s *= Math.pow(0.35, rep);
  if (used.has(asana.id)) s *= REPEATABLE.has(asana.id) ? 0.16 : 0.12;
  // A pose that appeared four poses ago is a repeat whatever the pool says.
  if (state.recentIds && state.recentIds.includes(asana.id)) s *= 0.05;

  // STAY ON ONE PLANE UNTIL IT IS TIME TO CHANGE. A sequence works through the
  // standing poses and then goes to the floor; it does not stand up and lie down
  // twelve times. Once the practice HAS come down, going back up is penalised
  // harder than coming down was — the descent is one-way in a real class, and
  // the cool-down that follows is all floor work anyway.
  if (state.plane && state.plane !== asana.plane) {
    s *= asana.plane === "standing" ? PLANE_RETURN_PENALTY : PLANE_CHANGE_PENALTY;
  }
  return s;
}

// Soft, not absolute: a single standing pose in the middle of floor work is
// sometimes right, and a ban would make the generator refuse sequences a teacher
// would write. These are the numbers that turned "tree, cobra, wide-legged fold,
// plank, warrior II" into a standing series followed by a floor series.
const PLANE_CHANGE_PENALTY = 0.18;
const PLANE_RETURN_PENALTY = 0.06;
/** Settling is a minute or two, never a proportional slice of a long practice. */
const CENTERING_MAX = 120;

function pick(pool, ctx, phase, used, recentFamilies, rand, allowRepeat = false, state = {}) {
  const scored = pool.map((a) => [a, scoreFor(a, ctx, phase, used, recentFamilies, allowRepeat, state)]).filter(([, s]) => s > 0);
  if (!scored.length) return null;
  const total = scored.reduce((t, [, s]) => t + s, 0);
  let r = rand() * total;
  for (const [a, s] of scored) { r -= s; if (r <= 0) return a; }
  return scored[scored.length - 1][0];
}

// --- fitting a built sequence to the requested length ------------------------
const BODY_PHASES = ["centering", "warmup", "build", "peak", "counter", "cool"];
/** How far the holds may be stretched or squeezed before poses come out instead. */
const SCALE_BOUNDS = [0.55, 1.45];
/** No hold drops below this, whatever the arithmetic wants. */
const MIN_HOLD_SECONDS = 15;

function fitToTarget(sections, peak, ctx, savShare) {
  const body = () => BODY_PHASES.reduce((s, p) => s + flowSeconds(sections[p] || []), 0);
  const bodyTarget = Math.max(60, ctx.targetSeconds * (1 - savShare));

  // 1. trim — a phase may lose its last-added pose, never its only one, and
  // NEVER a pose that is there because the peak depends on it.
  //
  // The first version popped the tail of the fullest phase, and the peak's
  // preparation is appended to the tail of the build — so trimming for time
  // silently dismantled the preparation for the hardest pose in the sequence.
  // That is the precise failure the arc model exists to prevent, arriving through
  // the back door of an unrelated optimisation.
  const removable = (p) => {
    const list = sections[p] || [];
    if (list.length <= 1) return -1;
    for (let i = list.length - 1; i >= 0; i--)
      if (!list[i].prepFor && !list[i].counterTo && !list[i].linked) return i;
    return -1;
  };
  const trimmable = () => BODY_PHASES
    .filter((p) => p !== "peak" && removable(p) >= 0)
    .sort((a, b) => sections[b].length - sections[a].length)[0] || null;
  let guard = 0;
  while (body() > bodyTarget * (1 + DURATION_FIT_TOLERANCE) && guard++ < 60) {
    const p = trimmable();
    if (!p) break;
    sections[p].splice(removable(p), 1);
  }
  // A linked salutation can still come off, but only whole rounds of it.
  guard = 0;
  while (body() > bodyTarget * (1 + DURATION_FIT_TOLERANCE) && guard++ < 12) {
    const warm = sections.warmup || [];
    const rounds = warm.filter((it) => it.round).map((it) => it.round);
    const last = rounds.length ? Math.max(...rounds) : 0;
    if (last <= 1) break;                       // one round of salutations stays
    sections.warmup = warm.filter((it) => it.round !== last);
  }

  // 2. scale what remains. Linked movements are exempt: one breath, one movement
  // is the definition of the thing, so it cannot be held longer to fill time.
  const cur = body();
  if (!cur) return;
  const f = Math.max(SCALE_BOUNDS[0], Math.min(SCALE_BOUNDS[1], bodyTarget / cur));
  if (Math.abs(f - 1) < 0.03) return;
  for (const p of BODY_PHASES) for (const it of sections[p] || []) {
    if (it.linked) continue;
    it.durationSeconds = Math.max(MIN_HOLD_SECONDS, Math.round((it.durationSeconds * f) / 5) * 5);
    if (it.holdBreaths != null && ctx.breathSeconds)
      it.holdBreaths = Math.max(1, Math.round(it.durationSeconds / ctx.breathSeconds));
  }
}

/** The drift the fitting pass works to. quality.js allows a little more. */
const DURATION_FIT_TOLERANCE = 0.08;

// --- the generator -----------------------------------------------------------
/**
 * Compose a sequence.
 *
 * @param {object} o
 * @param {string} o.intent      intent id (what the practice is FOR)
 * @param {number} o.minutes     target length
 * @param {string[]} o.limits    LIMITATION keys the practitioner is protecting
 * @param {string} [o.style]     override the intent's style
 * @param {number} [o.level]     1 accessible · 2 intermediate · 3 advanced
 * @param {number} [o.breathSeconds]
 * @param {number} [o.seed]
 */
export function generateFlow({ intent: intentId, minutes, limits = [], style: styleOverride = null,
  level = 2, breathSeconds = BREATH_SECONDS_DEFAULT, seed = 1 } = {}) {
  const intent = intentById(intentId);
  if (!intent) throw new Error(`unknown intent "${intentId}"`);
  const style = styleById(styleOverride || intent.style);
  if (!style) throw new Error(`unknown style "${styleOverride || intent.style}"`);

  // A fixed series is fixed by definition — nothing here composes it.
  if (style.authored) return primarySeries({ limits, level, breathSeconds, minutes });

  const rand = rng(seed);
  const targetSeconds = Math.round(minutes * 60);
  const savShare = (style.savasanaShare[0] + style.savasanaShare[1]) / 2;
  const ctx = { intent, style, limits, level, breathSeconds, targetSeconds, savasanaSeconds: 0 };

  // What the limitations cost, recorded so the app can name it rather than
  // quietly shipping a shorter library.
  const excluded = ASANAS
    .filter((a) => isContraindicated(a, limits))
    .map((a) => ({ id: a.id, name: a.name, sites: limitsHit(a, limits) }));
  const pool = ASANAS.filter((a) => !isContraindicated(a, limits) && a.level <= level);
  const reachableFamilies = new Set(pool
    .filter((a) => emphasisFor(intent, a.family) > 0
      && a.intensity >= style.intensityBand[0] && a.intensity <= style.intensityBand[1]
      && a.phases.some((ph) => ph !== "series"))
    .map((a) => a.family));

  // --- peak selection, before anything else, because it dictates the build ---
  //
  // IF WE CANNOT PREPARE IT, WE DO NOT CLIMB IT. A peak is only a candidate when
  // enough of its OWN preparatory poses survive this body's limitations and level
  // — otherwise a knee or a shoulder quietly strips the preparation and the flow
  // arrives at a hard pose cold. Dropping the peak is the honest outcome: the
  // sequence becomes a good flat practice instead of a bad peaked one.
  let peak = null;
  const resolvablePreps = (a) => {
    const seen = new Set();
    for (const id of a.preps) {
      const got = resolvePose(id, { limits, level });
      if (got && got.id !== a.id) seen.add(got.id);
    }
    return seen.size;
  };
  const wantsPeak = style.allowPeak && intent.peaks.length && targetSeconds >= 20 * 60;
  let peakRejected = [];
  if (wantsPeak) {
    const resolved = intent.peaks
      .map((id) => resolvePose(id, { limits, level }))
      .filter((a) => a && a.peak > 0 && a.phases.includes("peak"));
    const candidates = resolved.filter((a) => {
      const need = PREP_MIN[a.peak] || 3;
      const have = resolvablePreps(a);
      if (have < need) { peakRejected.push({ id: a.id, name: a.name, have, need }); return false; }
      return true;
    });
    if (candidates.length) peak = candidates[Math.floor(rand() * candidates.length)];
  }

  const shortLongHold = !peak && !!style.holdSeconds && targetSeconds < 20 * 60;
  const plan = peak ? PLAN_PEAKED : (shortLongHold ? PLAN_SHORT : PLAN_FLAT);
  const used = new Set();
  const sections = {};
  let recentFamilies = [];
  // Running sequence state the picker reads: where the body currently is, and
  // what it has just done. Threaded through phases rather than reset per phase,
  // because the standing-to-floor descent is a property of the whole practice.
  const seq = { plane: null, recentIds: [] };
  const noteChoice = (a) => {
    seq.plane = a.plane;
    seq.recentIds.push(a.id);
    if (seq.recentIds.length > 8) seq.recentIds.shift();
  };

  const fillPhase = (phase, budget, opts = {}) => {
    const items = [];
    let spent = 0;
    let guard = 0;
    // Two passes. The first refuses to repeat a pose at all; the second allows it
    // at a heavy penalty, and only runs if the first ran out of poses before it
    // ran out of time. Without it a 60-minute vinyasa finished at 49 minutes,
    // because the eligible pool for one phase is simply smaller than an hour.
    for (const allowRepeat of [false, true]) {
      while (spent < budget * 0.92 && guard++ < 60) {
        const eligible = opts.plane ? pool.filter((x) => x.plane === opts.plane) : pool;
        const a = pick(eligible, ctx, phase, used, recentFamilies.slice(-3), rand, allowRepeat, seq);
        if (!a) break;
        const t = opts.t == null ? rand() : opts.t;
        const it = makeItem(a, ctx, { phase, t });
        const cost = itemSeconds(it);
        // Don't blow the budget by more than half an item to place one more pose.
        if (spent + cost > budget * 1.12 && items.length) { spent = budget; break; }
        items.push(it);
        used.add(a.id);
        recentFamilies.push(a.family);
        noteChoice(a);
        spent += cost;
      }
      if (spent >= budget * 0.92) break;
    }
    sections[phase] = items;
    return items;
  };

  const budgetFor = (phase) => (plan.find(([p]) => p === phase) || [null, 0])[1] * targetSeconds;

  // 1. centering — always exactly one thing, so the practice starts by settling
  const centeringPose = resolvePose(style.id === "restorative" ? "balasana_open" : "centering", { limits, level })
    || resolvePose("savasana", { limits, level });
  sections.centering = centeringPose
    ? [makeItem(centeringPose, ctx, { phase: "centering", breaths: null, t: 0.5 })]
    : [];
  if (centeringPose) { used.add(centeringPose.id); }
  // The centering item is time-boxed to its share rather than to its own hold,
  // and CAPPED: settling is one to two minutes in any practice. A proportional
  // share of a 45-minute flow put two and a half minutes of sitting still in
  // front of a strong vinyasa, which is where people close the app.
  if (sections.centering.length) {
    sections.centering[0].durationSeconds =
      Math.min(CENTERING_MAX, Math.max(30, Math.round(budgetFor("centering"))));
    sections.centering[0].holdBreaths = null;
    sections.centering[0].transitionSeconds = 0;
    seq.plane = centeringPose.plane;
  }

  // 2. warm-up — sun salutations where the style flows, discrete poses otherwise
  if (shortLongHold) { sections.warmup = []; }
  else if (style.flowLinked && minutes >= 15) {
    const budget = budgetFor("warmup");
    const items = [];
    let spent = 0;
    // Cat/cow first: the spine wants to move before it holds anything.
    // No explicit breath count: cat/cow carries its own as DYNAMIC movement, and
    // if a wrist sends it down the substitution chain to a seated shape, that
    // shape gets the style's ordinary hold rather than cat/cow's eight breaths.
    const opener = resolvePose("cat_cow", { limits, level });
    if (opener) { const it = makeItem(opener, ctx, { phase: "warmup" }); items.push(it); spent += itemSeconds(it); used.add(opener.id); }
    let rounds = 0;
    while (spent < budget * 0.85 && rounds < 5) {
      const set = salutationItems(rounds < 2 || minutes < 30 ? SURYA_A : SURYA_B, ctx,
        { holdLast: rounds === 0 ? 5 : 3 });
      const cost = flowSeconds(set);
      if (spent + cost > budget * 1.15 && items.length > 1) break;
      set.forEach((it) => { it.round = rounds + 1; it.salutation = rounds < 2 || minutes < 30 ? "A" : "B"; });
      items.push(...set);
      set.forEach((it) => used.add(it.asanaId));
      spent += cost;
      rounds++;
    }
    sections.warmup = items;
    recentFamilies.push("standing");
  } else {
    fillPhase("warmup", budgetFor("warmup"), { t: 0.35 });
  }

  // 3. build — general work, then the peak's OWN preparation, in order
  const buildBudget = budgetFor("build");
  let prepItems = [];
  if (peak) {
    const want = style.prepCount[peak.peak] || 4;
    const preps = peak.preps
      .map((id) => resolvePose(id, { limits, level }))
      .filter(Boolean)
      .filter((a, i, arr) => arr.findIndex((b) => b.id === a.id) === i)
      .slice(0, want);
    prepItems = preps.map((a) => makeItem(a, ctx, { phase: "build", t: 0.5 }));
    prepItems.forEach((it) => { it.prepFor = peak.id; used.add(it.asanaId); });
    preps.forEach(noteChoice);
  }
  const prepCost = flowSeconds(prepItems);
  // THE BUILD DESCENDS ONCE: standing work, then floor work, then the peak's own
  // preparation. Scoring the plane as a preference alone was not enough — a
  // penalty is a bias and the roulette still reached past it often enough that a
  // fifth of swept flows were still bouncing up and down. Splitting the budget
  // makes the descent structural, which is what a class actually does: the
  // standing series, then down, and you stay down.
  const usable = Math.max(0, buildBudget - prepCost);
  const standingShare = style.flowLinked ? 0.55 : 0.5;
  // WHICH HALF COMES SECOND IS DECIDED BY THE PEAK. A standing peak wants the
  // standing block immediately before it, so the practice arrives there already
  // on its feet; a floor peak wants the floor block. Getting this backwards costs
  // two plane changes at the most important moment in the sequence — you stand
  // up, lie down, and stand up again to reach the pose you built toward.
  const first = peak && peak.plane === "standing" ? "floor" : "standing";
  const second = first === "standing" ? "floor" : "standing";
  const firstShare = first === "standing" ? standingShare : 1 - standingShare;
  fillPhase("build", usable * firstShare, { plane: first });
  const firstItems = sections.build;
  fillPhase("build", usable * (1 - firstShare), { plane: second });
  sections.build = [...firstItems, ...sections.build, ...prepItems];

  // 4. peak
  sections.peak = peak ? [makeItem(peak, ctx, { phase: "peak", t: 1 })] : [];
  if (peak) { used.add(peak.id); noteChoice(peak); }

  // 5. counter — the peak's own counters first, then the family fallback.
  // This is the half of the arc that gets forgotten, and forgetting it is how a
  // deep backbend becomes a sore back an hour later.
  if (peak) {
    const counters = (peak.counters.length ? peak.counters : (COUNTER_FAMILY[peak.family] || [])
      .flatMap((f) => pool.filter((a) => a.family === f && a.phases.includes("counter")).slice(0, 1).map((a) => a.id)))
      .map((id) => resolvePose(id, { limits, level }))
      .filter(Boolean)
      .filter((a, i, arr) => arr.findIndex((b) => b.id === a.id) === i);
    const items = [];
    let spent = 0;
    const budget = budgetFor("counter");
    for (const a of counters) {
      const it = makeItem(a, ctx, { phase: "counter", t: 0.5 });
      it.counterTo = peak.id;
      items.push(it);
      used.add(a.id);
      noteChoice(a);
      spent += itemSeconds(it);
      if (spent >= budget * 0.8 && items.length >= 1) break;
    }
    sections.counter = items;
  } else sections.counter = [];

  // 6. cool-down
  fillPhase("cool", budgetFor("cool"), { t: 0.7 });

  // 6b. fit the body of the practice to the length that was asked for.
  //
  // Every phase places at least one pose regardless of budget, because a phase
  // with nothing in it is a broken arc. In a long-hold style that floor is the
  // whole problem: five phases each forcing one restorative pose is already 37
  // minutes, whatever was requested. So the practice is trimmed and then scaled.
  //
  // Trim first, scale second, and in that order — shortening ten poses to fit a
  // ten-minute practice gives ten rushed poses, whereas dropping to four and
  // holding those properly gives a ten-minute practice. Poses come off the
  // fullest phase, never the peak, never a phase down to its last pose, and never
  // a linked sun salutation (half a salutation is not a salutation).
  fitToTarget(sections, peak, ctx, savShare);

  // 7. savasana — a PROPORTION of the session, never a fixed five minutes, and
  // computed from the practice that was actually BUILT rather than the one that
  // was requested. Deriving it from the target was wrong in both directions: a
  // sequence that overran got a savasana worth 5% of it, and one that came in
  // short got an unearned lie-down.
  const bodySeconds = ["centering", "warmup", "build", "peak", "counter", "cool"]
    .reduce((s, p) => s + flowSeconds(sections[p] || []), 0);
  const savasanaSeconds = Math.max(60,
    Math.round((bodySeconds * (savShare / (1 - savShare))) / 15) * 15);
  ctx.savasanaSeconds = savasanaSeconds;
  const sav = resolvePose("savasana", { limits, level });
  sections.savasana = sav ? [makeItem(sav, ctx, { phase: "savasana" })] : [];

  const order = peak
    ? ["centering", "warmup", "build", "peak", "counter", "cool", "savasana"]
    : ["centering", "warmup", "build", "cool", "savasana"];
  const items = order.flatMap((p) => sections[p] || []);
  items.forEach((it, i) => { it.id = `${it.asanaId}-${i}`; });

  const totalSeconds = flowSeconds(items);
  return {
    intent: intent.id,
    intentLabel: intent.label,
    style: style.id,
    styleName: style.name,
    styleFamily: style.family,
    minutes,
    targetSeconds,
    totalSeconds,
    breathSeconds,
    level,
    limits: [...limits],
    seed,
    peak: peak ? peak.id : null,
    peakRejected,
    peakName: peak ? peak.name : null,
    savasanaSeconds,
    items,
    sections,
    excluded,
    // What the practice could REACH, not what its emphasis map permits. Counting
    // permitted families overstated it badly: a bedtime practice excludes three
    // families outright, but the restorative intensity band excludes most of the
    // rest, so "9 available" was a number nothing could have hit.
    familiesAllowed: reachableFamilies.size,
    accounting: accountingFor(intent),
    note: intent.note || "",
    authored: false,
  };
}

/**
 * Convert a flow into the routine engine's definition shape.
 *
 * The engine already handles timed items, bilateral Left/Right and per-item cues;
 * what is new is `holdBreaths` (so a hold can be COUNTED rather than just timed)
 * and per-item transitions (a linked vinyasa movement has none).
 */
export function toRoutineDef(flow) {
  return {
    rounds: 1,
    transitionSeconds: null,          // per-item; the engine falls back to this when null
    breathSeconds: flow.breathSeconds,
    items: flow.items.map((it) => ({
      id: it.asanaId,
      itemId: it.id,
      name: it.name,
      sanskrit: it.sanskrit,
      mode: "timed",
      durationSeconds: it.durationSeconds,
      transitionSeconds: it.transitionSeconds,
      bilateral: it.bilateral,
      cue: it.cue,
      easier: it.easier,
      holdBreaths: it.holdBreaths,
      // The player's cue vocabulary, chosen explicitly rather than inferred from
      // the name — the warm-up engine's isStretch() regex matches on words like
      // "hamstring" and would never match an asana.
      cueKind: it.phase === "savasana" ? "rest" : (it.linked ? "flow" : "hold"),
      breathPaced: !!flow.breathSeconds && !it.linked && it.holdBreaths != null,
      phase: it.phase,
      illustrationId: it.art,
    })),
  };
}
