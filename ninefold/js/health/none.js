// health/none.js — the no-tracker provider, and the DEFAULT.
//
// Every method returns the interface's documented empty value. It declares no
// capabilities, so views hide their tracker cards entirely rather than showing
// permanently blank ones.
//
// This is not a degraded mode. Manual entry covers every field a tracker would
// fill — runs, bodyweight, sleep, macros — and the progression, cardio and
// volume engines never needed a wearable in the first place. The only things
// genuinely lost are the ones nobody can compute without continuous HR:
// a recovery score, a daily burn figure, and per-workout zone minutes.

const provider = {
  id: "none",
  label: "No tracker",
  caps: [],

  async status() { return { connected: false, unconfigured: true }; },
  async connect() { throw new Error("No tracker selected"); },
  async disconnect() {},

  async recoveryToday() { return null; },
  async sleepFor() { return null; },
  async burnFor() { return null; },
  async burnByDate() { return {}; },
  async workoutsFor() { return []; },
  async bestWorkoutFor() { return null; },
  async body() { return null; },
  async vo2max() { return null; },
  async loadSeries() { return null; },
};

export default provider;
export const createProvider = () => provider;
