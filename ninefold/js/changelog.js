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
  { v: 176, notes: [
    "Fixed: a yoga practice could open by saying \"stretch\" instead of naming the first pose, and then stay silent for the whole session. If the app had ever been opened before the voice was published, it kept believing there was no voice.",
    "Pausing a practice now stops the teacher mid-sentence. Resuming picks the pose back up rather than talking over where you already are.",
  ] },
  { v: 175, notes: [
    "In yoga, the teacher now tells you how to get into a pose WHILE you're moving into it, during the get-into-position countdown, and saves the alignment cues for once you're there.",
    "All spoken cues and countdowns are louder — about 7 dB up — and where your phone supports it the music dips for the length of each cue instead of the cue competing with it. The run countdown was getting lost under music.",
    "Cue volume is now a setting, from Soft to Over the beat. Profile → Audio.",
  ] },
  { v: 174, notes: [
    "If the spoken guidance hasn't been built on an install, the Yoga tab now says so instead of just running silent.",
  ] },
  { v: 173, notes: [
    "Yoga now has a voice. A real teacher talks you through every pose — names it, tells you how to get in, what matters, how long you're staying, and calls one more breath before you move on.",
    "Three experience levels. A beginner gets plain language, two cues and the way in; an expert gets the Sanskrit, the harder variation and far less talking. It changes which poses you're given, how long you hold them, and how much is explained.",
    "Sun salutations run as rounds now, the way a class does, instead of six five-second poses in a row.",
    "The breathing sound is actual breath rather than a tone.",
    "You can say what a practice stands in for. Do yin instead of your mobility session and Today shows that session as replaced, with the practice logged as its own summary.",
  ] },
  { v: 172, notes: [
    "Fixed: the button that starts a yoga practice was missing until you tapped something, and then sat underneath the tab bar where you couldn't reach it.",
    "The sequence now opens as its shape — how long each part takes and what the peak is — with the full pose list one tap away. A 45-minute flow was five screens of scrolling before you could start it.",
    "Once you've said what you're protecting, that question folds away to a single line instead of asking again every time.",
    "The practice screen fits on one screen again, including on a smaller phone.",
  ] },
  { v: 171, notes: [
    "There is a Yoga tab. You say what you want from a practice and how long you have, and it composes one — warm-up, build, a peak pose it has actually prepared you for, its counter-pose, and a savasana in proportion to the session.",
    "Holds are counted in breaths rather than seconds, with a soft tone marking the inhale and the exhale.",
    "You can tell it what you're protecting — knees, low back, SI joint, wrists, neck, shoulders — and it builds around that rather than filtering afterwards. It names the poses it left out and what it put in their place.",
    "The Ashtanga Primary Series is there in full, in its own fixed order, because that is what it is.",
    "A practice counts towards your week but never as hard sets. If one stood in for a lifting day, Progress says which muscles came up short.",
  ] },
  { v: 170, notes: [
    "The block builder now shows which of your picks actually shapes the lifting — with the reps, rest and effort it means — and says so when a second choice won't change anything.",
    "Generated blocks are checked before you start them: weekly sets per muscle, rep ranges suited to their job, rest matched to the loads, and nothing left untrained. Anything it can't fix, it names.",
    "A new block now varies its exercises from your last two, and tells you if something has been getting skipped across blocks.",
  ] },
  { v: 167, notes: [
    "During a workout you can now swap an exercise for one that trains the same thing, add any exercise from the full list, and add or drop a set.",
    "If a session didn't match the plan, the app asks once at the end whether to keep the change, ignore it, or just bear it in mind next time.",
    "A gym set up with pound plates can now be switched back to metric.",
    "A block can be exported as a spreadsheet, edited, and imported back — useful for checking a plan over before you start it.",
  ] },
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
