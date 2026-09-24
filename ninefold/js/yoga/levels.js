// yoga/levels.js — the three experience levels, and what each one changes.
//
// A LEVEL CHANGES TWO THINGS, AND THE SECOND MATTERS MORE.
//
//   1. WHICH POSES are eligible. A beginner is not offered crow or headstand.
//   2. HOW THE TEACHER TALKS. This is the part that actually makes a practice
//      feel like it was made for you, and it is not a difficulty setting.
//
// The teaching literature is unanimous on the second point: what separates
// beginner cueing from advanced cueing is LANGUAGE, not intensity. Beginners get
// plain words and no Sanskrit jargon — "gently engage your pelvic floor", never
// "activate mula bandha" — and a hard ceiling of one or two cues per pose,
// because comprehension runs out before the pose does. Experienced practitioners
// can hold three, and want the refinement and the bind rather than the basics
// they already know. So `cueBudget` below is a real constraint on the script,
// not a hint.
//
// The levels are also deliberately NOT a hierarchy of worth. "Beginner" gets the
// most spoken guidance, not the least.
//
// NO LEVEL SPEAKS SANSKRIT. It is shown on screen, correctly spelled, and never
// said aloud — the speech engine mangles it badly enough to teach the wrong
// sound. See the naming note in script.js.

export const LEVELS = {
  beginner: {
    id: "beginner",
    rank: 1,
    label: "Beginner",
    blurb: "New to yoga, or coming back to it. Everything explained, nothing assumed.",
    // Pose eligibility: only the accessible shapes.
    maxPoseLevel: 1,
    // How many alignment cues the narration may stack on one pose.
    cueBudget: 2,
    // How many of the FOUNDATIONAL cues to skip. Cues are authored ground-up, so
    // skipping from the front is skipping "ground the standing foot" — which an
    // experienced practitioner does not need said and a beginner absolutely does.
    // This is the real difference between advanced and expert: the expert gets a
    // LEANER read, not an extra sentence. Experienced students want refinement,
    // not the basics they already have.
    cueSkip: 0,
    // Always offer the way IN. Never open with the way deeper.
    offerEasier: true,
    offerDeeper: false,
    // More time to arrive in a shape you have not made before.
    transitionScale: 1.35,
    // Holds a little shorter — a first pigeon does not want five minutes.
    holdScale: 0.85,
  },
  advanced: {
    id: "advanced",
    rank: 2,
    label: "Advanced",
    blurb: "You know the shapes and the vocabulary. Cues refine rather than explain.",
    maxPoseLevel: 2,
    cueBudget: 3,
    cueSkip: 0,
    offerEasier: true,
    offerDeeper: true,
    transitionScale: 1,
    holdScale: 1,
  },
  expert: {
    id: "expert",
    rank: 3,
    label: "Expert",
    blurb: "Long holds, binds and the harder variations. Spoken guidance stays out of the way.",
    maxPoseLevel: 3,
    cueBudget: 2,
    // Skips the foundational cue. An expert being told to ground the standing
    // foot is being talked at, not taught.
    cueSkip: 1,
    // An expert still gets the way out offered — that is a safety affordance,
    // not a beginner's crutch, and the one thing a home practitioner cannot ask
    // for is permission to come out.
    offerEasier: true,
    offerDeeper: true,
    transitionScale: 0.8,
    holdScale: 1.2,
  },
};

export const LEVEL_KEYS = ["beginner", "advanced", "expert"];
export const DEFAULT_LEVEL = "advanced";
export const levelById = (id) => LEVELS[id] || LEVELS[DEFAULT_LEVEL];

/**
 * The numeric pose ceiling the generator has always used (1 accessible ·
 * 2 intermediate · 3 advanced). Kept as a separate concept from the level's own
 * rank so the two can drift apart without one silently redefining the other.
 */
export const poseCeiling = (id) => levelById(id).maxPoseLevel;

/** Accepts a level id, or the legacy 1/2/3 the first version stored. */
export function normaliseLevel(v) {
  if (typeof v === "string" && LEVELS[v]) return v;
  if (v === 1) return "beginner";
  if (v === 2) return "advanced";
  if (v === 3) return "expert";
  return DEFAULT_LEVEL;
}

export function checkLevels() {
  const problems = [];
  for (const k of LEVEL_KEYS) {
    const l = LEVELS[k];
    if (!l) { problems.push(`missing level "${k}"`); continue; }
    if (l.maxPoseLevel < 1 || l.maxPoseLevel > 3) problems.push(`${k}: maxPoseLevel out of range`);
    if (l.cueBudget < 1 || l.cueBudget > 3) problems.push(`${k}: cueBudget ${l.cueBudget} outside the 1-3 a person can actually hold`);
    if (!l.offerEasier) problems.push(`${k}: every level must be offered the way out`);
    if (!l.label || !l.blurb) problems.push(`${k}: needs a label and a blurb`);
  }
  if (LEVELS.beginner.cueBudget > LEVELS.advanced.cueBudget)
    problems.push("a beginner must not be given MORE cues to hold than an advanced practitioner");
  for (const k of LEVEL_KEYS) if (LEVELS[k].speakSanskrit)
    problems.push(`${k}: nothing speaks Sanskrit — see the naming note in script.js`);
  if (LEVELS.beginner.cueSkip > 0) problems.push("a beginner must never have the foundational cue skipped");
  if (LEVELS.expert.cueSkip < 1) problems.push("expert should skip the foundational cue, or it reads identically to advanced");
  return problems;
}
