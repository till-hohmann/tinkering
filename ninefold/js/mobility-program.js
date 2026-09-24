// mobility-program.js — the supplemental mobility & stability program: WHICH
// sessions exist and what's in them. The engine that progresses the holds lives
// in mobility.js; this file is only the content, so it can be swapped wholesale.
//
// A private overlay can replace this file at deploy time (see tools/deploy.ps1)
// with a routine built around someone's own needs. The version here is the
// GENERAL one: no rehab programming, no assumptions about anyone's history.
//
// >>> This is general fitness content, not medical advice. If you have a
// >>> diagnosed injury, pain that changes with load, or you're returning from
// >>> surgery, a physiotherapist should write your routine instead of an app.
//
// Three complementary sessions rather than the same routine three times, so
// every weekly target gets hit about twice through DIFFERENT exercises:
//
//   A "Hips & ankles"   (mobility bias)      — hip flexor length, hip rotation,
//                                              ankle dorsiflexion, soleus
//   B "Glutes & knees"  (strength bias)      — glute max/med, quad capacity,
//                                              adductors, controlled knee flexion
//   C "Core & control"  (motor-control bias) — the McGill-style endurance trio
//                                              plus hip openers
//
// Why these choices, briefly: the trunk endurance trio (dead bug, side plank,
// bird dog) is the standard low-back endurance battery; ankle dorsiflexion range
// and soleus capacity underpin squatting and running mechanics; glute medius
// work addresses the hip control most desk-bound lifters lack; hip flexor length
// offsets sitting. All of it is bodyweight and floor-only. A mini-band makes the
// abduction and bridge work better but nothing requires equipment.
//
// ~8-10 min each. The view scales every hold down ~30% on deload weeks.

// Which weekdays offer a session. Sessions are keyed by weekday for scheduling,
// but each carries a stable `key` (A/B/C) so a session done on a different day
// keeps its identity in the log.
export const MOBILITY_DAYS = new Set(["Wed", "Fri", "Sun"]);

export const MOBILITY_TITLE = "Mobility & stability";
export const MOBILITY_MINUTES = 9;

export const MOBILITY_SESSIONS = {
  Wed: {
    key: "A", title: "Hips & ankles", focus: "hip mobility · ankle range",
    items: [
      { id: "couch_stretch", name: "Hip flexor (couch)", mode: "timed", durationSeconds: 50, bilateral: true,
        cue: "Rear foot up on a couch or wall, hips tall, squeeze the glute on that side" },
      { id: "hip_9090", name: "90/90 hip switch", mode: "timed", durationSeconds: 75, bilateral: false,
        cue: "Sit tall, sweep the knees side to side, let the chest follow" },
      { id: "adductor_rockback", name: "Adductor rock-back", mode: "timed", durationSeconds: 40, bilateral: true,
        cue: "On all fours, one leg out to the side — rock the hips back slowly" },
      { id: "ankle_rock", name: "Knee-over-toes ankle rock", mode: "timed", durationSeconds: 40, bilateral: true,
        cue: "Half-kneel close to a wall, drive the knee past the toes, keep the heel down" },
      { id: "tib_raise", name: "Tibialis raise", mode: "timed", durationSeconds: 45, bilateral: false,
        cue: "Back against a wall, heels forward — lift both forefeet, slow" },
      { id: "soleus_raise", name: "Bent-knee calf raise", mode: "timed", durationSeconds: 40, bilateral: true,
        cue: "Knee slightly bent throughout, slow up and down — that's the soleus" },
    ],
  },
  Fri: {
    key: "B", title: "Glutes & knees", focus: "glute med · quad capacity",
    items: [
      { id: "glute_bridge", name: "Glute bridge", mode: "timed", durationSeconds: 60, bilateral: false,
        cue: "Slow reps, 2 s squeeze at the top. Harder: one leg at a time" },
      { id: "sl_hip_abduction", name: "Side-lying leg raise", mode: "timed", durationSeconds: 45, bilateral: true,
        cue: "Top leg straight, toes pointing forward, lift from the hip" },
      { id: "copenhagen", name: "Copenhagen plank", mode: "timed", durationSeconds: 30, bilateral: true,
        cue: "Side plank with the top foot on a chair, knee bent (short lever). Inner thigh works" },
      { id: "wall_sit", name: "Wall sit", mode: "timed", durationSeconds: 60, bilateral: false,
        cue: "Thighs to about parallel. Quiet, steady quads — it should burn, not pinch" },
      { id: "step_down", name: "Slow step-down", mode: "timed", durationSeconds: 45, bilateral: true,
        cue: "Stand on a step, lower the free heel to a tap — 3 s down, knee tracking over the toes" },
    ],
  },
  Sun: {
    key: "C", title: "Core & control", focus: "trunk endurance · motor control",
    items: [
      { id: "dead_bug", name: "Dead bug", mode: "timed", durationSeconds: 60, bilateral: false,
        cue: "Low back pressed flat, slow opposite arm and leg" },
      { id: "side_plank", name: "Side plank", mode: "timed", durationSeconds: 35, bilateral: true,
        cue: "Straight line from ear to ankle, hips high. Harder: lift the top leg" },
      { id: "bird_dog", name: "Bird dog", mode: "timed", durationSeconds: 45, bilateral: true,
        cue: "Opposite arm and leg long, hips level — don't let them rotate" },
      { id: "glute_bridge", name: "Glute bridge (light)", mode: "timed", durationSeconds: 45, bilateral: false,
        cue: "Easy tempo — this one is about waking the glutes up, not fatiguing them" },
      { id: "hip_9090", name: "90/90 hip switch", mode: "timed", durationSeconds: 60, bilateral: false,
        cue: "Finish loose — slow switches, breathe out at the bottom of each" },
    ],
  },
};
