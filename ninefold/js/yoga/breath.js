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
