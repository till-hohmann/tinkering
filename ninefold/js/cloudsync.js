// cloudsync.js — OPTIONAL durable off-device backup so training data survives a
// local storage wipe (app removed/re-added, iOS eviction, etc.). Talks to a
// token-protected backup Worker (KV-backed) that YOU deploy: pull-merge on boot,
// push a full snapshot (debounced) after every change.
//
// Entirely optional. With no backup endpoint configured the app is local-only
// and every function here becomes a no-op — file export stays the durable net.
// Even when configured, every call is best-effort and offline-safe: errors are
// swallowed so the app works fully with no network.
//
// The endpoint and token come from config.js (build-time overlay or the Settings
// screen), never from source. They are a credential: whoever holds them can read
// and overwrite the whole training log.

import * as db from "./db.js";
import { resolvedConfig, hasBackup } from "./config.js";

async function backupTarget() {
  const cfg = await resolvedConfig(db);
  return hasBackup(cfg) ? cfg.backup : null;
}

const authHeaders = (t) => ({ Authorization: "Bearer " + t.token });

// ⚠ A PUSH IS A WHOLE-STATE OVERWRITE, SO IT MAY ONLY FOLLOW A PULL.
// Boot used to pull, ignore a failed pull, and push anyway: a laptop on slow wifi
// timed out, then replaced the cloud copy with its own older view, and the phone's
// newer sessions were gone from the backup. A tab left open for days did the same
// on every save, since pulls only happened at boot. Now a push needs a successful
// pull in this page's lifetime, and one no older than PULL_FRESH_MS — a stale one
// is refreshed and merged first. The merge comes from app.js (setCloudMerge) so
// this module does not import the store.
const PULL_FRESH_MS = 60_000;
let lastPullOkAt = 0;
let mergeFn = null;
// The version of the backup this device last read or wrote, sent back as
// X-Backup-Version so the Worker can refuse a push built on an older copy. Only
// ever set from a Worker that returns one — an older Worker never sees the
// header, which its CORS rules would reject. (Not ETag/If-Match: the edge
// rewrites ETags to their weak form, and nothing would ever have matched.)
let lastEtag = null;
/** Register the non-destructive merge (store.mergeRestore) used before a push. */
export function setCloudMerge(fn) { mergeFn = fn; }

/**
 * Pull the cloud snapshot and say what happened.
 * status: "ok" (data set) | "empty" (reachable, nothing stored) | "unauthorized"
 *       | "error" | "offline" | "unconfigured"
 */
export async function cloudPullResult(timeoutMs = 3500) {
  const t = await backupTarget();
  if (!t) return { status: "unconfigured", data: null };
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(t.endpoint, { headers: authHeaders(t), signal: ctrl.signal });
    clearTimeout(timer);
    if (res.status === 401 || res.status === 403) return { status: "unauthorized", data: null };
    if (!res.ok) return { status: "error", data: null, httpStatus: res.status };
    const txt = await res.text();
    if (!txt || txt.trim() === "null") { lastPullOkAt = Date.now(); lastEtag = res.headers.get("X-Backup-Version") || null; return { status: "empty", data: null }; }
    const data = JSON.parse(txt);
    // Anything else (an HTML page from a captive portal, a proxy's error body)
    // is not this backup, and must not count as having heard from it.
    if (!data || !Array.isArray(data.sessions)) return { status: "error", data: null };
    lastPullOkAt = Date.now();
    lastEtag = res.headers.get("X-Backup-Version") || null;
    return { status: "ok", data };
  } catch (_) { return { status: "offline", data: null }; }
}

// Pull the cloud snapshot. Returns {programs, sessions, prefs} or null. Times out
// so a slow/offline network never blocks boot for long, and returns null when no
// backup is configured at all.
export async function cloudPull(timeoutMs = 3500) {
  return (await cloudPullResult(timeoutMs)).data;
}

// --- push health -------------------------------------------------------------
// A PUSH USED TO BE FIRE-AND-FORGET, AND THAT WAS THE WORST BUG IN THIS FILE.
// The response was never examined, so a rotated token (401), a refusal (409), a
// snapshot grown past the Worker's size limit (413) and the Worker simply being
// down all looked exactly like success. The only way to notice was to open
// Settings and press a button, which nobody does until the day they need the
// backup — the one day it is too late to find out.
//
// Recorded device-locally, deliberately NOT in SYNCED_PREFS: it describes THIS
// device's link to the service, and pushing it through the service it describes
// would be circular.
const HEALTH_KEY = "cloudHealth";

/** { at, ok, reason, status, consecutiveFailures } — or null if never attempted. */
export async function getCloudHealth() {
  try { return (await db.getPref(HEALTH_KEY)) || null; } catch (_) { return null; }
}

async function recordPush(ok, reason, status) {
  try {
    const prev = (await db.getPref(HEALTH_KEY)) || {};
    await db.setPref(HEALTH_KEY, {
      at: new Date().toISOString(), ok, reason: reason || null, status: status || null,
      consecutiveFailures: ok ? 0 : ((prev.consecutiveFailures || 0) + 1),
      lastOkAt: ok ? new Date().toISOString() : (prev.lastOkAt || null),
    });
  } catch (_) { /* diagnostics must never break the thing they diagnose */ }
}

let timer = null, inflight = false;
// Debounced push — coalesces a burst of saves into one upload.
export function cloudPushDebounced(buildState, delay = 2500) {
  clearTimeout(timer);
  timer = setTimeout(() => cloudPush(buildState), delay);
}
export async function cloudPush(buildState) {
  const t = await backupTarget();
  if (!t) return;
  if (inflight) { cloudPushDebounced(buildState, 1500); return; }
  inflight = true;
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const outcome = await pushOnce(t, buildState, attempt > 0);
      if (outcome !== "stale") return;
    }
    await recordPush(false, "refused", 412);   // still stale after a fresh merge
  } finally { inflight = false; }
}

// One push. Returns "done" or "stale" (the Worker refused it as built on an
// older copy, so the caller pulls, merges and tries once more).
async function pushOnce(t, buildState, forcePull) {
  if (forcePull || Date.now() - lastPullOkAt > PULL_FRESH_MS) {
    const pulled = await cloudPullResult();
    if (pulled.status === "ok" || pulled.status === "empty") {
      if (pulled.data) {
        if (!mergeFn) { await recordPush(false, "error"); return "done"; }
        await mergeFn(pulled.data);
      }
    } else {
      // Not heard from the backup, so this device cannot know it holds the
      // newest copy. Skip; the next change (or the next boot) tries again.
      await recordPush(false, pulled.status === "unauthorized" ? "unauthorized"
        : pulled.status === "offline" ? "offline" : "error", pulled.httpStatus);
      return "done";
    }
  }
  try {
    const state = await buildState();
    if (!state || !Array.isArray(state.sessions)) return "done";
    const res = await fetch(t.endpoint, { method: "PUT",
      headers: { ...authHeaders(t), "Content-Type": "application/json", ...(lastEtag ? { "X-Backup-Version": lastEtag } : {}) },
      body: JSON.stringify(state) });
    if (res.status === 412) return "stale";
    if (res.ok) { lastEtag = res.headers.get("X-Backup-Version") || lastEtag; await recordPush(true); return "done"; }
    // Name the failures that mean different things, because the fix differs:
    // a wrong token needs re-entering, a refusal means the Worker protected
    // something, and a size failure needs the log trimming.
    const reason = res.status === 401 || res.status === 403 ? "unauthorized"
      : res.status === 409 ? "refused"
      : res.status === 413 ? "too_large"
      : "error";
    await recordPush(false, reason, res.status);
    return "done";
  } catch (_) {
    // Offline is the ONE benign failure: the next change retries, and flagging it
    // would cry wolf every time a phone goes through a tunnel. Still recorded, so
    // a device that has been "offline" for a fortnight can be spotted.
    await recordPush(false, "offline");
    return "done";
  }
}

// Reachability probe for the Settings screen, so a self-hoster can verify their
// endpoint + token before trusting it with anything. Distinguishes the three
// failure modes that actually matter (unset / wrong token / unreachable).
export async function cloudCheck() {
  const t = await backupTarget();
  if (!t) return { ok: false, reason: "unconfigured" };
  try {
    const ctrl = new AbortController();
    const timer2 = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch(t.endpoint, { headers: authHeaders(t), signal: ctrl.signal });
    clearTimeout(timer2);
    if (res.status === 401 || res.status === 403) return { ok: false, reason: "unauthorized" };
    if (!res.ok) return { ok: false, reason: "error", status: res.status };
    const txt = await res.text();
    const empty = !txt || txt.trim() === "null";
    let sessions = 0;
    if (!empty) { try { sessions = (JSON.parse(txt).sessions || []).length; } catch (_) {} }
    return { ok: true, empty, sessions };
  } catch (_) { return { ok: false, reason: "unreachable" }; }
}
