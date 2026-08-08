# tinkering

Small AI-assisted operator tools, released as I build them. Each subfolder is a self-contained project with its own README, license, and setup instructions.

## What's here

- **[linkedin-engagement-console](./linkedin-engagement-console/)**. Daily LinkedIn engagement console. Pulls feed + peer-company posts via an MCP server, drafts comments grounded in your own recent activity, surfaces profiles to engage with, proposes own-content angles. Renders as a single self-contained HTML page in LinkedIn brand colors. **Not a developer?** Start with the [step-by-step getting-started guide](./linkedin-engagement-console/GETTING_STARTED.md).
- **[plaud-obsidian](./plaud-obsidian/)** (`v0.1.0`). Config-driven pipeline that turns Plaud voice-recording summaries into meaningful, properly-named, well-linked notes in an Obsidian vault. Four CLIs: an **ingester** (routing + filename normalisation + inbox fallback for unroutable files), a **templater** (keeps the wikilink references in your Plaud system prompts in sync with your Obsidian indices, so future summaries link to canonical names), a **relinker** (turns plain-text mentions of note titles and aliases into `[[wikilinks]]`), and a **graph audit** (surfaces missing index entries, stale notes, and concept candidates). Each CLI also ships as a Claude Code / Cowork skill bundle. Runs on top of [plaud-api](https://github.com/till-hohmann/plaud-api), which downloads Plaud summaries as clean markdown and is useful standalone if you don't use Obsidian. Pure Python, zero third-party deps, 74 passing tests. **Not a developer?** Start with the [step-by-step getting-started guide](./plaud-obsidian/GETTING_STARTED.md).

- **[ninefold](./ninefold/)**. Offline-first training app (PWA) that **writes your training plan**, runs each session with you, and adjusts the loads from what you actually lift. The plan builder is grounded in Andy Galpin's nine trainable adaptations, including an interference model that is *computed* rather than hand-tabulated — the adaptations sit on a neuromuscular-to-metabolic continuum, so the distance between two of them predicts how badly they'll fight each other in the same block. Autoregulating progression (double progression bridged by an effort-adjusted e1RM, snapped to weights you can physically load), cross-location exercise substitution with back-calculation, weekly volume against MEV/MAV landmarks, optional WHOOP or Apple Health. No account, no server unless you deploy one yourself. Buildless plain ES modules — no framework, no bundler, no build step. **Not a developer?** Start with the [step-by-step getting-started guide](./ninefold/GETTING_STARTED.md).

More to come as I open-source pieces of my own operator stack.

## Philosophy

These are tools I use myself. Each one solves a real workflow problem I had. The release is the sanitized version, with voice and data placeholders where my own context used to be. The architectural pattern is what was actually battle-tested.

A few patterns recur across projects:

- **Chat fetches, artifact displays.** MCP tools live in chat. The artifact is a viewer over JSON the chat baked in. This is more reliable than calling MCPs from the artifact JavaScript context.
- **Grounding before drafting.** Every output that sounds like the user must be grounded in real recent activity, not abstracted from training data. There is always a mandatory "read your own notes" step before any drafting step.
- **Voice and anti-patterns as load-bearing config.** What you don't write matters more than what you do. Both are configurable, both get enforced verbatim.

## License

Each project is MIT-licensed. See the top-level [LICENSE](./LICENSE) file.

## Contributing

Issues and PRs welcome. If you fork a project and make it your own, I'd love to hear about it.

By [@till-hohmann](https://github.com/till-hohmann).
