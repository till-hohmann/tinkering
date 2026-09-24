// yoga/ashtanga.js — the Primary Series (Yoga Chikitsa) as AUTHORED DATA.
//
// WHY THIS IS DATA AND NOT GENERATED. A fixed series is fixed by definition: the
// Primary Series is the same postures in the same order every single practice,
// and that sameness is the method rather than an implementation detail. Handing
// it to the generator would produce an "Ashtanga-style" sequence, which is Power
// yoga wearing the name. So the generator handles the composed styles and this
// file handles the one that is not composed.
//
// WHAT THE CONTRAINDICATION FILTER MAY AND MAY NOT DO HERE. It may not reorder
// or drop a posture — that would stop being the series. It substitutes in place
// (`SUBSTITUTES` in generate.js) and marks what it changed, so the practice is
// still recognisably the Primary Series and the app can say plainly which
// postures it altered and why. Where nothing safe exists, the posture is REPLACED
// BY A REST rather than removed, so the count and the rhythm survive.
//
// ⚠ THE SERIES IS FULL OF THE TWO DOCUMENTED INJURY MECHANISMS. Half the seated
// series is lotus-derived (knee hyperflexion plus rotation) and the finishing
// sequence is built on shoulderstand, plough and headstand (loaded cervical
// flexion). That is not a criticism of the method; it is why the filter matters
// more here than anywhere else in the app.

import { byId } from "./asanas.js";
import { STYLES, holdSecondsFor } from "./styles.js";
import { intentById, accountingFor } from "./intents.js";
import { resolvePose, flowSeconds } from "./compose.js";

// Five breaths, every posture, unless the tradition says otherwise. The three
// exceptions carried here are the ones every led class actually observes.
const FIVE = 5;

/** [id, breaths, opts] — opts.side runs an asymmetric posture both ways. */
const OPENING = [
  ["centering", 8, { label: "Opening", phase: "centering" }],
];

// Surya Namaskara A x5, B x5. The linked movements take one breath each; only
// the downward dog at the end of a round is held.
const SURYA_A = ["urdhva_hastasana", "uttanasana", "ardha_uttanasana", "chaturanga",
  "urdhva_mukha", "adho_mukha"];
const SURYA_B = ["utkatasana", "uttanasana", "ardha_uttanasana", "chaturanga", "urdhva_mukha",
  "adho_mukha", "virabhadrasana_1", "chaturanga", "urdhva_mukha", "adho_mukha",
  "virabhadrasana_1", "chaturanga", "urdhva_mukha", "adho_mukha"];

const STANDING = [
  ["padangusthasana", FIVE], ["padahastasana", FIVE],
  ["utthita_trikonasana", FIVE], ["parivrtta_trikonasana", FIVE],
  ["utthita_parsvakonasana", FIVE], ["parivrtta_parsvakonasana", FIVE],
  ["prasarita_a", FIVE], ["prasarita_b", FIVE], ["prasarita_c", FIVE], ["prasarita_d", FIVE],
  ["parsvottanasana", FIVE],
  ["utthita_hasta_padangusthasana", FIVE],
  ["ardha_baddha_padmottanasana", FIVE],
  ["utkatasana", FIVE], ["virabhadrasana_1", FIVE], ["virabhadrasana_2", FIVE],
];

const SEATED = [
  ["dandasana", FIVE],
  ["paschimottanasana", FIVE],
  ["purvottanasana", FIVE],
  ["ardha_baddha_padma_paschimottanasana", FIVE],
  ["triang_mukha_eka_pada_paschimottanasana", FIVE],
  ["janu_sirsasana", FIVE], ["janu_sirsasana_b", FIVE], ["janu_sirsasana_c", FIVE],
  ["marichyasana_a", FIVE], ["marichyasana_b", FIVE], ["marichyasana_c", FIVE], ["marichyasana_d", FIVE],
  ["navasana", FIVE, { rounds: 5, note: "Five times, with a lift between each" }],
  ["bhujapidasana", FIVE],
  ["kurmasana", FIVE],
  ["supta_kurmasana", FIVE],
  ["garbha_pindasana", FIVE],
  ["kukkutasana", FIVE],
  ["baddha_konasana", FIVE],
  ["upavistha_konasana", FIVE],
  ["supta_konasana", FIVE],
  ["supta_padangusthasana", FIVE],
  ["ubhaya_padangusthasana", FIVE],
  ["urdhva_mukha_paschimottanasana", FIVE],
  ["setu_bandhasana", FIVE],
];

const FINISHING = [
  ["urdhva_dhanurasana", FIVE, { rounds: 3, note: "Three times" }],
  ["paschimottanasana", 10, { note: "Ten breaths — the counter to the backbends" }],
  ["salamba_sarvangasana", 15, { note: "Traditionally held long" }],
  ["halasana", 8],
  ["karnapidasana", 8],
  ["urdhva_padmasana", FIVE],
  ["pindasana", FIVE],
  ["matsyasana", FIVE],
  ["uttana_padasana", FIVE],
  ["sirsasana", 15, { note: "Traditionally held long" }],
  ["balasana_open", 8, { note: "Rest here as long as you need" }],
  ["baddha_padmasana", FIVE],
  ["yoga_mudra", FIVE],
  ["padmasana", 10],
  ["tolasana", 10],
];

/** The series in order, with its section labels, before any substitution. */
export const SERIES_SECTIONS = [
  { key: "opening", label: "Opening", entries: OPENING },
  { key: "surya_a", label: "Surya Namaskara A", salutation: "A", rounds: 5, linked: SURYA_A },
  { key: "surya_b", label: "Surya Namaskara B", salutation: "B", rounds: 5, linked: SURYA_B },
  { key: "standing", label: "Standing sequence", entries: STANDING },
  { key: "seated", label: "Primary seated series", entries: SEATED },
  { key: "finishing", label: "Finishing sequence", entries: FINISHING },
];

/** Every posture the series names, in order, ids only. */
export const SERIES_IDS = SERIES_SECTIONS.flatMap((s) =>
  s.linked ? s.linked : s.entries.map(([id]) => id));

const REST_STAND_IN = {
  id: "balasana_open", name: "Rest", note: "Nothing here is safe for you — rest instead",
};

function makeSeriesItem(asana, { style, breathSeconds, breaths, phase, section, linked, note, rounds }) {
  const floor = ["seated", "supine", "restorative", "hip_opener", "forward_fold"].includes(asana.family);
  const seconds = holdSecondsFor(style, { breathSeconds, breaths: linked ? 1 : breaths });
  return {
    asanaId: asana.id,
    name: asana.name,
    sanskrit: asana.sanskrit,
    family: asana.family,
    phase,
    section,
    cue: asana.cue,
    easier: asana.easier,
    props: asana.props,
    art: asana.art,
    bilateral: asana.bilateral,
    intensity: asana.intensity,
    holdBreaths: linked ? 1 : breaths,
    durationSeconds: Math.max(3, Math.round(seconds)),
    transitionSeconds: linked ? 0 : (floor ? style.floorTransitionSeconds : style.transitionSeconds),
    linked: !!linked,
    note: note || "",
    rounds: rounds || 1,
  };
}

/**
 * Build the Primary Series for a given body.
 *
 * Returns the same flow shape generateFlow() does, so every consumer — the
 * player, the QC pass, the summary — treats an authored series and a generated
 * sequence identically.
 */
export function primarySeries({ limits = [], level = 3, breathSeconds = 5, minutes = 90 } = {}) {
  const style = STYLES.ashtanga;
  const intent = intentById("ashtanga");
  const ctx = { limits, level };
  const items = [];
  const substituted = [];
  const dropped = [];

  const place = (id, breaths, opts = {}) => {
    const want = byId(id);
    const got = resolvePose(id, ctx);
    if (!got) {
      // Nothing in the chain is safe. Keep the slot — a rest in the right place
      // preserves the shape of the practice; a gap does not.
      const rest = byId(REST_STAND_IN.id);
      dropped.push({ id, name: want ? want.name : id });
      items.push(makeSeriesItem(rest, { style, breathSeconds, breaths, phase: opts.phase || "build",
        section: opts.section, linked: opts.linked, note: REST_STAND_IN.note }));
      return;
    }
    if (got.id !== id) substituted.push({ from: id, fromName: want.name, to: got.id, toName: got.name });
    // FIVE ROUNDS OF BOAT IS FIVE HOLDS WITH A LIFT BETWEEN THEM, not one hold
    // five times as long. Multiplying the duration produced a 125-second boat
    // pose, which is neither the posture nor anything a person could do — and it
    // was the QC pass that noticed, not me reading it back.
    const n = opts.rounds || 1;
    for (let r = 1; r <= n; r++) {
      const it = makeSeriesItem(got, { style, breathSeconds, breaths,
        phase: opts.phase || "build", section: opts.section, linked: opts.linked,
        note: n > 1 ? (opts.note ? opts.note + " — " : "") + r + " of " + n : opts.note });
      if (n > 1) { it.round = r; it.rounds = n; }
      items.push(it);
    }
  };

  for (const sec of SERIES_SECTIONS) {
    if (sec.linked) {
      for (let r = 1; r <= sec.rounds; r++) {
        sec.linked.forEach((id, i) => {
          const last = i === sec.linked.length - 1;
          place(id, last ? 5 : 1, {
            phase: "warmup", section: sec.key, linked: !last,
            note: last ? `${sec.label} — round ${r} of ${sec.rounds}` : "",
          });
          const it = items[items.length - 1];
          it.round = r;
          it.salutation = sec.salutation;
        });
      }
    } else {
      for (const [id, breaths, opts = {}] of sec.entries) {
        place(id, breaths, { ...opts, section: sec.key,
          phase: sec.key === "opening" ? "centering" : (sec.key === "finishing" ? "cool" : "build") });
      }
    }
  }

  // Savasana closes it, as a proportion of the whole rather than a fixed number.
  const bodySeconds = flowSeconds(items);
  const savasanaSeconds = Math.max(300, Math.round((bodySeconds * 0.14) / 30) * 30);
  const sav = byId("savasana");
  items.push({
    ...makeSeriesItem(sav, { style, breathSeconds, breaths: 0, phase: "savasana", section: "finishing" }),
    durationSeconds: savasanaSeconds,
    holdBreaths: null,
    transitionSeconds: 15,
  });

  items.forEach((it, i) => { it.id = `${it.asanaId}-${i}`; });
  const totalSeconds = flowSeconds(items);

  return {
    intent: "ashtanga",
    intentLabel: intent ? intent.label : "Ashtanga Primary",
    style: "ashtanga",
    styleName: style.name,
    styleFamily: style.family,
    minutes: Math.round(totalSeconds / 60),
    // An authored series has no target length to miss. Its length is a
    // CONSEQUENCE of the postures and your breath rate, not a request — at five
    // seconds a breath the Primary runs about 65 minutes, at seven about 90.
    targetSeconds: totalSeconds,
    requestedSeconds: Math.round(minutes * 60),
    totalSeconds,
    breathSeconds,
    level,
    limits: [...limits],
    seed: 0,
    peak: null,
    peakName: null,
    savasanaSeconds,
    items,
    sections: groupBySection(items),
    excluded: [],
    substituted,
    dropped,
    accounting: accountingFor(intent),
    note: intent ? intent.note : "",
    authored: true,
  };
}

function groupBySection(items) {
  const out = {};
  for (const it of items) (out[it.phase] = out[it.phase] || []).push(it);
  return out;
}

/** Structural check — the series must name every posture it is supposed to. */
export function checkSeries() {
  const problems = [];
  for (const id of SERIES_IDS) if (!byId(id)) problems.push(`Primary Series names "${id}", which is not in the library`);
  const seatedCount = SEATED.length;
  if (seatedCount < 20) problems.push(`the seated series has ${seatedCount} postures, which is too few to be Primary`);
  if (!SERIES_IDS.includes("kurmasana")) problems.push("the seated series is missing kurmasana");
  if (!SERIES_IDS.includes("sirsasana")) problems.push("the finishing sequence is missing sirsasana");
  return problems;
}
