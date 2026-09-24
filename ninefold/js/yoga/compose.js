// yoga/compose.js — the primitives both the generator and the authored Primary
// Series need: seeded randomness, the substitution chain, and time accounting.
//
// This module exists to break a cycle rather than because the ideas belong
// together: generate.js delegates Ashtanga to ashtanga.js, and ashtanga.js needs
// the same substitution logic generate.js uses. Circular ES modules happen to
// work here, and "happens to work" is how a module ends up half-initialised at
// import time six months later.

import { byId, isContraindicated } from "./asanas.js";

// --- deterministic randomness ------------------------------------------------
// Seeded so a flow is reproducible: the same day and the same choices give the
// same sequence, "Regenerate" advances the seed, and a failing test can be
// re-run on the exact sequence that failed.
export function rng(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedFrom(str) {
  let h = 2166136261;
  const s = String(str);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// --- structural substitutions ------------------------------------------------
// When a pose is unavailable — a protected site, or above the practitioner's
// level — this is what takes its place rather than the pose simply vanishing. A
// sun salutation missing its chaturanga is not a sun salutation; a sun salutation
// with knees-chest-chin still is.
//
// Every chain terminates at something with no `avoid` flags at all, so
// resolvePose() can always answer for a body with any combination of
// limitations — or answer null, which is also a legitimate answer.
export const SUBSTITUTES = {
  chaturanga: "ashtanga_namaskara",
  ashtanga_namaskara: "cat_cow",
  urdhva_mukha: "bhujangasana",
  urdhva_dhanurasana: "setu_bandha",
  eka_pada_rajakapotasana: "sucirandhrasana",
  sleeping_swan: "sucirandhrasana",
  padmasana: "centering",
  ardha_padmasana: "baddha_konasana",
  baddha_konasana: "sucirandhrasana",
  salamba_sarvangasana: "viparita_karani",
  viparita_karani: "savasana",
  halasana: "supta_matsyendrasana",
  karnapidasana: "supta_matsyendrasana",
  sirsasana: "adho_mukha",
  supta_virasana: "setu_bandha",
  virasana: "dandasana",
  agnistambhasana: "sucirandhrasana",
  gomukhasana_legs: "sucirandhrasana",
  shoelace: "sucirandhrasana",
  supta_kurmasana: "kurmasana",
  kurmasana: "upavistha_konasana",
  upavistha_konasana: "baddha_konasana",
  bakasana: "malasana",
  bhujapidasana: "malasana",
  natarajasana: "vrksasana",
  tolasana: "navasana",
  kukkutasana: "navasana",
  garbha_pindasana: "navasana",
  urdhva_padmasana: "viparita_karani",
  pindasana: "supta_matsyendrasana",
  baddha_padmasana: "centering",
  yoga_mudra: "balasana_open",
  uttana_padasana: "setu_bandha",
  matsyasana: "supported_fish",
  supported_fish: "savasana",
  supported_bridge: "savasana",
  seal: "salamba_bhujangasana",
  dragon: "anjaneyasana",
  caterpillar: "paschimottanasana",
  paschimottanasana: "supta_padangusthasana",
  janu_sirsasana: "supta_padangusthasana",
  ustrasana: "setu_bandha",
  setu_bandha: "supta_matsyendrasana",
  dhanurasana: "salabhasana",
  salabhasana: "salamba_bhujangasana",
  bhujangasana: "salamba_bhujangasana",
  salamba_bhujangasana: "cat_cow",
  parivrtta_trikonasana: "utthita_trikonasana",
  parivrtta_parsvakonasana: "parivrtta_anjaneyasana",
  parivrtta_anjaneyasana: "thread_needle",
  parivrtta_utkatasana: "supta_matsyendrasana",
  utthita_trikonasana: "virabhadrasana_2",
  virabhadrasana_2: "tadasana",
  parsvottanasana: "uttanasana",
  uttanasana: "cat_cow",
  vasisthasana: "phalakasana",
  phalakasana: "cat_cow",
  navasana: "phalakasana",
  malasana: "baddha_konasana",
  utkatasana: "tadasana",
  virabhadrasana_1: "high_lunge",
  anjaneyasana: "high_lunge",
  high_lunge: "tadasana",
  balasana_open: "supta_matsyendrasana",
  adho_mukha: "cat_cow",
  cat_cow: "centering",
  ardha_chandrasana: "virabhadrasana_2",
  virabhadrasana_3: "high_lunge",
  utthita_hasta_padangusthasana: "supta_padangusthasana",
  utthita_parsvakonasana: "virabhadrasana_2",
  garudasana: "vrksasana",
  vrksasana: "tadasana",
  prasarita_c: "prasarita_a",
  prasarita_b: "prasarita_a",
  prasarita_d: "prasarita_a",
  prasarita_a: "uttanasana",
  purvottanasana: "setu_bandha",
  bharadvajasana: "supta_matsyendrasana",
  ardha_matsyendrasana: "supta_matsyendrasana",
  anahatasana: "balasana_open",
  thread_needle: "supta_matsyendrasana",
  padahastasana: "uttanasana",
  padangusthasana: "uttanasana",
  // Primary Series postures fall back to the shape they are a variant of.
  ardha_baddha_padmottanasana: "vrksasana",
  ardha_baddha_padma_paschimottanasana: "janu_sirsasana",
  triang_mukha_eka_pada_paschimottanasana: "janu_sirsasana",
  janu_sirsasana_b: "janu_sirsasana",
  janu_sirsasana_c: "janu_sirsasana",
  marichyasana_a: "paschimottanasana",
  marichyasana_b: "marichyasana_a",
  marichyasana_c: "ardha_matsyendrasana",
  marichyasana_d: "marichyasana_c",
  supta_konasana: "supta_matsyendrasana",
  ubhaya_padangusthasana: "navasana",
  urdhva_mukha_paschimottanasana: "navasana",
  setu_bandhasana: "setu_bandha",
  dandasana: "centering",
  supta_padangusthasana: "sucirandhrasana",
  sucirandhrasana: "savasana",
  supta_matsyendrasana: "savasana",
  tadasana: "centering",
};

/**
 * The usable pose for `id` given the constraints: itself if it is fine, else the
 * first substitute up the chain that is. Returns null when nothing works, which
 * is a legitimate answer — some postures have no version of themselves that is
 * safe for a given body, and pretending otherwise is how an app hurts someone.
 */
export function resolvePose(id, { limits = [], level = 3 } = {}, depth = 0) {
  const a = byId(id);
  if (!a) return null;
  if (!isContraindicated(a, limits) && a.level <= level) return a;
  if (depth > 8) return null;
  const sub = SUBSTITUTES[id];
  return sub ? resolvePose(sub, { limits, level }, depth + 1) : null;
}

// Poses that may legitimately appear more than once in one sequence — the
// neutral shapes a practice keeps returning to. Everything else appears once, so
// a 45-minute flow is 45 minutes of practice rather than triangle six times.
export const REPEATABLE = new Set(["adho_mukha", "tadasana", "balasana_open", "uttanasana",
  "ardha_uttanasana", "chaturanga", "ashtanga_namaskara", "urdhva_mukha", "bhujangasana",
  "urdhva_hastasana", "phalakasana", "utkatasana", "dandasana", "high_lunge",
  "virabhadrasana_1", "anjaneyasana", "cat_cow", "centering"]);

// --- time accounting ---------------------------------------------------------
/** Wall-clock cost of an item, counting BOTH sides of an asymmetric pose. */
export const itemSeconds = (it) =>
  (it.durationSeconds + it.transitionSeconds) * (it.bilateral ? 2 : 1);

export const flowSeconds = (items) => items.reduce((s, it) => s + itemSeconds(it), 0);

/** Where in the sequence, as a fraction of elapsed time, an item begins. */
export function elapsedAt(items, index) {
  let t = 0;
  for (let i = 0; i < index && i < items.length; i++) t += itemSeconds(items[i]);
  return t;
}
