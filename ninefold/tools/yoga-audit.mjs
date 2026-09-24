// Sweep every intent x length x limitation combination and report defects.
// The lifting-builder audit found 79% of generated blocks carried an error-level
// defect; this is the same sweep, run before anything ships rather than after.
import { INTENTS } from "../js/yoga/intents.js";
import { generateFlow } from "../js/yoga/generate.js";
import { auditFlow } from "../js/yoga/quality.js";
import { checkAsanas, ASANAS } from "../js/yoga/asanas.js";
import { checkIntents } from "../js/yoga/intents.js";
import { STYLES } from "../js/yoga/styles.js";
import { byId } from "../js/yoga/asanas.js";
import { checkSeries } from "../js/yoga/ashtanga.js";

console.log("library:", ASANAS.length, "poses");
const libProblems = checkAsanas({});
console.log("checkAsanas:", libProblems.length ? libProblems.slice(0, 25) : "clean");
const intProblems = checkIntents({ styles: STYLES, asanas: byId });
console.log("checkIntents:", intProblems.length ? intProblems : "clean");
console.log("checkSeries:", checkSeries().length ? checkSeries() : "clean");

const LIMIT_SETS = [
  [],
  ["knees"],
  ["si_joint"],
  ["knees", "si_joint"],           // Till's two
  ["low_back"],
  ["wrists"],
  ["neck", "inversions"],
  ["shoulders"],
  ["knees", "si_joint", "low_back", "wrists", "neck", "shoulders", "inversions"], // everything
];

let n = 0, withErrors = 0, withWarnings = 0;
const byCheck = {};
const worst = [];
for (const intent of INTENTS) {
  if (intent.id === "ashtanga") continue;
  for (const minutes of intent.minutes) {
    for (const limits of LIMIT_SETS) {
      for (let level = 1; level <= 3; level++) {
        for (let s = 1; s <= 3; s++) {
          let flow;
          try { flow = generateFlow({ intent: intent.id, minutes, limits, level, seed: s * 7919 }); }
          catch (e) { console.log("THREW", intent.id, minutes, limits.join("+"), level, e.message); n++; withErrors++; continue; }
          const a = auditFlow(flow);
          n++;
          if (a.errors.length) {
            withErrors++;
            if (worst.length < 14) worst.push({ i: intent.id, m: minutes, l: limits.join("+") || "none", lv: level,
              errs: a.errors.map((e) => `${e.id}: ${e.message}`) });
          }
          if (a.warnings.length) withWarnings++;
          for (const c of [...a.errors, ...a.warnings]) byCheck[c.id] = (byCheck[c.id] || 0) + 1;
        }
      }
    }
  }
}
console.log(`\nswept ${n} flows`);
console.log(`error-level defects: ${withErrors} (${Math.round((withErrors / n) * 100)}%)`);
console.log(`warnings:            ${withWarnings} (${Math.round((withWarnings / n) * 100)}%)`);
console.log("\nby check:");
for (const [k, v] of Object.entries(byCheck).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(5)}  ${k}`);
console.log("\nsamples:");
for (const w of worst) console.log(` ${w.i} ${w.m}min limits=${w.l} lvl${w.lv}\n    ${w.errs.join("\n    ")}`);
