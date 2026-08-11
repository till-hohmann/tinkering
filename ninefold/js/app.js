// app.js — bootstrap, service-worker registration, and a tiny hash router.

import { seedIfNeeded, mergeRestore, snapshot, getActiveProgram, initMobilityRoutine, initAudioPrefs } from "./store.js";
import { cloudPull, cloudPush } from "./cloudsync.js";
import { migrateIfNeeded, getProfile } from "./profile.js";
import { loadPhotoManifest } from "./exercise-photo.js";
import { applyTheme, DEFAULT_THEME } from "./theme.js";
import { mountAurora } from "./components/aurora.js";
import { mount, el, showTabs, hideTabs, setHiddenTabs } from "./ui.js";

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
import { renderYoga, renderYogaBuild, renderYogaSession } from "./views/yoga.js";
import { renderYSummary } from "./views/ysummary.js";

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
  // Yoga sits between Plan and Progress. The build screen is a drill-down (tab
  // bar visible, it's still the Yoga tab); the session itself is full-screen,
  // like every other guided player.
  [/^#\/yoga$/, () => renderYoga(), "yoga"],
  [/^#\/yoga\/build\/(\w+)\/(\d+)(?:\/(\d+))?$/, (m) => renderYogaBuild(m[1], m[2], m[3]), "yoga"],
  [/^#\/yoga\/do\/(\w+)\/(\d+)(?:\/(\d+))?$/, (m) => renderYogaSession(m[1], m[2], m[3]), null],
  // A logged practice, addressed by its completion timestamp — several a day are
  // allowed, so the date cannot identify one. The id is an ISO string with
  // colons and dots in it, hence `(.+)` and the decode.
  [/^#\/ysummary\/(.+)$/, (m) => renderYSummary(decodeURIComponent(m[1])), null],
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

/**
 * WHICH SKIN THE YOGA SECTION WEARS, DECIDED BY WHAT YOU ARE DOING.
 *
 * The rest of the app is a gym and looks like one. Yoga gets its own palette —
 * and two of them, because the two things you do here want opposite screens:
 *
 *   dawn  — the tab, the picker, the review, a logged practice. Read at arm's
 *           length, usually in daylight. Warm off-white, clay accent.
 *   night — the player itself. Phone on the mat, often a dim room, forty
 *           minutes of continuous looking. Deep indigo, lilac accent.
 *
 * Not a setting. "Wind down" and "Before bed" are two of the nine intents, and a
 * light screen at 22:00 would undo the practice it is meant to be carrying.
 *
 * The class goes on BODY: theme.js writes the active theme onto documentElement
 * as inline style, which a stylesheet rule on that element cannot beat — but
 * custom properties inherit, so setting them one level down shadows it.
 */
function yogaSkinFor(hash) {
  if (/^#\/yoga\/do\//.test(hash)) return "yoga-night";
  if (/^#\/yoga/.test(hash) || /^#\/ysummary\//.test(hash)) return "yoga-dawn";
  return null;
}

function applySkin(hash) {
  const skin = yogaSkinFor(hash);
  document.body.classList.toggle("yoga-dawn", skin === "yoga-dawn");
  document.body.classList.toggle("yoga-night", skin === "yoga-night");
  // The iOS status bar and the Android toolbar follow the page, or the section
  // reads as a light screen wearing a black hat.
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.content = skin
      ? getComputedStyle(document.body).getPropertyValue("--bg").trim()
      : getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
  }
}

async function router() {
  const hash = window.location.hash || "#/";
  for (const [re, handler, tab] of routes) {
    const m = hash.match(re);
    if (m) {
      // Set tab-bar visibility BEFORE awaiting: full-screen flows (e.g. an active
      // session) never resolve until finished, so doing this after the await
      // would leave the tab bar covering the screen's own controls.
      if (tab) showTabs(tab); else hideTabs();
      applySkin(hash);
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
  // Same reasoning for the audio settings: they live in localStorage for speed,
  // which no backup carries, so the restored copy is applied here.
  try { await initAudioPrefs(); } catch (err) { console.warn("audio prefs init skipped", err); }
  // Which tabs this install wants. Resolved after the restore, so a wiped device
  // gets its own answer back rather than the default one.
  try { await applyTabVisibility(); } catch (err) { console.warn("tab visibility skipped", err); }
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

/**
 * Hide the tabs whose feature is switched off.
 *
 * Exported because Settings has to call it the moment a toggle changes: a
 * feature you just turned on that needs a reload before its tab appears is a
 * feature that looks broken. This is also what makes `features.yoga` a real
 * switch rather than a flag nobody reads — the v161 lesson, where the bodyweight
 * card sat inside a card that was off by default and silently never appeared.
 */
export async function applyTabVisibility() {
  const p = await getProfile();
  const hidden = [];
  if (p && p.features && p.features.yoga === false) hidden.push("yoga");
  setHiddenTabs(hidden);
}

function registerSW() {
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch((e) => console.warn("SW failed", e));
    });
  }
}

boot();
