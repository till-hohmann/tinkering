// mfp-import.js — load a MyFitnessPal export into the nutrition log.
//
// MyFitnessPal (its data export, a Premium feature) emails a zip holding
// "Nutrition-Summary-<from>-to-<to>.csv": one row per MEAL, so a day is the sum
// of its rows. This reads either that CSV or the zip itself and turns it into
// the app's per-day shape { kcal, protein, carbs, fat }.
//
// Importing is meant to be done again and again over overlapping ranges, so the
// export is treated as the record for the days it covers: a day it holds is
// added or brought up to date, a day it doesn't hold is left alone, and a day
// whose totals already match is not rewritten (no needless sync push).

// One CSV line → fields. MFP quotes the Note column when it holds a comma.
export function csvFields(line) {
  const out = []; let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

const COLS = { date: "Date", kcal: "Calories", protein: "Protein (g)", carbs: "Carbohydrates (g)", fat: "Fat (g)" };

/** text of a Nutrition Summary CSV → { days: { "YYYY-MM-DD": {kcal,protein,carbs,fat} } } or { error } */
export function parseMfpCsv(text) {
  const lines = String(text || "").replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { error: "That file has no rows." };
  const head = csvFields(lines[0]).map((h) => h.trim());
  const idx = {};
  for (const [k, name] of Object.entries(COLS)) {
    idx[k] = head.indexOf(name);
    if (idx[k] < 0) return { error: `Not a MyFitnessPal Nutrition Summary (no "${name}" column).` };
  }
  const days = {};
  for (const l of lines.slice(1)) {
    const c = csvFields(l);
    const d = (c[idx.date] || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    const t = (days[d] ||= { kcal: 0, protein: 0, carbs: 0, fat: 0 });
    for (const k of ["kcal", "protein", "carbs", "fat"]) t[k] += Number(c[idx[k]]) || 0;
  }
  for (const t of Object.values(days)) for (const k of Object.keys(t)) t[k] = Math.round(t[k]);
  if (!Object.keys(days).length) return { error: "No dated rows found in that file." };
  return { days };
}

/** What an import would do against the current log: { add, update, same } date lists. */
export function planMfpImport(days, log) {
  const add = [], update = [], same = [];
  for (const [d, t] of Object.entries(days).sort()) {
    const e = (log || {})[d];
    if (!e) add.push(d);
    else if (["kcal", "protein", "carbs", "fat"].every((k) => Math.round(Number(e[k]) || 0) === t[k])) same.push(d);
    else update.push(d);
  }
  return { add, update, same };
}

/** A File (the .csv, or the emailed .zip) → parseMfpCsv result. */
export async function readMfpFile(file) {
  if (/\.zip$/i.test(file.name || "")) {
    const { zipEntryStream } = await import("./health/apple-import.js");
    const stream = await zipEntryStream(file, (n) => /(^|\/)Nutrition-Summary[^/]*\.csv$/i.test(n));
    return parseMfpCsv(await new Response(stream).text());
  }
  return parseMfpCsv(await file.text());
}
