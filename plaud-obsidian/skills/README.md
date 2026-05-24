# Skills

Four Claude Code / Cowork skills that wrap the plaud-obsidian CLIs with
an interactive layer. Each skill is a thin orchestrator — the CLIs do
the work, the skill handles the preview-confirm-apply loop and (for the
graph audit) the AI-assisted classification step.

## What's here

| Skill | Wraps | What it adds |
|---|---|---|
| [plaud-ingester](./plaud-ingester) | `plaud-ingest` | Interactive preview + confirmation + report |
| [plaud-templater](./plaud-templater) | `plaud-template-sync` | Interactive preview, surfacing of typo warnings |
| [plaud-relinker](./plaud-relinker) | `plaud-relink` | Diff preview with alias arrows, skip-rule guidance |
| [plaud-graph-audit](./plaud-graph-audit) | `plaud-graph-audit --json` | **AI-assisted classification of concept candidates into the right index, propose-and-approve index updates** |

The first three are mostly thin. The fourth is the value-add — the CLI
can detect concept candidates but can't decide which index they belong
in. The skill does that classification, proposes additions for review,
and writes approved entries to the index files.

## Installing

Each subfolder is a self-contained Claude Code skill. Copy whichever
ones you want into your skills directory:

```bash
# Claude Code default
cp -r plaud-ingester ~/.claude/skills/

# Or symlink so updates from a git pull flow through automatically:
ln -s "$(pwd)/plaud-ingester" ~/.claude/skills/plaud-ingester
```

If you're on Windows the path is `%USERPROFILE%\.claude\skills\`.

Restart Claude Code (or your Cowork client) and the skills should appear
in the available-skills list.

## Prerequisites

All four skills assume:

1. The `plaud-obsidian` CLIs are installed (`pip install -e .` from the
   parent folder, or `pip install plaud-obsidian` if a release exists).
2. You have a `config.json` somewhere on your machine. The skills look
   for it in the cwd, then `~/.config/plaud-obsidian/config.json`, then
   inside your vault.
3. For `plaud-ingester`, you also need `plaud-api` set up — see the
   [main README](../README.md) for the full bootstrap.

## Customising

The SKILL.md frontmatter `description` field is what Claude uses to decide
when to trigger the skill. If the default trigger phrasing doesn't match
how you talk about these tools (e.g. you say "tidy my vault" instead of
"audit my vault"), edit the `description` to include your phrasing.

The body of each SKILL.md is the prompt Claude follows when invoked. Edit
freely if you want different behaviour — e.g. always run in full-scan
mode instead of incremental, or skip the interactive confirmation step
for a fully-automated workflow.

## License

MIT, same as the rest of the repo. See [LICENSE](../../LICENSE).
