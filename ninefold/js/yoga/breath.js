// yoga/breath.js — how a hold counted in BREATHS becomes a number on a screen
// and a tone in your ears. Pure arithmetic: no DOM, no audio, no clock.
//
// Two functions, three lines, and they live in their own module for one reason:
// they were originally inline in the routine player's render loop, where nothing
// could reach them and the only verification available was reading them back.
// That is the same mistake as a test asserting a direction — it passes while the
// feature does nothing. Here they are testable, and tested.

/**
 * Breaths still to go in a hold.
 *
 * CEILING, not round: the count must read "5" for the whole of the first breath
 * and turn over only once that breath is finished. A counter that drops to 4
 * half a second in is counting the clock and calling it a breath, which is
 * exactly the difference the breath-paced mode exists to make.
 */
export const breathsRemaining = (remainingSec, breathSeconds) =>
  breathSeconds > 0 ? Math.max(0, Math.ceil(remainingSec / breathSeconds)) : 0;

/**
 * Which half-breath the practice is in at `elapsedSec`. Even is the inhale, odd
 * the exhale — so one breath is two phases and the pacer alternates correctly
 * without keeping any state of its own, which is what lets it survive a pause,
 * a +15s and the screen going off and coming back.
 */
export const breathPhaseAt = (elapsedSec, breathSeconds) =>
  breathSeconds > 0 ? Math.floor(elapsedSec / (breathSeconds / 2)) : 0;

export const isInhale = (phase) => phase % 2 === 0;

/**
 * How full the breathing orb is at `elapsedSec`: 0 at the bottom of an exhale,
 * 1 at the top of an inhale.
 *
 * COSINE, NOT A TRIANGLE. Linear growth turns around with a corner at the top of
 * the inhale, which is exactly where a breath should be unhurried. `(1 - cos 2πt)
 * / 2` is slowest at both ends and quickest through the middle, which is what a
 * breath actually does — and being one continuous expression over the whole
 * cycle, the inhale and the exhale cannot disagree at the join.
 *
 * Deliberately a function of elapsed time and nothing else: the orb, the breath
 * tone and the remaining count all read the same clock, so they cannot drift
 * apart across a pause, a +15s, or the screen going off and coming back.
 *
 * IN HERE RATHER THAN IN THE PLAYER because rAF does not run while the preview
 * pane is hidden, so anything living in the render loop can only be verified by
 * reading it back — the same reason breathsRemaining and breathPhaseAt are here.
 */
export const breathSwell = (elapsedSec, breathSeconds) => {
  if (!(breathSeconds > 0)) return 0;
  const t = (elapsedSec % breathSeconds) / breathSeconds;
  return (1 - Math.cos(2 * Math.PI * t)) / 2;
};
