---
name: plaud-graph-audit
description: >
  Runs a vault health audit and helps the user act on the findings. The
  underlying CLI produces structured JSON for four signals (wikilinks
  missing from indices, stale index entries, concept candidates, stale
  notes). This skill classifies the concept candidates into the right
  index, proposes index additions for user review, and writes approved
  entries to the index files. The CLI alone is read-only; this skill
  adds the AI-assisted classification + index-update step. Use whenever
  the user says "audit my vault", "what needs cleanup", "update the
  indices", "find concepts I should add to the index", "run the graph
  hygiene check", or any variation of wanting a vault health review.
version: 0.1.0
---

# Plaud graph audit

Wraps the `plaud-graph-audit` CLI from the
[plaud-obsidian](https://github.com/till-hohmann/tinkering/tree/main/plaud-obsidian)
package and adds the AI-assisted classification layer the pure CLI can't
provide. The CLI surfaces what's wrong; this skill helps fix it.

---

## Step 1 — Locate the config

Same lookup as the other plaud-obsidian skills.

Make sure the `indices` and `graph_audit` config sections are populated.
If `indices` is empty the audit can still find concept candidates and
stale notes but can't compute missing-from-indices.

---

## Step 2 — Run the audit (JSON mode)

```bash
plaud-graph-audit --config <config-path> --json
```

Parse the JSON output. Top-level keys: `note_count`,
`missing_from_indices`, `stale_in_indices`, `concept_candidates`,
`stale_notes`.

---

## Step 3 — Present the findings

Show the user a compact summary first — counts only — and then offer to
walk through each section in detail. Don't dump 200 candidates at once.

For each section the user wants to act on:

### Missing from indices

For each entry, propose which index it most likely belongs in (based on
the entry name and the folders the sample files live in). Group your
proposals by target index:

```
People Index (N additions):
  [[Name]] - one-line context from a sample file
  ...

Companies Index (N additions):
  [[Name]] - one-line context
  ...
```

Ask the user which to add. For approved entries, append them to the
matching index file under the most relevant H2 section. If no section
fits, add a new `## Other` section or ask the user where to file them.

### Stale in indices

These need a human judgement call — could be inactive contacts, expired
projects, or just typos. List them grouped by index and ask the user
which to remove. Don't auto-remove — that's destructive.

### Concept candidates

Combine broken-wikilink and recurring-phrase signals. For each candidate
worth surfacing, propose either:
- A new note (if the user wants to track it as a concept), OR
- An index entry only (if it's just a name/term that should be canonical
  but doesn't need its own page yet), OR
- An alias on an existing note (if the candidate looks like a variant
  of something that already exists).

Ask the user which path they want for each.

### Stale notes

For each stale note, show title + last-modified + backlink count + path.
Ask whether to archive, delete, or leave. Don't act without explicit
confirmation — these are concept notes the user wrote at some point.

---

## Step 4 — Apply approved changes

For index additions: edit the relevant index file in place. Add new
entries to the matching H2 section using the existing format in that
file (usually `- [[Name]] - description`). Preserve all other content.

For new alias additions: edit the target note's frontmatter to extend
the `aliases` array.

For new notes: create the file with minimal frontmatter and a placeholder
body the user can flesh out.

Don't touch the templates note from this skill — that's the templater's
job. After adding new entries to indices, suggest the user run the
`plaud-templater` skill so the new entries propagate to their Plaud
templates.

---

## Step 5 — Report

Tell the user:

- How many entries were added to each index.
- Any new notes that were created (link to them).
- Anything they declined that's still pending — so they can come back.

Then offer to run `plaud-templater` if any people / companies / projects
were added.

---

## Edge cases

- **Nothing to report.** Just say "Vault looks healthy — no signals from
  the audit." and stop.
- **User wants to skip the classification step.** Just print the raw
  human-readable audit (run without `--json` and pipe to the user).
- **An index file uses a non-standard format.** Read the file, match its
  existing convention rather than imposing the default `- [[Name]] -
  description` shape.
