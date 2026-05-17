# tinkering

Small AI-assisted operator tools, released as I build them. Each subfolder is a self-contained project with its own README, license, and setup instructions.

## What's here

- **[linkedin-engagement-console](./linkedin-engagement-console/)**. Daily LinkedIn engagement console. Pulls feed + peer-company posts via an MCP server, drafts comments grounded in your own recent activity, surfaces profiles to engage with, proposes own-content angles. Renders as a single self-contained HTML page in LinkedIn brand colors. **Not a developer?** Start with the [step-by-step getting-started guide](./linkedin-engagement-console/GETTING_STARTED.md).

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
