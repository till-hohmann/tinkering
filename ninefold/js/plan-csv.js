// plan-csv.js — a whole training block as a spreadsheet, and back again.
// Pure: no DOM, no storage.
//
// WHY THIS EXISTS. The builder generates six weeks in one go, and until now the
// only way to check its work was to tap through 42 days on a phone. Nobody
// audits a plan that way, so nobody audits the plan — which is a problem for a
// generator whose output you are about to spend six weeks obeying.
//
// LONG FORMAT, one row per exercise per day per week. It is repetitive on
// purpose: every row states its own week, day and block, so a row means the same
// thing wherever it ends up. That is what makes it safe to sort, filter and
// hand-edit in a spreadsheet — the operations people actually perform on a CSV.
//
// ⚠ THIS FORMAT IS LOSSY, AND IMPORT MUST TREAT IT THAT WAY. It carries the
// prescription and nothing else: warm-up and cool-down routines, interval
// finishers, equipment profiles and load anchors have no columns here. So a plan
// imported over an existing block MERGES onto it and keeps everything the CSV
// cannot express. Rebuilding a program from a CSV alone would silently strip a
// block of its routines, which is the kind of loss you notice one warm-up later.

const COLUMNS = ["block_name", "block_start", "block_weeks", "week", "phase", "weekday",
  "day_type", "day_label", "order", "exercise_id", "exercise", "sets", "rep_range",
  "rest_s", "role", "prescription"];

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// --- CSV primitives ----------------------------------------------------------
// Written out rather than pulled in: the app has no dependencies and this is the
// whole of what RFC 4180 needs. Quotes a field only when it must, because a file
// full of unnecessary quotes is one people stop trusting themselves to edit.
function csvCell(v) {
  const s = v == null ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Parse CSV text into rows of strings. Handles quotes, escaped quotes, CRLF, BOM. */
export function parseCSV(text) {
  const src = String(text || "").replace(/^﻿/, "");
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }   // "" is a literal quote
        else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"') { inQuotes = true; continue; }
    if (c === ",") { row.push(field); field = ""; continue; }
    if (c === "\r") continue;
    if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; continue; }
    field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  // A trailing newline yields one empty row; so does a blank line mid-file.
  return rows.filter((r) => r.some((c) => c !== ""));
}

// --- export ------------------------------------------------------------------

/** One block → CSV text. */
export function toCSV(program) {
  const name = (id) => ((program.exercises || {})[id] || {}).name || id;
  const lines = [COLUMNS.join(",")];
  const base = [program.name || program.id, program.startDate || "", program.lengthWeeks || ""];

  for (const w of program.weeks || []) {
    for (const weekday of WEEKDAYS) {
      const day = (w.days || {})[weekday];
      if (!day) continue;
      const tpl = (program.dayTemplates || {})[weekday] || {};
      const head = [...base, w.weekNumber, w.phaseName || "", weekday, day.type, tpl.label || ""];
      if (day.type === "strength" && (day.exercises || []).length) {
        day.exercises.forEach((e, i) => {
          lines.push([...head, i + 1, e.exerciseId, name(e.exerciseId), e.prescribedSets,
            e.repRange || "", e.restSeconds == null ? "" : e.restSeconds, e.role || "", ""].map(csvCell).join(","));
        });
      } else {
        // A cardio or rest day still gets a row. An absent row is ambiguous —
        // it could mean "rest" or "this day was dropped from the export" — and
        // the import has to be able to tell those apart.
        lines.push([...head, "", "", "", "", "", "", "", day.prescription || ""].map(csvCell).join(","));
      }
    }
  }
  return lines.join("\r\n") + "\r\n";
}

// --- import ------------------------------------------------------------------

/**
 * CSV text → a plan shape plus warnings. Never throws on bad data: it reports.
 * A file that fails here is usually a file someone edited by hand, and "row 34
 * has no rep range" is actionable where "import failed" is not.
 */
export function fromCSV(text) {
  const rows = parseCSV(text);
  const warnings = [];
  if (!rows.length) return { ok: false, warnings: ["That file is empty."] };

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const missing = ["week", "weekday", "day_type"].filter((c) => !header.includes(c));
  if (missing.length)
    return { ok: false, warnings: [`Not a plan export — missing the ${missing.join(", ")} column${missing.length === 1 ? "" : "s"}.`] };

  const col = (r, key) => { const i = header.indexOf(key); return i < 0 ? "" : (r[i] || "").trim(); };
  const num = (v) => { const n = Number(String(v).replace(",", ".")); return Number.isFinite(n) ? n : null; };

  const meta = { name: "", startDate: "", lengthWeeks: null };
  const weeks = new Map();          // weekNumber → { phaseName, days: Map(weekday → day) }
  const labels = new Map();         // weekday → day_label (block-wide, from the template)
  const exerciseNames = new Map();

  rows.slice(1).forEach((r, idx) => {
    const lineNo = idx + 2;         // 1-based, and row 1 is the header
    const wk = num(col(r, "week"));
    const weekday = col(r, "weekday");
    const type = (col(r, "day_type") || "").toLowerCase();
    if (wk == null || wk < 1) { warnings.push(`Row ${lineNo}: week "${col(r, "week")}" isn't a number — row skipped.`); return; }
    if (!WEEKDAYS.includes(weekday)) { warnings.push(`Row ${lineNo}: "${weekday}" isn't a weekday — row skipped.`); return; }

    if (!meta.name) meta.name = col(r, "block_name");
    if (!meta.startDate) meta.startDate = col(r, "block_start");
    if (meta.lengthWeeks == null) meta.lengthWeeks = num(col(r, "block_weeks"));
    if (col(r, "day_label")) labels.set(weekday, col(r, "day_label"));

    if (!weeks.has(wk)) weeks.set(wk, { phaseName: col(r, "phase"), days: new Map() });
    const week = weeks.get(wk);
    if (!week.days.has(weekday)) week.days.set(weekday, { weekday, type: type || "rest", exercises: [] });
    const day = week.days.get(weekday);
    if (type) day.type = type;
    if (col(r, "prescription")) day.prescription = col(r, "prescription");

    const exerciseId = col(r, "exercise_id");
    if (!exerciseId) return;        // a cardio or rest row: the day itself is the payload
    if (day.type !== "strength") {
      warnings.push(`Row ${lineNo}: ${weekday} week ${wk} is a ${day.type} day but names an exercise — treating it as strength.`);
      day.type = "strength";
    }
    const sets = num(col(r, "sets"));
    if (sets == null || sets < 1) {
      warnings.push(`Row ${lineNo}: "${col(r, "sets")}" isn't a set count for ${exerciseId} — row skipped.`);
      return;
    }
    if (col(r, "exercise")) exerciseNames.set(exerciseId, col(r, "exercise"));
    const rest = num(col(r, "rest_s"));
    day.exercises.push({
      _order: num(col(r, "order")) ?? day.exercises.length + 1,
      exerciseId,
      prescribedSets: Math.round(sets),
      repRange: col(r, "rep_range") || "8-12",
      restSeconds: rest == null ? 90 : Math.round(rest),
      role: col(r, "role") || "accessory",
    });
  });

  if (!weeks.size) return { ok: false, warnings: warnings.concat("No usable rows — nothing to import.") };

  const ordered = [...weeks.keys()].sort((a, b) => a - b);
  const outWeeks = ordered.map((n) => {
    const w = weeks.get(n);
    const days = {};
    for (const [weekday, day] of w.days) {
      const exercises = day.exercises.sort((a, b) => a._order - b._order).map(({ _order, ...e }) => e);
      days[weekday] = day.type === "strength"
        ? { weekday, type: "strength", exercises }
        : { weekday, type: day.type, ...(day.prescription ? { prescription: day.prescription } : {}) };
    }
    return { weekNumber: n, phaseName: w.phaseName || "", days };
  });

  // Gaps are worth naming: an edit that deletes week 3 by accident produces a
  // perfectly valid file whose weeks jump 2 → 4, and the app would run it.
  ordered.forEach((n, i) => {
    if (n !== i + 1) warnings.push(`Weeks are numbered ${ordered.join(", ")} — expected 1 to ${ordered.length}.`);
  });

  return { ok: true, meta, weeks: outWeeks, labels, exerciseNames, warnings };
}

/**
 * Fold a parsed plan onto a block. `base` supplies everything CSV can't carry.
 * `mode: "new"` mints a separate block (leaving the original untouched) and
 * needs an id; "update" keeps the block's identity so its logged sessions, which
 * reference it by id, stay attached to it.
 */
export function applyPlanCSV(base, parsed, { mode = "update", id, startDate } = {}) {
  const src = base || {};
  const exercises = { ...(src.exercises || {}) };
  for (const [exId, name] of parsed.exerciseNames || [])
    exercises[exId] = { ...(exercises[exId] || {}), name, ...(exercises[exId] ? {} : { cue: "", implement: "dumbbell_pair" }) };

  const dayTemplates = { ...(src.dayTemplates || {}) };
  // Keep each template's routines and label, but track the exercises the CSV
  // says the day now holds, so a regenerated or extended block agrees with it.
  for (const w of parsed.weeks) {
    for (const [weekday, day] of Object.entries(w.days)) {
      const tpl = dayTemplates[weekday];
      if (!tpl || day.type !== "strength") continue;
      dayTemplates[weekday] = { ...tpl,
        label: (parsed.labels && parsed.labels.get(weekday)) || tpl.label,
        exercises: day.exercises.map((e) => ({ exerciseId: e.exerciseId, role: e.role, restSeconds: e.restSeconds })) };
    }
    break;   // week 1 defines the template; later weeks vary only the scheme
  }

  const start = startDate || parsed.meta.startDate || src.startDate;
  return {
    ...src,
    id: mode === "new" ? id : src.id,
    name: parsed.meta.name || src.name,
    startDate: start,
    lengthWeeks: parsed.weeks.length,
    exercises,
    dayTemplates,
    weeks: parsed.weeks.map((w, i) => ({
      ...w,
      startDate: start ? addDaysISO(start, i * 7) : undefined,
    })),
  };
}

function addDaysISO(iso, days) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * What changed between two versions of a block, in the terms the user edited it
 * in. Shown BEFORE anything is written: an import that silently succeeds is
 * indistinguishable from an import that silently mangled the file.
 */
export function diffPlans(before, after) {
  const out = [];
  const b = before || {}, a = after || {};
  if ((b.name || "") !== (a.name || "")) out.push(`Renamed to "${a.name}"`);
  if ((b.startDate || "") !== (a.startDate || "")) out.push(`Starts ${a.startDate}`);
  const bw = (b.weeks || []).length, aw = (a.weeks || []).length;
  if (bw !== aw) out.push(`${bw} week${bw === 1 ? "" : "s"} → ${aw}`);

  const nameOf = (id) => ((a.exercises || {})[id] || (b.exercises || {})[id] || {}).name || id;
  for (const w of a.weeks || []) {
    const prev = (b.weeks || []).find((x) => x.weekNumber === w.weekNumber);
    for (const [weekday, day] of Object.entries(w.days || {})) {
      const was = prev && prev.days ? prev.days[weekday] : null;
      if (!was) { out.push(`Week ${w.weekNumber} ${weekday}: new`); continue; }
      if ((was.type || "") !== (day.type || "")) {
        out.push(`Week ${w.weekNumber} ${weekday}: ${was.type} → ${day.type}`);
        continue;
      }
      const bEx = was.exercises || [], aEx = day.exercises || [];
      const bIds = bEx.map((e) => e.exerciseId), aIds = aEx.map((e) => e.exerciseId);
      for (const id of aIds) if (!bIds.includes(id)) out.push(`Week ${w.weekNumber} ${weekday}: + ${nameOf(id)}`);
      for (const id of bIds) if (!aIds.includes(id)) out.push(`Week ${w.weekNumber} ${weekday}: − ${nameOf(id)}`);
      for (const e of aEx) {
        const o = bEx.find((x) => x.exerciseId === e.exerciseId);
        if (!o) continue;
        if (o.prescribedSets !== e.prescribedSets)
          out.push(`Week ${w.weekNumber} ${weekday}: ${nameOf(e.exerciseId)} ${o.prescribedSets} → ${e.prescribedSets} sets`);
        if ((o.repRange || "") !== (e.repRange || ""))
          out.push(`Week ${w.weekNumber} ${weekday}: ${nameOf(e.exerciseId)} ${o.repRange} → ${e.repRange} reps`);
      }
    }
  }
  return out;
}
