// health/whoop.js — the WHOOP adapter.
//
// A thin translation layer over js/whoop.js (the OAuth-broker client, which
// stays exactly as it was — it works and is verified against real data). All
// this does is present WHOOP's shapes through the common interface, and be
// honest about the two things WHOOP cannot supply.

import {
  whoopStatus, whoopConnect, whoopDisconnect,
  whoopRecovery, whoopSleep, whoopWorkouts, whoopCyclesAll, whoopBody, whoopBurnFor,
  mapRecovery, mapSleep, mapWorkout, mapCycle, mapBody,
  bestWorkoutFor as pickWorkout,
} from "../whoop.js";
import { CAP, acwr } from "./index.js";
import { todayISO } from "../model.js";

const provider = {
  id: "whoop",
  label: "WHOOP",

  // NOTE the two absences.
  //  - No CAP.vo2max: the workout endpoint has no VO2max field. WHOOP shows the
  //    number in its own app but has never exposed it via the API, so manual
  //    entry in Settings remains the only route and the app must not pretend
  //    otherwise.
  //  - CAP.zoneMinutes IS present, but the zones are WHOOP's own six bands, not
  //    the user's profile zones. They usually agree because the profile defaults
  //    to the same %HRmax model, but they are not guaranteed to.
  caps: [CAP.recovery, CAP.sleep, CAP.burn, CAP.workouts, CAP.body, CAP.load, CAP.zoneMinutes],

  async status() {
    const s = await whoopStatus();
    return {
      connected: !!s.connected,
      offline: !!s.offline,
      unconfigured: !!s.unconfigured,
      who: s.profile && s.profile.first_name ? s.profile.first_name : null,
    };
  },
  connect: whoopConnect,
  disconnect: whoopDisconnect,

  // WHOOP's own recovery score — a real vendor metric, so not flagged derived.
  async recoveryToday() {
    const recs = await whoopRecovery({ limit: 1 });
    const r = recs[0] && mapRecovery(recs[0]);
    return r ? { ...r, derived: false, source: "WHOOP" } : null;
  },

  async sleepFor(_iso) {
    // WHOOP's sleep collection is returned newest-first and a night is attributed
    // to the cycle it closes, so "last night" is simply the latest record. The
    // iso argument is accepted for interface symmetry and deliberately unused.
    const recs = await whoopSleep({ limit: 1 });
    return recs[0] ? mapSleep(recs[0]) : null;
  },

  // Calories OUT for a day: the cycle's kilojoule total (BMR + activity).
  async burnFor(iso) { return whoopBurnFor(iso || todayISO()); },

  async burnByDate(days = 60) {
    const out = {};
    for (const c of (await whoopCyclesAll(days)).map(mapCycle)) {
      if (c.date && c.kcal != null) out[c.date] = c.kcal;
    }
    return out;
  },

  async workoutsFor(iso) {
    const all = await whoopWorkouts({ limit: 25 });
    return all.filter((w) => (w.start || "").slice(0, 10) === iso).map(mapWorkout).filter(Boolean);
  },

  async bestWorkoutFor(iso) {
    const w = pickWorkout(await whoopWorkouts({ limit: 25 }), iso);
    return w ? mapWorkout(w) : null;
  },

  async body() { return mapBody(await whoopBody()); },

  async vo2max() { return null; },   // not exposed by the API — see caps above

  // Training load from daily strain. Strain is logarithmic 0-21, so the absolute
  // numbers mean nothing outside WHOOP — but the acute:chronic RATIO is still
  // meaningful, which is the whole point of routing it through acwr().
  async loadSeries(days = 35) {
    const cycles = (await whoopCyclesAll(days)).map(mapCycle);
    return acwr(
      cycles.filter((c) => c.strain != null).map((c) => ({ date: c.date, value: c.strain })),
      { unit: "strain", label: "WHOOP strain" },
    );
  },
};

export default provider;
export const createProvider = () => provider;
