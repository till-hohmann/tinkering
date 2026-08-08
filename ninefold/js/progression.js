// progression.js — the autoregulating progression engine (pure logic, no DOM).
//
// Turns the app from a passive logger into a coach: for each lift it reads your
// own history within the program and prescribes the NEXT working load + reps via
// double progression, bridging rep-range changes with an estimated-1RM (e1RM)
// calculation, snapping every load to the equipment you actually have, and
// flagging stalls. The strength view renders the recommendation and pre-fills it.
//
// Design choices (deliberate, evidence-based — see Training Science Reference):
//  - Double progression is primary: fill the rep range at the load, then add load.
//  - Rep count vs the prescribed range is the main proximity-to-failure signal;
//    optional logged RIR refines it but the engine never REQUIRES it (fast logging).
//  - When the week's rep range drops (heavier phase), hold e1RM and re-base the
//    load to the new bottom rep — that is the "go heavier this week" jump.
//  - Loads round to real equipment: barbell/EZ plate math, cable steps, a
//    discrete adjustable set, or a rack's fixed step. No un-loadable loads.

// Lower-body lifts get the larger load step (±5 kg vs ±2.5 kg upper) where the
// equipment grid allows; everything else is treated as upper.
const LOWER = new Set([
  "back_squat", "rdl_barbell", "bulgarian_split_squat_db", "db_walking_lunge",
  "standing_calf_raise_db", "db_goblet_squat", "db_rdl", "db_reverse_lunge",
  "db_hip_thrust", "db_calf_raise",
]);

export const isTimed = (rx) => !!(rx && (rx.timed || /s$/i.test(rx.repRange || "")));

// A recovery deload week — back off load AND volume to recover — as opposed to a
// peak/test week. Program data marks the back-off weeks in the week's phaseName
// ("Deload and Recover", "Deload"). "Deload and Test" is a PEAK/test week (chase
// a number on fresh legs), NOT a back-off, so it is deliberately excluded.
export function isDeloadWeek(week) {
  const p = (week && week.phaseName) || "";
  return /deload|recover/i.test(p) && !/test|peak/i.test(p);
}

export function parseRange(s) {
  const n = (s || "").match(/\d+/g);
  if (!n || !n.length) return null;
  const lo = Number(n[0]), hi = Number(n[n.length - 1]);
  return { lo, hi: Math.max(lo, hi) };
}

// Estimated 1RM (Epley). Comparable across rep ranges, so it's our strength
// yardstick for both rep-range bridging and stall detection.
export function e1rm(weightKg, reps) {
  const w = Number(weightKg) || 0, r = Number(reps) || 0;
  if (w <= 0 || r <= 0) return 0;
  return w * (1 + r / 30);
}

// Heaviest working set; ties broken by most reps.
export function topSet(ex) {
  if (!ex || !ex.sets) return null;
  let best = null;
  for (const s of ex.sets) {
    if (s.reps == null) continue;            // skip timed
    const w = Number(s.weightKg) || 0;
    if (!best || w > best.weightKg || (w === best.weightKg && s.reps > best.reps))
      best = { weightKg: w, reps: s.reps, rir: s.rir };
  }
  return best;
}

const workSets = (ex) => (ex && ex.sets ? ex.sets.filter((s) => s.reps != null) : []);
const allAtLeast = (ex, reps) => { const w = workSets(ex); return w.length > 0 && w.every((s) => s.reps >= reps); };

// Estimate reps-in-reserve on the last hard set. Logged RIR wins; otherwise
// infer from set-to-set rep DECAY: a truly hard top set bleeds reps across sets
// (10/9/8/7), so zero decay means the load was submaximal (reps to spare). This
// stops the engine under-loading clean-but-easy sets (the Week-1/2 finding).
function effortReserve(ex) {
  const ts = topSet(ex);
  if (ts && ts.rir != null) return Math.max(0, Math.min(4, ts.rir));
  const reps = workSets(ex).map((s) => s.reps);
  if (reps.length < 2) return 1;
  const decay = Math.max(...reps) - Math.min(...reps);
  if (decay <= 0) return 2;   // no decay → clearly had ~2+ in reserve
  if (decay === 1) return 1;
  return 0;                   // big decay → was at/near failure
}

// --- equipment-aware rounding -------------------------------------------------
const round2 = (x) => Math.round(x * 100) / 100;
function roundToStep(x, step, min) {
  const v = Math.round(x / step) * step;
  return Math.max(min != null ? min : 0, round2(v));
}
function nearestIn(vals, x) {
  if (!vals || !vals.length) return round2(x);
  return vals.reduce((a, b) => (Math.abs(b - x) < Math.abs(a - x) ? b : a));
}
function barStep(plates) { return 2 * Math.min(...(plates && plates.length ? plates : [1.25])); }

// Snap an arbitrary load to what the athlete can actually load right now.
export function roundLoad(load, implement, location, equip) {
  if (load == null) return null;
  equip = equip || {};
  if (implement === "bodyweight") return 0;
  if (implement === "barbell") {
    const bar = equip.barWeightKg || 20, step = barStep(equip.barbellPlatesKg);
    return Math.max(bar, bar + Math.round((load - bar) / step) * step);
  }
  if (implement === "ez_bar") {
    const bar = equip.ezBarWeightKg || 7.5, step = barStep(equip.ezBarPlatesKg);
    return Math.max(bar, bar + Math.round((load - bar) / step) * step);
  }
  if (implement === "cable") {
    const c = equip.cable || {}; const step = c.stepKg || 2.5;
    return roundToStep(load, step, c.minKg || step);
  }
  // dumbbells — snap to what's actually on the rack at this location: a discrete
  // set (adjustable dumbbells) or a fixed step, and NEVER above the heaviest
  // or below the lightest dumbbell there, so the engine can't prescribe an unloadable weight
  // (e.g. a hotel rack topping out at 22.5, adjustables at 40 kg/hand).
  const dloc = (equip.dumbbells && equip.dumbbells[location]) || {};
  if (Array.isArray(dloc.valuesKg) && dloc.valuesKg.length) return nearestIn(dloc.valuesKg, load);
  const step = dloc.stepKg || 2.5;
  const floor = dloc.minKg != null ? dloc.minKg : step;
  let v = roundToStep(load, step, floor);
  if (dloc.maxKg != null) v = Math.min(dloc.maxKg, v);
  return v;
}

// The heaviest per-hand dumbbell actually available at this location (max of the
// discrete adjustable set, or the fixed-range max), or null when it isn't
// a dumbbell / has no meaningful ceiling (barbell/EZ are plate-limited far above
// working loads). Lets the engine progress on reps — not an impossible load — at
// the cap, and keeps stall detection from crying wolf when e1RM plateaus there.
export function loadCeiling(implement, location, equip) {
  equip = equip || {};
  if (implement !== "dumbbell_pair" && implement !== "dumbbell_single") return null;
  const dloc = (equip.dumbbells && equip.dumbbells[location]) || null;
  if (!dloc) return null;
  if (Array.isArray(dloc.valuesKg) && dloc.valuesKg.length) return Math.max(...dloc.valuesKg);
  return dloc.maxKg != null ? dloc.maxKg : null;
}

// The discrete per-hand dumbbell set at a place, or null when that place uses a
// fixed step instead (or the implement isn't a dumbbell). Place names are free
// text supplied by the user's profile, so this must never test a literal name.
function discreteValues(implement, location, equip) {
  if (implement !== "dumbbell_pair" && implement !== "dumbbell_single") return null;
  const d = equip && equip.dumbbells && equip.dumbbells[location];
  return d && Array.isArray(d.valuesKg) && d.valuesKg.length ? d.valuesKg : null;
}

// Next loadable weight strictly above `load`.
export function nextLoadUp(load, implement, location, equip, lower) {
  equip = equip || {};
  if (implement === "bodyweight") return 0;
  // Discrete rack? Step to the next real dumbbell rather than a computed number.
  // (This used to test one hardcoded place name explicitly, which silently broke
  // the discrete path for every other place — including any the user names.)
  const dvals = discreteValues(implement, location, equip);
  if (dvals) {
    const up = dvals.find((v) => v > load); return up != null ? up : load;
  }
  const delta = lower ? 5 : 2.5;
  let cand = roundLoad(load + delta, implement, location, equip);
  if (cand <= load) cand = roundLoad(load + delta + 2.5, implement, location, equip);
  return cand;
}

function loadDown(load, implement, location, equip, lower) {
  equip = equip || {};
  const dvals = discreteValues(implement, location, equip);
  if (dvals) {
    const down = [...dvals].reverse().find((v) => v < load); return down != null ? down : load;
  }
  const delta = lower ? 5 : 2.5;
  return roundLoad(Math.max(0, load - delta), implement, location, equip);
}

// --- the recommendation -------------------------------------------------------
// args: { curRx, prevEx, prevRange, implement, location, equip, exerciseId }
//   curRx     current week's prescription { prescribedSets, repRange, timed? }
//   prevEx    previous logged occurrence { implement, sets:[{weightKg,reps,rir?}] } | null
//   prevRange the rep range PRESCRIBED on that previous occurrence (string) | null
// returns { direction:'up'|'hold'|'down'|'new'|'timed', load, reps, reason, e1rm? }
export function recommend({ curRx, prevEx, prevRange, implement, location, equip, exerciseId, deload }) {
  if (isTimed(curRx)) return { direction: "timed", reps: null, reason: "Hold the time, or add a few seconds vs last." };
  const cur = parseRange(curRx.repRange) || { lo: 8, hi: 10 };
  const lower = LOWER.has(exerciseId);

  // Deload week: target a genuinely easy effort — RPE ~6, about 4 reps in
  // reserve — at the reduced reps, using the SAME effort-adjusted e1RM the rest
  // of the engine uses. This auto-scales per lift and per how heavy you'd gotten
  // (typically ~10-15% under recent working load), which maintains the pattern
  // under real load. A blunt fixed % cut, anchored off a heavy low-rep top set,
  // lands near warm-up weight and maintains nothing. Volume is already cut via
  // the program's reduced sets, so this is the load/effort lever only.
  if (deload) {
    const ts = workSets(prevEx).length ? topSet(prevEx) : null;
    if (ts && ts.weightKg > 0) {
      const reserve = effortReserve(prevEx);
      const effE1 = e1rm(ts.weightKg, ts.reps + reserve);
      let target = effE1 / (1 + (cur.lo + 4) / 30);   // load for cur.lo reps at ~4 RIR (RPE 6)
      // Bound it to the evidence-based deload band: 10-20% under recent working
      // load (Training Science Reference §3/§9). Effort-aware WITHIN that band —
      // a near-failure lift cuts deeper, a fresh one stays lighter. Ceiling 0.88
      // (not 0.90) so coarse plate-rounding still lands at ~10%+, not just under.
      target = Math.min(ts.weightKg * 0.88, Math.max(ts.weightKg * 0.80, target));
      const load = roundLoad(target, implement, location, equip);
      return { direction: "deload", load, reps: cur.lo, e1rm: e1rm(load, cur.lo),
        reason: `Deload week — keep it easy (RPE ~6, ~4 reps in reserve), about 10-20% under your recent ${fmt(ts.weightKg, implement)}. Recovery, not work.` };
    }
    return { direction: "deload", load: null, reps: cur.lo,
      reason: `Deload week — go light: pick a load you could manage for ~${cur.lo + 4} reps and stop at ${cur.lo}. Easy and fast.` };
  }

  if (!prevEx || !workSets(prevEx).length) {
    return { direction: "new", load: null, reps: cur.lo,
      reason: `First time — pick a load you can do for ${curRx.repRange} at ~2 reps in reserve.` };
  }

  const ts = topSet(prevEx);
  const prevR = parseRange(prevRange) || cur;
  const prevE = e1rm(ts.weightKg, ts.reps);

  // At the dumbbell ceiling for this location the load can't go up — so any branch
  // that would add load (a heavier week, or all-sets-topped) pivots to REP/set/
  // tempo progression instead, and we never show a broken "go heavier" at the same
  // weight (which would actually cut reps) or a false equipment stall.
  const ceiling = loadCeiling(implement, location, equip);
  const atCeiling = ceiling != null && ts.weightKg >= ceiling - 1e-9;
  const capNum = ceiling != null && Number.isInteger(ceiling) ? ceiling : round2(ceiling);

  // 1) Heavier week: the rep range dropped, or last week you already beat this
  //    week's top rep. Re-base to the new bottom rep using an EFFORT-ADJUSTED
  //    e1RM (counts reps left in reserve), prescribing ~1 RIR. So an easy 50×10
  //    bridges to a genuinely heavier 6, not a soft one. Never go below last load.
  if (cur.hi < prevR.hi || ts.reps > cur.hi) {
    if (atCeiling) return capResponse(ts, capNum, "heavier");
    const reserve = effortReserve(prevEx);
    const effE1 = e1rm(ts.weightKg, ts.reps + reserve);
    const target = effE1 / (1 + (cur.lo + 1) / 30);     // load you'd do for lo+1 → lo at ~1 RIR
    const load = roundLoad(Math.max(target, ts.weightKg), implement, location, equip);
    const extra = reserve >= 2 ? " Last sets had reps to spare, so it's a real jump." : "";
    return { direction: load > ts.weightKg ? "up" : "hold", load, reps: cur.lo, e1rm: e1rm(load, cur.lo),
      reason: `Reps drop to ${curRx.repRange} this week — go heavier. Aim ${fmt(load, implement)} × ${cur.lo}.${extra}` };
  }

  // 1b) New-block / HIGHER-rep-range bridge: the previous work was in a clearly
  //     lower rep range (e.g. Block 1's 3-5 test week → Block 2's 6-8). Re-base
  //     the load from the effort-adjusted e1RM at the new bottom rep — the same
  //     bridge as the heavier-week jump, pointed the other way. Never ABOVE the
  //     last working load (more reps can't mean more weight).
  if (prevR.hi < cur.lo) {
    const reserve = effortReserve(prevEx);
    const effE1 = e1rm(ts.weightKg, ts.reps + reserve);
    const target = effE1 / (1 + (cur.lo + 1) / 30);
    const load = roundLoad(Math.min(target, ts.weightKg), implement, location, equip);
    return { direction: load < ts.weightKg ? "down" : "hold", load, reps: cur.lo, e1rm: e1rm(load, cur.lo),
      reason: `Higher rep range this block (${curRx.repRange} vs ${prevRange}) — re-based off your estimated 1RM. Aim ${fmt(load, implement)} × ${cur.lo}.` };
  }

  // 2) Same range, all sets at the top → earn the load bump (bigger if you had
  //    reps to spare).
  if (allAtLeast(prevEx, cur.hi)) {
    if (atCeiling) return capResponse(ts, capNum, "topped", ts.rir === 0);
    if (ts.rir === 0) { // hit top reps but nothing left → hold and clean it up
      return { direction: "hold", load: roundLoad(ts.weightKg, implement, location, equip), reps: cur.hi,
        e1rm: prevE, reason: `You hit ${cur.hi}+ but with nothing left (RIR 0) — repeat it cleaner before adding load.` };
    }
    const reserve = effortReserve(prevEx);
    let load = nextLoadUp(ts.weightKg, implement, location, equip, lower);
    if (reserve >= 2) load = nextLoadUp(load, implement, location, equip, lower); // submaximal → double jump
    const extra = reserve >= 2 ? " (bigger jump — you had reps to spare)." : "";
    return { direction: "up", load, reps: cur.lo, e1rm: e1rm(load, cur.lo),
      reason: `You hit every set at ${cur.hi}+ reps last time — add load.${extra}` };
  }

  // 3) Same range, within it but not topped out → hold load, chase a rep.
  if (allAtLeast(prevEx, cur.lo)) {
    const reps = Math.min(cur.hi, ts.reps + 1);
    const load = roundLoad(ts.weightKg, implement, location, equip);
    return { direction: "hold", load, reps, e1rm: e1rm(load, reps),
      reason: `Same load — add a rep toward ${cur.hi}.` };
  }

  // 4) Missed the bottom of the range → hold (or back off if badly short).
  if (ts.reps <= cur.lo - 2) {
    const load = loadDown(ts.weightKg, implement, location, equip, lower);
    return { direction: "down", load, reps: cur.lo, e1rm: e1rm(load, cur.lo),
      reason: `Came up short last time — back off and rebuild the reps.` };
  }
  const load = roundLoad(ts.weightKg, implement, location, equip);
  return { direction: "hold", load, reps: cur.lo, e1rm: e1rm(load, cur.lo),
    reason: `Repeat the load and complete all ${curRx.repRange} reps.` };
}

// At the dumbbell ceiling, load can't go up — so progress the reps, then a set,
// then a slower tempo. This keeps a capped lift productive instead of prescribing
// an impossible load bump (or, worse, the same load for fewer reps). `mode` is
// "heavier" (the week wanted more load) or "topped" (you filled the rep range);
// `nothingLeft` = you hit the top with RIR 0, so hold-and-add-a-set rather than
// chase another rep right away.
function capResponse(ts, capNum, mode, nothingLeft) {
  const load = ts.weightKg;
  if (nothingLeft) {
    return { direction: "cap", load, reps: ts.reps, e1rm: e1rm(load, ts.reps), ceiling: true,
      reason: `At the ${capNum} kg/hand dumbbell ceiling with nothing left — hold and add a set or a slower tempo to keep progressing. Load can't go up here.` };
  }
  const reps = ts.reps + 1;
  const lead = mode === "heavier" ? "Heavier week, but you're" : "You're";
  return { direction: "cap", load, reps, e1rm: e1rm(load, reps), ceiling: true,
    reason: `${lead} at the ${capNum} kg/hand dumbbell ceiling — add a rep (aim ${reps}), then a set or a slow tempo. Load can't go up here.` };
}

// Stall detection over the last 3 occurrences (oldest→newest list of logged
// exercises). Stalled = no meaningful e1RM gain across the window. `ceiling` (the
// per-hand dumbbell max at this location, optional) suppresses the flag when the
// lift is pinned at the cap — that plateau is the equipment, not a training stall,
// and the recommendation already coaches reps/sets/tempo there.
export function detectStall(history, ceiling) {
  const occ = (history || []).slice(-3);
  if (occ.length < 3) return null;
  if (ceiling != null) {
    const t = topSet(occ[occ.length - 1]);
    if (t && t.weightKg >= ceiling - 1e-9) return null;
  }
  const es = occ.map((ex) => { const t = topSet(ex); return t ? e1rm(t.weightKg, t.reps) : 0; });
  if (es.some((x) => x === 0)) return null;
  const improved = es[2] > es[0] + 0.5;
  return improved ? null
    : { stalled: true, message: "No strength gain in 3 sessions — drop to the bottom of the range and add load, or check recovery." };
}

function fmt(load, implement) {
  if (load == null) return "—";
  const n = Number(load);
  const t = Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, "");
  return implement === "dumbbell_pair" ? `2×${t}kg` : `${t}kg`;
}

// --- warm-up ramp ---------------------------------------------------------
// Ramp sets before the working weight, from the day's target load and the kit
// that's actually there. Compounds get a real ramp (empty bar → ~60% → ~80%);
// accessories get a single primer when the load is heavy enough to need one.
// Returns [{weightKg, reps}] or null when no warm-up is worth doing.
export function warmupPlan({ load, implement, location, equip, role, timed }) {
  if (timed || load == null || !load || implement === "bodyweight") return null;
  equip = equip || {};
  const bar = implement === "barbell" ? (equip.barWeightKg || 20)
    : implement === "ez_bar" ? (equip.ezBarWeightKg || 7.5) : 0;
  const raw = [];
  if (role === "compound") {
    if (bar) {
      raw.push({ w: bar, reps: 10 });
      raw.push({ w: load * 0.6, reps: 5 });
      if (load >= bar * 2.4) raw.push({ w: load * 0.8, reps: 3 });
    } else {
      raw.push({ w: load * 0.5, reps: 8 });
      raw.push({ w: load * 0.75, reps: 5 });
    }
  } else {
    if (load < 15 && !bar) return null;               // light accessory: first set warms it up
    raw.push({ w: Math.max(bar, load * 0.6), reps: 8 });
  }
  const out = [];
  for (const s of raw) {
    const w = Math.max(bar, roundLoad(s.w, implement, location, equip) ?? 0);
    // skip steps that collapse into each other or crowd the working weight
    if (w >= load * 0.95 && w > bar) continue;
    if (out.length && Math.abs(out[out.length - 1].weightKg - w) < 0.01) continue;
    out.push({ weightKg: w, reps: s.reps });
  }
  return out.length ? out : null;
}

// --- in-session replanning --------------------------------------------------
// After a working set is logged, decide whether the REMAINING sets need a new
// prescription right now (Juggernaut-style) instead of waiting for next week:
// a hard miss drops the load a notch to keep the next sets inside the rep
// range; an easy overshoot (with reps in reserve) bumps them one step.
// Returns { direction:'down'|'up', load, reps, reason } or null.
export function replanSets({ set, rx, implement, location, equip, allowUp = true }) {
  const range = parseRange(rx && rx.repRange);
  if (!range || !set || set.reps == null || !set.weightKg) return null;
  const shortfall = range.lo - set.reps;
  if (shortfall >= 2 || (shortfall >= 1 && set.rir === 0)) {
    const load = loadDown(set.weightKg, implement, location, equip);
    if (load > 0 && load < set.weightKg) return { direction: "down", load, reps: range.lo,
      reason: `${set.reps} reps fell under the ${rx.repRange} range — next sets at ${fmt(load, implement)} to stay in range.` };
  }
  if (allowUp && set.reps >= range.hi + 2 && (set.rir == null || set.rir >= 2)) {
    const load = nextLoadUp(set.weightKg, implement, location, equip);
    if (load > set.weightKg) return { direction: "up", load, reps: range.hi,
      reason: `${set.reps} reps with room to spare — next sets up to ${fmt(load, implement)}.` };
  }
  return null;
}
