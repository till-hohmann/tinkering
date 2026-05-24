---
name: plaud-ingester
description: >
  Ingests Plaud voice-recording summary files from the user's staging folder
  into their Obsidian vault. Renames files to clean YYYY-MM-DD prefixed
  titles, routes them to the right subfolder based on each file's frontmatter
  type, and parks unroutable files in an inbox folder so they don't sit
  invisible. Wraps the `plaud-ingest` CLI from the plaud-obsidian package.
  Use this skill whenever the user says "ingest my Plaud recordings",
  "process new summaries", "sync Plaud to Obsidian", "move recordings to
  the vault", "run the Plaud ingestion", or any variation of wanting to
  get Plaud transcription files into an Obsidian vault.
version: 0.1.0
---

# Plaud ingester

Thin wrapper around the `plaud-ingest` CLI shipped with the
[plaud-obsidian](https://github.com/till-hohmann/tinkering/tree/main/plaud-obsidian)
package. The CLI does all the work; this skill resolves the config path,
runs a preview, and handles the confirmation step interactively.

---

## Step 1 — Locate the config

The user keeps a `config.json` somewhere on their disk that points at their
recordings folder and their Obsidian vault. Common locations to check, in
order:

1. The current working directory.
2. `~/.config/plaud-obsidian/config.json`.
3. The vault root (e.g. `~/ObsidianVault/.plaud-obsidian/config.json`).
4. A path the user has set in a previous session.

If none exist, tell the user to `cp config.example.json config.json` in
their plaud-obsidian clone and edit it. Don't proceed without a config.

---

## Step 2 — Run a dry-run preview

Always preview first. Run:

```bash
plaud-ingest --config <config-path> --dry-run
```

Show the user the resulting table verbatim. The columns are:
original filename, new name, target folder, routing reason.

---

## Step 3 — Confirm and apply

Ask the user: *"Proceed with ingestion?"* If they say yes (or "go", "do it",
"yes", "y", etc.), run the real ingestion:

```bash
plaud-ingest --config <config-path> --yes
```

The `--yes` flag skips the CLI's own interactive prompt since the user
already confirmed.

---

## Step 4 — Report

Summarise what happened: how many files were ingested by folder, anything
that landed in the inbox (call those out so the user can triage them), any
failures.

If files landed in the inbox folder, briefly explain why (missing `type`
field in frontmatter, unfilled placeholder, etc.) and suggest the user
either fix the Plaud template that produced them or move the inbox files
manually.

---

## Edge cases

- **No new files.** Just say "No new Plaud recordings found." and stop.
- **CLI not installed.** Tell the user to run `pip install -e .` in the
  plaud-obsidian repo, or `pip install plaud-obsidian` if a release is
  available.
- **Source-delete failure (e.g. permission denied).** The CLI handles this
  gracefully and leaves the source files in place. Re-running is safe;
  the state file prevents re-processing.
