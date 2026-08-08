// export.js — vault round-trip (requirements §10). Produces two artifacts:
//   fitness-log.md      clean long-format markdown database (strength/cardio/notes)
//   fitness-backup.json full app state (programs + sessions) — durable backup + restore
// Both leave the device only as files the user saves via the share sheet / download.

import * as M from "./model.js";

const progName = (programs, id) => (programs.find((p) => p.id === id) || {}).name || id;

export function buildBackup(programs, sessions, iso, prefs = null) {
  return JSON.stringify(
    { schemaVersion: 1, exportedAt: iso, kind: "fitness-backup", programs, sessions,
      ...(prefs && Object.keys(prefs).length ? { prefs } : {}) },
    null, 2
  );
}

export function buildMarkdownLog(programs, sessions, iso) {
  const sorted = [...sessions].sort((a, b) => (a.date < b.date ? -1 : 1));
  const L = [];
  L.push(`# Ninefold Log`);
  L.push(`Exported ${iso} · ${sessions.length} sessions`, "");

  // strength
  L.push(`## Strength`, "");
  L.push(`| date | program | week | weekday | location | exercise | implement | set | weight_kg | reps | volume |`);
  L.push(`|---|---|---|---|---|---|---|---|---|---|---|`);
  for (const s of sorted) {
    for (const ex of s.strengthResult || []) {
      const name = exName(programs, s.programId, ex.exerciseId);
      ex.sets.forEach((set) => {
        const reps = set.reps == null ? `${set.seconds ?? 0}s` : set.reps;
        const vol = M.setVolume(ex.implement, set);
        L.push(`| ${s.date} | ${progName(programs, s.programId)} | ${s.weekNumber} | ${s.weekday} | ${s.location || ""} | ${name} | ${ex.implement} | ${set.setNumber} | ${set.weightKg} | ${reps} | ${Math.round(vol)} |`);
      });
    }
  }
  L.push("");

  // cardio
  L.push(`## Cardio`, "");
  L.push(`| date | program | week | weekday | type | time | distance_km | avg_hr | pace | rpe |`);
  L.push(`|---|---|---|---|---|---|---|---|---|---|`);
  for (const s of sorted) {
    if (s.type === "cardio" && s.cardioResult) {
      const c = s.cardioResult;
      const type = cardioType(programs, s);
      L.push(`| ${s.date} | ${progName(programs, s.programId)} | ${s.weekNumber} | ${s.weekday} | ${type} | ${M.fmtDuration(c.timeSeconds)} | ${c.distanceKm} | ${c.avgHR} | ${M.fmtPace(M.paceSecPerKm(c))} | ${c.feltRPE} |`);
    }
  }
  L.push("");

  // session notes
  L.push(`## Session notes`, "");
  L.push(`| date | bodyweight_kg | energy_sleep | niggles |`);
  L.push(`|---|---|---|---|`);
  for (const s of sorted) {
    const n = s.sessionNotes || {};
    if (n.bodyweightKg || n.energySleep || n.niggles) {
      L.push(`| ${s.date} | ${n.bodyweightKg || ""} | ${(n.energySleep || "").replace(/\|/g, "/")} | ${(n.niggles || "").replace(/\|/g, "/")} |`);
    }
  }
  L.push("");
  return L.join("\n");
}

function exName(programs, programId, exId) {
  const p = programs.find((x) => x.id === programId);
  return p && p.exercises && p.exercises[exId] ? p.exercises[exId].name : exId;
}
function cardioType(programs, s) {
  const p = programs.find((x) => x.id === s.programId);
  const t = p && p.dayTemplates && p.dayTemplates[s.weekday];
  return t ? t.cardioType || "cardio" : "cardio";
}

// Share via the iOS share sheet when possible, else fall back to a download.
export async function shareOrDownload(filename, text, mime) {
  const blob = new Blob([text], { type: mime });
  try {
    const file = new File([blob], filename, { type: mime });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: filename });
      return "shared";
    }
  } catch (e) {
    if (e && e.name === "AbortError") return "cancelled";
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  return "downloaded";
}
