// icons.js — single-stroke line-art, monochrome via currentColor (requirements §15).
// icon(id) returns an <svg>. Unknown ids fall back to a generic dot.
// Paths are intentionally simple/abstract; consistent 24x24 viewBox, stroke 2.

const P = {
  // --- day types ---
  run: "M13 4.5a1.6 1.6 0 1 0 0-.1ZM7 21l3-5 2 2 1 4M10 16l-2-4 4-3 3 2 3 .5M9 9l3-2 3 1",
  bike: "M6 18a3 3 0 1 0 0-.1ZM18 18a3 3 0 1 0 0-.1ZM6 18l4-7h5l-3-4M9 7h3M14 11l4 7",
  rest: "M4 18c4-6 12-6 16 0M7 10a2 2 0 1 0 0-.1ZM12 6v0M17 10v0",
  // --- implements ---
  barbell: "M3 12h2M19 12h2M6 8v8M8 8v8M16 8v8M18 8v8M8 12h8",
  dumbbell: "M4 9v6M6 9v6M18 9v6M20 9v6M6 12h12",
  cable: "M12 3v5M9 8h6l-1 6a2 2 0 0 1-4 0ZM7 21h10",
  ezbar: "M4 12h2M18 12h2M6 9v6M8 9v6M16 9v6M18 9v6M8 11c2 2 6 2 8 0",
  bodyweight: "M12 5a1.6 1.6 0 1 0 0-.1ZM12 8v6M8 10h8M10 20l2-6 2 6",
  // --- stretches / routine ---
  stretch: "M12 4a1.4 1.4 0 1 0 0-.1ZM12 7v6l-3 5M12 13l3 5M8 10l8 0",
  hamstring: "M5 20c2-8 12-8 14 0M9 6l3 4 3-4",
  quad: "M7 4v7l-2 9M17 4v7l2 9M7 8h10",
  hipflexor: "M6 20l4-9 4 3 4-7M10 11l-2-5",
  calf: "M9 4v8l-3 8M9 12h4l2 8",
  lats: "M12 4v6M6 7l6 3 6-3M7 20l5-10 5 10",
  chest: "M5 8h14M7 8c0 6 3 9 5 9s5-3 5-9",
  tspine: "M12 5v14M8 9l8 0M8 13c3 2 5 2 8 0",
  glute: "M8 6a3 3 0 1 0 0-.1ZM7 12c3 3 7 3 10 0l-2 8H9Z",
  walk: "M13 4.5a1.5 1.5 0 1 0 0-.1ZM11 21l1-7 2 1 1 5M12 14l-1-4 3-1 2 2M8 21l3-6",
  ankle: "M9 4v10l-3 6M9 14h5l1 6M5 20h6",
  arm: "M12 12a8 8 0 1 1-1-4M16 6l-1 3 3-1",
  generic: "M12 12a3 3 0 1 0 0-.1Z",
};

// alias many exercise / stretch ids to a base glyph
const ALIAS = {
  zone2: "run", intervals: "run", cardio: "run",
  back_squat: "barbell", rdl_barbell: "barbell", bench_press: "barbell",
  bent_over_row: "barbell", ohp_barbell: "barbell",
  ez_curl: "ezbar",
  lat_pulldown: "cable", face_pull: "cable", triceps_pushdown: "cable", cable_pallof: "cable",
  bulgarian_split_squat_db: "dumbbell", db_walking_lunge: "dumbbell", standing_calf_raise_db: "dumbbell",
  incline_db_press: "dumbbell", one_arm_db_row: "dumbbell", seated_db_shoulder_press: "dumbbell",
  db_reverse_fly: "dumbbell", db_lateral_raise: "dumbbell", db_hammer_curl: "dumbbell",
  overhead_triceps_ext: "dumbbell", db_goblet_squat: "dumbbell", db_rdl: "dumbbell",
  db_reverse_lunge: "dumbbell", db_hip_thrust: "dumbbell", db_calf_raise: "dumbbell",
  core_circuit: "bodyweight",
  // routine items
  easy_cardio: "bike", easy_jog_builtin: "run", leg_swings: "walk", hip_circles: "hipflexor",
  worlds_greatest: "stretch", scapular_wall_slides: "stretch", bodyweight_squats: "quad",
  arm_circles: "arm", ramp_up_sets: "barbell", ankle_rolls: "ankle",
  hip_flexors: "hipflexor", hamstrings: "hamstring", quads: "quad", chest_doorway: "chest",
  lats: "lats", tspine_rotation: "tspine", glute_figure4: "glute", glutes: "glute",
  easy_walk: "walk", calves: "calf",
};

export function iconPath(id) {
  const key = P[id] ? id : ALIAS[id] || "generic";
  return P[key];
}
export function icon(id, cls = "line") {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", cls);
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", iconPath(id));
  svg.appendChild(path);
  return svg;
}
