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

// Pull the cloud snapshot. Returns {programs, sessions, prefs} or null. Times out
// so a slow/offline network never blocks boot for long, and returns null when no
// backup is configured at all.
export async function cloudPull(timeoutMs = 3500) {
  const t = await backupTarget();
  if (!t) return null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(t.endpoint, { headers: authHeaders(t), signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const txt = await res.text();
    if (!txt || txt.trim() === "null") return null;
    const data = JSON.parse(txt);
    return data && Array.isArray(data.sessions) ? data : null;
  } catch (_) { return null; }
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
    const state = await buildState();
    if (!state || !Array.isArray(state.sessions)) return;
    await fetch(t.endpoint, { method: "PUT",
      headers: { ...authHeaders(t), "Content-Type": "application/json" },
      body: JSON.stringify(state) });
  } catch (_) { /* offline — next change retries */ } finally { inflight = false; }
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
