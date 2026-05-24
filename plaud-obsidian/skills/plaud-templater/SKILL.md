---
name: plaud-templater
description: >
  Rewrites the wikilink-rules block of the user's Plaud transcription
  templates with current canonical wikilinks from their Obsidian indices.
  The Plaud device's AI uses those templates as system prompts when
  generating summaries, so keeping them in sync means new summaries link
  to people, companies, and projects correctly. Wraps the
  `plaud-template-sync` CLI. Use this skill whenever the user says
  "update my Plaud templates", "sync the templates", "refresh the
  wikilink rules", "regenerate the template references", or any variation
  of wanting their Plaud-side templates to reflect the latest state of
  their indices.
version: 0.1.0
---

# Plaud templater

Thin wrapper around the `plaud-template-sync` CLI from the
[plaud-obsidian](https://github.com/till-hohmann/tinkering/tree/main/plaud-obsidian)
package. The CLI reads the user's indices and rewrites the content
between `<!-- WIKILINK-RULES:id --> ... <!-- /WIKILINK-RULES:id -->`
marker pairs in the templates note. Everything outside the markers is
left alone.

---

## Step 1 — Locate the config

Find the user's `config.json` (same lookup order as the ingester skill).
If not found, prompt the user to copy `config.example.json` and edit it.

The config sections relevant here are `indices`, `templates_note`, and
`templates`. If any are missing or empty, the templater will error
clearly — surface that to the user verbatim.

---

## Step 2 — Run a dry-run preview

```bash
plaud-template-sync --config <config-path> --dry-run
```

Show the user the summary. Per template block, it reports the wikilink
count and whether the block content changed.

If the report includes warnings (typos in `categories` entries, marker
blocks with no matching config, configured templates with no marker in
the note), surface them all — they're how the user catches typos.

---

## Step 3 — Apply

If the dry-run shows changes the user is happy with, run for real:

```bash
plaud-template-sync --config <config-path>
```

The templates note gets rewritten in place. The next time the user copies
their templates to the Plaud device, the new wikilink rules are active.

---

## Step 4 — Report

Tell the user:

- How many template blocks were rewritten.
- The total wikilink count in each block.
- Any warnings the dry-run surfaced (typos, orphan markers, unused config).
- The full path to the templates note that was rewritten.

If no changes were needed (idempotent re-run), say so plainly.

---

## Edge cases

- **Templates note doesn't exist.** Tell the user to create it. The skill
  shouldn't try to scaffold one — the templates are the user's content.
- **No markers in the templates note.** The CLI reports zero changes and
  lists all configured template ids as "unused". Surface that — the user
  forgot to add the marker pairs.
- **Index file missing.** The CLI treats it as empty. Tell the user the
  index path in their config doesn't point at a real file.
