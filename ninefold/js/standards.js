// standards.js — strength benchmarking (pure, no DOM). Scores the big lifts
// against bodyweight-relative strength standards (the Caliber/strengthlevel
// pattern): e1RM ÷ bodyweight → position on a five-level ladder, blended into
// one 0-100 score plus a per-lift balance view.
//
// Ratios are age-uncorrected — a deliberate simplification. They are a
// yardstick, not a verdict.
//
// Sex matters here and nowhere else in the app. Absolute bodyweight-relative
// strength differs enough between male and female populations that applying one
// set of ratios to both would tell roughly half of all users something false
// about themselves. When sex is unknown we return null and the caller hides the
// card, rather than defaulting to male and quietly mis-scoring.

export const LEVELS = ["Beginner", "Novice", "Intermediate", "Advanced", "Elite"];

// e1RM as a multiple of bodyweight at each level boundary.
export const STANDARDS_BY_SEX = {
  male: {
    back_squat:    { label: "Squat",  ratios: [0.75, 1.25, 1.50, 2.00, 2.50] },
    bench_press:   { label: "Bench",  ratios: [0.50, 0.75, 1.00, 1.50, 2.00] },
    rdl_barbell:   { label: "RDL",    ratios: [0.85, 1.30, 1.70, 2.10, 2.50] },
    ohp_barbell:   { label: "Press",  ratios: [0.35, 0.55, 0.80, 1.10, 1.40] },
    bent_over_row: { label: "Row",    ratios: [0.50, 0.75, 1.00, 1.25, 1.50] },
  },
  female: {
    back_squat:    { label: "Squat",  ratios: [0.50, 0.85, 1.20, 1.60, 2.00] },
    bench_press:   { label: "Bench",  ratios: [0.30, 0.50, 0.70, 1.00, 1.35] },
    rdl_barbell:   { label: "RDL",    ratios: [0.55, 0.95, 1.35, 1.75, 2.10] },
    ohp_barbell:   { label: "Press",  ratios: [0.20, 0.35, 0.50, 0.70, 0.90] },
    bent_over_row: { label: "Row",    ratios: [0.30, 0.50, 0.70, 0.90, 1.15] },
  },
};

// Back-compat for any caller that hasn't been given a sex yet.
export const STANDARDS = STANDARDS_BY_SEX.male;

export const standardsFor = (sex) => STANDARDS_BY_SEX[sex] || null;

// Score one lift: 0-100 where each level boundary sits at 20/40/60/80/100,
// interpolated between boundaries (and below the first one).
export function liftScore(e1, bodyweightKg, ratios) {
  if (!e1 || !bodyweightKg) return null;
  const r = e1 / bodyweightKg;
  let score;
  if (r <= ratios[0]) score = (r / ratios[0]) * 20;
  else if (r >= ratios[4]) score = 100;
  else {
    let i = 0; while (r >= ratios[i + 1]) i++;
    score = 20 * (i + 1) + 20 * ((r - ratios[i]) / (ratios[i + 1] - ratios[i]));
  }
  const passed = ratios.filter((x) => r >= x).length;
  const level = passed === 0 ? "Developing" : LEVELS[passed - 1];
  const next = passed < 5
    ? { level: LEVELS[passed], kg: Math.round(ratios[passed] * bodyweightKg * 2) / 2 }
    : null;
  return { score: Math.round(score), ratio: r, level, next };
}

// Overall benchmark from the best recent e1RM per lift ({exerciseId: e1RM}).
// Only lifts with data count; overall = mean of their scores.
// Returns null when sex is unknown — the benchmark is meaningless without it.
export function strengthScore(bestByLift, bodyweightKg, sex) {
  const table = standardsFor(sex);
  if (!table) return null;
  const lifts = [];
  for (const [id, std] of Object.entries(table)) {
    const e1 = bestByLift[id];
    const s = liftScore(e1, bodyweightKg, std.ratios);
    if (s) lifts.push({ id, label: std.label, e1, ...s,
      levelsKg: std.ratios.map((r) => Math.round(r * bodyweightKg)) });   // kg where each level starts
  }
  if (!lifts.length) return null;
  const overall = Math.round(lifts.reduce((a, l) => a + l.score, 0) / lifts.length);
  const level = overall < 20 ? "Developing" : LEVELS[Math.min(4, Math.floor(overall / 20) - 1)];
  return { overall, level, lifts };
}
