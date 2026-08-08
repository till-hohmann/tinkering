// exercise-photo.js — resolves the photoreal anatomy renders (the Nano Banana
// series described in tools/illustration-prompts.md) for an exercise id.
//
// The app is buildless and served as static files, so it cannot list a directory.
// `tools/build-exercise-images.py` writes img/exercises/manifest.json listing the
// ids that actually shipped; this module fetches that once and answers from it.
// Everything degrades to the SVG figure when a render is missing, so partial
// coverage is fine — generate the library a few exercises at a time.

const DIR = "./img/exercises/";
let manifest = null;      // Set of exercise ids, or null until loaded
let pending = null;

// Fallbacks: warm-up/cool-down ids and substitute lifts borrow the render of the
// movement they mirror. Only consulted when the id has no render of its OWN —
// the prompt pack does ship dedicated prompts for the substitute lifts, and a
// dedicated render must always win over a borrowed one.
const SHARES = {
  db_bench_press: "bench_press",
  db_bent_row: "bent_over_row",
  bw_pallof: "cable_pallof",
  glutes: "hip_9090",
  glute_figure4: "hip_9090",
  adductors: "hip_9090",
  hip_flexors: "couch_stretch",
  quads: "couch_stretch",
  hamstrings: "db_rdl",
  calves: "soleus_raise",
  lats: "lat_pulldown",
  backward_walk: "step_down",
};

// Load the manifest once. Never throws — a missing manifest just means "no
// renders yet", which is the correct state before the first batch is generated.
export function loadPhotoManifest() {
  if (manifest) return Promise.resolve(manifest);
  if (pending) return pending;
  pending = fetch(DIR + "manifest.json")
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => { manifest = new Set((j && j.ids) || []); return manifest; })
    .catch(() => { manifest = new Set(); return manifest; });
  return pending;
}

// The render URL for an exercise, or null if none shipped. Call after
// loadPhotoManifest() has resolved.
export function photoURL(exerciseId) {
  if (!manifest) return null;
  if (manifest.has(exerciseId)) return `${DIR}${exerciseId}.webp`;
  const alt = SHARES[exerciseId];
  return alt && manifest.has(alt) ? `${DIR}${alt}.webp` : null;
}

export const hasPhoto = (exerciseId) => !!photoURL(exerciseId);
