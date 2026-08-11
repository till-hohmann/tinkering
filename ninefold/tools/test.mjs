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
import { roundLoad, loadCeiling, nextLoadUp, rackAt, recommend } from "../js/progression.js";
import { deviationQuestions, applyTemplateDecisions, stampEffort, YES, NO, CONSIDER } from "../js/deviations.js";
import { toCSV, fromCSV, applyPlanCSV, diffPlans } from "../js/plan-csv.js";
import { BUILD_CONFIG, hasBackup, hasWhoop } from "../js/config.js";
import { EXERCISE_LIBRARY, checkLibrary, availableAt, pickForPattern, qualityOf } from "../js/exercise-library.js";
import { FULL_GYM, EXERCISE_NEEDS, stationsKnown, canDoHere, SURVEYED, IMPLEMENTS, STATIONS, PRESETS } from "../js/equipment.js";
import { MUSCLE_MAP } from "../js/volume.js";
import { EXERCISE_ANATOMY } from "../js/exercise-anatomy.js";
import { hasIllustration } from "../js/illustrations.js";
import { compatibility, interference, analysePriorities, blockShape, isStrength } from "../js/builder/adaptations.js";
import { generateProgram, spreadDays, summariseHistory } from "../js/builder/generate.js";
import { auditBlock, parseReps } from "../js/builder/quality.js";
import { THEMES, themeById, DEFAULT_THEME } from "../js/theme.js";
import { weightValue, fmtWeight, weightToKg, kgToLb, lbToKg, IMPERIAL_EQUIPMENT, METRIC_EQUIPMENT,
  defaultEquipmentFor, plateLabel, plateColor, weightLabel, isImperialWeight, setDisplayProfile,
  distanceValue, distanceToKm, lengthValue, lengthToCm, fmtPace as fmtPaceU, paceLabel,
  METRIC_PROFILE, readEdit, isStockRack, rackFields, isImperialRack } from "../js/units.js";
import { fmtWeight as fmtWeightM, fmtPace as fmtPaceM, setDisplay, dayCellRole } from "../js/model.js";
import { parseAppleExport, summarise, appleTime } from "../js/health/apple-import.js";
import { metaFor, candidatesFor, seedSubLoad, SUB_CANDIDATES, alternativesFor } from "../js/substitution.js";
import * as mob from "../js/mobility.js";
import { applyStretchResults, applyStretchTargets, stretchTarget, STRETCH_MIN, STRETCH_CAP } from "../js/stretch.js";
import { CHANGELOG, notesSince, versionNumber } from "../js/changelog.js";
import { checkAsanas, byId as asanaById } from "../js/yoga/asanas.js";
import { ASANA_ART_KEYS } from "../js/yoga/asana-art.js";
import { STYLES as YOGA_STYLES, BREATH_SECONDS_DEFAULT, BREATH_SECONDS_RANGE,
  holdSecondsFor } from "../js/yoga/styles.js";
import { INTENTS as YOGA_INTENTS, checkIntents, accountingFor } from "../js/yoga/intents.js";
import { generateFlow } from "../js/yoga/generate.js";
import { primarySeries, checkSeries } from "../js/yoga/ashtanga.js";
import { auditFlow } from "../js/yoga/quality.js";
import { breathsRemaining, breathPhaseAt, isInhale, breathSwell } from "../js/yoga/breath.js";
import { checkLevels } from "../js/yoga/levels.js";
import { checkScript, entryScript, exitScript, salutationScript, allHoldPhrases } from "../js/yoga/script.js";
import { ASANAS } from "../js/yoga/asanas.js";
import { flowSeconds as flowSecondsOf, elapsedAt as flowElapsedAt } from "../js/yoga/compose.js";

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
group("service worker — offline-first means every module is precached", () => {
  // See the comment at the top of sw.js: a module missing from SHELL still works
  // (the fetch handler runtime-caches it) right up until the release that clears
  // the old cache, and then it takes the app down for anyone who opens it
  // offline. Nothing else catches this, so it is caught here.
  const sw = readFileSync(new URL("../sw.js", import.meta.url), "utf8");
  const listed = new Set([...sw.matchAll(/"\.\/(js\/[^"]+)"/g)].map((m) => m[1]));
  const walk = (dir) => readdirSync(new URL(`../${dir}/`, import.meta.url), { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`) : e.name.endsWith(".js") ? [`${dir}/${e.name}`] : []));

  it("no module has drifted off the precache list", () => {
    const missing = walk("js").filter((f) => !listed.has(f));
    assert.deepEqual(missing, [], `add these to SHELL in sw.js:\n  ${missing.join("\n  ")}`);
  });
  it("the precache list names no module that no longer exists", () => {
    const onDisk = new Set(walk("js"));
    const stale = [...listed].filter((f) => !onDisk.has(f));
    assert.deepEqual(stale, [], "SHELL names a file that isn't there");
  });
  it("the cache name and the reported version agree", () => {
    // They are declared in two files and must be bumped together every deploy.
    const cache = (sw.match(/const CACHE = "fittrack-(v\d+)"/) || [])[1];
    const version = readFileSync(new URL("../js/version.js", import.meta.url), "utf8")
      .match(/APP_VERSION = "(v\d+)"/)[1];
    assert.equal(cache, version, "sw.js CACHE and js/version.js APP_VERSION are out of step");
  });
});

group("builder QC — the block that shipped must never generate again", () => {
  // Every assertion here is a defect found by auditing a real block a real user
  // was handed. The block was named "Strength kickstarter"; its parameters were
  // the SKILL adaptation's, because priorities.find() takes the first of the
  // strength family and Skill & technique is the first row in the list.
  const place = { name: "Gym", implements: [...FULL_GYM, SURVEYED], barWeightKg: 20, ezBarWeightKg: 7.5,
    barbellPlatesKg: [25, 20, 15, 10, 5, 2.5, 1.25], ezBarPlatesKg: [10, 5, 2.5, 1.25],
    cable: { minKg: 2.5, maxKg: 120, stepKg: 2.5 }, dumbbells: { minKg: 2.5, maxKg: 50, stepKg: 2.5 } };
  const gen = (over = {}) => {
    const r = generateProgram({ name: "T", startDate: "2026-08-10", lengthWeeks: 4,
      priorities: ["hypertrophy"], mandatoryDays: 5, optionalDays: 1, cardioPerWeek: 1, places: [place], ...over });
    return r.program || r;
  };

  it("isolation work is never prescribed in a strength rep range", () => {
    // The shipped block had leg extensions, calf raises, flies and curls at 5-6
    // reps for four weeks because accessories inherited the adaptation's span.
    for (const priorities of [["strength"], ["skill", "strength"], ["power"], ["hypertrophy"]]) {
      const p = gen({ priorities });
      for (const w of p.weeks) for (const d of Object.values(w.days)) for (const e of d.exercises || []) {
        if (e.role === "compound" || e.role === "core") continue;
        const r = parseReps(e.repRange);
        if (!r) continue;
        assert.ok(r.hi >= 8, `${priorities}: ${e.exerciseId} at ${e.repRange} — isolation below 8 reps`);
      }
    }
  });
  it("a heavy compound always gets real rest, whatever asked for it", () => {
    // skill's restSec tops out at 120 s, and 3-5 reps on 120 s is not the
    // session the prescription claims.
    for (const priorities of [["skill", "strength"], ["strength"], ["power"]]) {
      const p = gen({ priorities });
      for (const d of Object.values(p.weeks[0].days)) for (const e of d.exercises || []) {
        const r = parseReps(e.repRange);
        if (e.role !== "compound" || !r || r.hi > 5) continue;
        assert.ok(e.restSeconds >= 150, `${priorities}: ${e.exerciseId} ${e.repRange} on ${e.restSeconds}s`);
      }
    }
  });
  it("two arm slots are not two curls", () => {
    // Direct arm work was 17.5 biceps sets against 0 triceps: pickForPattern
    // penalised repeating an EXERCISE, never a muscle, and every curl in the
    // library sorts before every extension.
    const p = gen();
    const direct = { Biceps: 0, Triceps: 0 };
    for (const d of Object.values(p.weeks[0].days)) for (const e of d.exercises || []) {
      const map = MUSCLE_MAP[e.exerciseId] || {};
      for (const m of ["Biceps", "Triceps"]) if (map[m] >= 1) direct[m] += e.prescribedSets;
    }
    assert.ok(direct.Biceps > 0 && direct.Triceps > 0,
      `biceps ${direct.Biceps}, triceps ${direct.Triceps} — one arm muscle got nothing`);
  });
  it("two core slots are not the same core exercise twice over", () => {
    const p = gen();
    const quals = new Set();
    let slots = 0;
    for (const d of Object.values(p.weeks[0].days)) for (const e of d.exercises || []) {
      if (e.role !== "core") continue;
      slots++;
      const q = qualityOf(e.exerciseId);
      if (q) quals.add(q);
    }
    if (slots >= 2) assert.ok(quals.size >= 2, `${slots} core slots covering only ${[...quals]}`);
  });
  it("no muscle group is left untrained", () => {
    for (const days of [3, 4, 5]) {
      const p = gen({ mandatoryDays: days + 1, cardioPerWeek: 1 });
      const res = auditBlock(p, { adaptation: "hypertrophy" });
      const c = res.checks.find((x) => x.id === "coverage.untrained");
      assert.ok(c.ok, `${days} days: ${c.message}`);
    }
  });
  it("peak volume stays inside the productive range", () => {
    // 27.5 quad sets against a MAV of 16 is what an uncapped ramp produces.
    for (const days of [3, 4, 5]) for (const weeks of [4, 6, 8]) {
      const p = gen({ mandatoryDays: days + 1, lengthWeeks: weeks });
      const res = auditBlock(p, { adaptation: "hypertrophy" });
      const c = res.checks.find((x) => x.id === "volume.over_mav");
      assert.ok(c.ok, `${days}d ${weeks}w: ${c.message}`);
    }
  });
  it("more than one set is never added to an exercise at once", () => {
    for (const weeks of [4, 6, 8]) {
      const res = auditBlock(gen({ lengthWeeks: weeks }), { adaptation: "hypertrophy" });
      const c = res.checks.find((x) => x.id === "progression.ramp");
      assert.deepEqual(c.detail.bigJumps, [], `${weeks}w: ${c.message}`);
    }
  });
  it("a second cardio day becomes intervals, not a second easy run", () => {
    // No hard aerobic session is the one omission with a mortality signal.
    const p = gen({ mandatoryDays: 6, cardioPerWeek: 2 });
    const cardio = Object.values(p.weeks[0].days).filter((d) => d.type === "cardio");
    assert.equal(cardio.length, 2);
    assert.ok(cardio.some((d) => /zone 4|hard/i.test(d.prescription)), cardio.map((d) => d.prescription).join(" | "));
  });
  it("but an explicit cardio choice is never overridden", () => {
    const r = generateProgram({ name: "T", startDate: "2026-08-10", lengthWeeks: 4,
      priorities: ["hypertrophy", "long_endurance"], mandatoryDays: 6, optionalDays: 0,
      cardioPerWeek: 2, places: [place] });
    const cardio = Object.values((r.program || r).weeks[0].days).filter((d) => d.type === "cardio");
    assert.equal(cardio.filter((d) => /zone 4|hard/i.test(d.prescription)).length, 0,
      "the user asked for Zone 2 — say the VO2 gap, don't silently fix it");
    assert.ok(r.floorGaps.some((g) => /hard aerobic/i.test(g)), "…and it must still be named");
  });
  it("the whole input space generates without an error-level defect", () => {
    let checked = 0;
    for (const priorities of [["strength"], ["hypertrophy"], ["skill", "strength"], ["muscular_endurance"]])
      for (const days of [3, 4, 5]) for (const weeks of [4, 6]) for (const cardio of [1, 2]) {
        const p = gen({ priorities, mandatoryDays: days + cardio, cardioPerWeek: cardio, lengthWeeks: weeks });
        const res = auditBlock(p, { adaptation: priorities.find(isStrength) || "hypertrophy" });
        assert.deepEqual(res.errors.map((e) => e.id), [],
          `${priorities}/${days}d/${weeks}w/${cardio}c: ${res.errors.map((e) => e.message).join("; ")}`);
        checked++;
      }
    assert.ok(checked >= 48, `only ${checked} combinations checked`);
  });
});

group("builder — only the first strength pick shapes the lifting", () => {
  // Not a bug, but invisible, and that cost a real user a block: she picked
  // Skill & technique and then Strength, and the whole plan was built to skill's
  // parameters while the priorities screen told her the two "work well
  // together". These pin the behaviour so the screen's new wording stays true.
  const place = { name: "Gym", implements: [...FULL_GYM, SURVEYED], barWeightKg: 20, ezBarWeightKg: 7.5,
    barbellPlatesKg: [25, 20, 15, 10, 5, 2.5, 1.25], ezBarPlatesKg: [10, 5, 2.5, 1.25],
    cable: { minKg: 2.5, maxKg: 120, stepKg: 2.5 }, dumbbells: { minKg: 2.5, maxKg: 50, stepKg: 2.5 } };
  const restOfFirstCompound = (priorities) => {
    const r = generateProgram({ name: "T", startDate: "2026-08-10", lengthWeeks: 4, priorities,
      mandatoryDays: 5, optionalDays: 1, cardioPerWeek: 1, places: [place] });
    const p = r.program || r;
    for (const wd of ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]) {
      const d = p.weeks[0].days[wd];
      const e = d && (d.exercises || []).find((x) => x.role === "compound");
      if (e) return e.restSeconds;
    }
    return null;
  };

  it("a later strength-family pick changes nothing at all", () => {
    assert.equal(restOfFirstCompound(["skill", "strength"]), restOfFirstCompound(["skill"]),
      "adding Strength after Skill must be a no-op — if this ever changes, the screen's wording is wrong");
  });
  it("promoting it changes the whole block", () => {
    const asSkill = restOfFirstCompound(["skill", "strength"]);
    const asStrength = restOfFirstCompound(["strength", "skill"]);
    assert.notEqual(asSkill, asStrength, "the promote button has to actually do something");
    assert.ok(asStrength >= 150, `promoted to Strength, heavy compounds rest ${asStrength}s`);
  });
  it("a cardio pick alongside does not touch the lifting", () => {
    // Only the strength FAMILY competes for this slot; cardio picks are separate.
    assert.equal(restOfFirstCompound(["strength", "long_endurance"]), restOfFirstCompound(["strength"]));
  });
});

group("builder — a block knows what came before it", () => {
  const place = { name: "Gym", implements: [...FULL_GYM, SURVEYED], barWeightKg: 20, ezBarWeightKg: 7.5,
    barbellPlatesKg: [25, 20, 15, 10, 5, 2.5, 1.25], ezBarPlatesKg: [10, 5, 2.5, 1.25],
    cable: { minKg: 2.5, maxKg: 120, stepKg: 2.5 }, dumbbells: { minKg: 2.5, maxKg: 50, stepKg: 2.5 } };
  const gen = (over = {}) => {
    const r = generateProgram({ name: "T", startDate: "2026-08-10", lengthWeeks: 6, priorities: ["hypertrophy"],
      mandatoryDays: 5, optionalDays: 0, cardioPerWeek: 1, places: [place], ...over });
    return r.program || r;
  };

  it("with no history it behaves exactly as before", () => {
    const a = gen(), b = gen({ previousBlocks: [] });
    assert.deepEqual(Object.keys(a.exercises).sort(), Object.keys(b.exercises).sort());
  });
  it("a second block varies the movements from the first", () => {
    const first = gen();
    const second = gen({ startDate: "2026-09-21", previousBlocks: [first] });
    const a = new Set(Object.keys(first.exercises)), b = new Set(Object.keys(second.exercises));
    const shared = [...b].filter((id) => a.has(id));
    assert.ok(shared.length < b.size,
      "the second block reused every single lift — running the app twice gives the same plan");
  });
  it("variety never costs coverage", () => {
    // The nudge must not push the picker onto the wrong movement to be different.
    const first = gen();
    const second = gen({ startDate: "2026-09-21", previousBlocks: [first] });
    const res = auditBlock(second, { adaptation: "hypertrophy" });
    assert.deepEqual(res.errors.map((e) => e.id), [], res.errors.map((e) => e.message).join("; "));
  });
  it("a muscle skipped across blocks is named", () => {
    // Two blocks that never train calves should say so on the third.
    const stripped = (p) => ({ ...p, weeks: p.weeks.map((w) => ({ ...w, days: Object.fromEntries(
      Object.entries(w.days).map(([k, d]) => [k, d.type !== "strength" ? d : { ...d,
        exercises: (d.exercises || []).filter((e) => !(MUSCLE_MAP[e.exerciseId] || {}).Calves) }])) })) });
    const past = [stripped(gen()), stripped(gen())];
    const r = generateProgram({ name: "T3", startDate: "2026-11-02", lengthWeeks: 6, priorities: ["hypertrophy"],
      mandatoryDays: 5, optionalDays: 0, cardioPerWeek: 1, places: [place], previousBlocks: past });
    assert.ok(r.history.neglected.includes("Calves"), `neglected: ${r.history.neglected}`);
  });
  it("summarising history is safe on junk input", () => {
    assert.equal(summariseHistory().blocks, 0);
    assert.equal(summariseHistory([null, {}, { weeks: [] }]).blocks, 1);
  });
});

group("plan CSV — audit a block in a spreadsheet and put it back", () => {
  const prog = () => ({
    id: "p1", name: "Recomp Build", startDate: "2026-08-03", lengthWeeks: 2,
    equipmentProfile: { barWeightKg: 20 },                    // CSV cannot express this
    exercises: { back_squat: { name: "Barbell Back Squat", implement: "barbell", cue: "Brace" },
      plank: { name: "Plank", implement: "bodyweight", cue: "" } },
    dayTemplates: {
      Mon: { weekday: "Mon", type: "strength", label: "Lower", preRoutine: "warmupStrength",
        postRoutine: "cooldownStrength", exercises: [{ exerciseId: "back_squat", role: "compound", restSeconds: 180 }] },
      Tue: { weekday: "Tue", type: "cardio", label: "Zone 2", preRoutine: "warmupCardio", exercises: [] },
    },
    weeks: [1, 2].map((weekNumber) => ({ weekNumber, startDate: "2026-08-03", phaseName: "Build", days: {
      Mon: { weekday: "Mon", type: "strength", exercises: [
        { exerciseId: "back_squat", role: "compound", prescribedSets: 3, repRange: "6-8", restSeconds: 180 },
        { exerciseId: "plank", role: "core", prescribedSets: 2, repRange: "30-45", restSeconds: 60 }] },
      Tue: { weekday: "Tue", type: "cardio", prescription: "40 min Zone 2" },
      Wed: { weekday: "Wed", type: "rest" },
    } })),
  });

  it("a block survives the round trip unchanged", () => {
    const p = prog();
    const parsed = fromCSV(toCSV(p));
    assert.equal(parsed.ok, true);
    assert.deepEqual(parsed.warnings, []);
    assert.deepEqual(diffPlans(p, applyPlanCSV(p, parsed, { mode: "update" })), [],
      "export → import must be a no-op, or the file cannot be trusted for auditing");
  });
  it("rest and cardio days survive, so a missing row means something", () => {
    const parsed = fromCSV(toCSV(prog()));
    const wk1 = parsed.weeks[0].days;
    assert.equal(wk1.Wed.type, "rest");
    assert.equal(wk1.Tue.type, "cardio");
    assert.equal(wk1.Tue.prescription, "40 min Zone 2");
  });
  it("what the CSV cannot express is kept, not dropped", () => {
    // The whole reason import merges rather than rebuilds.
    const p = prog();
    const next = applyPlanCSV(p, fromCSV(toCSV(p)), { mode: "update" });
    assert.equal(next.dayTemplates.Mon.preRoutine, "warmupStrength");
    assert.equal(next.dayTemplates.Mon.postRoutine, "cooldownStrength");
    assert.deepEqual(next.equipmentProfile, { barWeightKg: 20 });
    assert.equal(next.exercises.back_squat.cue, "Brace", "cues have no column and must not be erased");
    assert.equal(next.exercises.back_squat.implement, "barbell");
  });
  it("updating in place keeps the block id, so its logged sessions stay attached", () => {
    const p = prog();
    assert.equal(applyPlanCSV(p, fromCSV(toCSV(p)), { mode: "update" }).id, "p1");
    assert.equal(applyPlanCSV(p, fromCSV(toCSV(p)), { mode: "new", id: "p2" }).id, "p2");
  });

  it("an edit made in a spreadsheet comes back as that edit", () => {
    const p = prog();
    const edited = toCSV(p).replace("back_squat,Barbell Back Squat,3,6-8", "back_squat,Barbell Back Squat,5,4-6");
    const next = applyPlanCSV(p, fromCSV(edited), { mode: "update" });
    assert.equal(next.weeks[0].days.Mon.exercises[0].prescribedSets, 5);
    assert.equal(next.weeks[0].days.Mon.exercises[0].repRange, "4-6");
    const changes = diffPlans(p, next);
    assert.ok(changes.some((c) => /3 → 5 sets/.test(c)), changes.join(" | "));
    assert.ok(changes.some((c) => /6-8 → 4-6 reps/.test(c)), changes.join(" | "));
  });
  it("a deleted row removes the exercise, and the diff says so", () => {
    const p = prog();
    const edited = toCSV(p).split("\r\n").filter((l) => !/,1,Build,Mon,strength,Lower,2,plank/.test(l)).join("\r\n");
    const next = applyPlanCSV(p, fromCSV(edited), { mode: "update" });
    assert.deepEqual(next.weeks[0].days.Mon.exercises.map((e) => e.exerciseId), ["back_squat"]);
    assert.ok(diffPlans(p, next).some((c) => /− Plank/.test(c)));
  });
  it("reordering rows reorders the day", () => {
    const p = prog();
    const edited = toCSV(p)
      .replace(",1,back_squat,", ",9,back_squat,");     // push the squat last in week 1 & 2
    const next = applyPlanCSV(p, fromCSV(edited), { mode: "update" });
    assert.deepEqual(next.weeks[0].days.Mon.exercises.map((e) => e.exerciseId), ["plank", "back_squat"]);
  });

  it("a file that isn't a plan is refused with a reason", () => {
    const r = fromCSV("name,email\nAda,ada@example.com\n");
    assert.equal(r.ok, false);
    assert.ok(/missing the/.test(r.warnings[0]), r.warnings[0]);
    assert.equal(fromCSV("").ok, false);
  });
  it("one bad row is reported and skipped, not fatal", () => {
    const p = prog();
    const edited = toCSV(p).replace("back_squat,Barbell Back Squat,3,6-8", "back_squat,Barbell Back Squat,lots,6-8");
    const r = fromCSV(edited);
    assert.equal(r.ok, true, "the rest of the plan is still importable");
    assert.ok(r.warnings.some((w) => /isn't a set count/.test(w)), r.warnings.join(" | "));
    assert.equal(r.weeks[0].days.Mon.exercises.length, 1, "only the good row survived");
  });
  it("a missing week is named rather than silently run", () => {
    const p = prog();
    const edited = toCSV(p).split("\r\n").filter((l) => !/,1,Build,/.test(l)).join("\r\n");
    const r = fromCSV(edited);
    assert.ok(r.warnings.some((w) => /expected 1 to/.test(w)), r.warnings.join(" | "));
  });
  it("commas and quotes inside a field survive the trip", () => {
    const p = prog();
    p.name = 'Block "A", rebuilt';
    p.weeks[0].days.Tue.prescription = '40 min Zone 2, then 6 × 20 s strides';
    const parsed = fromCSV(toCSV(p));
    assert.equal(parsed.meta.name, 'Block "A", rebuilt');
    assert.equal(parsed.weeks[0].days.Tue.prescription, "40 min Zone 2, then 6 × 20 s strides");
  });
  it("a spreadsheet's CRLF, BOM and trailing blank line are all fine", () => {
    const p = prog();
    const r = fromCSV("﻿" + toCSV(p) + "\r\n");
    assert.equal(r.ok, true);
    assert.deepEqual(r.warnings, []);
  });
});

group("deviations — today's changes, and whether they stick", () => {
  const prog = {
    id: "p1",
    exercises: { back_squat: { name: "Barbell Back Squat", implement: "barbell", cue: "" } },
    dayTemplates: { Mon: { weekday: "Mon", type: "strength", exercises: [
      { exerciseId: "back_squat", role: "compound", restSeconds: 180 },
      { exerciseId: "plank", role: "core", restSeconds: 60 },
    ] } },
    weeks: [1, 2, 3].map((weekNumber) => ({ weekNumber, days: { Mon: { weekday: "Mon", type: "strength", exercises: [
      { exerciseId: "back_squat", role: "compound", prescribedSets: 3, repRange: "6-8", restSeconds: 180 },
      { exerciseId: "plank", role: "core", prescribedSets: 2, repRange: "30-45", restSeconds: 60 },
    ] } } })),
  };
  const q = (dev) => deviationQuestions(dev, prog);

  it("an ordinary session asks nothing", () => {
    assert.deepEqual(q({ added: [], setChanges: [] }), []);
    assert.deepEqual(q(null), []);
  });
  it("a change you didn't actually perform asks nothing", () => {
    // added the exercise, then skipped it — the session is exactly as planned
    assert.deepEqual(q({ added: [{ exerciseId: "db_curl", sets: 0 }], setChanges: [] }), []);
    assert.deepEqual(q({ added: [], setChanges: [{ exerciseId: "back_squat", planned: 3, actual: 0, delta: -3 }] }), []);
  });
  it("an added exercise is named, not shown as an id", () => {
    const [item] = q({ added: [{ exerciseId: "db_curl", sets: 3 }], setChanges: [] });
    assert.equal(item.kind, "added");
    assert.ok(/DB Biceps Curl/.test(item.question), item.question);
    assert.equal(item.exerciseId, "db_curl");
  });
  it("a set change reads in plain numbers, both directions", () => {
    const [more] = q({ added: [], setChanges: [{ exerciseId: "back_squat", planned: 3, actual: 4, delta: 1 }] });
    assert.ok(/4 sets .* instead of 3 — 1 more\./.test(more.question), more.question);
    const [fewer] = q({ added: [], setChanges: [{ exerciseId: "back_squat", planned: 3, actual: 1, delta: -2 }] });
    assert.ok(/1 set .* instead of 3 — 2 fewer\./.test(fewer.question), fewer.question);
  });

  it("\"just for today\" changes nothing at all", () => {
    const qs = q({ added: [{ exerciseId: "db_curl", sets: 3 }], setChanges: [] });
    const answers = { [qs[0].key]: NO };
    assert.equal(applyTemplateDecisions(prog, qs, answers, { weekday: "Mon", fromWeek: 1 }), prog);
    const res = [{ exerciseId: "db_curl", sets: [{}, {}, {}] }];
    assert.equal(stampEffort(res, qs, answers), res, "no effort signal either");
  });

  it("\"yes\" adds the lift to FUTURE weeks only", () => {
    const qs = q({ added: [{ exerciseId: "db_curl", sets: 3 }], setChanges: [] });
    const next = applyTemplateDecisions(prog, qs, { [qs[0].key]: YES }, { weekday: "Mon", fromWeek: 1 });
    const ids = (wk) => next.weeks.find((w) => w.weekNumber === wk).days.Mon.exercises.map((e) => e.exerciseId);
    assert.deepEqual(ids(1), ["back_squat", "plank"], "the week just trained is history — never rewritten");
    assert.ok(ids(2).includes("db_curl"));
    assert.ok(ids(3).includes("db_curl"));
    assert.equal(prog.weeks[1].days.Mon.exercises.length, 2, "the original program must not be mutated");
  });
  it("an added lift lands before the core work, not after it", () => {
    const qs = q({ added: [{ exerciseId: "db_curl", sets: 3 }], setChanges: [] });
    const next = applyTemplateDecisions(prog, qs, { [qs[0].key]: YES }, { weekday: "Mon", fromWeek: 1 });
    assert.deepEqual(next.weeks[1].days.Mon.exercises.map((e) => e.exerciseId), ["back_squat", "db_curl", "plank"]);
  });
  it("an added lift reaches the day TEMPLATE, so a regenerated block keeps it", () => {
    const qs = q({ added: [{ exerciseId: "db_curl", sets: 3 }], setChanges: [] });
    const next = applyTemplateDecisions(prog, qs, { [qs[0].key]: YES }, { weekday: "Mon", fromWeek: 1 });
    assert.ok(next.dayTemplates.Mon.exercises.some((e) => e.exerciseId === "db_curl"));
    assert.ok(next.exercises.db_curl && next.exercises.db_curl.name === "DB Biceps Curl",
      "and gets a library entry, or it renders as a raw id forever");
  });
  it("\"yes\" on a set change rewrites the count in future weeks", () => {
    const qs = q({ added: [], setChanges: [{ exerciseId: "back_squat", planned: 3, actual: 4, delta: 1 }] });
    const next = applyTemplateDecisions(prog, qs, { [qs[0].key]: YES }, { weekday: "Mon", fromWeek: 1 });
    const sets = (wk) => next.weeks.find((w) => w.weekNumber === wk).days.Mon.exercises[0].prescribedSets;
    assert.equal(sets(1), 3, "history untouched");
    assert.equal(sets(2), 4);
    assert.equal(sets(3), 4);
  });

  it("\"remember it\" leaves the plan alone and marks the log instead", () => {
    const qs = q({ added: [], setChanges: [{ exerciseId: "back_squat", planned: 3, actual: 4, delta: 1 }] });
    const answers = { [qs[0].key]: CONSIDER };
    assert.equal(applyTemplateDecisions(prog, qs, answers, { weekday: "Mon", fromWeek: 1 }), prog);
    const res = stampEffort([{ exerciseId: "back_squat", sets: [] }], qs, answers);
    assert.equal(res[0].extraSets, 1);
  });
  it("dropping sets marks the log the OTHER way", () => {
    const qs = q({ added: [], setChanges: [{ exerciseId: "back_squat", planned: 3, actual: 1, delta: -2 }] });
    const res = stampEffort([{ exerciseId: "back_squat", sets: [] }], qs, { [qs[0].key]: CONSIDER });
    assert.equal(res[0].extraSets, -1, "sign, not magnitude — it's a nudge, not a verdict");
  });
  it("an added exercise's whole volume is not read as huge headroom", () => {
    const qs = q({ added: [{ exerciseId: "db_curl", sets: 5 }], setChanges: [] });
    const res = stampEffort([{ exerciseId: "db_curl", sets: [] }], qs, { [qs[0].key]: CONSIDER });
    assert.equal(res[0].extraSets, 1, "5 extra sets of a NEW lift still means one step");
  });
});

group("progression — extra volume you chose not to program still counts", () => {
  // `extraSets` is written only when the user picked "remember it" at the end of
  // a session. It moves the effort reserve by ONE step, which means it changes
  // the prescription exactly where the reserve drives the number — the rep-range
  // bridges, and the topped-out double-jump threshold — and nowhere else.
  //
  // That is not a gap. A clean session with no rep decay already infers a reserve
  // of 2, which is already the top of the meaningful range and already earns the
  // bigger jump; a third step would be a load leap dressed up as autoregulation.
  // These assert the real numbers rather than a direction, so a future change to
  // the caps shows up here as a failure instead of passing vacuously.
  const equip = { locations: { Gym: ["barbell"] }, byPlace: { Gym: {
    barWeightKg: 20, ezBarWeightKg: 7.5, barbellPlatesKg: [25, 20, 15, 10, 5, 2.5, 1.25],
    ezBarPlatesKg: [10, 5, 2.5, 1.25], cable: { minKg: 2.5, maxKg: 120, stepKg: 2.5 } } } };
  const at = (repRange, prevRange, sets, extraSets) => recommend({
    curRx: { prescribedSets: 3, repRange }, prevRange, implement: "barbell",
    location: "Gym", equip, exerciseId: "back_squat", prevEx: { sets, extraSets } });
  const clean = [{ weightKg: 80, reps: 8 }, { weightKg: 80, reps: 8 }, { weightKg: 80, reps: 8 }];
  const heavyTriple = [{ weightKg: 100, reps: 5 }, { weightKg: 100, reps: 5 }, { weightKg: 100, reps: 4 }];

  it("an unmarked session prescribes exactly what it always did", () => {
    assert.equal(at("6-8", "6-8", clean).load, 90, "guard: the untouched baseline");
    assert.equal(at("6-8", "6-8", clean, 0).load, 90, "extraSets: 0 must be indistinguishable from absent");
    assert.equal(at("6-8", "6-8", clean, undefined).load, 90);
  });
  it("stopping short lowers the next target", () => {
    // reserve 2 → 1, so the topped-out branch stops double-jumping: 80 → 85, not 90
    assert.equal(at("6-8", "6-8", clean, -1).load, 85);
  });
  it("an extra set raises the target where the reserve sets the number", () => {
    // the higher-rep-range bridge re-bases straight off the effort-adjusted e1RM
    assert.equal(at("6-8", "3-5", heavyTriple).load, 97.5, "guard: the untouched baseline");
    assert.equal(at("6-8", "3-5", heavyTriple, 1).load, 100);
    assert.equal(at("6-8", "3-5", heavyTriple, -1).load, 95);
  });
  it("an extra set never LOWERS a target, in any branch", () => {
    for (const [range, prev, sets] of [["6-8", "6-8", clean], ["6-8", "3-5", heavyTriple],
      ["6-8", "8-12", [{ weightKg: 60, reps: 12 }, { weightKg: 60, reps: 12 }, { weightKg: 60, reps: 12 }]]])
      assert.ok(at(range, prev, sets, 1).load >= at(range, prev, sets).load,
        `${range} from ${prev} went backwards on an extra set`);
  });
  it("it stays a nudge — never a second load jump on top of the double jump", () => {
    // clean 8/8/8 already earns the bigger jump (reserve 2), and one more set
    // must not compound into a third plate step.
    assert.equal(at("6-8", "6-8", clean, 1).load, 90, "already double-jumping — do not stack another step");
  });
  it("a logged RIR is still the primary evidence", () => {
    const grind = clean.map((s) => ({ ...s, rir: 0 }));
    // RIR 0 on a topped set means hold and clean it up, whatever the volume said
    assert.equal(at("6-8", "6-8", grind).direction, "hold");
    assert.equal(at("6-8", "6-8", grind, 1).direction, "hold", "an extra set cannot override RIR 0");
  });
});

group("swap — an equal alternative for a lift you can't do today", () => {
  const FULL = ["barbell", "ez_bar", "cable", "dumbbell_pair", "dumbbell_single", "machine",
    "bench", "incline_bench", "rack", "pullup_bar", SURVEYED];
  const gym = availableAt(FULL);
  const dumbbellsOnly = availableAt(["dumbbell_pair", "dumbbell_single", "bench", SURVEYED]);

  it("the curated 1:1 match is offered first", () => {
    const alts = alternativesFor("back_squat", { pool: gym });
    assert.equal(alts[0], "db_goblet_squat", "SUB_CANDIDATES order must survive");
    assert.equal(alts.includes("back_squat"), false, "never offer the lift being replaced");
  });
  it("substitute-only lifts reach the list, which is where most matches live", () => {
    // db_bench_press is in SUB_EXERCISES, not the library, so filtering the
    // curated matches against the library pool alone silently drops the best one.
    const usable = new Set([...gym.map((e) => e.id), "db_bench_press"]);
    const alts = alternativesFor("bench_press", { pool: gym, available: usable });
    assert.equal(alts[0], "db_bench_press");
  });
  it("a lift with no curated match still gets same-pattern alternatives", () => {
    // front_squat has no SUB_CANDIDATES entry at all — the general fallback is
    // the only thing standing between the user and an empty suggestions list.
    assert.equal(SUB_CANDIDATES.front_squat, undefined, "guard: this test assumes no curated entry");
    const alts = alternativesFor("front_squat", { pool: gym });
    assert.ok(alts.length > 0, "every lift must offer something");
    const patterns = new Set(alts.map((id) => EXERCISE_LIBRARY.find((e) => e.id === id).pattern));
    assert.deepEqual([...patterns], ["squat"], "alternatives must train the same pattern");
  });
  it("a compound is not swapped for an isolation exercise first", () => {
    const alts = alternativesFor("front_squat", { pool: gym });
    const first = EXERCISE_LIBRARY.find((e) => e.id === alts[0]);
    assert.equal(first.role, "compound", "same role outranks everything else");
  });
  it("nothing the gym cannot load is ever offered", () => {
    const alts = alternativesFor("back_squat", { pool: dumbbellsOnly });
    const ids = new Set(dumbbellsOnly.map((e) => e.id));
    for (const id of alts) assert.ok(ids.has(id), `${id} is not available at this place`);
    assert.equal(alts.includes("front_squat"), false, "no barbell, no barbell alternatives");
  });
  it("an unknown lift degrades to nothing rather than throwing", () => {
    assert.deepEqual(alternativesFor("not_a_real_lift", { pool: gym }), []);
    assert.deepEqual(alternativesFor("back_squat", {}), []);
  });
  it("the list is capped so the section stays a shortlist", () => {
    assert.ok(alternativesFor("back_squat", { pool: gym, limit: 3 }).length <= 3);
  });
});

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

group("calendar — a day you trained outlives the block that planned it", () => {
  const block = { id: "prog-1", startDate: "2026-08-03", lengthWeeks: 6 };
  const strengthDone = { id: "sess-1", type: "strength" };
  const cardioDone = { id: "sess-2", type: "cardio" };

  it("a planned training day opens its plan", () => {
    const r = dayCellRole(block, "strength", null);
    assert.equal(r.actionable, true);
    assert.equal(r.orphanDone, false);
    assert.equal(r.kind, "strength");
  });
  it("a planned rest day is not actionable", () => {
    assert.equal(dayCellRole(block, "rest", null).actionable, false);
  });
  it("a date outside every block stays empty", () => {
    const r = dayCellRole(null, "none", null);
    assert.equal(r.actionable, false);
    assert.equal(r.orphanDone, false);
  });
  it("a logged day whose block was deleted is STILL openable", () => {
    // The regression this exists for: delete a block five days in and those five
    // completed days became blank, unclickable "No plan" squares. The sessions
    // were never deleted — they were just unreachable, which reads the same.
    const r = dayCellRole(null, "none", strengthDone);
    assert.equal(r.actionable, true, "a session you logged must never become unreachable");
    assert.equal(r.orphanDone, true, "and it opens its own summary, not a plan that is gone");
    assert.equal(r.kind, "strength", "it colours by what was actually done");
  });
  it("an orphaned run reads as a run", () => {
    assert.equal(dayCellRole(null, "none", cardioDone).kind, "cardio");
  });
  it("a logged day that still has its block keeps the planned route", () => {
    const r = dayCellRole(block, "strength", strengthDone);
    assert.equal(r.orphanDone, false, "the block is still there — open the plan, not the summary");
    assert.equal(r.actionable, true);
  });
  it("a session with no recorded type still gets a cell", () => {
    assert.equal(dayCellRole(null, "none", { id: "s" }).kind, "strength");
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
  it("the plates-on-the-bar chip can be moved BOTH ways", () => {
    // The bug this exists for: the imperial test was `|bar - 20.41| < 0.5`, and
    // the metric bar is 20 kg — 0.41 kg away, inside the tolerance. Every rack
    // read as imperial, so "Pounds" was permanently lit and tapping "Metric"
    // wrote a 20 kg bar that classified as imperial again. The chip looked dead.
    const metricPlace = { name: "Gym", ...rackFields(METRIC_EQUIPMENT) };
    const imperialPlace = { name: "Gym", ...rackFields(IMPERIAL_EQUIPMENT) };
    assert.equal(isImperialRack(imperialPlace), true);
    assert.equal(isImperialRack(metricPlace), false, "a 20 kg bar is not a 45 lb bar");
    // the two bars are close enough that any absolute tolerance ≥0.42 fails here
    assert.ok(Math.abs(IMPERIAL_EQUIPMENT.barWeightKg - METRIC_EQUIPMENT.barWeightKg) < 0.5,
      "the two stock bars really are inside half a kilo of each other");
    // and the round trip the user actually performs must stick
    const toggled = { ...imperialPlace, ...rackFields(METRIC_EQUIPMENT) };
    assert.equal(isImperialRack(toggled), false, "tapping Metric must survive the next read");
    const back = { ...toggled, ...rackFields(IMPERIAL_EQUIPMENT) };
    assert.equal(isImperialRack(back), true);
    // an edited bar still lands on exactly one side rather than neither
    assert.equal(isImperialRack({ barWeightKg: 15 }), false);    // women's bar
    assert.equal(isImperialRack({ barWeightKg: 25 }), true);     // nearer the 45 lb
    assert.equal(isImperialRack({}), false);                     // no bar → metric default
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
// ---------------------------------------------------------------------------
// YOGA. The generator is the same shape of program as the block builder, which
// shipped 79% defective because nothing graded the finished artefact — so these
// assert against WHOLE composed sequences, not against the pieces.
group("yoga — the library holds together", () => {
  it("every pose is structurally complete and has a figure", () => {
    assert.deepEqual(checkAsanas({ art: ASANA_ART_KEYS }), []);
  });
  it("every intent names a real style and real peaks", () => {
    assert.deepEqual(checkIntents({ styles: YOGA_STYLES, asanas: asanaById }), []);
  });
  it("the Primary Series names postures that exist", () => {
    assert.deepEqual(checkSeries(), []);
  });
  it("no intent claims to substitute cardio", () => {
    // Yoga averages ~3.3 METs against 8-9 for a Zone 2 run. The app may never
    // offer it as a cardio session, at any length or vigour.
    assert.deepEqual(YOGA_INTENTS.filter((i) => String(i.substitutes) === "cardio").map((i) => i.id), []);
  });
  it("a yoga session contributes zero hard sets", () => {
    for (const i of YOGA_INTENTS) assert.equal(accountingFor(i).hardSets, 0, i.id);
  });
});

group("yoga — the arc is a dependency, not a preference", () => {
  const flow = generateFlow({ intent: "strong_flow", minutes: 45, limits: [], level: 2, seed: 4242 });
  const audit = auditFlow(flow);
  it("composes without an error-level defect", () => {
    assert.deepEqual(audit.errors.map((e) => e.id), []);
  });
  it("puts every preparatory pose BEFORE the peak", () => {
    const peakIdx = flow.items.findIndex((it) => it.phase === "peak");
    assert.ok(peakIdx > 0, "there is a peak");
    const prepsAfter = flow.items.slice(peakIdx + 1).filter((it) => it.prepFor);
    assert.deepEqual(prepsAfter.map((p) => p.asanaId), [], "preparation must precede the peak");
  });
  it("puts every counter-pose AFTER the peak", () => {
    const peakIdx = flow.items.findIndex((it) => it.phase === "peak");
    const countersBefore = flow.items.slice(0, peakIdx).filter((it) => it.counterTo);
    assert.deepEqual(countersBefore.map((c) => c.asanaId), []);
  });
  it("ends in savasana, at 10-20% of the practice", () => {
    const last = flow.items[flow.items.length - 1];
    assert.equal(last.phase, "savasana");
    const share = last.durationSeconds / flow.totalSeconds;
    assert.ok(share >= 0.10 && share <= 0.20, `savasana share ${Math.round(share * 100)}%`);
  });
  it("lands the peak between 55% and 75% of elapsed time", () => {
    const idx = flow.items.findIndex((it) => it.phase === "peak");
    const at = flowElapsedAt(flow.items, idx) / flowSecondsOf(flow.items);
    assert.ok(at >= 0.55 && at <= 0.75, `peak at ${Math.round(at * 100)}%`);
  });
  it("is reproducible from its seed", () => {
    const again = generateFlow({ intent: "strong_flow", minutes: 45, limits: [], level: 2, seed: 4242 });
    assert.deepEqual(again.items.map((i) => i.asanaId), flow.items.map((i) => i.asanaId));
  });
  it("gives a different sequence on a different seed", () => {
    const other = generateFlow({ intent: "strong_flow", minutes: 45, limits: [], level: 2, seed: 4243 });
    assert.notDeepEqual(other.items.map((i) => i.asanaId), flow.items.map((i) => i.asanaId));
  });
});

group("yoga — contraindications are an input, not a filter", () => {
  // The two sites that matter: the knee (deep flexion plus rotation — lotus,
  // pigeon) and the sacroiliac joint (asymmetric open-hip shapes). Both are
  // documented yoga injury mechanisms, which is why this is not a polish pass.
  const limits = ["knees", "si_joint"];
  it("no protected pose survives into any generated sequence", () => {
    for (const intent of YOGA_INTENTS) {
      if (intent.id === "ashtanga") continue;
      for (const minutes of intent.minutes) {
        const f = generateFlow({ intent: intent.id, minutes, limits, level: 3, seed: 99 });
        const bad = f.items.filter((it) => {
          const a = asanaById(it.asanaId);
          return a && a.avoid.some((s) => limits.includes(s));
        });
        assert.deepEqual(bad.map((b) => b.asanaId), [], `${intent.id} ${minutes}min`);
      }
    }
  });
  it("names what it left out instead of silently omitting it", () => {
    const f = generateFlow({ intent: "hips_low_back", minutes: 30, limits, level: 3, seed: 7 });
    assert.ok(f.excluded.length > 0);
    assert.ok(f.excluded.some((e) => e.id === "padmasana"), "lotus is a knee pose and must be named");
    for (const e of f.excluded) assert.ok(e.sites.length > 0, `${e.id} says which site`);
  });
  it("drops the peak rather than arriving at one it cannot prepare", () => {
    // Every peak whose own preparation the limitations strip must be refused.
    const f = generateFlow({ intent: "strong_flow", minutes: 30,
      limits: ["knees", "si_joint", "low_back", "wrists", "shoulders", "neck", "inversions"],
      level: 3, seed: 5 });
    const audit = auditFlow(f);
    assert.deepEqual(audit.errors.map((e) => e.id), []);
  });
});

group("yoga — the Primary Series stays the Primary Series", () => {
  it("substitutes in place and keeps every slot", () => {
    const plain = primarySeries({ limits: [], level: 3, breathSeconds: 5 });
    const knees = primarySeries({ limits: ["knees", "si_joint"], level: 3, breathSeconds: 5 });
    assert.equal(knees.items.length, plain.items.length,
      "the filter may substitute a posture but never remove one");
    assert.ok(knees.substituted.length > 20, `expected many lotus substitutions, got ${knees.substituted.length}`);
  });
  it("audits clean for a body protecting the classic injury sites", () => {
    const f = primarySeries({ limits: ["knees", "si_joint", "neck"], level: 3, breathSeconds: 5 });
    assert.deepEqual(auditFlow(f).errors.map((e) => e.id), []);
  });
  it("runs five rounds of each salutation as separate rounds", () => {
    const f = primarySeries({ limits: [], level: 3, breathSeconds: 5 });
    const roundsA = new Set(f.items.filter((i) => i.salutation === "A").map((i) => i.round));
    assert.equal(roundsA.size, 5);
  });
  it("takes its length from the breath rate, not from a target", () => {
    const slow = primarySeries({ limits: [], level: 3, breathSeconds: 7 });
    const fast = primarySeries({ limits: [], level: 3, breathSeconds: 5 });
    assert.ok(slow.totalSeconds > fast.totalSeconds * 1.2);
    assert.equal(slow.targetSeconds, slow.totalSeconds, "an authored series has no target to miss");
  });
});

group("yoga — a hold is counted in breaths, not seconds", () => {
  const BS = 5;   // seconds per breath
  it("reads the full count for the whole of the first breath", () => {
    // A 5-breath hold is 25 s. At 0 s elapsed it must say 5, and it must still
    // say 5 after four seconds — a counter that drops to 4 immediately is
    // counting the clock and calling it a breath.
    assert.equal(breathsRemaining(25, BS), 5);
    assert.equal(breathsRemaining(21, BS), 5);
    assert.equal(breathsRemaining(20, BS), 4);
  });
  it("reaches one on the last breath and zero at the end", () => {
    assert.equal(breathsRemaining(5, BS), 1);
    assert.equal(breathsRemaining(0.4, BS), 1);
    assert.equal(breathsRemaining(0, BS), 0);
  });
  it("never goes negative when a hold is extended past its target", () => {
    assert.equal(breathsRemaining(-12, BS), 0);
  });
  it("alternates inhale and exhale twice per breath", () => {
    const phases = [0, 2.5, 5, 7.5, 10].map((t) => breathPhaseAt(t, BS));
    assert.deepEqual(phases, [0, 1, 2, 3, 4]);
    assert.deepEqual(phases.map(isInhale), [true, false, true, false, true]);
  });
  it("gives one inhale and one exhale per breath over a whole hold", () => {
    const seen = new Set();
    for (let t = 0; t < 25; t += 0.1) seen.add(breathPhaseAt(t, BS));
    assert.equal(seen.size, 10, "5 breaths = 10 half-breaths");
    assert.equal([...seen].filter(isInhale).length, 5);
  });
  it("survives a breath rate of zero rather than dividing by it", () => {
    assert.equal(breathsRemaining(25, 0), 0);
    assert.equal(breathPhaseAt(25, 0), 0);
  });
});

group("yoga — the three levels are genuinely three levels", () => {
  it("the level definitions hold together", () => {
    assert.deepEqual(checkLevels(), []);
  });
  it("every pose has spoken cues, and they pass their own rules", () => {
    assert.deepEqual(checkScript({ asanas: ASANAS }), []);
  });
  it("a beginner is never offered a pose above their ceiling", () => {
    const f = generateFlow({ intent: "strong_flow", minutes: 45, limits: [], level: "beginner", seed: 3 });
    const tooHard = f.items.filter((it) => (asanaById(it.asanaId) || {}).level > 1);
    assert.deepEqual(tooHard.map((t) => t.asanaId), []);
  });
  it("beginner, advanced and expert produce DIFFERENT words for the same pose", () => {
    const item = { asanaId: "utthita_trikonasana", side: "Left", holdBreaths: 5, durationSeconds: 25 };
    const b = entryScript(item, "beginner", 0).text;
    const a = entryScript(item, "advanced", 0).text;
    const e = entryScript(item, "expert", 0).text;
    assert.notEqual(b, a, "beginner and advanced must differ");
    assert.notEqual(a, e, "advanced and expert must differ");
  });
  it("NO level ever speaks the Sanskrit name", () => {
    // It is shown on screen, correctly spelled, and never said: the speech
    // engine mangles it badly enough to teach the wrong sound, and edge-tts
    // escapes SSML so <phoneme> can't fix it.
    for (const a of ASANAS) {
      if (!a.sanskrit || a.sanskrit.toLowerCase() === (a.name || "").toLowerCase()) continue;
      for (const lvl of ["beginner", "advanced", "expert"]) {
        const t = entryScript({ asanaId: a.id, holdBreaths: 5, durationSeconds: 25 }, lvl, 0).text;
        assert.ok(!t.includes(a.sanskrit), `${a.id}: ${lvl} heard "${a.sanskrit}"`);
      }
    }
  });
  it("a beginner hears no jargon", () => {
    for (const a of ASANAS) {
      const t = entryScript({ asanaId: a.id, holdBreaths: 5, durationSeconds: 25 }, "beginner", 0).text;
      for (const j of ["mula bandha", "drishti", "uddiyana"])
        assert.ok(!t.toLowerCase().includes(j), `${a.id}: beginner heard "${j}"`);
    }
  });
  it("a beginner is never given more than two alignment cues", () => {
    for (const a of ASANAS) {
      const parts = entryScript({ asanaId: a.id, holdBreaths: 5, durationSeconds: 25 }, "beginner", 0).parts;
      const cues = parts.filter((p) => p.role === "cue").length;
      assert.ok(cues <= 2, `${a.id}: ${cues} cues for a beginner`);
    }
  });
  it("every level is still offered the way out", () => {
    for (const lvl of ["beginner", "advanced", "expert"]) {
      const parts = entryScript({ asanaId: "eka_pada_rajakapotasana", holdBreaths: 8, durationSeconds: 40 }, lvl, 0).parts;
      assert.ok(parts.some((p) => p.role === "easier"), `${lvl} was not offered the way out`);
    }
  });
  it("the hold length is always spoken", () => {
    for (const lvl of ["beginner", "advanced", "expert"]) {
      const parts = entryScript({ asanaId: "vrksasana", holdBreaths: 6, durationSeconds: 30 }, lvl, 0).parts;
      const hold = parts.find((p) => p.role === "hold");
      assert.ok(hold && /6 breaths/.test(hold.text), `${lvl}: hold length not spoken`);
    }
  });
  it("an expert holds longer and moves faster than a beginner", () => {
    const mk = (lvl) => generateFlow({ intent: "hips_low_back", minutes: 20, limits: [], level: lvl, seed: 9 });
    const avg = (f, k) => f.items.reduce((s, it) => s + it[k], 0) / f.items.length;
    assert.ok(avg(mk("expert"), "durationSeconds") > avg(mk("beginner"), "durationSeconds"));
    assert.ok(avg(mk("expert"), "transitionSeconds") < avg(mk("beginner"), "transitionSeconds"));
  });
});

group("yoga — the narration has no silent gaps", () => {
  // THE RENDER PIPELINE SWEEPS; THIS ASSERTS THE SWEEP IS COMPLETE.
  //
  // The first render inferred hold sentences from a hand-picked list of breath
  // counts, which missed odd counts and every time-based phrasing that yin and
  // restorative produce. Poses reached the mat with nobody saying how long you
  // were staying, and only a by-hand check against the manifest found it. This
  // makes the gap a test failure instead.
  const HOLD_SET = new Set(allHoldPhrases());
  it("every hold sentence a real practice produces is one the renderer emits", () => {
    const missing = new Set();
    for (const level of ["beginner", "advanced", "expert"]) {
      for (const intent of ["hips_low_back", "strong_flow", "wind_down", "sleep", "post_run", "full_body"]) {
        for (const minutes of [10, 20, 45]) {
          const f = generateFlow({ intent, minutes, limits: [], level, seed: 21 });
          for (const it of f.items) {
            if (it.flowRound) continue;
            const parts = entryScript({ asanaId: it.asanaId, side: it.bilateral ? "Left" : null,
              holdBreaths: it.holdBreaths, durationSeconds: it.durationSeconds, dynamic: it.dynamic },
              level, 0).parts;
            const hold = parts.find((p) => p.role === "hold");
            if (hold && !HOLD_SET.has(hold.text)) missing.add(hold.text);
          }
        }
      }
    }
    assert.deepEqual([...missing], [], "hold sentences the renderer would never have produced");
  });
  it("enumerates breath counts, seconds and minutes", () => {
    const all = allHoldPhrases().join(" | ");
    assert.ok(/5 breaths/.test(all) && /7 breaths/.test(all), "odd breath counts included");
    assert.ok(/seconds/.test(all), "second-based holds included");
    assert.ok(/minutes/.test(all), "minute-based holds included");
  });
});

group("yoga — the passage splits across the transition without losing a word", () => {
  // The entry passage is spoken in two halves: naming and how to arrive WHILE
  // you move, alignment and options once you are in the shape. A role missing
  // from both halves is a line that is simply never said, and nothing else would
  // notice — the practice would just be quietly less useful.
  const ARRIVE_ROLES = new Set(["name", "enter", "salutation"]);
  it("arrive + settle is exactly the whole passage, in order", () => {
    for (const level of ["beginner", "advanced", "expert"]) {
      for (const a of ASANAS) {
        const parts = entryScript({ asanaId: a.id, side: a.bilateral ? "Left" : null,
          holdBreaths: 5, durationSeconds: 25 }, level, 0).parts;
        const arrive = parts.filter((p) => ARRIVE_ROLES.has(p.role));
        const settle = parts.filter((p) => !ARRIVE_ROLES.has(p.role));
        assert.deepEqual([...arrive, ...settle].map((p) => p.text), parts.map((p) => p.text),
          `${a.id} @ ${level}: the split reorders or drops a line`);
      }
    }
  });
  it("the moving half names the pose and says how to get there", () => {
    for (const a of ASANAS) {
      const parts = entryScript({ asanaId: a.id, holdBreaths: 5, durationSeconds: 25 }, "advanced", 0).parts;
      const arrive = parts.filter((p) => ARRIVE_ROLES.has(p.role));
      assert.ok(arrive.some((p) => p.role === "name"), `${a.id}: nothing names the pose while you move into it`);
      assert.ok(arrive.length >= 2, `${a.id}: the moving half is only ${arrive.length} line(s)`);
    }
  });
  it("the settled half always ends by saying how long you are staying", () => {
    for (const a of ASANAS) {
      const parts = entryScript({ asanaId: a.id, holdBreaths: 5, durationSeconds: 25 }, "advanced", 0).parts;
      const settle = parts.filter((p) => !ARRIVE_ROLES.has(p.role));
      assert.equal(settle[settle.length - 1].role, "hold", `${a.id}: the hold length is not the last thing said`);
    }
  });
});

group("yoga — a salutation is one step, not six countdowns", () => {
  const f = generateFlow({ intent: "strong_flow", minutes: 45, limits: [], level: "advanced", seed: 4242 });
  it("produces no five-second poses", () => {
    const tiny = f.items.filter((it) => it.durationSeconds < 15);
    assert.deepEqual(tiny.map((t) => `${t.name} ${t.durationSeconds}s`), []);
  });
  it("a salutation round carries its movements", () => {
    const rounds = f.items.filter((it) => it.flowRound);
    assert.ok(rounds.length > 0, "there is at least one salutation round");
    for (const r of rounds) {
      assert.ok(r.moves && r.moves.length >= 5, `${r.name}: ${(r.moves || []).length} movements`);
      assert.ok(r.durationSeconds >= r.moves.length * 4, "a round lasts as long as its movements");
    }
  });
  it("the round is narrated as one passage", () => {
    const s = salutationScript("A", 2, 5, "advanced");
    assert.ok(/Round 2/.test(s.text));
    assert.ok(/Inhale/.test(s.text) && /Exhale/.test(s.text), "the movements are called");
  });
});

group("yoga — the breath is paced at a practised rate, not a resting one", () => {
  // Pinned to NUMBERS, not to a direction. A test asserting "slower than before"
  // passes forever once it has passed once; these fail if the default drifts
  // back toward the resting respiratory range (12-20 breaths/min) that the old
  // 5-second default sat at the top of.
  it("a breath is 6 seconds — 10 a minute", () => {
    assert.equal(BREATH_SECONDS_DEFAULT, 6);
    assert.equal(60 / BREATH_SECONDS_DEFAULT, 10);
  });
  it("the range spans a flow pace to the resonance band, and offers nothing faster than 15/min", () => {
    const [lo, hi] = BREATH_SECONDS_RANGE;
    assert.equal(lo, 4);
    assert.ok(60 / lo <= 15, `fastest offered is ${60 / lo}/min`);
    // 4.5-7 breaths/min is where the HRV literature puts resonance; the slow end
    // has to actually reach it or the option is decorative.
    assert.ok(60 / hi <= 7, `slowest offered is ${60 / hi}/min, needs to reach the resonance band`);
  });
  it("the default puts breath-counted holds where a class holds them", () => {
    const bs = BREATH_SECONDS_DEFAULT;
    // Vinyasa 3-5 breaths, hatha 6-10 — the numbers those styles declare.
    assert.equal(holdSecondsFor(YOGA_STYLES.vinyasa, { breathSeconds: bs, t: 1 }), 30);
    assert.equal(holdSecondsFor(YOGA_STYLES.hatha, { breathSeconds: bs, t: 0 }), 36);
    assert.equal(holdSecondsFor(YOGA_STYLES.hatha, { breathSeconds: bs, t: 1 }), 60);
  });
  it("time-counted styles do not move with it", () => {
    // Yin and restorative count in minutes; a slower breath must not lengthen
    // a five-minute shape into a seven-minute one.
    for (const s of Object.values(YOGA_STYLES)) {
      if (!s.holdSeconds) continue;
      assert.equal(holdSecondsFor(s, { breathSeconds: 4, t: 0.5 }),
        holdSecondsFor(s, { breathSeconds: 12, t: 0.5 }), `${s.id} moved with the breath rate`);
    }
  });
});

group("yoga — the orb is something to breathe with, not a timer in disguise", () => {
  const BS = 6;
  it("empty at the bottom of the exhale, full at the top of the inhale", () => {
    assert.equal(+breathSwell(0, BS).toFixed(6), 0);          // start of the inhale
    assert.equal(+breathSwell(BS / 2, BS).toFixed(6), 1);     // the turn
    assert.equal(+breathSwell(BS, BS).toFixed(6), 0);         // back to the bottom
  });
  it("agrees with the audio pacer about which half it is in", () => {
    // The tone and the orb read the same clock; if they ever disagreed you would
    // be watching one breath and hearing another.
    for (let t = 0; t < BS * 3; t += 0.25) {
      const rising = breathSwell(t + 0.05, BS) > breathSwell(t, BS);
      const inhaling = isInhale(breathPhaseAt(t, BS));
      // At the exact turn the derivative flips, so only assert away from it.
      const nearTurn = Math.abs((t % (BS / 2))) < 0.1 || Math.abs((t % (BS / 2)) - BS / 2) < 0.1;
      if (!nearTurn) assert.equal(rising, inhaling, `t=${t}: rising=${rising} inhaling=${inhaling}`);
    }
  });
  it("moves slowest at the turns and fastest through the middle", () => {
    // This is the whole reason it is a cosine and not a triangle: a linear ramp
    // turns around with a corner exactly where a breath should be unhurried.
    const d = (t) => Math.abs(breathSwell(t + 0.01, BS) - breathSwell(t, BS));
    assert.ok(d(BS / 4) > d(0.001) * 5, "the middle of the inhale outruns the turn");
    assert.ok(d(BS / 2 - 0.02) < d(BS / 4), "it settles into the top of the inhale");
  });
  it("repeats every breath, at any pace", () => {
    for (const bs of [4, 6, 8, 12]) {
      for (const t of [0.7, 2.3, 5.1]) {
        assert.equal(+breathSwell(t, bs).toFixed(9), +breathSwell(t + bs * 3, bs).toFixed(9));
      }
    }
  });
  it("stays in range and never divides by zero", () => {
    for (let t = 0; t < 30; t += 0.13) {
      const v = breathSwell(t, BS);
      assert.ok(v >= 0 && v <= 1, `${v} out of range at ${t}`);
    }
    assert.equal(breathSwell(5, 0), 0);
  });
});

group("yoga — a practice is addressed by when it finished, not by its date", () => {
  // store.js is IndexedDB-backed and cannot be imported here, so the BEHAVIOUR
  // was verified in the browser (create, patch, reject a bad edit, delete one of
  // two practices on the same day, open a stale link). What is worth catching
  // statically is the rule itself coming undone: several practices a day are
  // allowed, so a date-scoped delete takes the morning one along with the
  // evening one. That is a silent loss with no error and nothing to notice.
  const store = readFileSync(new URL("../js/store.js", import.meta.url), "utf8");
  const yogaBlock = store.slice(store.indexOf("--- yoga practice log"),
    store.indexOf("How this person practises"));

  it("every mutation of the yoga log is keyed by `at`", () => {
    assert.ok(/export async function updateYogaEntry\(at,/.test(yogaBlock));
    assert.ok(/export async function removeYogaEntry\(at\)/.test(yogaBlock));
    assert.ok(/export async function yogaEntryAt\(at\)/.test(yogaBlock));
  });
  it("nothing deletes a whole date", () => {
    // The old removeYogaDone(iso, at) removed EVERY entry on `iso` when `at` was
    // omitted — one optional argument between correct and destructive.
    assert.ok(!/removeYogaDone/.test(store), "removeYogaDone is back, and it deletes by date");
  });
  it("the summary screen is reachable", () => {
    const app = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
    assert.ok(/#\\\/ysummary/.test(app), "no route to a logged practice");
    // A practice logged from three screens and openable from none was the bug.
    for (const f of ["views/home.js", "views/week.js", "views/yoga.js"]) {
      const src = readFileSync(new URL(`../js/${f}`, import.meta.url), "utf8");
      assert.ok(src.includes("#/ysummary/"), `${f} shows a practice it cannot open`);
    }
  });
});

group("yoga — the peak's preparation stays inside its own plane block", () => {
  // The build descends once: standing work, then floor work (or the reverse,
  // decided by the peak). The preps used to be appended AFTER both blocks, so a
  // standing prep for a floor peak landed alone between floor poses — the exact
  // random walk the block structure exists to prevent, reintroduced at the tail.
  const changes = (items) => {
    let n = 0;
    for (let i = 1; i < items.length; i++) if (items[i].plane !== items[i - 1].plane) n++;
    return n;
  };
  it("no prep is stranded on its own plane inside the build", () => {
    const bad = [];
    for (const intent of YOGA_INTENTS) {
      for (const m of intent.minutes || [intent.defaultMinutes]) {
        for (const level of ["beginner", "advanced", "expert"]) {
          const f = generateFlow({ intent: intent.id, minutes: m, level, limits: [] });
          const build = f.items.filter((it) => it.phase === "build");
          for (let i = 1; i < build.length - 1; i++) {
            if (!build[i].prepFor) continue;
            const lone = build[i].plane !== build[i - 1].plane && build[i].plane !== build[i + 1].plane;
            if (lone) bad.push(`${intent.id} ${m}min ${level}: ${build[i].asanaId} (${build[i].plane}) alone`);
          }
        }
      }
    }
    assert.deepEqual(bad, []);
  });
  it("the build changes plane no more than a class does", () => {
    // Two blocks plus their preps is at most a handful of changes; a random walk
    // is a dozen. Pinned so a future selection change cannot quietly loosen it.
    const worst = [];
    for (const intent of YOGA_INTENTS) {
      for (const level of ["beginner", "advanced", "expert"]) {
        const f = generateFlow({ intent: intent.id, minutes: intent.defaultMinutes, level, limits: [] });
        const c = changes(f.items.filter((it) => it.phase === "build"));
        if (c > 3) worst.push(`${intent.id} ${level}: ${c} changes`);
      }
    }
    assert.deepEqual(worst, []);
  });
});

group("yoga — the whole space is swept, as the builder audit taught", () => {
  it("no intent, length, limitation or level produces an error-level defect", () => {
    const LIMIT_SETS = [[], ["knees"], ["si_joint"], ["knees", "si_joint"], ["low_back"],
      ["wrists"], ["neck", "inversions"], ["shoulders"],
      ["knees", "si_joint", "low_back", "wrists", "neck", "shoulders", "inversions"]];
    let swept = 0;
    const failures = [];
    for (const intent of YOGA_INTENTS) {
      if (intent.id === "ashtanga") continue;
      for (const minutes of intent.minutes) {
        for (const limits of LIMIT_SETS) {
          for (let level = 1; level <= 3; level++) {
            const f = generateFlow({ intent: intent.id, minutes, limits, level, seed: 1234 });
            const a = auditFlow(f);
            swept++;
            if (a.errors.length) failures.push(`${intent.id} ${minutes}min [${limits.join("+") || "none"}] lvl${level}: ${a.errors[0].id}`);
          }
        }
      }
    }
    assert.ok(swept >= 200, `swept only ${swept}`);
    assert.deepEqual(failures.slice(0, 5), []);
  });
});

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
