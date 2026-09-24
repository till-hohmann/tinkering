// yoga/positions.js — where the body actually IS in each pose, and which way it
// faces. One row per asana, and the reason this is a separate table rather than
// five more arguments to A() in asanas.js is that it has to be READ as a table:
// the whole point is comparing a pose against its neighbours, and you cannot do
// that when the rows are eight hundred lines apart.
//
// WHY THIS FILE EXISTS AT ALL. The generator used to know one structural fact
// about a pose — `plane`, standing or floor — and picked everything else by
// weighted roulette over a filtered pool. That produces sequences no teacher
// would write: plank, then a seated twist, then sphinx, then cow-face legs, then
// chaturanga. Every pose individually reasonable, the sequence a random walk,
// because "floor" covers lying on your front, lying on your back, sitting up and
// being on your hands, which are four different places to be.
//
// The rule the sequencing literature keeps repeating is the opposite of what the
// old picker optimised for: a pose should lead into the next one by SIMILARITY
// with it, not by contrast, and a sequence should minimise how often the body
// changes position. So position is now the primary structural fact and the
// generator groups by it.
//
// FIELDS
//   pos    where the body is. See POSITIONS — this drives the grouping.
//   face   which way you face on the mat. Only meaningful standing and lunging:
//          `long` is a wide stance open to the long edge (warrior II, triangle),
//          `short` is square to the front of the mat (warrior I, pyramid),
//          `neutral` is feet together and pivots to either for free. Alternating
//          long and short every pose is the standing-series version of position
//          thrash — you are re-setting your feet on every single shape.
//   rot    hip rotation of the working or standing leg. Changing this while
//          balanced on a straight leg is the one transition orthopaedic writing
//          singles out: half moon into warrior III grinds the hip because it asks
//          for external-to-internal rotation with no way to unload the joint.
//   spine  the dominant spinal action, so a practice can be balanced across the
//          six directions and two deep opposing shapes are never adjacent.
//   still  CAN THIS BE HELD FOR MINUTES IN STILLNESS. Yin and restorative hold in
//          minutes, and the generator had no way to know that upward plank is not
//          a shape you hold for four minutes — so it prescribed exactly that.
//   leg    balancing on a STRAIGHT standing leg. Only these can commit the hip
//          rotation flip above; a bent standing leg unloads it.

/** Where the body is. THE ORDER IS THE SEQUENCE ORDER — see POSITION_ORDER. */
export const POSITIONS = {
  standing:  { name: "Standing", floor: false },
  lunge:     { name: "Lunging", floor: false },
  quadruped: { name: "On hands", floor: true },
  prone:     { name: "On the belly", floor: true },
  kneeling:  { name: "Kneeling", floor: true },
  seated:    { name: "Seated", floor: true },
  supine:    { name: "On the back", floor: true },
};

/**
 * THE ORDER A CLASS DESCENDS IN, and it is one-way.
 *
 * Standing work first while the body is warm and attention is fresh, then down
 * through the hands to the belly, up onto the knees to release, then sitting,
 * then lying down. Prone before kneeling because child's pose is what a prone
 * backbend series releases into; seated before supine because you are already
 * halfway there.
 *
 * The distance between two entries is the cost of the transition, which is what
 * makes standing-to-supine expensive and prone-to-kneeling nearly free.
 */
export const POSITION_ORDER = ["standing", "lunge", "quadruped", "prone", "kneeling", "seated", "supine"];

/**
 * THE DESCENT AS A CLASS ACTUALLY MAKES IT — in tiers, not one position at a time.
 *
 * Standing and lunging are ONE place to be. Warriors, triangle and side angle
 * are lunges; mountain, chair and the balances are standing; a class moves
 * between them freely because your feet never leave the mat. Treating them as
 * two consecutive stations meant a practice building toward a standing balance
 * stopped before it ever reached the warriors — the peak's own tier truncated
 * the build, and the standing series that every vinyasa is mostly made of
 * vanished. The whole rest of the descent genuinely is one position at a time.
 */
export const POSITION_TIERS = [
  ["standing", "lunge"], ["quadruped"], ["prone"], ["kneeling"], ["seated"], ["supine"],
];

/** Which tier of the descent a position belongs to. */
export const tierOf = (pos) => POSITION_TIERS.findIndex((t) => t.includes(pos));

export const FACINGS = ["long", "short", "neutral"];
export const ROTATIONS = ["external", "internal", "neutral"];
export const SPINE_DIRECTIONS = ["flexion", "extension", "lateral", "rotation", "neutral"];

// P(pos, face, rot, spine, still, leg) — positional, so the table reads as a table.
const P = (pos, face, rot, spine, still = false, leg = false) =>
  ({ pos, face, rot, spine, still, leg });

/**
 * One row per asana. A pose missing from here fails checkAsanas(), which is the
 * point: a half-added pose should break the suite, not compose a bad flow at
 * runtime for somebody standing on a mat.
 */
export const POSITION_OF = {
  // ---------------------------------------------------------------- centering
  centering:            P("seated", "neutral", "neutral", "neutral", true),
  ujjayi:               P("seated", "neutral", "neutral", "neutral", true),
  balasana_open:        P("kneeling", "neutral", "neutral", "flexion", true),
  cat_cow:              P("quadruped", "neutral", "neutral", "neutral"),
  thread_needle:        P("quadruped", "neutral", "neutral", "rotation", true),

  // ------------------------------------------------------- sun salutation A/B
  tadasana:             P("standing", "neutral", "neutral", "neutral"),
  urdhva_hastasana:     P("standing", "neutral", "neutral", "extension"),
  uttanasana:           P("standing", "neutral", "neutral", "flexion"),
  ardha_uttanasana:     P("standing", "neutral", "neutral", "neutral"),
  phalakasana:          P("quadruped", "neutral", "neutral", "neutral"),
  chaturanga:           P("quadruped", "neutral", "neutral", "neutral"),
  ashtanga_namaskara:   P("quadruped", "neutral", "neutral", "extension"),
  urdhva_mukha:         P("prone", "neutral", "neutral", "extension"),
  adho_mukha:           P("quadruped", "neutral", "neutral", "neutral"),
  utkatasana:           P("standing", "neutral", "neutral", "neutral"),
  // A lunge is its own position: the feet are split and staying split is what
  // makes low lunge into warrior I free and low lunge into a seated twist not.
  anjaneyasana:         P("lunge", "short", "internal", "extension"),
  high_lunge:           P("lunge", "short", "internal", "neutral"),

  // ------------------------------------------------------------ standing work
  virabhadrasana_1:        P("lunge", "short", "internal", "extension"),
  virabhadrasana_2:        P("lunge", "long", "external", "neutral"),
  viparita_virabhadrasana: P("lunge", "long", "external", "lateral"),
  utthita_parsvakonasana:  P("lunge", "long", "external", "lateral"),
  utthita_trikonasana:     P("standing", "long", "external", "lateral"),
  parivrtta_trikonasana:   P("standing", "short", "internal", "rotation"),
  parivrtta_parsvakonasana:P("lunge", "short", "internal", "rotation"),
  parivrtta_anjaneyasana:  P("lunge", "short", "internal", "rotation"),
  parsvottanasana:         P("standing", "short", "internal", "flexion"),
  prasarita_a:             P("standing", "long", "external", "flexion"),
  prasarita_c:             P("standing", "long", "external", "flexion"),
  utkata_konasana:         P("standing", "long", "external", "neutral"),
  malasana:                P("standing", "neutral", "external", "flexion"),
  padangusthasana:         P("standing", "neutral", "neutral", "flexion"),
  padahastasana:           P("standing", "neutral", "neutral", "flexion"),
  parivrtta_utkatasana:    P("standing", "neutral", "neutral", "rotation"),

  // --------------------------------------------------------------- balancing
  // `leg` is set only where the standing leg is STRAIGHT. Eagle bends it, so
  // eagle can follow anything; half moon and warrior III cannot follow each other.
  vrksasana:                     P("standing", "neutral", "external", "neutral", false, true),
  garudasana:                    P("standing", "neutral", "internal", "neutral"),
  utthita_hasta_padangusthasana: P("standing", "short", "neutral", "flexion", false, true),
  virabhadrasana_3:              P("standing", "short", "internal", "neutral", false, true),
  ardha_chandrasana:             P("standing", "long", "external", "lateral", false, true),
  natarajasana:                  P("standing", "short", "internal", "extension", false, true),

  // ---------------------------------------------------------------- backbends
  bhujangasana:         P("prone", "neutral", "neutral", "extension"),
  salamba_bhujangasana: P("prone", "neutral", "neutral", "extension", true),
  salabhasana:          P("prone", "neutral", "neutral", "extension"),
  dhanurasana:          P("prone", "neutral", "neutral", "extension"),
  seal:                 P("prone", "neutral", "neutral", "extension", true),
  ustrasana:            P("kneeling", "neutral", "neutral", "extension"),
  anahatasana:          P("kneeling", "neutral", "neutral", "extension", true),
  supta_virasana:       P("kneeling", "neutral", "internal", "extension", true),
  setu_bandha:          P("supine", "neutral", "neutral", "extension"),
  urdhva_dhanurasana:   P("supine", "neutral", "neutral", "extension"),
  matsyasana:           P("supine", "neutral", "neutral", "extension", true),
  uttana_padasana:      P("supine", "neutral", "neutral", "extension"),
  purvottanasana:       P("seated", "neutral", "neutral", "extension"),

  // ------------------------------------------------------------------ seated
  dandasana:            P("seated", "neutral", "neutral", "neutral", true),
  virasana:             P("kneeling", "neutral", "internal", "neutral", true),
  padmasana:            P("seated", "neutral", "external", "neutral", true),
  ardha_padmasana:      P("seated", "neutral", "external", "neutral", true),
  baddha_padmasana:     P("seated", "neutral", "external", "neutral", true),
  paschimottanasana:    P("seated", "neutral", "neutral", "flexion", true),
  janu_sirsasana:       P("seated", "neutral", "external", "flexion", true),
  upavistha_konasana:   P("seated", "neutral", "external", "flexion", true),
  caterpillar:          P("seated", "neutral", "neutral", "flexion", true),
  yoga_mudra:           P("seated", "neutral", "external", "flexion", true),
  ardha_matsyendrasana: P("seated", "neutral", "neutral", "rotation", true),
  bharadvajasana:       P("seated", "neutral", "neutral", "rotation", true),
  navasana:             P("seated", "neutral", "neutral", "neutral"),

  // -------------------------------------------------------------- hip openers
  baddha_konasana:         P("seated", "neutral", "external", "flexion", true),
  eka_pada_rajakapotasana: P("seated", "neutral", "external", "flexion", true),
  sleeping_swan:           P("seated", "neutral", "external", "flexion", true),
  shoelace:                P("seated", "neutral", "external", "flexion", true),
  gomukhasana_legs:        P("seated", "neutral", "external", "neutral", true),
  agnistambhasana:         P("seated", "neutral", "external", "flexion", true),
  dragon:                  P("lunge", "short", "internal", "neutral", true),
  sucirandhrasana:         P("supine", "neutral", "external", "neutral", true),
  ananda_balasana:         P("supine", "neutral", "external", "flexion", true),

  // ------------------------------------------------------------------ supine
  supta_padangusthasana: P("supine", "neutral", "neutral", "flexion", true),
  supta_matsyendrasana:  P("supine", "neutral", "neutral", "rotation", true),
  bananasana:            P("supine", "neutral", "neutral", "lateral", true),
  savasana:              P("supine", "neutral", "neutral", "neutral", true),
  viparita_karani:       P("supine", "neutral", "neutral", "neutral", true),
  supported_bridge:      P("supine", "neutral", "neutral", "extension", true),
  supported_fish:        P("supine", "neutral", "neutral", "extension", true),

  // ------------------------------------------------- core and arm balances
  vasisthasana:  P("quadruped", "neutral", "neutral", "lateral"),
  bakasana:      P("quadruped", "neutral", "external", "flexion"),
  bhujapidasana: P("quadruped", "neutral", "external", "flexion"),
  kukkutasana:   P("quadruped", "neutral", "external", "neutral"),
  tolasana:      P("seated", "neutral", "external", "neutral"),
  garbha_pindasana: P("seated", "neutral", "external", "flexion"),

  // -------------------------------------------------------------- inversions
  // Head below heart, but the BODY is still somewhere: shoulderstand and plough
  // are things you do lying on your back, and sequencing them as such is what
  // stops the generator standing you up to get to them.
  salamba_sarvangasana: P("supine", "neutral", "neutral", "neutral"),
  halasana:             P("supine", "neutral", "neutral", "flexion"),
  karnapidasana:        P("supine", "neutral", "neutral", "flexion"),
  urdhva_padmasana:     P("supine", "neutral", "external", "neutral"),
  pindasana:            P("supine", "neutral", "external", "flexion"),
  sirsasana:            P("quadruped", "neutral", "neutral", "neutral"),

  // ------------------------------------------ Primary Series only (`series`)
  prasarita_b: P("standing", "long", "external", "flexion"),
  prasarita_d: P("standing", "long", "external", "flexion"),
  ardha_baddha_padmottanasana: P("standing", "neutral", "external", "flexion", false, true),
  ardha_baddha_padma_paschimottanasana: P("seated", "neutral", "external", "flexion"),
  triang_mukha_eka_pada_paschimottanasana: P("seated", "neutral", "internal", "flexion"),
  janu_sirsasana_b: P("seated", "neutral", "external", "flexion"),
  janu_sirsasana_c: P("seated", "neutral", "external", "flexion"),
  marichyasana_a: P("seated", "neutral", "neutral", "flexion"),
  marichyasana_b: P("seated", "neutral", "external", "flexion"),
  marichyasana_c: P("seated", "neutral", "neutral", "rotation"),
  marichyasana_d: P("seated", "neutral", "external", "rotation"),
  kurmasana: P("seated", "neutral", "external", "flexion"),
  supta_kurmasana: P("seated", "neutral", "external", "flexion"),
  supta_konasana: P("supine", "neutral", "external", "flexion"),
  ubhaya_padangusthasana: P("seated", "neutral", "neutral", "flexion"),
  urdhva_mukha_paschimottanasana: P("seated", "neutral", "neutral", "flexion"),
  setu_bandhasana: P("supine", "neutral", "neutral", "extension"),
};

/** `plane` is now DERIVED, so the two facts can never disagree. */
export const planeOf = (pos) => (POSITIONS[pos] && POSITIONS[pos].floor ? "floor" : "standing");

/** How far apart two positions are on the descent. 0 = same place. */
export function positionDistance(a, b) {
  const i = POSITION_ORDER.indexOf(a), j = POSITION_ORDER.indexOf(b);
  if (i < 0 || j < 0) return 0;
  return Math.abs(i - j);
}
