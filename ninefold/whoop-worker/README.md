# strong-whoop

OAuth 2.0 broker + read-only proxy between the Ninefold PWA and the **WHOOP
Developer API**. The PWA can't call WHOOP directly (the client secret must stay
server-side and the browser is blocked by CORS), so this Worker brokers the auth
and proxies the data.

## Security model

- **WHOOP client id/secret** live ONLY as Wrangler secrets — never in the repo.
- The app authenticates with a **device-generated `linkId`** stored only on the
  device. The Worker keeps WHOOP tokens in KV keyed by **`sha256(linkId)`**, so a
  KV dump never exposes a usable credential.
- OAuth CSRF is covered by a random, single-use, short-TTL `state`.
- The Worker stores **only OAuth tokens — never health data**, which streams
  straight through to the app on demand.
- CORS is locked to the app origin; every data endpoint requires the linkId.
- All scopes are **read-only** (`read:profile read:workout read:recovery
  read:cycles read:sleep` + `offline` for refresh).

## One-time setup

### 1. Register a WHOOP app
At <https://developer.whoop.com> → create an app (your WHOOP account):

- **Redirect URI:** `https://<your-whoop-worker>.workers.dev/auth/callback`
- **Scopes:** `read:profile`, `read:workout`, `read:recovery`, `read:cycles`,
  `read:sleep`, `offline`
- Copy the **Client ID** and **Client Secret**.

(A personal app needs no review for your own account; WHOOP only requires
approval to go past a handful of users.)

### 2. Set the secrets (never committed)
From this folder:

```bash
npx wrangler secret put WHOOP_CLIENT_ID       # paste the Client ID at the prompt
npx wrangler secret put WHOOP_CLIENT_SECRET   # paste the Client Secret at the prompt
```

Paste the values when prompted — never put them on the command line, or they
land in your shell history.

### 3. Deploy

```bash
npx wrangler deploy
```

Then in the app: **Profile → WHOOP → Connect**.

## Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/auth/start` | `Bearer <linkId>` | returns the WHOOP authorize URL |
| GET | `/auth/callback` | (WHOOP redirect) | exchanges the code, stores tokens |
| GET | `/status` | `Bearer <linkId>` | `{connected, profile?}` |
| POST | `/disconnect` | `Bearer <linkId>` | deletes the stored tokens |
| GET | `/workouts` `/recovery` `/sleep` `/cycle` | `Bearer <linkId>` | proxied WHOOP data (`limit/start/end/nextToken`) |

KV namespace `STRONG_WHOOP` (id in `wrangler.toml`) holds `link:<hash>` token
records and short-lived `state:<state>` entries — nothing else.
