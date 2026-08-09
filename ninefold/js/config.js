// config.js — the single place where a deployment is configured.
//
// Ninefold ships EMPTY: every value below is either a safe generic default or
// null. An install with this file untouched is a fully working, fully offline,
// local-only app — IndexedDB plus file export/import, no backend, no accounts.
//
// There are two ways to point an install at your own services, and they compose:
//
//   1. BUILD-TIME (the private overlay). Your deploy script copies your own
//      config over this file into the staging directory, so your install needs
//      no setup at all. See tools/deploy.ps1 and overlay/README.md. This file is
//      the one that gets replaced, which is why nothing secret may ever be
//      committed here.
//
//   2. RUNTIME (the Settings screen). A self-hoster deploys the public code
//      unchanged and pastes their Worker URLs and token into Settings. Those are
//      stored in prefs on the device and override the build-time values.
//
// Runtime wins over build-time, which wins over the defaults here. Resolution
// lives in resolvedConfig() below; nothing else in the app reads this object
// directly.

// --- build-time defaults (replaced wholesale by a private overlay) ------------
export const BUILD_CONFIG = {
  // Display name. Used by the manifest generator, the export headers, the
  // WHOOP/Apple landing pages and the Settings footer.
  appName: "Ninefold",

  // Durable off-device backup. null = local-only: the app works completely, it
  // just can't restore itself after a storage wipe (file export is the net).
  // Self-host: deploy backup-worker/ and put its URL + a token you invent here.
  backup: {
    endpoint: null,        // e.g. "https://ninefold-backup.<you>.workers.dev"
    token: null,           // a long random string YOU choose; gates read+write
  },

  // WHOOP. Requires your own WHOOP developer app + your own deployed
  // whoop-worker/ — WHOOP caps unapproved apps to a small number of users, so
  // there is no shared instance to borrow.
  whoop: {
    endpoint: null,        // e.g. "https://ninefold-whoop.<you>.workers.dev"
  },

  // Apple Health arrives by push: a Shortcut on your phone writes to the backup
  // Worker's /health-ingest route on a schedule. Nothing to configure beyond
  // having a backup endpoint — see docs/apple-health.md.
  apple: {
    enabled: true,
  },

  // Seeded personal defaults. PUBLIC BUILDS LEAVE THIS null. A private overlay
  // uses it so an existing install migrates without re-entering everything; the
  // profile migration reads it exactly once, on first upgrade.
  legacyDefaults: null,
  //   {
  //     goal: { weightKg, baselineKg, baselineDate },
  //     sex: "male" | "female",
  //     birthYear: 1234,
  //   }
};

// --- runtime overrides -------------------------------------------------------
// Stored in prefs (device-local, deliberately NOT synced — an endpoint+token is
// a credential, and syncing it through the very service it unlocks is circular).
const RUNTIME_KEY = "deploymentConfig";

let cached = null;

// Merge one level deep: a runtime override of `backup` replaces the whole
// object, which is what you want (endpoint and token travel together).
export async function resolvedConfig(db) {
  if (cached) return cached;
  let runtime = {};
  try { runtime = (await db.getPref(RUNTIME_KEY)) || {}; } catch (_) { /* pre-DB call */ }
  cached = {
    ...BUILD_CONFIG,
    ...runtime,
    backup: { ...BUILD_CONFIG.backup, ...(runtime.backup || {}) },
    whoop: { ...BUILD_CONFIG.whoop, ...(runtime.whoop || {}) },
    apple: { ...BUILD_CONFIG.apple, ...(runtime.apple || {}) },
  };
  return cached;
}

export async function setRuntimeConfig(db, patch) {
  const cur = (await db.getPref(RUNTIME_KEY)) || {};
  const next = { ...cur, ...patch };
  for (const k of ["backup", "whoop", "apple"]) {
    if (patch && patch[k]) next[k] = { ...(cur[k] || {}), ...patch[k] };
  }
  await db.setPref(RUNTIME_KEY, next);
  cached = null;                       // force re-resolve
  return next;
}

export function clearConfigCache() { cached = null; }

// Convenience predicates — every network feature is optional, so callers ask
// before they reach for it rather than failing into a catch block.
export const hasBackup = (cfg) => !!(cfg && cfg.backup && cfg.backup.endpoint && cfg.backup.token);
export const hasWhoop = (cfg) => !!(cfg && cfg.whoop && cfg.whoop.endpoint);
export const hasAppleIngest = (cfg) => !!(cfg && cfg.apple && cfg.apple.enabled && hasBackup(cfg));
