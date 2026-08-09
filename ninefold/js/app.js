// app.js — bootstrap, service-worker registration, and a tiny hash router.

import { seedIfNeeded, mergeRestore, snapshot, getActiveProgram, initMobilityRoutine } from "./store.js";
import { cloudPull, cloudPush } from "./cloudsync.js";
import { migrateIfNeeded, getProfile } from "./profile.js";
import { loadPhotoManifest } from "./exercise-photo.js";
import { applyTheme, DEFAULT_THEME } from "./theme.js";
import { mountAurora } from "./components/aurora.js";
import { mount, el, showTabs, hideTabs } from "./ui.js";

import { renderHome } from "./views/home.js";
import { renderSession, renderPlannedSession } from "./views/session.js";
import { renderHistory } from "./views/history.js";
import { renderSettings } from "./views/settings.js";
import { renderWeek } from "./views/week.js";
import { renderCalendar } from "./views/calendar.js";
import { renderDay } from "./views/day.js";
import { renderProgress, renderComposition } from "./views/progress.js";
import { renderRecords } from "./views/records.js";
import { renderSummary } from "./views/summary.js";
import { renderWeekSummary } from "./views/weeksummary.js";
import { renderNutrition } from "./views/nutrition.js";
import { renderMobility } from "./views/mobility.js";
import { renderMobSummary } from "./views/mobsummary.js";
import { renderExercise } from "./views/exercise.js";
import { renderBuilder } from "./views/builder.js";
import { renderWelcome } from "./views/welcome.js";

// route table: hash pattern -> handler(params); tab = which bottom-nav tab is
// active (null = a full-screen flow / drill-down, so the tab bar is hidden).
const routes = [
  [/^#\/?$/, () => renderHome(), "today"],
  [/^#\/session\/([\d-]+)$/, (m) => renderSession(m[1]), null],
  [/^#\/do\/([\w-]+)\/(\d+)\/(\w+)$/, (m) => renderPlannedSession(m[1], Number(m[2]), m[3]), null],
  [/^#\/summary\/([\w-]+)$/, (m) => renderSummary(m[1]), null],
  [/^#\/weeksummary\/(\d+)$/, (m) => renderWeekSummary(m[1]), null],
  [/^#\/calendar(?:\/(\d{4}-\d{2}))?$/, (m) => renderCalendar(m[1]), "plan"],
  [/^#\/week$/, () => renderWeek(), "plan"],
  [/^#\/week\/([\w-]+)\/(\d+)$/, (m) => renderWeek(m[1], Number(m[2])), "plan"],
  [/^#\/day\/([\w-]+)\/(\d+)\/(\w+)$/, (m) => renderDay(m[1], Number(m[2]), m[3]), null],
  [/^#\/progress$/, () => renderProgress(), "progress"],
  [/^#\/body$/, () => renderComposition(), "body"],
  [/^#\/records$/, () => renderRecords(), null],
  [/^#\/exercise\/([\w-]+)$/, (m) => renderExercise(m[1]), null],
  [/^#\/nutrition(?:\/([\d-]+))?$/, (m) => renderNutrition(m[1]), null],
  [/^#\/mobility(?:\/(Mon|Wed|Fri|Sun))?$/, (m) => renderMobility(m[1]), null],
  [/^#\/msummary\/([\d-]+)$/, (m) => renderMobSummary(m[1]), null],
  [/^#\/history$/, () => renderHistory(), null],
  [/^#\/welcome$/, () => renderWelcome(), null],
  [/^#\/build$/, () => renderBuilder(), null],
  [/^#\/settings$/, () => renderSettings(), "profile"],
];

async function router() {
  const hash = window.location.hash || "#/";
  for (const [re, handler, tab] of routes) {
    const m = hash.match(re);
    if (m) {
      // Set tab-bar visibility BEFORE awaiting: full-screen flows (e.g. an active
      // session) never resolve until finished, so doing this after the await
      // would leave the tab bar covering the screen's own controls.
      if (tab) showTabs(tab); else hideTabs();
      try { await handler(m); }
      catch (err) { showError(err); }
      return;
    }
  }
  window.location.hash = "#/";
}

function showError(err) {
  console.error(err);
  try { showTabs("today"); } catch {}   // never strand the user with the nav bar hidden
  mount([
    el("div.card", {}, [
      el("h2", { text: "Something went wrong" }),
      el("p.dim", { text: String(err && err.message ? err.message : err) }),
      el("div.btn-row", { style: "margin-top:12px" }, [
        el("button.btn.primary", { onclick: () => { location.hash = "#/"; } }, "Go to Today"),
        el("button.btn", { onclick: () => location.reload() }, "Reload"),
      ]),
    ]),
  ]);
}

async function boot() {
  // Theme FIRST: the aurora canvas reads its palette from the resolved CSS vars,
  // so mounting it before the theme is applied would bake in the default colours
  // for the life of the session.
  try {
    const prof = await getProfile();
    applyTheme((prof && prof.theme) || DEFAULT_THEME);
  } catch (_) { applyTheme(DEFAULT_THEME); }
  mountAurora();   // living gradient backdrop, behind everything
  // Exercise renders resolve synchronously inside illustration(), which every
  // tile in the app calls inline — so the manifest has to be in hand before the
  // first screen paints. Never throws: no manifest just means "no photos yet".
  try { await loadPhotoManifest(); } catch (_) {}
  try {
    await seedIfNeeded();
  } catch (err) {
    showError(err);
    return;
  }
  // Durable cloud restore: pull the off-device backup and merge in anything
  // missing locally (non-destructive) — this is what brings a wiped device back.
  // A no-op when no backup endpoint is configured (the local-only default).
  try {
    const cloud = await cloudPull();
    if (cloud) await mergeRestore(cloud);
  } catch (_) { /* offline — local data still works */ }
  // Profile migration runs AFTER the restore so a wiped device that just pulled
  // its programs back can still derive its places from them. Idempotent: it
  // returns the existing profile untouched once one exists.
  let active = null;
  try {
    active = await getActiveProgram();
    await migrateIfNeeded(active);
  } catch (err) { console.warn("profile migration skipped", err); }
  // Resolve the mobility routine before the first render, and AFTER the cloud
  // merge so a restored device gets its own routine back rather than capturing
  // the build's default over the top of it.
  try { await initMobilityRoutine(); } catch (err) { console.warn("mobility routine init skipped", err); }
  window.addEventListener("hashchange", router);
  // First run: onboarding, then the builder. Both only when landing on the
  // default route, so a deep link (a shared summary URL, a bookmark) still wins
  // and isn't hijacked by setup.
  const atRoot = !window.location.hash || window.location.hash === "#/";
  if (atRoot) {
    let onboarded = false;
    try { const p = await getProfile(); onboarded = !!(p && p.onboardedAt); } catch (_) {}
    if (!onboarded) window.location.hash = "#/welcome";
    else if (!active) window.location.hash = "#/build";
  }
  await router();
  registerSW();
  // Fire-and-forget: a tracker that computes VO2max keeps the log current
  // without the user retyping what their watch already knows. Never awaited —
  // it must not hold up the first paint, and it fails silently offline.
  import("./health/index.js").then((h) => h.syncTrackerVO2max()).catch(() => {});
  cloudPush(snapshot);   // reflect local state up to the cloud
}

function registerSW() {
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch((e) => console.warn("SW failed", e));
    });
  }
}

boot();
