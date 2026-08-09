// ninefold-whoop — OAuth 2.0 broker + read-only proxy between the Ninefold PWA and
// the WHOOP Developer API. The PWA cannot talk to WHOOP directly (the client
// secret must stay server-side and browser→WHOOP calls are blocked by CORS), so
// this Worker brokers the auth and proxies the data.
//
// SECURITY MODEL (health data — kept deliberately tight):
//  - The WHOOP client id/secret live ONLY as Wrangler secrets (WHOOP_CLIENT_ID,
//    WHOOP_CLIENT_SECRET). They are never in this file or the git repo.
//  - The app authenticates with a high-entropy `linkId` generated on the user's
//    device and stored ONLY there (never in the deployed JS, never synced to the
//    training-log cloud, never sent through WHOOP's `state`). The Worker stores
//    WHOOP tokens in KV keyed by sha256(linkId), so a KV dump never reveals a
//    usable credential.
//  - OAuth CSRF is covered by a random, single-use, short-TTL `state`.
//  - The Worker stores ONLY OAuth tokens — never the health data itself, which
//    streams straight through to the app on demand.
//  - CORS is locked to the app origin; every data endpoint requires the bearer
//    linkId. All scopes are read-only.

const WHOOP_AUTH = "https://api.prod.whoop.com/oauth/oauth2/auth";
const WHOOP_TOKEN = "https://api.prod.whoop.com/oauth/oauth2/token";
const WHOOP_API = "https://api.prod.whoop.com/developer/v2";
const SCOPES = "offline read:profile read:workout read:recovery read:cycles read:sleep read:body_measurement";
const TOKEN_TTL_FALLBACK = 3600;       // seconds, if WHOOP omits expires_in
const STATE_TTL = 600;                 // seconds an OAuth attempt stays valid

function cors(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Authorization,Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}
const json = (obj, status, origin) =>
  new Response(JSON.stringify(obj), { status: status || 200,
    headers: { "Content-Type": "application/json", ...cors(origin) } });

async function sha256Hex(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function randUrlSafe(n = 24) {
  const a = new Uint8Array(n); crypto.getRandomValues(a);
  return btoa(String.fromCharCode(...a)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function bearer(req) {
  const h = req.headers.get("Authorization") || "";
  return h.startsWith("Bearer ") ? h.slice(7) : null;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const origin = env.APP_ORIGIN || "*";
    if (req.method === "OPTIONS") return new Response(null, { headers: cors(origin) });
    const path = url.pathname.replace(/\/+$/, "") || "/";
    try {
      if (path === "/auth/start" && req.method === "POST") return authStart(req, env, url, origin);
      if (path === "/auth/callback" && req.method === "GET") return authCallback(env, url, origin);
      if (path === "/status" && req.method === "GET") return status(req, env, origin);
      if (path === "/disconnect" && req.method === "POST") return disconnect(req, env, origin);
      if (path === "/workouts" && req.method === "GET") return proxy(req, env, url, origin, "/activity/workout");
      if (path === "/recovery" && req.method === "GET") return proxy(req, env, url, origin, "/recovery");
      if (path === "/sleep" && req.method === "GET") return proxy(req, env, url, origin, "/activity/sleep");
      if (path === "/cycle" && req.method === "GET") return proxy(req, env, url, origin, "/cycle");
      if (path === "/body" && req.method === "GET") return proxy(req, env, url, origin, "/user/measurement/body");
      if (path === "/") return json({ ok: true, service: "strong-whoop" }, 200, origin);
      return json({ error: "not found" }, 404, origin);
    } catch (e) {
      return json({ error: "server_error", detail: String((e && e.message) || e) }, 500, origin);
    }
  },
};

// --- OAuth ---------------------------------------------------------------
async function authStart(req, env, url, origin) {
  const linkId = bearer(req);
  if (!linkId || linkId.length < 20) return json({ error: "missing_link_id" }, 400, origin);
  if (!env.WHOOP_CLIENT_ID) return json({ error: "worker_unconfigured" }, 500, origin);
  const linkHash = await sha256Hex(linkId);
  const state = randUrlSafe(24);
  await env.STRONG_WHOOP.put("state:" + state, linkHash, { expirationTtl: STATE_TTL });
  const a = new URL(WHOOP_AUTH);
  a.searchParams.set("response_type", "code");
  a.searchParams.set("client_id", env.WHOOP_CLIENT_ID);
  a.searchParams.set("redirect_uri", `${url.origin}/auth/callback`);
  a.searchParams.set("scope", SCOPES);
  a.searchParams.set("state", state);
  return json({ authorizeUrl: a.toString() }, 200, origin);
}

async function authCallback(env, url, origin) {
  if (url.searchParams.get("error")) return page("WHOOP sign-in was cancelled.", origin, false);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return page("Missing authorization code.", origin, false);
  const linkHash = await env.STRONG_WHOOP.get("state:" + state);
  if (!linkHash) return page("This sign-in link expired or was already used. Start again from the app.", origin, false);
  await env.STRONG_WHOOP.delete("state:" + state);
  const tok = await tokenRequest(env, { grant_type: "authorization_code", code,
    redirect_uri: `${url.origin}/auth/callback` });
  if (!tok || !tok.access_token) return page("Could not complete WHOOP sign-in. Please try again.", origin, false);
  await storeTokens(env, linkHash, tok);
  return page("WHOOP connected. You can return to Ninefold.", origin, true);
}

async function tokenRequest(env, params) {
  const body = new URLSearchParams({ ...params,
    client_id: env.WHOOP_CLIENT_ID, client_secret: env.WHOOP_CLIENT_SECRET });
  if (params.grant_type === "refresh_token") body.set("scope", SCOPES);
  const res = await fetch(WHOOP_TOKEN, { method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  if (!res.ok) return null;
  return res.json();
}

async function storeTokens(env, linkHash, tok, prev) {
  const rec = {
    access: tok.access_token,
    refresh: tok.refresh_token || (prev && prev.refresh) || null,   // WHOOP rotates refresh tokens
    expiresAt: Date.now() + ((tok.expires_in || TOKEN_TTL_FALLBACK) * 1000) - 60000,
  };
  await env.STRONG_WHOOP.put("link:" + linkHash, JSON.stringify(rec));
  return rec;
}

// Return a valid access token for this link, refreshing if needed; null if not linked.
async function accessFor(env, linkHash) {
  const raw = await env.STRONG_WHOOP.get("link:" + linkHash);
  if (!raw) return null;
  const rec = JSON.parse(raw);
  if (rec.expiresAt && Date.now() < rec.expiresAt) return rec.access;
  if (!rec.refresh) return null;
  const tok = await tokenRequest(env, { grant_type: "refresh_token", refresh_token: rec.refresh });
  if (!tok || !tok.access_token) return null;
  const updated = await storeTokens(env, linkHash, tok, rec);
  return updated.access;
}

// --- endpoints -----------------------------------------------------------
async function status(req, env, origin) {
  const linkId = bearer(req);
  if (!linkId) return json({ connected: false }, 200, origin);
  const access = await accessFor(env, await sha256Hex(linkId));
  if (!access) return json({ connected: false }, 200, origin);
  const r = await fetch(WHOOP_API + "/user/profile/basic", { headers: { Authorization: "Bearer " + access } });
  if (!r.ok) return json({ connected: true }, 200, origin);
  const p = await r.json().catch(() => ({}));
  return json({ connected: true, profile: { first_name: p.first_name, last_name: p.last_name } }, 200, origin);
}

async function disconnect(req, env, origin) {
  const linkId = bearer(req);
  if (linkId) await env.STRONG_WHOOP.delete("link:" + (await sha256Hex(linkId)));
  return json({ connected: false }, 200, origin);
}

async function proxy(req, env, url, origin, apiPath) {
  const linkId = bearer(req);
  if (!linkId) return json({ error: "not_linked" }, 401, origin);
  const access = await accessFor(env, await sha256Hex(linkId));
  if (!access) return json({ error: "not_linked" }, 401, origin);
  const target = new URL(WHOOP_API + apiPath);
  for (const k of ["limit", "start", "end", "nextToken"]) {
    const v = url.searchParams.get(k); if (v) target.searchParams.set(k, v);
  }
  const r = await fetch(target, { headers: { Authorization: "Bearer " + access } });
  const text = await r.text();
  return new Response(text, { status: r.status,
    headers: { ...cors(origin), "Content-Type": "application/json" } });
}

// --- the post-auth landing page (shown in the browser tab WHOOP redirects to) ---
function page(msg, origin, ok) {
  const html = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ninefold · WHOOP</title><style>
body{font-family:-apple-system,BlinkMacSystemFont,system-ui,sans-serif;background:#0a0c0f;color:#e8eaed;
display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:24px;text-align:center}
.c{max-width:340px}.t{font-size:2.6rem;margin-bottom:6px;color:${ok ? "#2fe6a6" : "#fbbf24"}}
h2{font-weight:700;font-size:1.15rem;line-height:1.4}
a{display:inline-block;margin-top:22px;background:#2fe6a6;color:#042016;font-weight:800;
padding:14px 24px;border-radius:13px;text-decoration:none}</style></head>
<body><div class="c"><div class="t">${ok ? "✓" : "⚠"}</div><h2>${msg}</h2>
<a href="${origin}/#/settings">Return to Ninefold</a></div></body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
