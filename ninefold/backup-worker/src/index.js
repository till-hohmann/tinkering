// ninefold-backup — a tiny token-protected KV store holding one Ninefold
// install's full state (programs + sessions + synced settings) so it survives
// any on-device storage wipe. Deploy your own; there is no shared instance.
//
//   GET  /                -> the stored JSON (or "null")
//   PUT  /                -> overwrite the stored JSON
//   POST /health-ingest   -> append a day of Apple Health metrics (see below)
//   GET  /health          -> the Apple Health metrics store (or "null")
//
// All routes require  Authorization: Bearer <BACKUP_TOKEN>.
//
// SECURITY: the token is a Wrangler secret, never source. It gates read AND
// write, so whoever holds it can read and overwrite the entire training log —
// treat it like a password and generate it randomly:
//
//   wrangler secret put BACKUP_TOKEN      (paste at the prompt; never on argv)
//
// The storage key is derived from the token hash rather than hardcoded, so one
// deployment can serve several independent installs (e.g. two people sharing a
// Cloudflare account) without either being able to read the other.
//
// CORS is open because a PWA on *.pages.dev calls this cross-origin and the
// token — not the origin — is the real gate. Set APP_ORIGIN to lock it down.

const CORS_METHODS = "GET,PUT,POST,OPTIONS";

// "Has this snapshot come from an install someone actually set up?" The marker is
// `onboardedAt`, not the mere presence of a profile: the app writes a blank
// profile during its first-boot migration, so an empty install has one too.
const hasProfile = (s) =>
  !!(s && s.prefs && s.prefs.profile && s.prefs.profile.onboardedAt);

function cors(origin) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": CORS_METHODS,
    "Access-Control-Allow-Headers": "Authorization,Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

async function sha256Hex(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Constant-time-ish compare so the token can't be recovered a byte at a time.
function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export default {
  async fetch(req, env) {
    const origin = env.APP_ORIGIN || "*";
    const H = cors(origin);
    if (req.method === "OPTIONS") return new Response(null, { headers: H });

    if (!env.BACKUP_TOKEN) {
      return new Response(JSON.stringify({ error: "worker_unconfigured",
        detail: "Set the BACKUP_TOKEN secret: wrangler secret put BACKUP_TOKEN" }),
        { status: 500, headers: { ...H, "Content-Type": "application/json" } });
    }

    const auth = req.headers.get("Authorization") || "";
    const presented = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!safeEqual(presented, env.BACKUP_TOKEN))
      return new Response("unauthorized", { status: 401, headers: H });

    // Per-token namespace: two installs on one Worker never collide or leak.
    // BACKUP_KEY overrides the derived namespace — set it (as a plain [vars]
    // entry, it is not a secret) when you already have data under a key of your
    // own choosing, so rotating the token doesn't orphan the existing backup.
    const ns = env.BACKUP_KEY || (await sha256Hex(env.BACKUP_TOKEN)).slice(0, 16);
    const STATE_KEY = env.BACKUP_KEY ? env.BACKUP_KEY : "state:" + ns;
    const HEALTH_KEY = "health:" + ns;

    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const jsonHeaders = { ...H, "Content-Type": "application/json" };

    // --- the training state -------------------------------------------------
    if (path === "/" && req.method === "GET") {
      const v = await env.STRONG_BACKUP.get(STATE_KEY);
      return new Response(v || "null", { headers: jsonHeaders });
    }
    if (path === "/" && req.method === "PUT") {
      const body = await req.text();
      if (body.length > 5_000_000) return new Response("too large", { status: 413, headers: H });
      let parsed;
      try { parsed = JSON.parse(body); } catch (_) {
        return new Response("invalid json", { status: 400, headers: H });
      }
      // Refuse to overwrite a real backup with an empty one — a client that boots
      // before its DB opens must never be able to blank the only durable copy.
      if (!parsed || !Array.isArray(parsed.sessions))
        return new Response("missing sessions array", { status: 400, headers: H });
      // TWO REFUSALS, ONE IDEA: a client that has lost its memory must not be
      // able to tell this store to forget too. Both are cases where the incoming
      // snapshot is strictly poorer than the stored one in a way no user action
      // produces, so the write is far more likely to be an accident than intent.
      const prevRaw = (parsed.sessions.length === 0 || !hasProfile(parsed))
        ? await env.STRONG_BACKUP.get(STATE_KEY) : null;
      if (prevRaw) {
        let prev = null;
        try { prev = JSON.parse(prevRaw); } catch (_) { /* unparseable — let the write through */ }
        if (prev) {
          // 1. Zero sessions over a log that has some.
          if (parsed.sessions.length === 0 && (prev.sessions || []).length > 0) {
            return new Response(JSON.stringify({ error: "refused_empty_overwrite",
              detail: "Stored backup is non-empty; refusing to replace it with zero sessions." }),
              { status: 409, headers: jsonHeaders });
          }
          // 2. No profile over a stored one. This is the wiped-device case, and it
          //    is subtle: the device HAS sessions (it just pulled them back), so
          //    the check above passes, while its settings are still the blank ones
          //    a fresh install starts with. Left unguarded, the first push after a
          //    mis-stepped restore overwrites the only copy of the zones, goal,
          //    places and routine that the restore was supposed to bring back.
          if (!hasProfile(parsed) && hasProfile(prev)) {
            return new Response(JSON.stringify({ error: "refused_profile_regression",
              detail: "Stored backup has a set-up profile; refusing to replace it with one that has none. "
                + "If this device should start fresh, clear the stored backup first." }),
              { status: 409, headers: jsonHeaders });
          }
        }
      }
      await env.STRONG_BACKUP.put(STATE_KEY, body);
      return new Response("ok", { headers: H });
    }

    // --- Apple Health push ingest -------------------------------------------
    // An iOS Shortcut (docs/apple-health.md) POSTs one JSON object per run:
    //   { "days": [ { "date": "2026-08-08", "restingHR": 50, "hrv": 116,
    //                 "sleepHours": 7.4, "weightKg": 96.2, "activeKcal": 780,
    //                 "basalKcal": 2100, "vo2max": 44.2,
    //                 "workouts": [ {...} ] } ] }
    // Days merge by date (last write wins per field), so a Shortcut that reruns
    // or backfills is idempotent. Kept separate from the training state because
    // the phone writes here while the app writes there — one owner per key.
    if (path === "/health-ingest" && req.method === "POST") {
      const body = await req.text();
      if (body.length > 2_000_000) return new Response("too large", { status: 413, headers: H });
      let incoming;
      try { incoming = JSON.parse(body); } catch (_) {
        return new Response("invalid json", { status: 400, headers: H });
      }
      // THREE ACCEPTED SHAPES, because the client is a hand-built Shortcut.
      //   { days: [ {...} ] }   the documented one
      //   [ {...} ]             a bare array
      //   { date, hrv, ... }    ONE day, unwrapped
      //
      // The third exists for a practical reason: Shortcuts can build a flat JSON
      // body from its own UI in a few taps, where a nested array-of-dictionaries
      // means routing a Text action through a file variable — a step that fails
      // silently and reports itself as "the network connection was lost".
      // Meeting the tool where it is costs three lines and removes the single
      // most likely reason someone gives up during setup.
      const days = Array.isArray(incoming) ? incoming
        : incoming && Array.isArray(incoming.days) ? incoming.days
        : incoming && typeof incoming.date === "string" ? [incoming]
        : [];
      if (!Array.isArray(days) || !days.length)
        return new Response(JSON.stringify({ error: "no_days" }), { status: 400, headers: jsonHeaders });

      let store = {};
      const prev = await env.STRONG_BACKUP.get(HEALTH_KEY);
      if (prev) { try { store = JSON.parse(prev) || {}; } catch (_) { store = {}; } }
      const byDate = store.byDate || {};
      let written = 0;
      for (const d of days) {
        if (!d || typeof d.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(d.date)) continue;
        byDate[d.date] = { ...(byDate[d.date] || {}), ...d };
        written++;
      }
      // Bound the store so a runaway Shortcut can't grow it without limit —
      // two years of daily metrics is far more than any view reads.
      const dates = Object.keys(byDate).sort();
      if (dates.length > 800) for (const stale of dates.slice(0, dates.length - 800)) delete byDate[stale];

      store = { byDate, updatedAt: new Date().toISOString(), source: "apple-health" };
      await env.STRONG_BACKUP.put(HEALTH_KEY, JSON.stringify(store));
      return new Response(JSON.stringify({ ok: true, written, totalDays: Object.keys(byDate).length }),
        { headers: jsonHeaders });
    }
    if (path === "/health" && req.method === "GET") {
      const v = await env.STRONG_BACKUP.get(HEALTH_KEY);
      return new Response(v || "null", { headers: jsonHeaders });
    }

    return new Response("method not allowed", { status: 405, headers: H });
  },
};
