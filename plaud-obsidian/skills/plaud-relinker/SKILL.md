---
name: plaud-relinker
description: >
  Finds plain-text mentions of note titles and aliases in the user's
  Obsidian vault and turns them into proper [[wikilinks]]. Respects
  frontmatter, code blocks, headings, and Dataview inline fields.
  Incremental by default — only scans files changed since the last
  successful run. Wraps the `plaud-relink` CLI. Use this skill whenever
  the user says "re-link my vault", "fix unlinked references", "find
  wikilinks I missed", "add brackets where I forgot them", or any
  variation of wanting plain-text mentions converted to wikilinks.
version: 0.1.0
---

# Plaud relinker

Thin wrapper around the `plaud-relink` CLI from the
[plaud-obsidian](https://github.com/till-hohmann/tinkering/tree/main/plaud-obsidian)
package. The CLI handles file walking, alias resolution, code-block
protection, and the state file. This skill drives the preview-confirm-apply
loop interactively.

---

## Step 1 — Locate the config

Same lookup as the ingester / templater skills.

The `relinker` config section controls behaviour: `state_file` (where
the incremental timestamp lives), `skip_prefixes` and `skip_exact`
(titles to never link), `protected_paths` (vault-relative file paths
the relinker will not modify), `min_title_length`, and `exclude_folders`.

---

## Step 2 — Run a dry-run

Default to incremental mode unless the user asks for a full scan.

```bash
plaud-relink --config <config-path> --dry-run
```

For a full re-scan:

```bash
plaud-relink --config <config-path> --dry-run --full
```

Show the user the diff verbatim. Each change line has the form:

```
L 12  [Anna Schmidt]
       - Original line text
       + Modified line text
```

Alias matches show as `[matched-text -> canonical-title]` so the user can
see when a bare "Anna" is collapsing to `[[Anna Schmidt]]`.

---

## Step 3 — Confirm and apply

Ask the user. Pay attention to any specific files they want to skip — if
they say "don't touch X.md", note that and either skip the file (omit it
from the run) or suggest the user add it to `relinker.protected_paths`
in config for permanent protection.

If the user approves the whole batch:

```bash
plaud-relink --config <config-path> --yes
```

If they want to skip a particular title everywhere, suggest they add it
to the state file's `skip_titles` array. If they want to skip a title in
just one file, suggest `skip_occurrences`. Both persist across runs.

---

## Step 4 — Report

Tell the user:

- How many files were modified, how many link insertions total.
- The scan mode (incremental vs. full) and the cutoff date if incremental.
- Whether the state file was stamped (it is, on a successful apply,
  unless `--no-stamp` was passed).

---

## Edge cases

- **Nothing to relink.** Just say "Vault is already fully linked" and
  stop. This is the common case for incremental runs.
- **A file has frontmatter that mentions a note title (e.g. `related:
  [[Name]]`).** The relinker skips frontmatter entirely. If the user
  wants frontmatter rewritten too, that's out of scope — direct them to
  edit manually.
- **An alias produces an unwanted match.** Tell the user how to either
  remove the alias from the source note's frontmatter, add the title to
  `skip_titles` in state, or use `skip_occurrences` for a single file.
