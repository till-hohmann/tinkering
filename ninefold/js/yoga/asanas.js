// yoga/asanas.js — the catalogue of postures the flow generator can choose from.
// Pure data, the same job exercise-library.js does for the lifting side.
//
// WHY THIS IS NOT PART OF exercise-library.js. A lift is chosen by PATTERN and
// balanced by muscle volume; an asana is chosen by its place in an ARC and
// balanced by whether its counter-pose follows it. The two catalogues answer
// different questions, so merging them would mean every field being null for
// half the rows. They share nothing but the idea of "a thing you do".
//
// >>> This is general fitness content, not medical advice. Yoga's two documented
// >>> injury sites are the knee (hyperflexion plus rotation — lotus, pigeon) and
// >>> the sacroiliac joint (asymmetric and flexion/abduction/external-rotation
// >>> shapes). Both are handled by the `avoid` flags below, which the generator
// >>> treats as a first-class input rather than a later filter.
//
// THE `avoid` VOCABULARY IS DELIBERATELY GENERIC. The public build must carry no
// one's diagnosis, so a pose declares which SITE it stresses and the profile
// carries which sites a given person is protecting. Nothing here knows about any
// individual.

/** Body sites a pose can stress. A profile ticks the ones it is protecting. */
export const LIMITATIONS = {
  knees:      { label: "Knees", note: "Skips deep knee flexion with rotation — lotus, hero, full pigeon." },
  low_back:   { label: "Low back", note: "Skips deep backbends and loaded spinal flexion." },
  si_joint:   { label: "SI joint / pelvis", note: "Skips asymmetric wide-legged and open-hip shapes." },
  wrists:     { label: "Wrists", note: "Skips weight-bearing on the hands." },
  neck:       { label: "Neck", note: "Skips shoulderstand, plough and headstand." },
  shoulders:  { label: "Shoulders", note: "Skips binds and full overhead loading." },
  inversions: { label: "Inversions", note: "Skips going head-below-heart." },
};
export const LIMITATION_KEYS = Object.keys(LIMITATIONS);

/**
 * Families. The generator balances a sequence across these the way the block
 * builder balances across movement patterns.
 */
export const FAMILIES = {
  breath:       { name: "Breath / centering", floor: true },
  standing:     { name: "Standing" },
  balance:      { name: "Balance" },
  backbend:     { name: "Backbend" },
  forward_fold: { name: "Forward fold" },
  twist:        { name: "Twist" },
  hip_opener:   { name: "Hip opener" },
  inversion:    { name: "Inversion" },
  core:         { name: "Core / arm balance" },
  seated:       { name: "Seated / neutral", floor: true },
  supine:       { name: "Supine / reclined", floor: true },
  restorative:  { name: "Restorative", floor: true },
};

/**
 * The default counter for each family — what has to FOLLOW a pose of that family
 * to leave the body neutral. The generator prefers a pose's own declared
 * `counters`; this is the fallback, and quality.js grades against it.
 */
export const COUNTER_FAMILY = {
  backbend: ["forward_fold", "twist", "supine"],
  forward_fold: ["backbend", "seated"],
  twist: ["seated", "supine", "forward_fold"],
  inversion: ["supine", "restorative", "seated"],
  core: ["forward_fold", "supine", "restorative"],
  hip_opener: ["supine", "seated", "forward_fold"],
  balance: ["standing", "forward_fold", "seated"],
  standing: ["forward_fold", "standing"],
};

/**
 * Arc phases a pose can occupy. This is the single most important field: the arc
 * is a hard dependency, not a preference, and a pose that can only be a peak must
 * never turn up in the warm-up.
 */
export const PHASES = ["centering", "warmup", "build", "peak", "counter", "cool", "savasana",
  // "series" is not an arc phase. It marks a posture that exists only because a
  // FIXED series names it, so the generator never picks it: no composed sequence
  // asks for "peak" and gets a bound-lotus marichyasana.
  "series"];

// Sensible phase defaults by family, so most entries don't have to spell it out.
const DEFAULT_PHASES = {
  breath: ["centering", "savasana"],
  standing: ["build"],
  balance: ["build", "peak"],
  backbend: ["build", "peak"],
  forward_fold: ["warmup", "build", "counter", "cool"],
  twist: ["build", "counter", "cool"],
  hip_opener: ["build", "cool"],
  inversion: ["peak", "cool"],
  core: ["build", "peak"],
  seated: ["warmup", "counter", "cool"],
  supine: ["warmup", "counter", "cool"],
  restorative: ["cool", "savasana"],
};

/**
 * `intensity` is a 1-5 band, anchored to the measured energy cost of yoga rather
 * than to how hard a pose looks. The systematic review puts full sessions at
 * 3.3 METs and individual asanas at 2.2, with Surya Namaskar the lone outlier at
 * 7.4 — so 5 here means "as vigorous as yoga gets", which is still well under a
 * Zone 2 run. Nothing in this file is a cardio substitute and the app never
 * offers it as one.
 */
export const INTENSITY_METS = { 1: 2.0, 2: 2.4, 3: 3.0, 4: 4.2, 5: 7.0 };

/**
 * How many specific preparatory poses a peak needs, by how complex it is. The
 * teaching convention is 3-4 for something like triangle and 6-8 for a wheel.
 *
 * It lives HERE rather than in quality.js because it is a claim about the poses,
 * not about a sequence: a peak that does not declare enough preparation cannot be
 * prepared by any generator, so checkAsanas() enforces it and a half-added peak
 * fails the test suite instead of producing an unpreparable flow at runtime.
 */
export const PREP_MIN = { 1: 3, 2: 5, 3: 6 };

const A = (id, name, sanskrit, family, opts = {}) => ({
  id, name, sanskrit, family,
  intensity: opts.intensity == null ? 2 : opts.intensity,
  level: opts.level || 1,                       // 1 accessible · 2 intermediate · 3 advanced
  bilateral: !!opts.bi,                          // asymmetric — must run both sides
  flow: !!opts.flow,                             // can be linked one breath, one movement
  // Movement on a clock rather than a hold. Cat/cow is not a shape you fail to
  // maintain, so the style's hold band does not apply to it and the QC pass does
  // not judge it as one.
  dynamic: !!opts.dynamic,
  hold: opts.hold == null ? null : opts.hold,    // default breaths; null = the style decides
  peak: opts.peak || 0,                          // 0 never a peak · 1-3 how much prep it needs
  phases: opts.phases || DEFAULT_PHASES[family] || ["build"],
  preps: opts.preps || [],                       // poses that prepare THIS pose
  counters: opts.counters || [],                 // poses that neutralise it
  props: opts.props || [],
  avoid: opts.avoid || [],
  easier: opts.easier || "",                     // the modification, always offered
  cue: opts.cue || "",
  art: opts.art || id,
  // Cheruka 2023 segmented vinyasa into seven sequences and found integration and
  // restorative significantly lower in heart rate than the rest — a ready-made
  // intensity taxonomy, so the generator uses it rather than inventing one.
  segment: opts.segment || null,
  // ARE YOU ON YOUR FEET OR ON THE FLOOR?
  //
  // This exists because the first generated flows were exhausting to read: tree,
  // then cobra, then wide-legged fold, then plank, then warrior II. Every one of
  // those poses was individually reasonable and the sequence was nonsense,
  // because standing up and lying down twelve times is not a practice — real
  // sequences work through the standing poses and then go to the floor and stay
  // there. The family alone cannot say: "forward fold" covers both uttanasana
  // and paschimottanasana, which are as far apart as two poses get.
  plane: opts.plane || (["standing", "balance"].includes(family) ? "standing" : "floor"),
  // A LINK, NOT A DESTINATION. Half lift and upward salute exist to get you into
  // the next shape; they are not poses anyone holds. That never mattered while
  // the styles counted in breaths — three breaths in a half lift is exactly what
  // it is — but a long-hold style asked for four minutes of it, which is not a
  // pose, it is a mistake with a timer on it.
  transitional: !!opts.transitional,
});

export const ASANAS = [
  // ---------------------------------------------------------------- centering
  A("centering", "Seated centering", "Sukhasana", "breath",
    { intensity: 1, hold: 10, segment: "integration", art: "sukhasana",
      cue: "Sit tall, eyes soft. Let the breath get long before anything moves.",
      easier: "Sit on a folded blanket, or against a wall." }),
  A("ujjayi", "Ocean breath", "Ujjayi pranayama", "breath",
    { intensity: 1, hold: 10, segment: "integration", art: "sukhasana",
      cue: "Narrow the throat slightly so the breath is audible. This is the pace for the whole practice.",
      easier: "Just breathe through the nose, evenly. The sound is optional." }),
  A("balasana_open", "Child's pose", "Balasana", "restorative",
    { intensity: 1, hold: 8, segment: "integration", avoid: ["knees"], art: "balasana",
      phases: ["centering", "warmup", "counter", "cool"],
      cue: "Knees wide, big toes touching, forehead down. Breathe into the back ribs.",
      easier: "A blanket behind the knees, or a bolster under the chest.",
      props: ["bolster", "blanket"] }),
  A("cat_cow", "Cat / cow", "Marjaryasana Bitilasana", "seated",
    { intensity: 2, hold: 8, flow: true, dynamic: true, segment: "integration", avoid: ["wrists"],
      phases: ["warmup"],
      cue: "Inhale the chest forward, exhale round the back. Move at the speed of the breath.",
      easier: "On forearms if the wrists complain." }),
  A("thread_needle", "Thread the needle", "Parsva Balasana", "twist",
    { intensity: 2, hold: 6, bi: true, segment: "integration", phases: ["warmup", "cool"],
      cue: "Slide one arm under the other, shoulder and temple to the mat.",
      easier: "Keep the top hand on the floor for support." }),

  // ------------------------------------------------------- sun salutation A/B
  A("tadasana", "Mountain", "Tadasana", "standing",
    { intensity: 1, hold: 5, flow: true, segment: "integration", art: "tadasana",
      phases: ["centering", "warmup", "build", "cool"],
      cue: "Feet grounded, crown tall, arms heavy. This is the reset between everything.",
      counters: [] }),
  A("urdhva_hastasana", "Upward salute", "Urdhva Hastasana", "standing",
    { intensity: 2, transitional: true, hold: 1, flow: true, segment: "sun_salutation", avoid: ["shoulders"],
      phases: ["warmup", "build"],
      cue: "Inhale, sweep the arms up. Ribs stay knitted.",
      easier: "Arms shoulder-width instead of overhead." }),
  A("uttanasana", "Standing forward fold", "Uttanasana", "forward_fold",
    { intensity: 2, plane: "standing", hold: 5, flow: true, segment: "sun_salutation", avoid: ["low_back"],
      cue: "Exhale, fold from the hips. Soften the knees — length beats straightness.",
      easier: "Bend the knees generously, or hands to blocks.", props: ["block"] }),
  A("ardha_uttanasana", "Half lift", "Ardha Uttanasana", "forward_fold",
    { intensity: 2, transitional: true, plane: "standing", hold: 1, flow: true, segment: "sun_salutation",
      phases: ["warmup", "build"],
      cue: "Inhale, fingertips to shins, chest forward, back flat.",
      easier: "Hands on the thighs." }),
  A("phalakasana", "Plank", "Phalakasana", "core",
    { intensity: 3, hold: 5, flow: true, segment: "sun_salutation", avoid: ["wrists"],
      cue: "One line from crown to heels. Push the floor away.",
      easier: "Knees down, or forearms instead of hands.",
      counters: ["balasana_open"] }),
  A("chaturanga", "Four-limbed staff", "Chaturanga Dandasana", "core",
    { intensity: 4, level: 2, hold: 1, flow: true, segment: "sun_salutation",
      avoid: ["wrists", "shoulders"],
      cue: "Elbows back and in, stop at shoulder height. Lower with control.",
      easier: "Knees down, or skip straight to the belly.",
      counters: ["balasana_open"] }),
  A("ashtanga_namaskara", "Knees, chest, chin", "Ashtanga Namaskara", "core",
    { intensity: 2, hold: 1, flow: true, segment: "sun_salutation", avoid: ["wrists"],
      cue: "Knees down, chest and chin to the mat, hips stay high.",
      easier: "This IS the easier chaturanga — take it any time." }),
  A("urdhva_mukha", "Upward-facing dog", "Urdhva Mukha Svanasana", "backbend",
    { intensity: 3, level: 2, hold: 3, flow: true, segment: "sun_salutation",
      avoid: ["low_back", "wrists", "shoulders"],
      cue: "Thighs off the mat, shoulders over wrists, chest through the arms.",
      easier: "Cobra instead — thighs stay down, less to hold up.",
      counters: ["adho_mukha", "balasana_open"] }),
  A("adho_mukha", "Downward-facing dog", "Adho Mukha Svanasana", "inversion",
    { intensity: 3, hold: 5, flow: true, segment: "sun_salutation",
      avoid: ["wrists", "shoulders"], phases: ["warmup", "build", "counter", "cool"],
      cue: "Hips high and back, heels heavy. Bend the knees as much as you need.",
      easier: "Knees bent, or forearms down for dolphin.",
      counters: ["balasana_open"] }),
  A("utkatasana", "Chair", "Utkatasana", "standing",
    { intensity: 3, hold: 5, flow: true, segment: "sun_salutation", avoid: ["knees"],
      cue: "Sit back over the heels, weight out of the toes, arms alongside the ears.",
      easier: "Sit less deeply, hands to the heart." }),
  A("anjaneyasana", "Low lunge", "Anjaneyasana", "hip_opener",
    { intensity: 3, plane: "standing", hold: 5, bi: true, flow: true, segment: "crescent_lunge",
      avoid: ["knees"], phases: ["warmup", "build"],
      cue: "Back knee down, hips sink forward, front knee over the ankle.",
      easier: "A blanket under the back knee. Hands on blocks either side.",
      props: ["blanket", "block"],
      counters: ["adho_mukha", "uttanasana"] }),
  A("high_lunge", "High lunge", "Ashta Chandrasana", "standing",
    { intensity: 3, hold: 5, bi: true, flow: true, segment: "crescent_lunge",
      cue: "Back heel lifted, hips square forward, arms up.",
      easier: "Shorten the stance, hands to the hips." }),

  // ------------------------------------------------------------ standing work
  A("virabhadrasana_1", "Warrior I", "Virabhadrasana I", "standing",
    { intensity: 3, hold: 5, bi: true, segment: "standing", avoid: ["si_joint", "shoulders"],
      cue: "Back foot at 45°, hips forward, front knee over the ankle, arms up.",
      easier: "Widen the stance side to side — squaring the hips is easier with room.",
      preps: ["anjaneyasana", "adho_mukha"],
      counters: ["uttanasana", "adho_mukha"] }),
  A("virabhadrasana_2", "Warrior II", "Virabhadrasana II", "standing",
    { intensity: 3, hold: 5, bi: true, segment: "standing", avoid: ["knees"],
      cue: "Hips open to the side, front knee tracking the middle toe, gaze past the front hand.",
      easier: "Bend the front knee less.",
      counters: ["uttanasana", "tadasana"] }),
  A("viparita_virabhadrasana", "Reverse warrior", "Viparita Virabhadrasana", "standing",
    { intensity: 3, hold: 4, bi: true, segment: "standing", avoid: ["low_back"],
      cue: "Front arm up and back, back hand light on the thigh. Side body long, not crunched.",
      easier: "Reach up rather than back." }),
  A("utthita_parsvakonasana", "Extended side angle", "Utthita Parsvakonasana", "standing",
    { intensity: 3, hold: 5, bi: true, segment: "standing", avoid: ["knees", "si_joint"],
      cue: "Forearm to the thigh or hand to a block, top arm over the ear.",
      easier: "Forearm on the front thigh instead of the hand to the floor.",
      props: ["block"] }),
  A("utthita_trikonasana", "Triangle", "Utthita Trikonasana", "standing",
    { intensity: 3, hold: 5, bi: true, segment: "standing", avoid: ["si_joint", "neck"],
      cue: "Reach long over the front leg first, then lower. Both sides of the waist stay long.",
      easier: "Hand to a block or the shin, gaze forward instead of up.",
      props: ["block"],
      preps: ["virabhadrasana_2", "uttanasana"],
      counters: ["uttanasana", "tadasana"] }),
  A("parivrtta_trikonasana", "Revolved triangle", "Parivrtta Trikonasana", "twist",
    { intensity: 4, plane: "standing", level: 2, hold: 5, bi: true, peak: 1, segment: "standing",
      avoid: ["si_joint", "low_back"], phases: ["build", "peak"],
      cue: "Hips level and square, then rotate from the ribs. Short stance beats a deep one.",
      easier: "Hand to a block outside the front foot, back heel lifted.",
      props: ["block"],
      preps: ["parsvottanasana", "anjaneyasana", "utthita_trikonasana", "parivrtta_anjaneyasana"],
      counters: ["uttanasana", "adho_mukha", "balasana_open"] }),
  A("parivrtta_parsvakonasana", "Revolved side angle", "Parivrtta Parsvakonasana", "twist",
    { intensity: 4, plane: "standing", level: 2, hold: 5, bi: true, peak: 1, segment: "standing",
      avoid: ["si_joint", "knees", "low_back"], phases: ["build", "peak"],
      cue: "Elbow outside the front knee, palms together, press to deepen.",
      easier: "Back knee down and hand to the floor instead of the bind.",
      preps: ["anjaneyasana", "parivrtta_anjaneyasana", "high_lunge"],
      counters: ["adho_mukha", "balasana_open"] }),
  A("parivrtta_anjaneyasana", "Revolved low lunge", "Parivrtta Anjaneyasana", "twist",
    { intensity: 3, plane: "standing", hold: 5, bi: true, segment: "crescent_lunge", avoid: ["si_joint", "knees"],
      cue: "Back knee down, hand to the floor, other arm opens up.",
      easier: "Keep both hands down and just turn the chest.",
      props: ["blanket"] }),
  A("parsvottanasana", "Pyramid", "Parsvottanasana", "forward_fold",
    { intensity: 3, plane: "standing", hold: 5, bi: true, segment: "standing", avoid: ["si_joint", "low_back"],
      phases: ["build"],
      cue: "Hips square, front leg long, fold over it with a flat back.",
      easier: "Hands to blocks, front knee softly bent.", props: ["block"] }),
  A("prasarita_a", "Wide-legged forward fold", "Prasarita Padottanasana A", "forward_fold",
    { intensity: 3, plane: "standing", hold: 5, segment: "standing", avoid: ["low_back"], phases: ["build", "cool"],
      cue: "Feet parallel and wide, hinge from the hips, crown toward the mat.",
      easier: "Hands to blocks. Bend the knees.", props: ["block"] }),
  A("prasarita_c", "Wide-legged fold, clasped", "Prasarita Padottanasana C", "forward_fold",
    { intensity: 3, plane: "standing", level: 2, hold: 5, segment: "standing", avoid: ["low_back", "shoulders"],
      phases: ["build"],
      cue: "Hands clasped behind, arms travel overhead as you fold.",
      easier: "Hold a strap between the hands instead of clasping.", props: ["strap"] }),
  A("utkata_konasana", "Goddess", "Utkata Konasana", "standing",
    { intensity: 3, hold: 5, segment: "standing", avoid: ["knees"],
      cue: "Toes out, knees track the toes, sink until the thighs work.",
      easier: "Sink halfway." }),
  A("malasana", "Garland squat", "Malasana", "hip_opener",
    { intensity: 2, plane: "standing", hold: 6, segment: "standing", avoid: ["knees"], phases: ["build", "cool"],
      cue: "Feet a little wider than the hips, elbows inside the knees, chest tall.",
      easier: "Sit on a block. Heels on a rolled blanket.", props: ["block", "blanket"] }),
  A("padangusthasana", "Big toe pose", "Padangusthasana", "forward_fold",
    { intensity: 2, plane: "standing", hold: 5, segment: "standing", avoid: ["low_back"], phases: ["build"],
      cue: "Feet hip-width, take hold of the big toes, lengthen then fold.",
      easier: "Hold the ankles or a strap.", props: ["strap"], art: "uttanasana" }),
  A("padahastasana", "Hand-under-foot", "Padahastasana", "forward_fold",
    { intensity: 2, plane: "standing", hold: 5, segment: "standing", avoid: ["low_back", "wrists"], phases: ["build"],
      cue: "Slide the palms under the feet, toes to the wrist creases.",
      easier: "Hands to the shins instead.", art: "uttanasana" }),

  // ------------------------------------------------------------------ balance
  A("vrksasana", "Tree", "Vrksasana", "balance",
    { intensity: 2, hold: 6, bi: true, segment: "balancing", avoid: ["knees"],
      cue: "Sole to the calf or the inner thigh — never the side of the knee.",
      easier: "Toes stay on the floor, heel to the ankle. A wall behind you.",
      props: ["wall"],
      counters: ["tadasana", "uttanasana"] }),
  A("garudasana", "Eagle", "Garudasana", "balance",
    { intensity: 3, hold: 5, bi: true, segment: "balancing", avoid: ["knees", "shoulders"],
      cue: "Cross the thighs, then the arms. Sit down as you wrap.",
      easier: "Toe of the top foot to the floor as a kickstand; hands to opposite shoulders." }),
  A("utthita_hasta_padangusthasana", "Extended hand-to-big-toe", "Utthita Hasta Padangusthasana", "balance",
    { intensity: 4, plane: "standing", level: 2, hold: 5, bi: true, peak: 1, segment: "balancing",
      avoid: ["si_joint", "low_back"], phases: ["build", "peak"],
      cue: "Lift the knee first, then extend as far as the standing hip stays level.",
      easier: "Strap around the foot, or just hold the knee.", props: ["strap", "wall"],
      preps: ["vrksasana", "supta_padangusthasana", "uttanasana"],
      counters: ["tadasana", "uttanasana"] }),
  A("virabhadrasana_3", "Warrior III", "Virabhadrasana III", "balance",
    { intensity: 4, level: 2, hold: 5, bi: true, peak: 1, segment: "balancing",
      avoid: ["si_joint", "low_back"], phases: ["build", "peak"],
      cue: "Hips level, back leg strong and parallel to the floor, crown reaching forward.",
      easier: "Hands to blocks or a wall, back toes on the floor.", props: ["block", "wall"],
      preps: ["high_lunge", "vrksasana", "adho_mukha"],
      counters: ["uttanasana", "tadasana"] }),
  A("ardha_chandrasana", "Half moon", "Ardha Chandrasana", "balance",
    { intensity: 4, level: 2, hold: 5, bi: true, peak: 1, segment: "balancing",
      avoid: ["si_joint", "neck"], phases: ["build", "peak"],
      cue: "Bottom hand a foot ahead of the standing toes; stack the top hip.",
      easier: "Bottom hand on a block, back to a wall, gaze down.", props: ["block", "wall"],
      preps: ["utthita_trikonasana", "virabhadrasana_2", "vrksasana"],
      counters: ["uttanasana", "tadasana"] }),
  A("natarajasana", "Dancer", "Natarajasana", "balance",
    { intensity: 4, level: 3, hold: 5, bi: true, peak: 2, segment: "balancing",
      avoid: ["low_back", "knees", "shoulders"], phases: ["peak"],
      cue: "Press the lifted foot into the hand, chest lifts as the leg goes back.",
      easier: "Strap around the foot. Hold a wall with the free hand.", props: ["strap", "wall"],
      preps: ["anjaneyasana", "vrksasana", "bhujangasana", "setu_bandha", "high_lunge",
        "urdhva_hastasana", "virabhadrasana_1"],
      counters: ["uttanasana", "balasana_open"] }),

  // ---------------------------------------------------------------- backbends
  A("bhujangasana", "Cobra", "Bhujangasana", "backbend",
    { intensity: 2, hold: 5, segment: "back_bending", avoid: ["low_back", "wrists"],
      phases: ["warmup", "build"],
      cue: "Hands under the shoulders, elbows in, lift with the back before the arms.",
      easier: "Baby cobra — barely leave the floor. That is the whole pose.",
      counters: ["balasana_open", "adho_mukha"] }),
  A("salamba_bhujangasana", "Sphinx", "Salamba Bhujangasana", "backbend",
    { intensity: 2, hold: 8, segment: "back_bending", avoid: ["low_back"],
      phases: ["warmup", "build", "cool"],
      cue: "Forearms down, elbows under the shoulders. Soft, long-held backbend.",
      easier: "Slide the elbows further forward.",
      counters: ["balasana_open"] }),
  A("salabhasana", "Locust", "Salabhasana", "backbend",
    { intensity: 3, hold: 5, segment: "back_bending", avoid: ["low_back", "neck"],
      cue: "Lift chest, arms and legs. Look at the floor, not forward.",
      easier: "Lift the upper body only, or one leg at a time.",
      counters: ["balasana_open"] }),
  A("dhanurasana", "Bow", "Dhanurasana", "backbend",
    { intensity: 4, level: 2, hold: 5, peak: 1, segment: "back_bending",
      avoid: ["low_back", "shoulders", "knees"], phases: ["build", "peak"],
      cue: "Hold the ankles, kick INTO the hands — the kick does the lifting.",
      easier: "One side at a time (half bow), or a strap around the ankles.", props: ["strap"],
      preps: ["bhujangasana", "salabhasana", "anjaneyasana", "setu_bandha"],
      counters: ["balasana_open", "supta_matsyendrasana"] }),
  A("ustrasana", "Camel", "Ustrasana", "backbend",
    { intensity: 4, level: 2, hold: 5, peak: 1, segment: "back_bending",
      avoid: ["low_back", "neck", "knees"], phases: ["build", "peak"],
      cue: "Hips over the knees the whole time. Chest lifts first, head goes last.",
      easier: "Hands on the low back, or blocks beside the ankles. Keep the chin down.",
      props: ["block", "blanket"],
      preps: ["anjaneyasana", "setu_bandha", "bhujangasana", "salabhasana"],
      counters: ["balasana_open", "supta_matsyendrasana"] }),
  A("setu_bandha", "Bridge", "Setu Bandha Sarvangasana", "backbend",
    { intensity: 2, hold: 6, segment: "back_bending", avoid: ["neck"],
      phases: ["warmup", "build", "counter", "cool"],
      cue: "Feet hip-width, press down to lift the hips. Never turn the head once you are up.",
      easier: "A block under the sacrum and simply rest there.", props: ["block"],
      counters: ["ananda_balasana", "supta_matsyendrasana"] }),
  A("urdhva_dhanurasana", "Wheel", "Urdhva Dhanurasana", "backbend",
    { intensity: 5, level: 3, hold: 5, peak: 3, segment: "back_bending",
      avoid: ["low_back", "wrists", "shoulders", "neck"], phases: ["peak"],
      cue: "Hands by the ears, elbows in. Press the hips up before the head leaves the mat.",
      easier: "Bridge instead, or come up onto the crown and stop there.",
      preps: ["setu_bandha", "bhujangasana", "anjaneyasana", "ustrasana", "dhanurasana", "adho_mukha"],
      counters: ["ananda_balasana", "supta_matsyendrasana", "paschimottanasana"] }),
  A("anahatasana", "Melting heart", "Anahatasana", "backbend",
    { intensity: 1, hold: 10, segment: "back_bending", avoid: ["shoulders", "knees"],
      phases: ["warmup", "cool"],
      cue: "Hips over the knees, chest melts toward the mat, arms long.",
      easier: "A bolster under the chest. Forearms down.", props: ["bolster"] }),
  A("matsyasana", "Fish", "Matsyasana", "backbend",
    { intensity: 2, level: 2, hold: 6, segment: "back_bending", avoid: ["neck", "low_back"],
      phases: ["counter", "cool"],
      cue: "Forearms under the hips, chest lifts, crown lightly down. Weight stays in the elbows.",
      easier: "A block lengthwise under the shoulder blades and rest.", props: ["block", "bolster"],
      counters: ["balasana_open", "ananda_balasana"] }),

  // ------------------------------------------------------------ forward folds
  A("dandasana", "Staff", "Dandasana", "seated",
    { intensity: 1, hold: 5, phases: ["warmup", "counter", "cool"],
      cue: "Legs long, hands beside the hips, spine stacked. The seated mountain.",
      easier: "Sit on a folded blanket, knees softly bent.", props: ["blanket"] }),
  A("paschimottanasana", "Seated forward fold", "Paschimottanasana", "forward_fold",
    { intensity: 2, hold: 8, avoid: ["low_back"], phases: ["build", "counter", "cool"],
      cue: "Lengthen forward over the legs rather than down toward them.",
      easier: "Strap around the feet, knees bent, sit on a blanket.", props: ["strap", "blanket"],
      counters: ["setu_bandha", "purvottanasana"] }),
  A("janu_sirsasana", "Head-to-knee", "Janu Sirsasana", "forward_fold",
    { intensity: 2, hold: 8, bi: true, avoid: ["knees"], phases: ["build", "cool"],
      cue: "One sole to the inner thigh, turn the chest over the long leg, then fold.",
      easier: "A block under the bent knee, strap around the foot.", props: ["block", "strap"] }),
  A("upavistha_konasana", "Wide-legged seated fold", "Upavistha Konasana", "forward_fold",
    { intensity: 2, hold: 8, avoid: ["low_back"], phases: ["build", "cool"],
      cue: "Legs wide, kneecaps up, walk the hands forward with a long spine.",
      easier: "Sit up on a blanket and stay upright — that is already the pose.", props: ["blanket"] }),
  A("purvottanasana", "Upward plank", "Purvottanasana", "backbend",
    { intensity: 3, level: 2, hold: 5, avoid: ["wrists", "shoulders", "neck"],
      phases: ["build", "counter"],
      cue: "Hands behind, fingers forward, lift the hips and open the chest.",
      easier: "Reverse tabletop — knees bent, feet flat.",
      counters: ["paschimottanasana", "balasana_open"] }),

  // ------------------------------------------------------------------- twists
  A("ardha_matsyendrasana", "Half lord of the fishes", "Ardha Matsyendrasana", "twist",
    { intensity: 2, hold: 6, bi: true, avoid: ["si_joint", "knees"],
      cue: "Sit tall first, then turn. Lengthen on the inhale, rotate on the exhale.",
      easier: "Bottom leg straight instead of folded. Hand behind for height.",
      counters: ["dandasana", "paschimottanasana"] }),
  A("bharadvajasana", "Bharadvaja's twist", "Bharadvajasana", "twist",
    { intensity: 2, hold: 6, bi: true, avoid: ["knees", "si_joint"], phases: ["build", "cool"],
      cue: "Legs to one side, turn away from them. Gentle and very stable.",
      easier: "Sit on a blanket so the hips are even.", props: ["blanket"] }),
  A("supta_matsyendrasana", "Reclined twist", "Supta Matsyendrasana", "twist",
    { intensity: 1, hold: 10, bi: true, phases: ["counter", "cool"],
      cue: "Knees fall to one side, shoulders stay down, breathe into the top ribs.",
      easier: "A block or bolster between or under the knees.", props: ["block", "bolster"] }),
  A("parivrtta_utkatasana", "Revolved chair", "Parivrtta Utkatasana", "twist",
    { intensity: 4, plane: "standing", level: 2, hold: 5, bi: true, peak: 1, avoid: ["knees", "si_joint", "low_back"],
      phases: ["build", "peak"],
      cue: "Knees level, elbow outside the opposite thigh, twist from the mid-back.",
      easier: "Hands at the heart, half the depth. Sit less low.",
      preps: ["utkatasana", "parivrtta_anjaneyasana", "cat_cow"],
      counters: ["uttanasana", "tadasana"] }),

  // -------------------------------------------------------------- hip openers
  A("baddha_konasana", "Bound angle / butterfly", "Baddha Konasana", "hip_opener",
    { intensity: 1, hold: 10, avoid: ["knees"], phases: ["warmup", "build", "cool"],
      cue: "Soles together, let the knees be heavy. Never press them down.",
      easier: "Blocks under both knees. Feet further from the body.", props: ["block", "blanket"] }),
  A("sucirandhrasana", "Figure four", "Sucirandhrasana", "hip_opener",
    { intensity: 1, hold: 8, bi: true, phases: ["warmup", "counter", "cool"],
      cue: "Ankle over the opposite knee, draw the bottom thigh in. Reclined, so the low back is safe.",
      easier: "Keep the bottom foot on the floor and just press the top knee away.",
      counters: ["ananda_balasana"] }),
  A("eka_pada_rajakapotasana", "Pigeon", "Eka Pada Rajakapotasana", "hip_opener",
    { intensity: 3, level: 2, hold: 10, bi: true, avoid: ["knees", "si_joint"],
      phases: ["build", "cool"],
      cue: "Front shin angled, hips SQUARE. If the front knee talks, come out.",
      easier: "Reclined figure four instead — same hip, none of the knee load.",
      props: ["blanket", "bolster"],
      counters: ["balasana_open", "adho_mukha"] }),
  A("gomukhasana_legs", "Cow face legs", "Gomukhasana", "hip_opener",
    { intensity: 2, hold: 8, bi: true, avoid: ["knees"], phases: ["build", "cool"],
      cue: "Knees stacked, feet either side. Sit tall before folding.",
      easier: "Cross the shins loosely instead. Sit up on a block.", props: ["block"] }),
  A("agnistambhasana", "Fire log", "Agnistambhasana", "hip_opener",
    { intensity: 3, level: 2, hold: 8, bi: true, avoid: ["knees"], phases: ["build", "cool"],
      cue: "Shins stacked one over the other, both feet flexed hard.",
      easier: "Simple cross-legged, or a block under the top knee.", props: ["block"] }),
  A("ananda_balasana", "Happy baby", "Ananda Balasana", "hip_opener",
    { intensity: 1, hold: 8, phases: ["counter", "cool"],
      cue: "Hold the outer feet, knees toward the armpits, sacrum heavy.",
      easier: "One side at a time, or hold behind the thighs.", props: ["strap"] }),
  A("supta_padangusthasana", "Reclined hand-to-big-toe", "Supta Padangusthasana", "forward_fold",
    { intensity: 2, hold: 8, bi: true, phases: ["warmup", "cool"],
      cue: "Strap around the arch, lift the leg only as far as the other hip stays down.",
      easier: "Bend the lifted knee. Bend the bottom knee, foot flat.", props: ["strap"] }),
  A("virasana", "Hero", "Virasana", "seated",
    { intensity: 1, hold: 8, avoid: ["knees"], phases: ["warmup", "cool"],
      cue: "Kneel, feet either side of the hips, sit between them.",
      easier: "Sit on a block between the feet. Or kneel normally.", props: ["block"] }),
  A("supta_virasana", "Reclined hero", "Supta Virasana", "backbend",
    { intensity: 3, level: 2, hold: 10, avoid: ["knees", "low_back"], phases: ["build", "cool"],
      cue: "From hero, lower back onto the elbows, then the bolster. Slowly.",
      easier: "Stay on the elbows, or use a bolster the whole way.", props: ["bolster"],
      counters: ["balasana_open", "ananda_balasana"] }),
  A("padmasana", "Lotus", "Padmasana", "seated",
    { intensity: 2, level: 3, hold: 10, avoid: ["knees"], phases: ["centering", "cool"],
      cue: "Both feet high on the opposite thighs. Only if the HIPS open, never the knees.",
      easier: "Half lotus or simple cross-legged. There is no prize for lotus." }),
  A("ardha_padmasana", "Half lotus", "Ardha Padmasana", "seated",
    { intensity: 2, level: 2, hold: 10, bi: true, avoid: ["knees"], phases: ["centering", "cool"],
      cue: "One foot up on the opposite thigh, the other shin folded in front.",
      easier: "Simple cross-legged.", art: "padmasana" }),

  // ------------------------------------------------------- core / arm balance
  A("navasana", "Boat", "Navasana", "core",
    { intensity: 4, hold: 5, avoid: ["low_back"],
      cue: "Chest lifted, spine long, shins parallel to the floor.",
      easier: "Hold behind the thighs, toes down. Keep the chest tall.",
      counters: ["ananda_balasana", "supta_matsyendrasana"] }),
  A("vasisthasana", "Side plank", "Vasisthasana", "core",
    { intensity: 4, level: 2, hold: 5, bi: true, avoid: ["wrists", "shoulders"],
      cue: "Stack the feet, hips high, one long line.",
      easier: "Bottom knee down, or forearm instead of hand.",
      counters: ["balasana_open"] }),
  A("bakasana", "Crow", "Bakasana", "core",
    { intensity: 5, level: 3, hold: 5, peak: 2, avoid: ["wrists", "shoulders"], phases: ["peak"],
      cue: "Knees high on the arms, gaze forward, lean until the feet get light.",
      easier: "One foot at a time. A block under the feet to start higher.", props: ["block"],
      preps: ["malasana", "phalakasana", "adho_mukha", "navasana", "utkatasana", "cat_cow"],
      counters: ["balasana_open", "uttanasana"] }),
  A("bhujapidasana", "Shoulder pressing", "Bhujapidasana", "core",
    { intensity: 5, level: 3, hold: 5, peak: 2, avoid: ["wrists", "shoulders"], phases: ["peak"],
      cue: "Legs high on the upper arms, cross the ankles, lift.",
      easier: "Stay in a low squat with the hands down.",
      preps: ["malasana", "bakasana", "prasarita_a", "phalakasana", "upavistha_konasana", "adho_mukha"],
      counters: ["balasana_open", "dandasana"] }),
  A("kurmasana", "Tortoise", "Kurmasana", "forward_fold",
    { intensity: 4, level: 3, hold: 5, peak: 2, avoid: ["low_back", "shoulders"], phases: ["peak"],
      cue: "Legs wide, arms threaded under the knees, chest toward the mat.",
      easier: "Wide-legged seated fold instead.",
      preps: ["upavistha_konasana", "baddha_konasana", "paschimottanasana", "prasarita_a", "janu_sirsasana", "malasana"],
      counters: ["dandasana", "balasana_open"] }),
  A("supta_kurmasana", "Sleeping tortoise", "Supta Kurmasana", "forward_fold",
    { intensity: 5, level: 3, hold: 5, peak: 3, avoid: ["low_back", "shoulders", "knees", "neck"],
      phases: ["peak"],
      cue: "Ankles crossed behind the head, hands bound behind the back.",
      easier: "Stay in tortoise. This one takes years and that is fine.",
      preps: ["kurmasana", "upavistha_konasana", "baddha_konasana", "bhujapidasana", "paschimottanasana", "malasana", "prasarita_a"],
      counters: ["dandasana", "balasana_open"], art: "kurmasana" }),
  A("garbha_pindasana", "Embryo in the womb", "Garbha Pindasana", "core",
    { intensity: 4, level: 3, hold: 5, avoid: ["knees", "low_back"], phases: ["peak"],
      cue: "From lotus, arms through the legs, roll in a circle.",
      easier: "Hug the knees and rock. Skip the lotus entirely.",
      preps: ["padmasana", "navasana"],
      counters: ["dandasana", "savasana"] }),
  A("kukkutasana", "Rooster", "Kukkutasana", "core",
    { intensity: 5, level: 3, hold: 5, avoid: ["knees", "wrists", "shoulders"], phases: ["peak"],
      cue: "From embryo, press the hands down and lift the whole seat off the mat.",
      easier: "Skip it — it needs full lotus first.",
      preps: ["padmasana", "garbha_pindasana"],
      counters: ["dandasana"], art: "tolasana" }),
  A("tolasana", "Scales", "Tolasana", "core",
    { intensity: 4, level: 3, hold: 5, avoid: ["knees", "wrists", "shoulders"], phases: ["peak", "cool"],
      cue: "In lotus, hands beside the hips, lift.",
      easier: "Cross-legged and just press the hands down, hips stay put.",
      preps: ["padmasana"], counters: ["dandasana"] }),

  // --------------------------------------------------------------- inversions
  A("viparita_karani", "Legs up the wall", "Viparita Karani", "restorative",
    { intensity: 1, hold: 20, avoid: ["inversions"], phases: ["cool", "savasana"],
      cue: "Hips close to the wall, legs resting up it. Do nothing at all.",
      easier: "Calves on a chair seat instead.", props: ["wall", "bolster"] }),
  A("salamba_sarvangasana", "Shoulderstand", "Salamba Sarvangasana", "inversion",
    { intensity: 4, level: 3, hold: 10, peak: 2, avoid: ["neck", "inversions", "shoulders"],
      phases: ["peak", "cool"],
      cue: "Weight in the shoulders and elbows, never the neck. Do not turn the head.",
      easier: "Legs up the wall instead — most of the benefit, none of the neck load.",
      props: ["blanket"],
      preps: ["setu_bandha", "halasana", "navasana", "adho_mukha", "phalakasana", "ananda_balasana"],
      counters: ["matsyasana", "savasana"] }),
  A("halasana", "Plough", "Halasana", "inversion",
    { intensity: 4, level: 3, hold: 8, avoid: ["neck", "inversions", "low_back"],
      phases: ["peak", "cool"],
      cue: "Toes over the head, hands supporting the back. Neck stays still.",
      easier: "Feet to a chair behind you, or stay in bridge.", props: ["blanket"],
      counters: ["matsyasana", "savasana"] }),
  A("karnapidasana", "Ear pressure", "Karnapidasana", "inversion",
    { intensity: 4, level: 3, hold: 8, avoid: ["neck", "inversions", "low_back"], phases: ["peak"],
      cue: "From plough, knees bend down beside the ears.",
      easier: "Stay in plough, or come down.", art: "halasana",
      counters: ["matsyasana", "savasana"] }),
  A("sirsasana", "Headstand", "Salamba Sirsasana", "inversion",
    { intensity: 5, level: 3, hold: 10, peak: 3, avoid: ["neck", "inversions", "shoulders"],
      phases: ["peak"],
      cue: "Forearms wide and heavy, most of the weight in them. Core lifts the legs, not a kick.",
      easier: "Dolphin, or legs up the wall. Neither is a lesser pose.", props: ["wall"],
      preps: ["adho_mukha", "phalakasana", "navasana", "salamba_sarvangasana", "balasana_open", "anahatasana", "vasisthasana"],
      counters: ["balasana_open", "savasana"] }),
  A("uttana_padasana", "Extended leg pose", "Uttana Padasana", "backbend",
    { intensity: 3, level: 2, hold: 5, avoid: ["neck", "low_back"], phases: ["counter", "cool"],
      cue: "From fish, legs and arms lift to 45°.",
      easier: "Stay in supported fish.", art: "matsyasana",
      counters: ["balasana_open", "savasana"] }),
  A("urdhva_padmasana", "Upward lotus", "Urdhva Padmasana", "inversion",
    { intensity: 4, level: 3, hold: 5, avoid: ["knees", "neck", "inversions"], phases: ["peak"],
      cue: "In shoulderstand, fold into lotus, hands to the knees.",
      easier: "Stay in shoulderstand with the legs straight.", art: "salamba_sarvangasana",
      counters: ["matsyasana"] }),
  A("pindasana", "Embryo", "Pindasana", "inversion",
    { intensity: 4, level: 3, hold: 5, avoid: ["knees", "neck", "inversions"], phases: ["peak"],
      cue: "From upward lotus, lower the knees to the forehead and wrap the arms.",
      easier: "Knees to the forehead without the lotus.", art: "halasana",
      counters: ["matsyasana"] }),
  A("baddha_padmasana", "Bound lotus", "Baddha Padmasana", "seated",
    { intensity: 3, level: 3, hold: 5, avoid: ["knees", "shoulders"], phases: ["cool"],
      cue: "In lotus, reach behind and take hold of each foot.",
      easier: "Cross-legged with the hands clasped behind the back.", art: "padmasana" }),
  A("yoga_mudra", "Yoga seal", "Yoga Mudra", "forward_fold",
    { intensity: 2, level: 3, hold: 5, avoid: ["knees", "shoulders"], phases: ["cool"],
      cue: "From bound lotus, fold the chin toward the floor.",
      easier: "Cross-legged, hands clasped behind, fold forward.", art: "padmasana" }),

  // -------------------------------------------------------------- yin / cool
  A("bananasana", "Banana", "Bananasana", "supine",
    { intensity: 1, hold: 15, bi: true, phases: ["cool"],
      cue: "Hips stay put, feet and shoulders travel to one side. A long side-body stretch.",
      easier: "Less curve. Bend the knees." }),
  A("dragon", "Dragon lunge", "Utthan Pristhasana", "hip_opener",
    { intensity: 2, hold: 15, bi: true, avoid: ["knees"], phases: ["build", "cool"],
      cue: "Deep low lunge, hands or forearms inside the front foot. Let it be heavy and slow.",
      easier: "Hands to blocks, back knee on a blanket.", props: ["block", "blanket"],
      art: "anjaneyasana" }),
  A("caterpillar", "Caterpillar", "Paschimottanasana", "forward_fold",
    { intensity: 1, hold: 20, avoid: ["low_back"], phases: ["cool"],
      cue: "Rounded, unforced fold over long legs. Let gravity do all of it.",
      easier: "Bolster on the thighs and rest the chest on it.", props: ["bolster"],
      art: "paschimottanasana" }),
  A("sleeping_swan", "Sleeping swan", "Eka Pada Rajakapotasana", "hip_opener",
    { intensity: 2, hold: 20, bi: true, avoid: ["knees", "si_joint"], phases: ["cool"],
      cue: "Pigeon, folded forward, held long. Come out if the knee has anything to say.",
      easier: "Reclined figure four. Same hip, no knee load.", props: ["bolster", "blanket"],
      art: "eka_pada_rajakapotasana" }),
  A("shoelace", "Shoelace", "Gomukhasana", "hip_opener",
    { intensity: 2, hold: 20, bi: true, avoid: ["knees"], phases: ["cool"],
      cue: "Knees stacked, fold forward slowly.",
      easier: "Cross the shins instead. Sit up on a block.", props: ["block"],
      art: "gomukhasana_legs" }),
  A("seal", "Seal", "Bhujangasana variation", "backbend",
    { intensity: 2, hold: 12, avoid: ["low_back", "wrists"], phases: ["cool"],
      cue: "Sphinx with straight arms, hands further forward. Long hold, soft glutes.",
      easier: "Stay on the forearms in sphinx.", art: "salamba_bhujangasana",
      counters: ["balasana_open"] }),
  A("supported_bridge", "Supported bridge", "Setu Bandha, supported", "restorative",
    { intensity: 1, hold: 20, avoid: ["neck"], phases: ["cool", "savasana"],
      cue: "Block under the sacrum at its lowest height. Rest completely.",
      easier: "Lower block, or a folded blanket.", props: ["block", "bolster"],
      art: "setu_bandha" }),
  A("supported_fish", "Supported fish", "Matsyasana, supported", "restorative",
    { intensity: 1, hold: 20, avoid: ["neck"], phases: ["cool", "savasana"],
      cue: "Bolster along the spine, arms open. Nothing to hold.",
      easier: "A rolled blanket instead of a bolster.", props: ["bolster", "blanket"],
      art: "matsyasana" }),

  // ------------------------------------------------- Ashtanga Primary Series
  // Postures that exist in the app only because the Primary Series names them.
  // They are NOT in the generator's pool (`phases: ["series"]` matches no arc
  // phase), because a fixed series is the one place these shapes belong — and
  // several of them are lotus-derived, which is precisely the knee mechanism the
  // whole contraindication model exists to catch.
  //
  // Variants that are the same SHAPE with a different grip or a different leg
  // deliberately share a figure. Drawing four distinguishable marichyasanas at
  // 64x64 would be a drawing that lies about how different they are.
  A("prasarita_b", "Wide-legged fold, hands to hips", "Prasarita Padottanasana B", "forward_fold",
    { intensity: 3, plane: "standing", hold: 5, avoid: ["low_back"], phases: ["series"], art: "prasarita_a",
      cue: "Hands to the hips, elbows back, fold with a long spine.",
      easier: "Hands to blocks in front.", props: ["block"] }),
  A("prasarita_d", "Wide-legged fold, big toes", "Prasarita Padottanasana D", "forward_fold",
    { intensity: 3, plane: "standing", hold: 5, avoid: ["low_back"], phases: ["series"], art: "prasarita_a",
      cue: "Take hold of the big toes, bend the elbows out, crown down.",
      easier: "Hold the ankles instead.", props: ["block"] }),
  A("ardha_baddha_padmottanasana", "Standing half-bound lotus", "Ardha Baddha Padmottanasana", "balance",
    { intensity: 4, plane: "standing", level: 3, bi: true, hold: 5, avoid: ["knees", "shoulders", "low_back"],
      phases: ["series"], art: "vrksasana",
      cue: "Half lotus standing, bind behind the back, fold over the standing leg.",
      easier: "Tree pose and a forward fold, separately." }),
  A("ardha_baddha_padma_paschimottanasana", "Seated half-bound lotus fold", "Ardha Baddha Padma Paschimottanasana", "forward_fold",
    { intensity: 3, level: 3, bi: true, hold: 5, avoid: ["knees", "shoulders"],
      phases: ["series"], art: "janu_sirsasana",
      cue: "One foot into half lotus, bind, fold over the long leg.",
      easier: "Head-to-knee pose without the bind." }),
  A("triang_mukha_eka_pada_paschimottanasana", "Three-limbed forward fold", "Triang Mukha Eka Pada Paschimottanasana", "forward_fold",
    { intensity: 3, level: 2, bi: true, hold: 5, avoid: ["knees"], phases: ["series"], art: "janu_sirsasana",
      cue: "One shin folded back beside the hip, fold over the long leg.",
      easier: "A blanket under the sitting bone of the folded side.", props: ["blanket"] }),
  A("janu_sirsasana_b", "Head-to-knee B", "Janu Sirsasana B", "forward_fold",
    { intensity: 3, level: 2, bi: true, hold: 5, avoid: ["knees"], phases: ["series"], art: "janu_sirsasana",
      cue: "Sit on the heel of the bent leg, fold over the long one.",
      easier: "Head-to-knee A instead." }),
  A("janu_sirsasana_c", "Head-to-knee C", "Janu Sirsasana C", "forward_fold",
    { intensity: 3, level: 3, bi: true, hold: 5, avoid: ["knees"], phases: ["series"], art: "janu_sirsasana",
      cue: "Ball of the bent foot down, heel toward the navel, then fold.",
      easier: "Head-to-knee A. C is hard on the knee and there is no rush." }),
  A("marichyasana_a", "Marichyasana A", "Marichyasana A", "forward_fold",
    { intensity: 3, level: 2, bi: true, hold: 5, avoid: ["shoulders", "low_back"],
      phases: ["series"], art: "marichyasana",
      cue: "One knee up, wrap that arm around the shin, bind behind, fold forward.",
      easier: "Hold a strap between the hands.", props: ["strap"] }),
  A("marichyasana_b", "Marichyasana B", "Marichyasana B", "forward_fold",
    { intensity: 4, level: 3, bi: true, hold: 5, avoid: ["knees", "shoulders", "low_back"],
      phases: ["series"], art: "marichyasana",
      cue: "Half lotus under, other knee up, bind, fold.",
      easier: "Marichyasana A. The lotus leg is what makes this one a knee pose.", props: ["strap"] }),
  A("marichyasana_c", "Marichyasana C", "Marichyasana C", "twist",
    { intensity: 3, level: 2, bi: true, hold: 5, avoid: ["shoulders", "si_joint"],
      phases: ["series"], art: "marichyasana",
      cue: "Knee up, twist toward it, elbow outside the thigh, bind behind.",
      easier: "Elbow to the knee, no bind.", props: ["strap"] }),
  A("marichyasana_d", "Marichyasana D", "Marichyasana D", "twist",
    { intensity: 4, level: 3, bi: true, hold: 5, avoid: ["knees", "shoulders", "si_joint"],
      phases: ["series"], art: "marichyasana",
      cue: "Half lotus under, twist to the raised knee, bind.",
      easier: "Marichyasana C.", props: ["strap"] }),
  A("supta_konasana", "Reclined angle", "Supta Konasana", "inversion",
    { intensity: 3, level: 2, hold: 5, avoid: ["neck", "inversions", "low_back"],
      phases: ["series"], art: "halasana",
      cue: "From plough, legs wide, take the big toes, then roll up to sit.",
      easier: "Stay in a supported plough, or skip the roll." }),
  A("ubhaya_padangusthasana", "Both big toes", "Ubhaya Padangusthasana", "core",
    { intensity: 4, level: 3, hold: 5, avoid: ["low_back"], phases: ["series"], art: "navasana",
      cue: "Roll up holding both big toes and balance on the sitting bones.",
      easier: "Boat pose holding behind the thighs." }),
  A("urdhva_mukha_paschimottanasana", "Upward forward fold", "Urdhva Mukha Paschimottanasana", "forward_fold",
    { intensity: 4, level: 3, hold: 5, avoid: ["low_back"], phases: ["series"], art: "navasana",
      cue: "Balancing on the sitting bones, draw the legs and chest together.",
      easier: "Boat pose. Same balance, far less hamstring." }),
  A("setu_bandhasana", "Bridge (Ashtanga)", "Setu Bandhasana", "backbend",
    { intensity: 4, level: 3, hold: 5, avoid: ["neck", "low_back"], phases: ["series"], art: "setu_bandha",
      cue: "Crown of the head down, heels together, lift the hips. Neck loaded — go carefully.",
      easier: "Ordinary bridge, shoulders down. The neck version earns nothing extra." }),

  // ----------------------------------------------------------------- savasana
  A("savasana", "Savasana", "Savasana", "restorative",
    { intensity: 1, hold: 0, phases: ["savasana"], art: "savasana",
      cue: "Lie down, let the floor take all of it. Nothing left to do.",
      easier: "A bolster under the knees, a blanket over you.", props: ["bolster", "blanket"] }),
];

// --------------------------------------------------------------------- lookup
const BY_ID = new Map(ASANAS.map((a) => [a.id, a]));
export const byId = (id) => BY_ID.get(id) || null;
export const asanaName = (id) => (byId(id) || {}).name || id;

/** Every pose in `family`. */
export const byFamily = (family) => ASANAS.filter((a) => a.family === family);

/** Poses eligible for an arc phase. */
export const forPhase = (phase) => ASANAS.filter((a) => a.phases.includes(phase));

/**
 * Does this pose stress a site the practitioner is protecting?
 * `limits` is an array of LIMITATION keys from the profile.
 */
export function isContraindicated(asana, limits) {
  if (!asana || !limits || !limits.length) return false;
  return asana.avoid.some((site) => limits.includes(site));
}

/** The subset of the library that is safe for these limitations. */
export const safeFor = (limits, pool = ASANAS) =>
  pool.filter((a) => !isContraindicated(a, limits));

/**
 * Which limitation flags a pose trips, for messaging. Returns [] when clear.
 */
export const limitsHit = (asana, limits) =>
  !asana || !limits ? [] : asana.avoid.filter((s) => limits.includes(s));

/**
 * Structural validation, in the spirit of exercise-library.js checkLibrary().
 * A half-added pose should fail the test suite, not render as a blank tile.
 */
export function checkAsanas({ art } = {}) {
  const problems = [];
  const seen = new Set();
  for (const a of ASANAS) {
    if (seen.has(a.id)) problems.push(`${a.id}: duplicate entry`);
    seen.add(a.id);
    if (!FAMILIES[a.family]) problems.push(`${a.id}: unknown family "${a.family}"`);
    for (const p of a.phases) if (!PHASES.includes(p)) problems.push(`${a.id}: unknown phase "${p}"`);
    for (const s of a.avoid) if (!LIMITATION_KEYS.includes(s)) problems.push(`${a.id}: unknown limitation "${s}"`);
    for (const id of a.preps) if (!BY_ID.has(id)) problems.push(`${a.id}: prep "${id}" is not in the library`);
    for (const id of a.counters) if (!BY_ID.has(id)) problems.push(`${a.id}: counter "${id}" is not in the library`);
    if (a.intensity < 1 || a.intensity > 5) problems.push(`${a.id}: intensity ${a.intensity} out of band`);
    // A peak with too little preparation is the defect the arc model exists to
    // prevent, and it is unfixable downstream — no generator can prepare a peak
    // that never says what prepares it.
    if (a.peak > 0 && a.preps.length < (PREP_MIN[a.peak] || 3))
      problems.push(`${a.id}: a peak of complexity ${a.peak} needs ${PREP_MIN[a.peak]} prep poses, has ${a.preps.length}`);
    if (a.peak > 0 && a.counters.length === 0) problems.push(`${a.id}: a peak pose must declare a counter`);
    if (a.peak > 0 && !a.phases.includes("peak")) problems.push(`${a.id}: peak ${a.peak} but "peak" is not among its phases`);
    // Accessibility is the whole point: every pose offers a way in.
    if (!a.easier && a.family !== "breath" && a.id !== "tadasana") problems.push(`${a.id}: no easier variation offered`);
    if (!a.cue) problems.push(`${a.id}: no cue`);
    if (art && !art.has(a.art)) problems.push(`${a.id}: no figure for art key "${a.art}"`);
  }
  return problems;
}
