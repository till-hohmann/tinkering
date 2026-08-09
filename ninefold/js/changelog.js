// changelog.js — what to tell someone who has been away since version N.
//
// ONLY USER-VISIBLE CHANGES BELONG HERE. A release that fixed a race, tightened a
// guard or renamed a variable gets no entry, and that is the point: a notice that
// appears every time anything ships stops being read within a fortnight. Several
// versions below are deliberately absent for exactly that reason.
//
// Newest first. Each `v` is the numeric part of APP_VERSION, so the app can show
// only what happened since the last version this device actually saw.
//
// Write the lines for the person using the app, not the person who fixed it:
// "stretches now adjust to what you held", never "wired stretchProg through the
// routine player".

export const CHANGELOG = [
  { v: 166, notes: [
    "This card. When the app updates it will tell you what changed, once, and only when there is something worth saying.",
  ] },
  { v: 165, notes: [
    "Stretches in warm-ups and cool-downs now adapt. Stop one early and the next one asks for what you actually held; hold it fully twice and it grows.",
  ] },
  { v: 162, notes: [
    "Apple Health setup is much harder to get wrong — the exact fields are shown, and the app now says so when data arrives under names it can't read.",
  ] },
  { v: 161, notes: [
    "Bodyweight has its own place in Profile, and the strength benchmark now says what it needs instead of quietly staying empty.",
    "A gym can be set to pound plates independently of your units, so travelling no longer produces weights the bar can't make.",
  ] },
  { v: 157, notes: [
    "If your backup stops working you'll be told, rather than finding out when you need it.",
  ] },
  { v: 156, notes: [
    "A reinstalled app can restore everything from the first screen — tap \"I already have a backup\" before setting up.",
  ] },
  { v: 153, notes: [
    "Somewhere new? Describe it once for that session with \"Just for today\" and nothing is saved.",
    "Each gym keeps its own plates, dumbbells and cable stack, so the weights asked for are ones that gym can actually load.",
  ] },
];

/** The numeric part of a version string: "v165" -> 165. */
export const versionNumber = (v) => {
  const m = String(v || "").match(/(\d+)/);
  return m ? Number(m[1]) : 0;
};

/** The most recent release that actually had something to say. */
export const latestNotes = (max = 6) => (CHANGELOG[0] ? CHANGELOG[0].notes.slice(0, max) : []);

/**
 * Entries newer than `sinceVersion`, capped so someone returning after months
 * gets the highlights rather than a wall. Returns [] when there is nothing to
 * say, which is the case the caller should treat as "show nothing at all".
 */
export function notesSince(sinceVersion, currentVersion, max = 6) {
  const from = versionNumber(sinceVersion);
  const to = versionNumber(currentVersion);
  if (!to || to <= from) return [];
  const out = [];
  for (const entry of CHANGELOG) {
    if (entry.v <= from || entry.v > to) continue;
    for (const n of entry.notes) {
      if (out.length < max) out.push(n);
    }
  }
  return out;
}
