// test.mjs — assertions for the pure engines.
//
//   node tools/test.mjs
//
// Covers the logic that has no DOM and no storage: profile derivations, the
// strength standards, equipment resolution and the load-rounding engine. These
// are the parts where a silent wrong answer is worst — they produce the numbers
// the user actually trains against.
//
// Also guards the public build: the "ships empty" suite fails if a personal
// value or a credential ever reappears in committed source.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

import {
  defaultProfile, makePlace, estimateMaxHR, ageOf, resolveMaxHR, resolveZoneBounds,
  proteinTarget, equipmentFor, withPlace, ZONE_PCT, placeNames, needsPlacePrompt, TRACKED_FEATURES,
  lbFromKg, kgFromLb, inFromCm, cmFromIn, miFromKm, kmFromMi,
} from "../js/profile.js";
import { strengthScore, liftScore, standardsFor, STANDARDS_BY_SEX, LEVELS } from "../js/standards.js";
import { roundLoad, loadCeiling, nextLoadUp, rackAt } from "../js/progression.js";
import { BUILD_CONFIG, hasBackup, hasWhoop } from "../js/config.js";
import { EXERCISE_LIBRARY, checkLibrary, availableAt, pickForPattern } from "../js/exercise-library.js";
import { FULL_GYM, EXERCISE_NEEDS, stationsKnown, canDoHere, SURVEYED, IMPLEMENTS, STATIONS, PRESETS } from "../js/equipment.js";
import { MUSCLE_MAP } from "../js/volume.js";
import { EXERCISE_ANATOMY } from "../js/exercise-anatomy.js";
import { hasIllustration } from "../js/illustrations.js";
import { compatibility, interference, analysePriorities, blockShape } from "../js/builder/adaptations.js";
import { generateProgram, spreadDays } from "../js/builder/generate.js";
import { THEMES, themeById, DEFAULT_THEME } from "../js/theme.js";
import { weightValue, fmtWeight, weightToKg, kgToLb, lbToKg, IMPERIAL_EQUIPMENT, METRIC_EQUIPMENT,
  defaultEquipmentFor, plateLabel, plateColor, weightLabel, isImperialWeight, setDisplayProfile,
  distanceValue, distanceToKm, lengthValue, lengthToCm, fmtPace as fmtPaceU, paceLabel,
  METRIC_PROFILE, readEdit, isStockRack, rackFields } from "../js/units.js";
import { fmtWeight as fmtWeightM, fmtPace as fmtPaceM, setDisplay } from "../js/model.js";
import { parseAppleExport, summarise, appleTime } from "../js/health/apple-import.js";
import { metaFor, candidatesFor, seedSubLoad, SUB_CANDIDATES } from "../js/substitution.js";
import * as mob from "../js/mobility.js";
import { applyStretchResults, applyStretchTargets, stretchTarget, STRETCH_MIN, STRETCH_CAP } from "../js/stretch.js";
import { CHANGELOG, notesSince, versionNumber } from "../js/changelog.js";

let passed = 0, failed = 0;
const groups = [];
function group(name, fn) { groups.push([name, fn]); }
function it(name, fn) {
  try { fn(); passed++; }
  catch (e) { failed++; console.error(`  FAIL  ${name}\n        ${e.message}`); }
}

// ---------------------------------------------------------------------------
group("profile — ships empty", () => {
  const p = defaultProfile();
  it("carries no identity", () => {
    assert.equal(p.sex, null);
    assert.equal(p.birthYear, null);
    assert.equal(p.name, "");
  });
  it("carries no goal", () => {
    assert.equal(p.goal.weightKg, null);
    assert.equal(p.goal.baselineKg, null);
    assert.equal(p.goal.baselineDate, null);
  });
  it("carries no physiology", () => {
    assert.equal(p.physiology.maxHR, null);
    assert.equal(p.physiology.zoneBounds, null);
  });
  it("has no places and no tracker", () => {
    assert.deepEqual(p.places, []);
    assert.equal(p.tracker.provider, "none");
  });
  it("defaults to maintenance, not a cut", () => {
    // A fresh user has not said they want to lose weight. Defaulting the deficit
    // to a non-zero number would put every new install into a deficit silently.
    assert.equal(p.nutrition.deficitTarget, 0);
  });
  it("is not onboarded", () => assert.equal(p.onboardedAt, null));
});

group("profile — max HR and zones", () => {
  it("estimateMaxHR uses Tanaka, not 220-age", () => {
    assert.equal(estimateMaxHR(40), Math.round(208 - 0.7 * 40));   // 180, vs 180 for 220-age
    assert.equal(estimateMaxHR(60), 166);                          // 220-age would say 160
    assert.equal(estimateMaxHR(null), null);
  });
  it("ageOf rejects nonsense", () => {
    assert.equal(ageOf({ birthYear: 1985 }, 2026), 41);
    assert.equal(ageOf({ birthYear: null }, 2026), null);
    assert.equal(ageOf({ birthYear: 1700 }, 2026), null);
  });
  it("explicit max HR beats the age estimate", () => {
    const p = { ...defaultProfile(), birthYear: 1985, physiology: { maxHR: 194, zoneBounds: null } };
    assert.equal(resolveMaxHR(p), 194);
  });
  it("falls back to the age estimate", () => {
    const p = { ...defaultProfile(), birthYear: 1986 };
    assert.equal(resolveMaxHR(p), estimateMaxHR(2026 - 1986));
  });
  it("zone bounds are 6 strictly increasing numbers", () => {
    const p = { ...defaultProfile(), birthYear: 1985 };
    const z = resolveZoneBounds(p);
    assert.equal(z.length, 6);
    for (let i = 1; i < z.length; i++) assert.ok(z[i] > z[i - 1], `zone ${i} not above ${i - 1}: ${z}`);
  });
  it("top of zone 5 is exactly max HR", () => {
    const p = { ...defaultProfile(), physiology: { maxHR: 194, zoneBounds: null } };
    assert.equal(resolveZoneBounds(p)[5], 194);
  });
  it("explicit zone bounds survive untouched", () => {
    const mine = [108, 138, 152, 166, 181, 194];
    const p = { ...defaultProfile(), physiology: { maxHR: 194, zoneBounds: mine } };
    assert.deepEqual(resolveZoneBounds(p), mine);
  });
  it("returns null when nothing is known", () => {
    assert.equal(resolveZoneBounds(defaultProfile()), null);
  });
  it("ZONE_PCT is ordered and plausible", () => {
    assert.equal(ZONE_PCT.length, 5);
    for (let i = 1; i < 5; i++) assert.ok(ZONE_PCT[i] > ZONE_PCT[i - 1]);
    assert.ok(ZONE_PCT[0] > 0.4 && ZONE_PCT[4] < 1);
  });
});

group("profile — units round-trip", () => {
  it("weight", () => {
    assert.ok(Math.abs(kgFromLb(lbFromKg(100)) - 100) < 1e-9);
    assert.ok(Math.abs(lbFromKg(100) - 220.462) < 0.01);
  });
  it("length", () => {
    assert.ok(Math.abs(cmFromIn(inFromCm(90)) - 90) < 1e-9);
    assert.ok(Math.abs(inFromCm(2.54) - 1) < 1e-9);
  });
  it("distance", () => {
    assert.ok(Math.abs(kmFromMi(miFromKm(10)) - 10) < 1e-9);
    assert.ok(Math.abs(miFromKm(1.609344) - 1) < 1e-9);
  });
  it("null in, null out", () => {
    assert.equal(lbFromKg(null), null);
    assert.equal(kmFromMi(null), null);
  });
});

group("profile — places replace hardcoded cities", () => {
  const program = {
    equipmentProfile: {
      barWeightKg: 20, ezBarWeightKg: 7.5,
      barbellPlatesKg: [20, 10, 5, 2.5, 1.25], ezBarPlatesKg: [20, 10, 5, 2.5, 1.25],
      cable: { minKg: 2.5, maxKg: 120, stepKg: 2.5 },
      dumbbells: { Gym: { minKg: 7.5, maxKg: 22.5, stepKg: 2.5 }, Home: { valuesKg: [5, 9, 13, 20, 30, 40] } },
      locations: { Gym: ["barbell", "ez_bar", "cable", "dumbbell_pair"], Home: ["dumbbell_pair"] },
    },
  };
  it("no places falls back to the program's own profile", () => {
    const e = equipmentFor(defaultProfile(), program);
    assert.deepEqual(e.locations.Gym, ["barbell", "ez_bar", "cable", "dumbbell_pair"]);
  });
  it("no places and no program still yields a usable gym", () => {
    const e = equipmentFor(defaultProfile(), null);
    assert.ok(e.barWeightKg > 0);
    assert.ok(Object.keys(e.locations).length >= 1);
  });
  it("user places win and any name works", () => {
    const p = { ...defaultProfile(), places: [
      makePlace("Basement", { implements: ["dumbbell_pair", "bodyweight"], dumbbells: { valuesKg: [8, 12, 16, 24] } }),
      makePlace("Hotel", { implements: ["bodyweight"] }),
    ] };
    const e = equipmentFor(p, program);
    assert.deepEqual(e.locations.Basement, ["dumbbell_pair", "bodyweight"]);
    assert.deepEqual(e.dumbbells.Basement.valuesKg, [8, 12, 16, 24]);
    assert.deepEqual(e.locations.Hotel, ["bodyweight"]);
  });
  it("plates and the cable stack resolve PER PLACE, not from the first one", () => {
    // The bug this guards: bar, plates and cable used to be read from places[0]
    // for every place, so someone training in a different gym most weeks was
    // prescribed their first gym's loadable weights everywhere. Invisible if you
    // always train in one room; wrong most weeks if you don't.
    const p = { ...defaultProfile(), places: [
      makePlace("Home rack", { implements: ["barbell", "cable", "bodyweight"],
        barbellPlatesKg: [20, 10, 5, 2.5], cable: { minKg: 2.5, maxKg: 120, stepKg: 2.5 } }),
      makePlace("Hotel", { implements: ["barbell", "cable", "bodyweight"],
        barbellPlatesKg: [25, 20, 15, 10, 5, 2.5, 1.25], cable: { minKg: 5, maxKg: 90, stepKg: 5 } }),
    ] };
    const e = equipmentFor(p, null);
    assert.deepEqual(rackAt(e, "Hotel").barbellPlatesKg, [25, 20, 15, 10, 5, 2.5, 1.25]);
    assert.equal(rackAt(e, "Hotel").cable.stepKg, 5);
    assert.equal(rackAt(e, "Home rack").cable.stepKg, 2.5);
    // and the rounding that actually reaches the athlete
    assert.equal(roundLoad(47.5, "cable", "Home rack", e), 47.5, "a 2.5 kg stack can set 47.5");
    assert.equal(roundLoad(47.5, "cable", "Hotel", e), 50, "a 5 kg stack cannot");
  });
  it("a one-off place reaches the engines without touching the profile", () => {
    // The traveller case: a gym used once should behave exactly like a saved
    // place for the length of a session, and leave nothing behind.
    const p = { ...defaultProfile(), places: [
      makePlace("Home rack", { implements: ["barbell", "bodyweight"], barbellPlatesKg: [20, 10, 5, 2.5] }),
    ] };
    const base = equipmentFor(p, null);
    const away = withPlace(base, { name: "Away", implements: ["dumbbell_pair", "cable", "bodyweight"],
      cable: { minKg: 5, maxKg: 90, stepKg: 5 }, dumbbells: { minKg: 2, maxKg: 24, stepKg: 2 } });
    assert.deepEqual(away.locations.Away, ["dumbbell_pair", "cable", "bodyweight"]);
    assert.equal(roundLoad(47.5, "cable", "Away", away), 50);
    assert.equal(roundLoad(23, "dumbbell_pair", "Away", away), 24);
    assert.ok(away.locations["Home rack"], "the saved place must survive the fold");
    assert.equal(base.locations.Away, undefined, "the base object must not be mutated");
    assert.deepEqual(p.places.map((x) => x.name), ["Home rack"], "nothing written to the profile");
  });
  it("a one-off place overrides a saved place of the same name", () => {
    // "I'm at my usual gym, but the rack is out of order" — today's answer wins.
    const p = { ...defaultProfile(), places: [
      makePlace("Gym", { implements: ["barbell", "rack", "bodyweight"] }),
    ] };
    const today = withPlace(equipmentFor(p, null), { name: "Gym", implements: ["dumbbell_pair", "bodyweight"] });
    assert.deepEqual(today.locations.Gym, ["dumbbell_pair", "bodyweight"]);
  });
  it("withPlace on nothing is a no-op", () => {
    const e = equipmentFor(defaultProfile(), null);
    assert.equal(withPlace(e, null), e);
    assert.equal(withPlace(e, { name: "" }), e);
  });
  it("a rack with no byPlace entry falls back to the flat fields", () => {
    // Programs carry a flat equipmentProfile and callers without a location in
    // hand pass it straight through — that path must keep working untouched.
    assert.equal(roundLoad(47.5, "cable", "Anywhere", program.equipmentProfile), 47.5);
    assert.equal(rackAt(program.equipmentProfile, "Nowhere").barWeightKg, 20);
  });
  it("a program location the profile doesn't describe is preserved", () => {
    // Importing someone else's program must never strand a day with no kit.
    const p = { ...defaultProfile(), places: [makePlace("Basement", { implements: ["dumbbell_pair"] })] };
    const e = equipmentFor(p, program);
    assert.ok(e.locations.Gym, "program location dropped");
  });
  it("place prompting only when there's a real choice", () => {
    assert.equal(needsPlacePrompt(defaultProfile()), false);
    const one = { ...defaultProfile(), places: [makePlace("Gym")] };
    assert.equal(needsPlacePrompt(one), false);
    const two = { ...defaultProfile(), places: [makePlace("Gym"), makePlace("Home")] };
    assert.equal(needsPlacePrompt(two), true);
    assert.deepEqual(placeNames(two), ["Gym", "Home"]);
  });
});

group("profile — protein target", () => {
  it("scales with bodyweight", () => {
    const p = defaultProfile();
    assert.equal(proteinTarget(p, 100), 180);
  });
  it("null without a bodyweight", () => assert.equal(proteinTarget(defaultProfile(), null), null));
});

// ---------------------------------------------------------------------------
group("standards — sex is required, not assumed", () => {
  it("returns null when sex is unknown", () => {
    // The old code silently applied male ratios to everyone.
    assert.equal(strengthScore({ back_squat: 140 }, 90, null), null);
    assert.equal(strengthScore({ back_squat: 140 }, 90, undefined), null);
  });
  it("both tables exist and cover the same lifts", () => {
    const m = Object.keys(STANDARDS_BY_SEX.male).sort();
    const f = Object.keys(STANDARDS_BY_SEX.female).sort();
    assert.deepEqual(m, f);
  });
  it("the same lift scores differently by sex", () => {
    const male = strengthScore({ back_squat: 100 }, 80, "male");
    const female = strengthScore({ back_squat: 100 }, 80, "female");
    assert.ok(female.overall > male.overall, "female ratios should score the same lift higher");
  });
  it("ratios are strictly increasing in both tables", () => {
    for (const [sex, table] of Object.entries(STANDARDS_BY_SEX)) {
      for (const [lift, std] of Object.entries(table)) {
        for (let i = 1; i < std.ratios.length; i++) {
          assert.ok(std.ratios[i] > std.ratios[i - 1], `${sex}.${lift} ratio ${i} not increasing`);
        }
      }
    }
  });
  it("standardsFor is null-safe", () => {
    assert.equal(standardsFor("nonsense"), null);
    assert.ok(standardsFor("female"));
  });
});

group("standards — score boundaries", () => {
  const ratios = STANDARDS_BY_SEX.male.back_squat.ratios;
  it("first boundary scores 20", () => {
    const s = liftScore(ratios[0] * 100, 100, ratios);
    assert.equal(s.score, 20);
    assert.equal(s.level, LEVELS[0]);
  });
  it("top boundary caps at 100 and Elite", () => {
    const s = liftScore(ratios[4] * 100, 100, ratios);
    assert.equal(s.score, 100);
    assert.equal(s.level, "Elite");
    assert.equal(s.next, null);
  });
  it("below the first boundary is Developing", () => {
    const s = liftScore(ratios[0] * 50, 100, ratios);
    assert.equal(s.level, "Developing");
    assert.ok(s.score < 20);
  });
  it("no bodyweight, no score", () => assert.equal(liftScore(140, null, ratios), null));
});

// ---------------------------------------------------------------------------
group("progression — discrete racks at any place name", () => {
  // The regression this guards: nextLoadUp/loadDown used to test
  // `location === "Home"` literally, so a discrete dumbbell set at ANY other
  // place silently fell through to a generic 2.5 kg step and could prescribe a
  // weight that does not exist on the rack.
  const equip = {
    barWeightKg: 20, barbellPlatesKg: [20, 10, 5, 2.5, 1.25],
    dumbbells: {
      Basement: { valuesKg: [5, 7, 9, 11, 13, 15, 18, 20, 22, 25, 27, 29, 32, 34, 36, 38, 40] },
      Gym: { minKg: 7.5, maxKg: 22.5, stepKg: 2.5 },
    },
    locations: { Basement: ["dumbbell_pair"], Gym: ["barbell", "dumbbell_pair"] },
  };
  it("rounds to a real dumbbell on a discrete rack", () => {
    // Values chosen off the midpoints: 21 and 26 are exact ties on this rack
    // (20|22 and 25|27), so they'd assert a tie-break rule rather than rounding.
    assert.equal(roundLoad(23, "dumbbell_pair", "Basement", equip), 22);
    assert.equal(roundLoad(26.5, "dumbbell_pair", "Basement", equip), 27);
    assert.equal(roundLoad(4, "dumbbell_pair", "Basement", equip), 5);   // clamps to lightest
  });
  it("steps UP the discrete list, not by 2.5", () => {
    assert.equal(nextLoadUp(15, "dumbbell_pair", "Basement", equip), 18);
    assert.equal(nextLoadUp(29, "dumbbell_pair", "Basement", equip), 32);
  });
  it("never exceeds the heaviest dumbbell present", () => {
    assert.equal(nextLoadUp(40, "dumbbell_pair", "Basement", equip), 40);
    assert.equal(loadCeiling("dumbbell_pair", "Basement", equip), 40);
  });
  it("fixed-step racks still honour their ceiling", () => {
    assert.equal(loadCeiling("dumbbell_pair", "Gym", equip), 22.5);
    assert.ok(roundLoad(30, "dumbbell_pair", "Gym", equip) <= 22.5);
  });
  it("barbell rounds to loadable plate pairs", () => {
    const v = roundLoad(83, "barbell", "Gym", equip);
    assert.ok(v >= 20, "never below the empty bar");
    assert.ok(Math.abs((v - 20) % 2.5) < 1e-9, `${v} is not a loadable total`);
  });
  it("bodyweight has no ceiling", () => {
    assert.equal(loadCeiling("bodyweight", "Gym", equip), null);
    assert.equal(loadCeiling("barbell", "Gym", equip), null);
  });
});

// ---------------------------------------------------------------------------
group("substitution — every candidate resolves to a real lift", () => {
  // A program's exercise map only holds what THAT plan uses, so most substitute
  // candidates aren't in it. They used to fall through to a last-resort stub
  // that printed the raw id and called everything a dumbbell PAIR — which then
  // fed the seed ratio and the load rounding. Anyone training away from their
  // planned place hits this on almost every session.
  const prog = { exercises: { back_squat: { name: "Barbell Back Squat", implement: "barbell", cue: "" } } };
  it("no candidate anywhere renders as its own id", () => {
    for (const orig of Object.keys(SUB_CANDIDATES)) {
      for (const cid of candidatesFor(orig)) {
        const m = metaFor(prog, cid);
        assert.notEqual(m.name, cid, `${cid} has no display name`);
        assert.ok(m.name && m.name.length > 2, `${cid} name looks wrong: ${m.name}`);
      }
    }
  });
  it("candidates carry their TRUE implement, not a dumbbell-pair default", () => {
    assert.equal(metaFor(prog, "db_goblet_squat").implement, "dumbbell_single");
    assert.equal(metaFor(prog, "one_arm_db_row").implement, "dumbbell_single");
    assert.equal(metaFor(prog, "core_circuit").implement, "bodyweight");
    assert.equal(metaFor(prog, "incline_db_press").implement, "dumbbell_pair");
  });
  it("a bodyweight substitute is seeded at zero load, not a prescribed weight", () => {
    const equip = { dumbbells: { Away: { minKg: 2, maxKg: 24, stepKg: 2 } }, locations: { Away: ["dumbbell_pair"] } };
    const impl = metaFor(prog, "core_circuit").implement;
    assert.equal(seedSubLoad("cable_pallof", "core_circuit", 30, impl, "Away", equip), 0);
  });
  it("a substitute is never seeded above the heaviest dumbbell there", () => {
    const equip = { dumbbells: { Away: { minKg: 2, maxKg: 24, stepKg: 2 } }, locations: { Away: ["dumbbell_pair"] } };
    const impl = metaFor(prog, "db_goblet_squat").implement;
    assert.ok(seedSubLoad("back_squat", "db_goblet_squat", 120, impl, "Away", equip) <= 24);
  });
  it("the program's own entry still wins over the library", () => {
    const custom = { exercises: { db_goblet_squat: { name: "My Goblet", implement: "dumbbell_single", cue: "" } } };
    assert.equal(metaFor(custom, "db_goblet_squat").name, "My Goblet");
  });
});

// ---------------------------------------------------------------------------
group("mobility — the routine is data, so a build can serve two people", () => {
  it("the build's own routine is storable — days as an array, not a Set", () => {
    const r = mob.defaultRoutine();
    assert.ok(Array.isArray(r.days) && r.days.length, "days must survive JSON");
    assert.deepEqual(JSON.parse(JSON.stringify(r)), r, "routine must round-trip through JSON");
    assert.ok(Object.keys(r.sessions).length >= 1);
  });
  it("applying a stored routine swaps what every view reads", () => {
    const custom = { title: "My rehab", minutes: 12, days: ["Mon", "Thu"], sessions: {
      Mon: { key: "R", title: "Reset", focus: "knee", items: [{ id: "x", name: "X", mode: "timed", durationSeconds: 30 }] },
      Thu: { key: "A", title: "Hips", focus: "hips", items: [{ id: "y", name: "Y", mode: "timed", durationSeconds: 30 }] },
    } };
    assert.equal(mob.applyRoutine(custom), true);
    assert.equal(mob.MOBILITY_TITLE, "My rehab");
    assert.equal(mob.MOBILITY_MINUTES, 12);
    assert.equal(mob.isMobilityDay("Mon"), true);
    assert.equal(mob.isMobilityDay("Wed"), false, "the default's days must not linger");
    assert.equal(mob.sessionFor("Mon").title, "Reset");
    assert.equal(mob.sessionByKey("R").title, "Reset");
  });
  it("days fall back to whatever weekdays the routine defines", () => {
    assert.equal(mob.applyRoutine({ sessions: { Sat: { key: "A", title: "S", items: [] } } }), true);
    assert.deepEqual([...mob.MOBILITY_DAYS], ["Sat"]);
  });
  it("junk is refused rather than leaving the app with no sessions", () => {
    const before = mob.MOBILITY_SESSIONS;
    for (const bad of [null, undefined, {}, { sessions: {} }, { sessions: "nope" }, { title: "x" }]) {
      assert.equal(mob.applyRoutine(bad), false, `accepted ${JSON.stringify(bad)}`);
    }
    assert.equal(mob.MOBILITY_SESSIONS, before, "a refused routine must change nothing");
  });
  it("restores cleanly to the build default", () => {
    assert.equal(mob.applyRoutine(mob.defaultRoutine()), true);
    assert.equal(mob.MOBILITY_TITLE, "Mobility & stability");
  });
});

// ---------------------------------------------------------------------------
group("stretches — a hold you cut short changes the next one", () => {
  const ham  = { id: "ham_stretch", name: "Hamstring", mode: "timed", durationSeconds: 40 };
  const quad = { id: "quad_stretch", name: "Quad", mode: "timed", durationSeconds: 40 };
  const jog  = { id: "easy_jog", name: "Easy jog", mode: "timed", durationSeconds: 120 };
  const items = [ham, quad, jog];
  const hold = (id, sec, side) => ({ id, side: side || null, targetSec: 40, heldSec: sec });

  it("starts from whatever the program prescribes", () => {
    assert.equal(stretchTarget({}, ham), 40);
  });
  it("two full holds earn +5s, one does not", () => {
    let st = applyStretchResults({}, items, [hold("ham_stretch", 40)]).state;
    assert.equal(stretchTarget(st, ham), 40, "one good hold should not promote");
    st = applyStretchResults(st, items, [hold("ham_stretch", 41)]).state;
    assert.equal(stretchTarget(st, ham), 45);
  });
  it("stopping well short re-bases the target to what was actually held", () => {
    // The whole point: 40s was too long, so stop asking for 40s.
    const { state, changes } = applyStretchResults({}, items, [hold("ham_stretch", 22)]);
    assert.equal(stretchTarget(state, ham), 20);
    assert.ok(changes.some((c) => /Hamstring/.test(c)));
  });
  it("close-but-not-full leaves it alone", () => {
    const st = applyStretchResults({}, items, [hold("ham_stretch", 32)]).state;   // 80%
    assert.equal(stretchTarget(st, ham), 40);
  });
  it("the worst side governs a two-sided stretch", () => {
    const st = applyStretchResults({}, items, [
      hold("ham_stretch", 40, "left"), hold("ham_stretch", 18, "right")]).state;
    assert.equal(stretchTarget(st, ham), 20, "a 40/18 stretch is an 18 stretch");
  });
  it("never prescribes below the floor or above the cap", () => {
    const low = applyStretchResults({}, items, [hold("ham_stretch", 1)]).state;
    assert.ok(stretchTarget(low, ham) >= STRETCH_MIN);
    let hi = { ham_stretch: { targetSec: STRETCH_CAP, streak: 1, lastActual: STRETCH_CAP } };
    hi = applyStretchResults(hi, items, [hold("ham_stretch", STRETCH_CAP + 10)]).state;
    assert.equal(stretchTarget(hi, ham), STRETCH_CAP, "must not grow past the cap");
  });
  it("an item you never reached is untouched", () => {
    // Bailing out of a cool-down must not read as failing everything in it.
    const st = applyStretchResults({}, items, [hold("ham_stretch", 12)]).state;
    assert.equal(st.quad_stretch, undefined);
    assert.equal(stretchTarget(st, quad), 40);
  });
  it("applies targets to a routine without touching dynamic work", () => {
    const isStretch = (it) => /stretch/.test(it.id);
    const st = { ham_stretch: { targetSec: 55, streak: 0, lastActual: 55 } };
    const { def, items: applied } = applyStretchTargets({ items }, st, isStretch);
    assert.equal(def.items.find((i) => i.id === "ham_stretch").durationSeconds, 55);
    assert.equal(def.items.find((i) => i.id === "easy_jog").durationSeconds, 120, "the jog is not a stretch");
    assert.equal(applied.length, 3);
  });
  it("a skipped session changes nothing at all", () => {
    const before = { ham_stretch: { targetSec: 45, streak: 1, lastActual: 45 } };
    assert.deepEqual(applyStretchResults(before, items, []).state, before);
  });
});

// ---------------------------------------------------------------------------
group("release notes — only when there is something to say", () => {
  it("shows nothing when you are already current", () => {
    assert.deepEqual(notesSince("v165", "v165"), []);
    assert.deepEqual(notesSince("v170", "v165"), [], "a newer 'seen' must not go backwards");
  });
  it("shows only what happened since the version you saw", () => {
    const since161 = notesSince("v161", "v165");
    assert.ok(since161.length >= 1);
    assert.ok(since161.some((n) => /stretch/i.test(n)), "should include the v165 change");
    assert.ok(!since161.some((n) => /Just for today/i.test(n)), "v153 is older than v161");
  });
  it("caps a long absence rather than dumping everything", () => {
    const all = notesSince("v100", "v165", 3);
    assert.equal(all.length, 3);
  });
  it("entries are ordered newest first and carry a numeric version", () => {
    for (let i = 1; i < CHANGELOG.length; i++)
      assert.ok(CHANGELOG[i].v < CHANGELOG[i - 1].v, "changelog must stay newest-first");
    for (const e of CHANGELOG) {
      assert.ok(Number.isInteger(e.v) && e.v > 0);
      assert.ok(e.notes.length && e.notes.every((n) => typeof n === "string" && n.length > 10));
    }
  });
  it("no entry reads like a commit message", () => {
    // The rule this file exists to enforce: written for the person using the app.
    const jargon = /(refactor|wired|pref|param|regex|null|API|endpoint|guard|commit)/i;
    for (const e of CHANGELOG) for (const n of e.notes)
      assert.ok(!jargon.test(n), `too technical: "${n}"`);
  });
  it("versionNumber tolerates whatever it is handed", () => {
    assert.equal(versionNumber("v165"), 165);
    assert.equal(versionNumber("165"), 165);
    assert.equal(versionNumber(undefined), 0);
    assert.equal(versionNumber("nonsense"), 0);
  });
});

// ---------------------------------------------------------------------------
group("config — the public build carries no secrets", () => {
  // This is the guard that keeps a token out of a public repo. If any of these
  // fail, the committed config has been personalised and must not be published.
  it("no backup endpoint or token", () => {
    assert.equal(BUILD_CONFIG.backup.endpoint, null);
    assert.equal(BUILD_CONFIG.backup.token, null);
  });
  it("no WHOOP endpoint", () => assert.equal(BUILD_CONFIG.whoop.endpoint, null));
  it("no seeded personal defaults", () => assert.equal(BUILD_CONFIG.legacyDefaults, null));
  it("predicates reject the empty config", () => {
    assert.equal(hasBackup(BUILD_CONFIG), false);
    assert.equal(hasWhoop(BUILD_CONFIG), false);
  });
  it("predicates accept a configured one", () => {
    assert.equal(hasBackup({ backup: { endpoint: "https://x.dev", token: "t" } }), true);
    assert.equal(hasBackup({ backup: { endpoint: "https://x.dev", token: null } }), false);
  });
});

// ---------------------------------------------------------------------------
group("exercise library — integrity", () => {
  it("every entry resolves downstream", () => {
    // Figures resolve through illustrations.js (which maps ids onto shared poses,
    // e.g. back_squat -> squat_bar), NOT through raw pose keys. Checking POSES
    // directly reported 40 false failures.
    const figures = { has: (id) => hasIllustration(id) };
    const problems = checkLibrary({ muscleMap: MUSCLE_MAP, anatomy: EXERCISE_ANATOMY, figures });
    assert.deepEqual(problems, [], problems.join("; "));
  });
  it("covers a commercial gym", () => {
    // The library exists so the builder can program for a real gym, not just a
    // rack. Under ~100 entries it starts refusing patterns people expect.
    assert.ok(EXERCISE_LIBRARY.length >= 100, `library is only ${EXERCISE_LIBRARY.length}`);
    const gym = availableAt(["barbell", "ez_bar", "cable", "dumbbell_pair", "dumbbell_single", "machine"]);
    assert.equal(gym.length, EXERCISE_LIBRARY.length, "a full gym should reach every entry");
    for (const p of ["squat", "hinge", "lunge", "push_h", "push_v", "pull_h", "pull_v",
                     "knee_iso", "ham_iso", "chest_iso", "calf", "arm", "delt", "core", "carry", "trap"]) {
      assert.ok(pickForPattern(p, gym), `no gym option for ${p}`);
    }
  });
  it("machines are only offered when the place has them", () => {
    const noMachines = availableAt(["barbell", "dumbbell_pair", "dumbbell_single"]);
    assert.ok(!noMachines.some((e) => e.implement === "machine"));
    assert.equal(pickForPattern("knee_iso", noMachines), null, "leg extension needs a machine");
  });
  it("prefers a fresh lift over one already used this week", () => {
    // Regression: with a large library the generator still picked the same bench
    // and row on both upper days, because nothing penalised repetition.
    const gym = availableAt(["barbell", "ez_bar", "cable", "dumbbell_pair", "dumbbell_single", "machine"]);
    const first = pickForPattern("push_h", gym);
    const second = pickForPattern("push_h", gym, { usedThisWeek: [first.id] });
    assert.notEqual(second.id, first.id, "should reach for a variant");
    // …but a compound must still beat an accessory even when repeated.
    assert.equal(second.role, "compound");
  });
  it("a bodyweight-only setup can still train every major pattern", () => {
    // Regression: with no push-up, inverted row or pull-up in the library, a
    // bodyweight-only install got a plan of wall sits and calf raises.
    const bw = availableAt([]);
    for (const pattern of ["squat", "hinge", "push_h", "pull_h", "pull_v", "core"]) {
      assert.ok(pickForPattern(pattern, bw), `no bodyweight option for ${pattern}`);
    }
    assert.equal(pickForPattern("push_h", bw).id, "push_up");
    assert.equal(pickForPattern("pull_v", bw).id, "pull_up");
    // A real squat should beat an isometric hold when both are available.
    assert.equal(pickForPattern("squat", bw).id, "bodyweight_squats");
  });
  it("bodyweight is always available", () => {
    const pool = availableAt([]);
    assert.ok(pool.length > 0);
    assert.ok(pool.every((e) => e.implement === "bodyweight"));
  });
  it("pattern picking prefers compounds", () => {
    const gym = availableAt(["barbell", "dumbbell_pair", "dumbbell_single", "cable", "ez_bar"]);
    assert.equal(pickForPattern("squat", gym).id, "back_squat");
    assert.equal(pickForPattern("hinge", gym).id, "rdl_barbell");
  });
  it("degrades to what's actually present", () => {
    const home = availableAt(["dumbbell_pair", "dumbbell_single"]);
    assert.equal(pickForPattern("squat", home).id, "db_goblet_squat");
    assert.equal(pickForPattern("push_h", home).id, "db_bench_press");
  });
  it("exclusion works, so a day can't pick the same lift twice", () => {
    const gym = availableAt(["barbell", "dumbbell_pair", "dumbbell_single"]);
    const first = pickForPattern("squat", gym);
    const second = pickForPattern("squat", gym, { exclude: [first.id] });
    assert.notEqual(second && second.id, first.id);
  });
});

group("adaptations — interference", () => {
  it("adjacent adaptations are compatible", () => {
    assert.equal(compatibility("strength", "hypertrophy").level, "compatible");
    assert.equal(compatibility("vo2max", "long_endurance").level, "compatible");
  });
  it("opposite ends conflict", () => {
    assert.equal(compatibility("skill", "long_endurance").level, "conflicting");
    assert.equal(compatibility("speed", "long_endurance").level, "conflicting");
  });
  it("interference is symmetric and zero against itself", () => {
    assert.equal(interference("strength", "vo2max"), interference("vo2max", "strength"));
    assert.equal(interference("strength", "strength"), 0);
  });
  it("analysePriorities flags an overloaded list", () => {
    const a = analysePriorities(["skill", "speed", "power", "strength"]);
    assert.equal(a.tooMany, true);
  });
  it("a tight pair produces no conflicts", () => {
    const a = analysePriorities(["strength", "hypertrophy"]);
    assert.equal(a.conflicting.length, 0);
    assert.equal(a.tooMany, false);
  });
});

group("block shapes — no back-to-back deloads", () => {
  // Regression: "every 7th week OR the last week" produced TWO consecutive
  // deload weeks at 8, 15, 22... i.e. a fortnight of detraining.
  it("never schedules two deloads in a row, at any length", () => {
    for (let w = 2; w <= 30; w++) {
      const s = blockShape("classic").build(w).map((p) => p[0]).join("");
      assert.ok(!/DD/.test(s), `classic ${w} weeks -> ${s}`);
    }
  });
  it("always ends on a recovery or test week", () => {
    for (const id of ["classic", "taper_test"]) {
      for (let w = 4; w <= 12; w++) {
        const phases = blockShape(id).build(w);
        assert.match(phases[w - 1], /deload/i, `${id} ${w}`);
      }
    }
  });
  it("taper_test keeps every other week a build week", () => {
    const s = blockShape("taper_test").build(8).map((p) => p[0]).join("");
    assert.equal(s, "BBBBBBBD");
  });
});

group("generator — produces a runnable program", () => {
  const gym = { name: "Gym", implements: ["barbell", "ez_bar", "cable", "dumbbell_pair", "dumbbell_single"],
    dumbbells: { minKg: 2.5, maxKg: 40, stepKg: 2.5 } };
  const base = { name: "Test", startDate: "2026-09-07", lengthWeeks: 6, places: [gym] };

  it("emits the schema the app already executes", () => {
    const { program: p } = generateProgram({ ...base, priorities: ["strength"], daysPerWeek: 4 });
    for (const k of ["id", "name", "startDate", "lengthWeeks", "equipmentProfile", "exercises", "routines", "dayTemplates", "weeks"]) {
      assert.ok(p[k] != null, `missing ${k}`);
    }
    assert.equal(p.weeks.length, 6);
    assert.equal(Object.keys(p.dayTemplates).length, 7, "every weekday needs a template");
  });
  it("every prescribed exercise exists in the program's own library", () => {
    const { program: p } = generateProgram({ ...base, priorities: ["hypertrophy"], daysPerWeek: 4 });
    for (const w of p.weeks) {
      for (const d of Object.values(w.days)) {
        for (const e of d.exercises || []) {
          assert.ok(p.exercises[e.exerciseId], `${e.exerciseId} prescribed but not defined`);
        }
      }
    }
  });
  it("week start dates advance by exactly 7 days", () => {
    const { program: p } = generateProgram({ ...base, priorities: ["strength"], daysPerWeek: 3 });
    for (let i = 1; i < p.weeks.length; i++) {
      const gap = (Date.parse(p.weeks[i].startDate) - Date.parse(p.weeks[i - 1].startDate)) / 86400000;
      assert.equal(gap, 7);
    }
  });
  it("volume rises across a block and backs off on the deload", () => {
    const { program: p } = generateProgram({ ...base, priorities: ["hypertrophy"], daysPerWeek: 4, lengthWeeks: 6 });
    const setsIn = (w) => Object.values(w.days).filter((d) => d.type === "strength")
      .reduce((a, d) => a + d.exercises.reduce((x, e) => x + e.prescribedSets, 0), 0);
    assert.ok(setsIn(p.weeks[4]) > setsIn(p.weeks[0]), "volume should rise");
    assert.ok(setsIn(p.weeks[5]) < setsIn(p.weeks[4]), "deload should cut volume");
  });
  it("rep ranges are real prescriptions, not the whole span", () => {
    // Regression: the adaptation's reps span was emitted verbatim, so a
    // hypertrophy block prescribed "3x6-15" — which tells a lifter nothing.
    const { program: p } = generateProgram({ ...base, priorities: ["hypertrophy"], daysPerWeek: 4 });
    for (const d of Object.values(p.weeks[0].days)) {
      for (const e of d.exercises || []) {
        if (/s$/.test(e.repRange)) continue;              // timed hold
        const [lo, hi] = e.repRange.split("-").map(Number);
        assert.ok(hi > lo, `${e.exerciseId}: "${e.repRange}" is not a range`);
        assert.ok(hi - lo <= 5, `${e.exerciseId}: "${e.repRange}" is too wide to be a prescription`);
      }
    }
  });
  it("timed holds are prescribed in seconds, not reps", () => {
    // Regression: wall sits and planks were given "3x4-5".
    const { program: p } = generateProgram({ ...base, priorities: ["strength"], daysPerWeek: 4 });
    for (const d of Object.values(p.weeks[0].days)) {
      for (const e of d.exercises || []) {
        if (e.role === "core") assert.match(e.repRange, /^\d+s$/, `${e.exerciseId} core should be timed`);
      }
    }
  });
  it("no builder scaffolding leaks into stored data", () => {
    const { program: p } = generateProgram({ ...base, priorities: ["strength"], daysPerWeek: 4 });
    assert.ok(!JSON.stringify(p).includes("_lib"), "internal field leaked into the program");
  });
  it("respects available days and never exceeds them", () => {
    const { program: p, summary } = generateProgram({
      ...base, priorities: ["strength"], daysPerWeek: 5, availableDays: ["Tue", "Thu"] });
    const training = Object.values(p.dayTemplates).filter((d) => d.type !== "rest").map((d) => d.weekday);
    assert.ok(training.every((d) => ["Tue", "Thu"].includes(d)), `trained on ${training}`);
    assert.ok(summary.strengthDays + summary.cardioDays <= 2);
  });
  it("warns rather than silently producing a hollow plan", () => {
    const r = generateProgram({ ...base, priorities: ["hypertrophy"], daysPerWeek: 3, places: [{ name: "Hotel", implements: [] }] });
    assert.ok(r.warnings.length, "bodyweight-only should warn about missing patterns");
    assert.ok(r.warnings.some((w) => /push/i.test(w)));
  });
  it("flags conflicting priorities", () => {
    const r = generateProgram({ ...base, priorities: ["speed", "long_endurance"], daysPerWeek: 4 });
    assert.ok(r.warnings.some((w) => /opposite directions/i.test(w)));
  });
  it("reports health-floor gaps", () => {
    const r = generateProgram({ ...base, priorities: ["strength"], daysPerWeek: 3 });
    assert.ok(r.floorGaps.length);
    assert.ok(r.floorGaps.some((g) => /Zone 2/.test(g)));
  });
  it("survives a one-day week", () => {
    const r = generateProgram({ ...base, priorities: ["strength"], daysPerWeek: 1, availableDays: ["Sat"] });
    assert.equal(r.summary.strengthDays, 1);
    assert.ok(r.program.weeks.length === 6);
  });
  it("spreads sessions rather than stacking them", () => {
    const days = spreadDays(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], 3);
    assert.equal(days.length, 3);
    assert.equal(new Set(days).size, 3);
  });
});

group("themes — vary brand, never meaning", () => {
  const REQUIRED = ["--bg", "--bg-1", "--bg-elev", "--bg-elev2", "--bg-elev3", "--bg-elev-hero",
    "--line", "--line-soft", "--text", "--text-dim", "--text-faint",
    "--accent", "--accent-press", "--accent-ghost", "--on-accent", "--accent-shadow",
    "--grad-cta", "--grad-vibrant", "--glow", "--aurora-1", "--aurora-2", "--aurora-3"];
  it("every theme defines the full token set", () => {
    for (const t of THEMES) {
      for (const k of REQUIRED) assert.ok(t.vars[k], `${t.id} missing ${k}`);
    }
  });
  it("no theme overrides a semantic data colour", () => {
    // The whole point: mint means strength in every theme. A theme that set
    // --data-* or --cyan/--violet/--coral would change what charts SAY.
    const forbidden = ["--data-strength", "--data-cardio", "--data-recovery", "--data-intensity",
      "--cyan", "--violet", "--coral", "--amber", "--blue", "--red"];
    for (const t of THEMES) {
      for (const k of forbidden) assert.ok(!(k in t.vars), `${t.id} must not override ${k}`);
    }
  });
  it("colours are well-formed", () => {
    for (const t of THEMES) {
      for (const [k, v] of Object.entries(t.vars)) {
        if (k.startsWith("--aurora") || k === "--accent-shadow") {
          const parts = v.split(",").map((n) => Number(n.trim()));
          assert.equal(parts.length, 3, `${t.id} ${k} should be an rgb triple`);
          assert.ok(parts.every((n) => Number.isFinite(n) && n >= 0 && n <= 255), `${t.id} ${k} out of range`);
        } else if (v.startsWith("#")) {
          // 6-digit only: an 8-digit value with 00 alpha renders invisible, which
          // is exactly the typo that made one theme's dim text disappear.
          assert.match(v, /^#[0-9a-f]{6}$/i, `${t.id} ${k} = "${v}" is not a 6-digit hex`);
        }
      }
    }
  });
  it("ids are unique and the default resolves", () => {
    assert.equal(new Set(THEMES.map((t) => t.id)).size, THEMES.length);
    assert.equal(themeById(DEFAULT_THEME).id, DEFAULT_THEME);
    assert.equal(themeById("nonsense").id, THEMES[0].id, "unknown id must fall back, not crash");
  });
  it("each theme has a distinct accent", () => {
    const accents = THEMES.map((t) => t.vars["--accent"]);
    assert.equal(new Set(accents).size, accents.length);
  });
});

group("equipment — stations gate exercises without punishing old installs", () => {
  const full = [...FULL_GYM];
  const garage = ["barbell", "bodyweight", SURVEYED];       // a bar on the floor, asked about stations
  const garagePlusRack = ["barbell", "bodyweight", "rack", SURVEYED];
  const legacy = ["barbell", "dumbbell_pair", "bodyweight"]; // saved before stations existed

  it("a bar with no rack and no bench loses the lifts that need them", () => {
    const ids = availableAt(garage).map((e) => e.id);
    assert.equal(ids.includes("back_squat"), false, "no rack, no back squat");
    assert.equal(ids.includes("bench_press"), false, "no bench, no bench press");
    assert.equal(ids.includes("rdl_barbell"), true, "an RDL needs neither — it must survive");
    assert.equal(ids.includes("deadlift"), true);
  });
  it("adding the rack brings the racked lifts back", () => {
    const ids = availableAt(garagePlusRack).map((e) => e.id);
    assert.equal(ids.includes("back_squat"), true);
    assert.equal(ids.includes("ohp_barbell"), true);
    assert.equal(ids.includes("bench_press"), false, "still no bench");
  });
  it("a place that was never asked keeps everything", () => {
    // The regression that matters: someone who has been benching for a year must
    // not lose bench press because a new question appeared in the builder.
    assert.equal(stationsKnown(legacy), false);
    const ids = availableAt(legacy).map((e) => e.id);
    assert.equal(ids.includes("bench_press"), true);
    assert.equal(ids.includes("back_squat"), true);
  });
  it("bodyweight-only still trains every major pattern", () => {
    const ids = availableAt(["bodyweight"]).map((e) => e.id);
    for (const must of ["push_up", "bodyweight_squats", "bw_lunge", "glute_bridge"]) {
      assert.ok(ids.includes(must), `bodyweight install lost ${must}`);
    }
    assert.equal(ids.includes("pull_up"), true, "no station info = assume the bar exists");
  });
  it("a bodyweight place that WAS asked loses the hanging work", () => {
    const ids = availableAt(["bodyweight", "bench", SURVEYED]).map((e) => e.id);   // asked, no bar
    assert.equal(ids.includes("pull_up"), false);
    assert.equal(ids.includes("dip"), false);
    assert.equal(ids.includes("push_up"), true);
  });
  it("every gated exercise id exists in the library", () => {
    const known = new Set(EXERCISE_LIBRARY.map((e) => e.id));
    for (const [station, ids] of Object.entries(EXERCISE_NEEDS)) {
      for (const id of ids) assert.ok(known.has(id), `${station} gates ${id}, which is not in the library`);
    }
  });
  it("the full-gym preset unlocks the whole library", () => {
    assert.equal(availableAt(full).length, EXERCISE_LIBRARY.length);
  });
});

group("features — every toggle is offered, and every toggle does something", () => {
  // The audit found the second half of this contract missing: onboarding asked
  // which optional trackers you wanted and then only two Progress cards ever
  // read the answer, so switching nutrition off still left a nutrition card
  // forever. Both directions are asserted, because either one rotting is a lie
  // told to the user — an unofferable flag, or a switch that does nothing.
  const declared = Object.keys(defaultProfile().features);
  const offered = TRACKED_FEATURES.map(([k]) => k);

  it("every declared feature can be switched", () => {
    const missing = declared.filter((k) => !offered.includes(k));
    assert.deepEqual(missing, [], `not offered in Settings/onboarding: ${missing}`);
  });
  it("every offered feature is a real one", () => {
    const bogus = offered.filter((k) => !declared.includes(k));
    assert.deepEqual(bogus, [], `offered but absent from the profile: ${bogus}`);
  });
  it("every toggle is actually read by some view", () => {
    const dir = new URL("../js/", import.meta.url);
    const seen = new Set();
    const walk = (d) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const u = new URL(e.name + (e.isDirectory() ? "/" : ""), d);
        if (e.isDirectory()) walk(u);
        else if (e.name.endsWith(".js")) {
          for (const m of readFileSync(u, "utf8").matchAll(/features\.(\w+)/g)) seen.add(m[1]);
        }
      }
    };
    walk(dir);
    const inert = offered.filter((k) => !seen.has(k));
    assert.deepEqual(inert, [], `toggle exists but nothing honours it: ${inert}`);
  });
  it("TRACKED_FEATURES carries a title and a description for each", () => {
    for (const row of TRACKED_FEATURES) {
      assert.equal(row.length, 3, `malformed row: ${row}`);
      assert.ok(row[1] && row[2], `missing copy for ${row[0]}`);
    }
  });
});

group("units — display only, storage stays metric", () => {
  const metric = { units: { weight: "kg", length: "cm", distance: "km" } };
  const imperial = { units: { weight: "lb", length: "in", distance: "mi" } };

  it("round-trips through the input path", () => {
    assert.ok(Math.abs(weightToKg(225, imperial) - lbToKg(225)) < 1e-9);
    assert.equal(weightToKg(100, metric), 100);
    assert.ok(Math.abs(weightToKg("102,5", metric) - 102.5) < 1e-9, "German decimal comma must parse");
  });
  it("formats each system the way it's spoken", () => {
    assert.equal(fmtWeight(100, metric), "100 kg");
    assert.equal(fmtWeight(100, imperial), "220 lb");     // not 220.5
    assert.equal(fmtWeight(null, metric), "–");
  });
  it("a plate face shows the denomination stamped on the disc", () => {
    // Regression: the 1.25 kg plate went through the 1-decimal display rounding
    // and came out "1.3" — a disc that exists on no rack — and then missed its
    // entry in the colour table and rendered in the fallback blue.
    assert.equal(plateLabel(1.25, metric), "1.25");
    assert.equal(plateColor(1.25, metric), "#9ca3af");
    assert.deepEqual(METRIC_EQUIPMENT.barbellPlatesKg.map((k) => plateLabel(k, metric)),
      ["25", "20", "15", "10", "5", "2.5", "1.25"]);
    // and every metric denomination still has a colour of its own
    const cols = METRIC_EQUIPMENT.barbellPlatesKg.map((k) => plateColor(k, metric));
    assert.equal(new Set(cols).size, cols.length, "each plate needs a distinct face colour");
  });
  it("keeps fractional plates intact", () => {
    // Regression: rounding every pound value to a whole number turned the real
    // 2.5 lb plate into "3", i.e. an object that doesn't exist on any rack.
    const lb2_5 = IMPERIAL_EQUIPMENT.barbellPlatesKg[IMPERIAL_EQUIPMENT.barbellPlatesKg.length - 1];
    assert.equal(weightValue(lb2_5, imperial), 2.5);
    assert.equal(plateLabel(lb2_5, imperial), "2.5");
  });
  it("imperial equipment is real gym kit", () => {
    assert.equal(weightValue(IMPERIAL_EQUIPMENT.barWeightKg, imperial), 45);
    assert.deepEqual(IMPERIAL_EQUIPMENT.barbellPlatesKg.map((k) => weightValue(k, imperial)), [45, 35, 25, 10, 5, 2.5]);
    assert.equal(weightValue(IMPERIAL_EQUIPMENT.dumbbells.maxKg, imperial), 100);
  });
  it("metric equipment is unchanged", () => {
    assert.equal(METRIC_EQUIPMENT.barWeightKg, 20);
    assert.deepEqual(METRIC_EQUIPMENT.barbellPlatesKg, [25, 20, 15, 10, 5, 2.5, 1.25]);
  });
  it("defaults follow the profile's units", () => {
    assert.equal(defaultEquipmentFor(imperial).barWeightKg, IMPERIAL_EQUIPMENT.barWeightKg);
    assert.equal(defaultEquipmentFor(metric).barWeightKg, 20);
    assert.equal(defaultEquipmentFor(undefined).barWeightKg, 20, "no profile must not crash");
  });
  it("labels and predicates", () => {
    assert.equal(weightLabel(imperial), "lb");
    assert.equal(weightLabel(metric), "kg");
    assert.equal(isImperialWeight(metric), false);
    assert.equal(isImperialWeight(undefined), false);
  });
  it("length and distance convert at both edges", () => {
    assert.equal(lengthValue(100, metric), 100);
    assert.equal(lengthValue(2.54, imperial), 1);
    assert.ok(Math.abs(lengthToCm(1, imperial) - 2.54) < 1e-9);
    assert.equal(distanceValue(10, metric), 10);
    assert.equal(distanceValue(1.609344, imperial), 1);
    assert.ok(Math.abs(distanceToKm(1, imperial) - 1.609344) < 1e-9);
  });
  it("pace reads out per displayed distance unit", () => {
    // 5:00/km is a slower-LOOKING 8:03/mi — same run, the runner's own number.
    assert.equal(fmtPaceU(300, metric), "5:00 /km");
    assert.equal(fmtPaceU(300, imperial), "8:03 /mi");
    assert.equal(fmtPaceU(300, imperial, { withUnit: false }), "8:03");
    assert.equal(paceLabel(imperial), "/mi");
    assert.equal(fmtPaceU(null, metric), "–");
  });
  it("a loaded imperial barbell lands on whole pounds", () => {
    // bar + 45 a side should read exactly 135, not 134 or 136 — which is the
    // whole reason plate denominations are stored as exact lb equivalents.
    const bar = IMPERIAL_EQUIPMENT.barWeightKg;
    const plate45 = IMPERIAL_EQUIPMENT.barbellPlatesKg[0];
    assert.equal(weightValue(bar + plate45 * 2, imperial), 135);
    assert.equal(weightValue(bar + (plate45 + IMPERIAL_EQUIPMENT.barbellPlatesKg[2]) * 2, imperial), 185);
  });
});

group("units — the ambient profile drives every read-only string", () => {
  const imperial = { units: { weight: "lb", length: "in", distance: "mi" } };
  // The formatters in model.js are imported by nearly every view and take no
  // profile, so a units switch reaches them through the ambient registration
  // that profile.js performs. If that link breaks, the app shows an imperial
  // user metric numbers under a "lb" label — the exact bug this replaced.
  const asImperial = (fn) => { setDisplayProfile(imperial); try { fn(); } finally { setDisplayProfile(null); } };

  it("model.fmtWeight follows the registered profile", () => {
    assert.equal(fmtWeightM(100), "100 kg");                    // unset = metric
    asImperial(() => {
      assert.equal(fmtWeightM(100), "220 lb");
      assert.equal(fmtWeightM(100, { withUnit: false }), "220");
    });
    assert.equal(fmtWeightM(100), "100 kg", "the ambient must be resettable");
  });
  it("model.fmtPace follows it too", () => {
    assert.equal(fmtPaceM(300), "5:00 /km");
    asImperial(() => assert.equal(fmtPaceM(300), "8:03 /mi"));
  });
  it("a logged set reads in the user's unit", () => {
    const set = { weightKg: 60, reps: 8 };
    assert.equal(setDisplay("barbell", set), "60kg · 8");
    asImperial(() => {
      assert.equal(setDisplay("barbell", set), "132lb · 8");
      assert.equal(setDisplay("dumbbell_pair", { weightKg: 20, reps: 10 }), "2×44lb · 10");
      assert.equal(setDisplay("bodyweight", { weightKg: 0, reps: 12 }), "BW · 12");
      assert.equal(setDisplay("barbell", { weightKg: 0, seconds: 45, reps: null }), "45s");
    });
  });
  it("an untouched edit field never rewrites what it displays", () => {
    // THE REGRESSION. 18 kg displays as "40 lb"; converting that back on save
    // stores 18.1437, and the next open-and-save rounds it again. Opening the
    // set editor and pressing Save without typing anything silently rewrote
    // every set in the session. An unchanged field must return the stored value.
    setDisplayProfile(imperial);
    try {
      const field = (kg) => { const i = { value: String(weightValue(kg)), dataset: {} }; i.dataset.shown = i.value; return i; };
      for (const kg of [16, 17.5, 18, 20, 5, 62.5]) {
        const i = field(kg);
        assert.equal(readEdit(i, kg, (v) => weightToKg(Number(v))), kg, `${kg} kg must survive an untouched save`);
      }
      const edited = field(18);
      edited.value = "45";                                   // the user really typed a new number
      assert.ok(Math.abs(readEdit(edited, 18, (v) => weightToKg(Number(v))) - lbToKg(45)) < 1e-9);
      const emptied = field(18);
      emptied.value = "";                                    // unparseable → keep what was stored
      assert.equal(readEdit(emptied, 18, (v) => (Number(v) ? weightToKg(Number(v)) : null)), 18);
    } finally { setDisplayProfile(null); }
  });
  it("a rack is re-based only when it is still stock", () => {
    // Switching units must not rewrite a rack somebody has edited: that rack
    // describes a real gym. Only an untouched stock set may be swapped.
    const metricPlace = { name: "Gym", ...rackFields(METRIC_EQUIPMENT) };
    const imperialPlace = { name: "Gym", ...rackFields(IMPERIAL_EQUIPMENT) };
    assert.equal(isStockRack(metricPlace, METRIC_EQUIPMENT), true);
    assert.equal(isStockRack(imperialPlace, IMPERIAL_EQUIPMENT), true);
    assert.equal(isStockRack(metricPlace, IMPERIAL_EQUIPMENT), false);
    const edited = { ...metricPlace, barbellPlatesKg: [25, 20, 15, 10, 5] };   // no 2.5s
    assert.equal(isStockRack(edited, METRIC_EQUIPMENT), false, "an edited rack must never be re-based");
    const oddBar = { ...metricPlace, barWeightKg: 15 };                        // women's bar
    assert.equal(isStockRack(oddBar, METRIC_EQUIPMENT), false);
    assert.equal(isStockRack(null, METRIC_EQUIPMENT), false);
    assert.equal(isStockRack(metricPlace, null), false);
  });
  it("re-basing yields kit that physically exists", () => {
    const imperial = { units: { weight: "lb", length: "in", distance: "mi" } };
    const rebased = { name: "Gym", ...rackFields(IMPERIAL_EQUIPMENT) };
    assert.equal(weightValue(rebased.barWeightKg, imperial), 45);
    assert.deepEqual(rebased.barbellPlatesKg.map((k) => weightValue(k, imperial)), [45, 35, 25, 10, 5, 2.5]);
    // and the copy is deep — re-basing two places must not alias one array
    const a = rackFields(METRIC_EQUIPMENT), b = rackFields(METRIC_EQUIPMENT);
    a.barbellPlatesKg.push(999);
    assert.equal(b.barbellPlatesKg.includes(999), false);
    assert.equal(METRIC_EQUIPMENT.barbellPlatesKg.includes(999), false, "must not mutate the shared constant");
  });
  it("an explicit profile still beats the ambient", () => {
    asImperial(() => {
      assert.equal(fmtWeight(100, METRIC_PROFILE), "100 kg", "the vault export must stay metric");
      assert.equal(fmtPaceU(300, METRIC_PROFILE), "5:00 /km");
    });
  });
});

// ---------------------------------------------------------------------------
// Apple import. These are async, so they run before the synchronous groups are
// printed and push their own results in.
const appleXml = (rows) =>
  '<?xml version="1.0" encoding="UTF-8"?>\n<HealthData locale="en_GB">\n' + rows.join("\n") + "\n</HealthData>";
const asFile = (text, name = "export.xml") => new File([text], name);

async function appleTests() {
  console.log("\napple import — export.xml");
  const R = (t, extra) => `<Record type="${t}" ${extra}/>`;

  it("parses dates with an offset (the sleep-dropping bug)", () => {
    // replace(" ","T") only replaces the FIRST space, leaving "…T09:00:00 +0100",
    // which parses as NaN and silently dropped every sleep record.
    assert.ok(Number.isFinite(appleTime("2025-01-01 23:00:00 +0100")));
    assert.equal(new Date(appleTime("2025-01-01 23:00:00 +0100")).toISOString(), "2025-01-01T22:00:00.000Z");
    assert.ok(Number.isFinite(appleTime("2025-01-01 23:00:00 -0500")));
  });

  const xml = appleXml([
    R("HKQuantityTypeIdentifierBodyMass", 'unit="lb" startDate="2025-03-01 07:00:00 +0000" endDate="2025-03-01 07:00:00 +0000" value="200"'),
    R("HKQuantityTypeIdentifierActiveEnergyBurned", 'unit="Cal" startDate="2025-03-01 09:00:00 +0000" endDate="2025-03-01 09:00:00 +0000" value="300"'),
    R("HKQuantityTypeIdentifierActiveEnergyBurned", 'unit="Cal" startDate="2025-03-01 10:00:00 +0000" endDate="2025-03-01 10:00:00 +0000" value="250"'),
    R("HKQuantityTypeIdentifierBodyFatPercentage", 'unit="%" startDate="2025-03-01 07:00:00 +0000" endDate="2025-03-01 07:00:00 +0000" value="0.223"'),
    R("HKQuantityTypeIdentifierWaistCircumference", 'unit="in" startDate="2025-03-01 07:00:00 +0000" endDate="2025-03-01 07:00:00 +0000" value="36"'),
    R("HKCategoryTypeIdentifierSleepAnalysis", 'startDate="2025-03-01 23:00:00 +0000" endDate="2025-03-02 06:00:00 +0000" value="HKCategoryValueSleepAnalysisAsleepCore"'),
    R("HKCategoryTypeIdentifierSleepAnalysis", 'startDate="2025-03-01 22:00:00 +0000" endDate="2025-03-01 23:00:00 +0000" value="HKCategoryValueSleepAnalysisInBed"'),
    R("HKQuantityTypeIdentifierStepCount", 'unit="count" startDate="2025-03-01 09:00:00 +0000" endDate="2025-03-01 09:00:00 +0000" value="500"'),
    '<Workout workoutActivityType="HKWorkoutActivityTypeRunning" duration="30" totalDistance="5" totalDistanceUnit="km" startDate="2025-03-02 18:00:00 +0000" endDate="2025-03-02 18:30:00 +0000"/>',
    '<Workout workoutActivityType="HKWorkoutActivityTypeRunning" duration="30" totalDistance="5" totalDistanceUnit="km" startDate="2025-03-02 18:00:00 +0000" endDate="2025-03-02 18:30:00 +0000"/>',
    '<Workout workoutActivityType="HKWorkoutActivityTypeTraditionalStrengthTraining" duration="60" startDate="2025-03-03 18:00:00 +0000" endDate="2025-03-03 19:00:00 +0000"/>',
  ]);
  const r = await parseAppleExport(asFile(xml));
  const d1 = r.byDate["2025-03-01"], d2 = r.byDate["2025-03-02"];

  it("converts imperial weight to kg", () => assert.equal(d1.weightKg, 90.7));
  it("converts inches to cm", () => assert.equal(d1.waistCm, 91.4));
  it("reads body fat as a fraction", () => assert.equal(d1.bodyFatPct, 22.3));
  it("SUMS energy and treats Cal as kilocalories", () => {
    // Lowercasing the unit made "Cal" match "cal" and divided by 1000: 550 -> 1.
    assert.equal(d1.activeKcal, 550);
  });
  it("counts only asleep stages, attributed to the wake date", () => {
    assert.equal(d1.sleepHours, undefined, "sleep belongs to the morning you wake");
    assert.equal(d2.sleepHours, 7, "InBed must not inflate it");
  });
  it("ignores record types it doesn't want", () => {
    assert.equal(r.counts.HKQuantityTypeIdentifierStepCount, undefined);
  });
  it("keeps cardio workouts, drops strength, dedupes duplicates", () => {
    assert.equal(r.workouts.length, 1);
    assert.equal(r.workouts[0].sport, "Running");
    assert.equal(r.workouts[0].distanceKm, 5);
    assert.equal(r.workouts[0].timeSeconds, 1800);
  });
  it("warns that Apple HRV is a different statistic", async () => {
    const hrv = await parseAppleExport(asFile(appleXml([
      R("HKQuantityTypeIdentifierHeartRateVariabilitySDNN", 'unit="ms" startDate="2025-03-01 07:00:00 +0000" endDate="2025-03-01 07:00:00 +0000" value="45"')])));
    assert.ok(hrv.warnings.some((w) => /SDNN/.test(w)));
  });
  it("survives a tag split across stream chunks", async () => {
    // 3 MB forces multiple reads; a naive scanner loses the record on the seam.
    const many = [];
    for (let i = 0; i < 12000; i++) {
      const day = String((i % 28) + 1).padStart(2, "0");
      many.push(R("HKQuantityTypeIdentifierRestingHeartRate",
        `unit="count/min" startDate="2025-04-${day} 07:00:00 +0000" endDate="2025-04-${day} 07:00:00 +0000" value="55"`));
    }
    const big = await parseAppleExport(asFile(appleXml(many)));
    assert.equal(big.counts.HKQuantityTypeIdentifierRestingHeartRate, 12000, "records lost at a chunk boundary");
    assert.equal(Object.keys(big.byDate).length, 28);
  });
  it("reports nothing rather than throwing on a non-export file", async () => {
    const junk = await parseAppleExport(asFile("just some text, not xml at all"));
    assert.equal(junk.records, 0);
    assert.ok(junk.warnings.some((w) => /No health records/i.test(w)));
  });
  it("summarise counts each metric", () => {
    const s = summarise(r);
    assert.equal(s.weight, 1);
    assert.equal(s.workouts, 1);
    assert.equal(s.from, "2025-03-01");
  });
}

await appleTests();

// ---------------------------------------------------------------------------
// The backup Worker's write guards, exercised as real requests against an
// in-memory KV. These protect the only durable copy of a training log, and both
// refusals exist because the failure they prevent has a plausible everyday path
// (a device wiped by an app reinstall, pushing its blank settings back up).
async function workerTests() {
  const worker = (await import("../backup-worker/src/index.js")).default;
  const TOKEN = "t".repeat(40);
  const kv = new Map();
  const env = { BACKUP_TOKEN: TOKEN, STRONG_BACKUP: {
    get: async (k) => (kv.has(k) ? kv.get(k) : null),
    put: async (k, v) => { kv.set(k, v); },
  } };
  const put = (body) => worker.fetch(new Request("https://x/", { method: "PUT",
    headers: { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify(body) }), env);

  const real   = { installId: "inst-mine", sessions: [{ id: "a" }, { id: "b" }], programs: [],
                   prefs: { profile: { onboardedAt: "2026-01-15", physiology: { maxHR: 194 } } } };
  // A complete, healthy snapshot — from somebody else's phone.
  const foreign = { installId: "inst-hers", sessions: [{ id: "x" }, { id: "y" }], programs: [],
                    prefs: { profile: { onboardedAt: "2026-08-09", physiology: { maxHR: 178 } } } };
  const noId   = { sessions: [{ id: "a" }], programs: [],
                   prefs: { profile: { onboardedAt: "2026-01-15" } } };
  const blank  = { sessions: [{ id: "a" }, { id: "b" }], programs: [], prefs: { profile: { onboardedAt: null } } };
  const noPref = { sessions: [{ id: "a" }], programs: [] };
  const empty  = { sessions: [], programs: [], prefs: { profile: { onboardedAt: "2026-01-15" } } };

  kv.clear();
  const freshBlank = (await put(blank)).status;      // nothing stored yet
  kv.clear();
  const first  = (await put(real)).status;
  const overBlank = (await put(blank)).status;
  const overNone  = (await put(noPref)).status;
  const overEmpty = (await put(empty)).status;
  const again  = (await put(real)).status;
  const overForeign = (await put(foreign)).status;
  // Captured HERE, before the next push: an accepted write naturally replaces the
  // stored blob, so asserting after it would test the wrong snapshot.
  const stored = JSON.parse(kv.values().next().value);
  const overNoId = (await put(noId)).status;          // an older client, pre-installId

  group("backup Worker — a wiped device cannot erase the backup", () => {
    it("accepts a set-up install", () => assert.equal(first, 200));
    it("refuses a blank profile over a set-up one", () => assert.equal(overBlank, 409));
    it("refuses a snapshot carrying no prefs at all", () => assert.equal(overNone, 409));
    it("still refuses zero sessions over a real log", () => assert.equal(overEmpty, 409));
    it("keeps accepting the real install", () => assert.equal(again, 200));
    it("leaves the stored profile untouched through all of it", () => {
      assert.equal(stored.prefs.profile.onboardedAt, "2026-01-15");
      assert.equal(stored.prefs.profile.physiology.maxHR, 194);
    });
    it("refuses a complete snapshot from a DIFFERENT install", () => {
      // The credential-confusion case: two people, one holding the other's token.
      // Nothing else catches it — the data is full and the profile is set.
      assert.equal(overForeign, 409);
      assert.equal(stored.prefs.profile.physiology.maxHR, 194, "someone else's numbers got in");
      assert.deepEqual(stored.sessions.map((s) => s.id), ["a", "b"]);
    });
    it("still accepts a client that sends no install id at all", () => {
      // An older install must not be locked out of its own backup.
      assert.equal(overNoId, 200);
    });
    it("does NOT block a genuinely fresh backup", () => {
      // Guarding must not stop a new install from ever writing its first snapshot.
      assert.equal(freshBlank, 200);
    });
  });
}

await workerTests();

for (const [name, fn] of groups) { console.log("\n" + name); fn(); }
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
