# LinkedIn Engagement Console

A self-contained HTML console that turns your daily LinkedIn engagement pass into a triage workflow. Drafts grounded comments, surfaces profiles to engage with, proposes your own-content angles. Designed to keep you on the value-adding part of LinkedIn without burning an hour on it.

![LinkedIn-blue cards, three columns: Comments, Engage with, Post Ideas.](./preview.png)

## What it does

The console renders three columns:

- **Comments** — top-N posts from your feed and tracked peer companies, each with a draft comment in your voice, a "why this matters" line, and one-click open + copy + redraft + done + skip actions.
- **Engage with** — profiles worth following or connecting with, with a one-liner reason.
- **Post Ideas** — own-content angles grounded in your recent activity, with hook and supporting paragraph.

State persists in `localStorage`, so cards you mark done or skip stay out of view across sessions.

## How it works

```
┌───────────────────────────┐                       ┌──────────────────────────┐
│       Claude (chat)       │                       │     Engagement Console   │
│                           │                       │       (HTML artifact)    │
│  1. Loads your strategy   │                       │                          │
│  2. Calls LinkedIn MCP    │                       │  Renders JSON baked in   │
│  3. Reads your notes      │                       │  by chat. Local-only     │
│  4. Drafts grounded       │  ── writes JSON ──▶   │  state via localStorage. │
│     comments              │     into the HTML     │  Buttons trigger:        │
│  5. Bakes JSON into the   │                       │   - open LinkedIn        │
│     artifact              │                       │   - copy comment         │
│                           │                       │   - redraft via askLLM   │
└───────────────────────────┘                       └──────────────────────────┘
```

This is the "chat fetches, artifact displays" pattern. LinkedIn MCP tools live in chat where they work reliably; the artifact is just a viewer. Trying to call MCPs from artifact JavaScript fails in most sandboxed iframe environments.

## Requirements

- A LinkedIn MCP server. Recommended: [stickerdaniel/linkedin-mcp-server](https://github.com/stickerdaniel/linkedin-mcp-server) (Apache 2.0, Patchright-based, stealth scraping).
- An LLM client that supports MCP and can run HTML artifacts. Examples: Claude Desktop with Cowork mode, Claude Code with artifact rendering, or any agent harness that does both.
- A way to keep your own context files (identity, voice, strategy). A markdown vault works; so does a Notes app. The skill template shows the contract.

## Quick start

### 1. Install the MCP server

```bash
git clone https://github.com/stickerdaniel/linkedin-mcp-server
cd linkedin-mcp-server
# Follow the upstream README for install + LinkedIn auth.
```

### 2. Clone this repo

```bash
git clone https://github.com/till-hohmann/tinkering
cd tinkering/linkedin-engagement-console
```

### 3. Fill in your strategy

```bash
cp strategy.template.md linkedin-strategy.md
# Edit linkedin-strategy.md — fill in your lenses, personas, skip patterns.
```

`linkedin-strategy.md` is in `.gitignore` so your real strategy never leaves your machine.

### 4. Customize the console persona

Open `index.html` and edit the `PERSONA` config block near the top:

```javascript
const PERSONA = {
  identity: "an operator who builds. Keep tone direct, concrete, numerate.",
  voiceRules: [
    "Short sentences. Concrete nouns. Real names and real numbers.",
    "No em-dashes. Use periods or commas instead.",
    // ... your rules
  ],
  lensPostures: {
    biotech: "...",
    ai_builder: "...",
    operator: "...",
    vc: "..."
  },
  commentLength: "1 to 3 sentences",
  postLength: "120 to 150 words"
};
```

These two constants are the only places the Redraft and Expand buttons hardcode your voice. Everything else is data-driven.

### 5. Adopt the orchestration skill

Drop `skill.template.md` into wherever your LLM client loads skills from. In Claude Desktop / Cowork, that's the plugin or skill directory. In Claude Code, the `~/.claude/skills/` folder. Rename it to whatever trigger phrase you want.

Run it with "linkedin brief" (or your renamed trigger). The skill will:

1. Load your context files
2. Call the LinkedIn MCP to pull feed + peer-company posts
3. Read your own recent notes to ground the drafts
4. Score, classify, draft
5. Bake the result into the artifact's JSON block

### 6. Open the artifact

Open `index.html` in your LLM client's artifact viewer. The demo data ships with the file; once the skill has run, the data block is replaced and the view refreshes.

## File layout

```
linkedin-engagement-console/
├── README.md                # this file
├── index.html               # the console — one file, no build step
├── strategy.template.md     # template for linkedin-strategy.md (gitignored when filled)
├── skill.template.md        # the orchestration skill the LLM runs
└── examples/
    └── example-data.json    # canonical JSON shape your skill must produce
```

## Data shape

The `<script id="briefing-data">` block in `index.html` is parsed at load. Your skill replaces it. See `examples/example-data.json` for the canonical shape. Fields:

- `generated_at` — ISO 8601 timestamp
- `posts_scanned` — integer, shown in header
- `comments[]` — `{ url, author, company?, lens, score, why, draft }`
- `engage[]` — `{ name, profile_hint, reason, lens }`
- `post_ideas[]` — `{ angle, hook, supporting }`

`lens` must be one of the keys in `PERSONA.lensPostures` (`biotech`, `ai_builder`, `operator`, `vc` by default). Add or rename keys to match your own lenses; the lens chip color CSS in `index.html` covers those four.

## Why this exists

LinkedIn is a real channel for operator-credibility but has a high noise-to-signal ratio. Most engagement tools optimise for volume; this one optimises for the opposite. The point is to put 3-4 substantive comments and 1-2 connect requests on the right posts each day, grounded in what you actually did this week, and skip everything else without the algorithm grinding you down.

The hardest part of "draft a comment in my voice" is not voice — it's that the LLM has no idea what you did this week. Generic operator-speak ("real partner deals replacing pilot grants") reads as authentic to nobody. The mandatory grounding step in `skill.template.md` is the load-bearing part of the architecture.

## Customization

- **Add a lens.** Edit `PERSONA.lensPostures` in `index.html`, add a matching CSS rule for `.lens.your_new_lens` in the `<style>` block, list it in `linkedin-strategy.md`.
- **Change the brand colors.** Edit the `--li-*` CSS variables in `index.html`. The current palette is LinkedIn's; change it to anything.
- **Disable the in-artifact Redraft.** The button falls back to chat if `window.sendPrompt` exists. If neither is available, the button shows "Unavailable" and stays inert.
- **Add a column.** The grid is 3-up. Edit `.cols { grid-template-columns: 1fr 1fr 1fr; }` and add a `<div class="col" id="col-yours">` block plus a `renderYours()` function. The render functions all follow the same shape.

## What's NOT in this repo

- The LinkedIn MCP server itself (use [stickerdaniel/linkedin-mcp-server](https://github.com/stickerdaniel/linkedin-mcp-server))
- Your auth token or LinkedIn cookies (these stay local; see `.gitignore`)
- Your strategy file with real names (also gitignored)
- Any specific people, companies, or numbers from the author's own work

## License

MIT. See top-level [LICENSE](../LICENSE).

## Contributing

If you fork this and ship a meaningful variant — different industry, different lens model, different LLM stack — open an issue with a link. Happy to point to it from this README.
