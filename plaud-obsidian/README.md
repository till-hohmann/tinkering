# plaud-obsidian

A small, config-driven pipeline that turns Plaud voice recordings into
meaningful, properly-named, well-linked notes in an Obsidian vault. Stops
short of "another folder of `04-15 Meeting_ ...-Summary.md` files you'll
never find again."

This is the sanitised release of a stack I run on my own vault every day.
Voice and data placeholders where my own context used to be — the architecture
is what was actually battle-tested.

**Not a developer?** Start with [GETTING_STARTED.md](./GETTING_STARTED.md) —
it walks through the same setup using Claude Code or Cowork to do the work
for you.

## What it does

A typical Plaud summary lands in your staging folder looking like this:

```
04-15 1on1_ Anna Schmidt-Summary.md
```

After ingestion, it lives at:

```
ObsidianVault/10_Meetings/14_1on1/2026-04-15_1on1_Anna Schmidt.md
```

…with a clean, sortable filename, in the right subfolder, and on its way to
being properly linked into your knowledge graph. No more triage.

## The pipeline

This repo ships the **upper layers**:

- **Ingester** (`plaud-ingest`) — routes Plaud summaries into vault subfolders
  with clean, consistent filenames. Config-driven; no IR-specific routing
  knowledge baked in.
- **Templater** (`plaud-template-sync`) — keeps the wikilink-reference block
  of your Plaud-side templates in sync with your Obsidian indices, so the AI
  on the device knows the canonical link format for every person, company,
  and project you care about.
- **Graph hygiene** — `plaud-relink` finds plain-text mentions of note
  titles that should be `[[wikilinks]]` and fixes them. `plaud-graph-audit`
  is a read-only health check that surfaces wikilinks missing from your
  indices, stale index entries, concept candidates, and stale semantic
  notes.

The **bottom layer** is a separate repo:
[**plaud-api**](https://github.com/till-hohmann/plaud-api). It's a tiny Python
client that pulls AI-generated summaries from your Plaud account. Install and
configure it first; this repo runs on top of what it produces.

## Quick start

You'll need Python 3.9+, a Plaud account, and an Obsidian vault.

```bash
# 1. Get plaud-api running first — that pulls summaries from your account.
#    See: https://github.com/till-hohmann/plaud-api

# 2. Clone this repo.
git clone https://github.com/till-hohmann/tinkering.git
cd tinkering/plaud-obsidian

# 3. Install (zero third-party deps; pure stdlib).
pip install -e .

# 4. Make your config from the template, then edit it.
cp config.example.json config.json
# Open config.json — set paths.recordings_dir, paths.vault_root,
# and adjust the routing[] table to match how your vault is organised.

# 5. Dry run first — preview what would happen.
plaud-ingest --config config.json --dry-run

# 6. Looks right? Run it for real.
plaud-ingest --config config.json
```

## Config

One file, `config.json`. Copy from `config.example.json` and edit:

| Section | What it controls |
|---|---|
| `paths` | Where your Plaud staging folder is, where your vault is, what subfolder to use for unroutable files. |
| `fields` | Frontmatter field names this tool reads (`type`, `participant`, `meeting_title`, `date`). Change if your Plaud templates use different names. |
| `routing` | The whole story for the ingester. Each entry maps a `type` value in the frontmatter to a vault folder, a filename prefix, and a naming style. First match wins. Unknown `type` → inbox. |
| `naming` | Knobs for the short-title rule (max words, stopwords to strip). |
| `self_participant_names` | Names that count as "you" in a 1-on-1, so the *other* participant ends up in the filename. |
| `indices` | List of `{id, path}` entries pointing at your Obsidian index files. The templater reads these. Paths are vault-relative. |
| `templates_note` | Vault-relative path to the markdown note that holds your Plaud-side templates. The templater rewrites only the content between `<!-- WIKILINK-RULES:<id> -->` markers. |
| `templates` | List of `{id, include: [{index, categories}]}` entries. Each one says how to populate the matching marker block. `categories` is either `"*"` (all H2 sections from that index) or a list of section names. |
| `corrections` | Optional list of `{from, to}` find/replace pairs applied to every rendered template block. |
| `relinker` | Knobs for the relinker. `state_file`, `skip_prefixes`/`skip_exact`/`protected_paths` (titles or paths to leave alone), `min_title_length`, `exclude_folders`. |
| `graph_audit` | Knobs for the audit. `semantic_folders` (folders containing concept notes for the stale-note check), `exclude_folders`, `min_phrase_count`, `max_stale_backlinks`, `min_stale_age_days`. |

Four naming styles are supported per route:

- `one_on_one` → `YYYY-MM-DD_<prefix>_<Participant>.md`
- `titled` → `YYYY-MM-DD_<prefix>_<Short Title>.md`
- `journal` → `YYYY-MM-DD_Journal.md` (one per day; numbered if multiple)
- `inbox` → `YYYY-MM-DD_Inbox_<Short Title>.md` (parking lot for the unroutable)

## Templater: keep your wikilinks in sync

The `plaud-template-sync` command rewrites the wikilink-reference block of
your Plaud-side templates from your Obsidian indices. The flow:

1. You keep all your Plaud transcription templates in one vault note (set
   `templates_note` in config — default `_Meta/PlaudTemplates.md`).
2. Each template has a `<!-- WIKILINK-RULES:<id> --> ... <!-- /WIKILINK-RULES:<id> -->`
   marker pair. The templater only rewrites the content between markers; the
   rest of the note is yours.
3. Each `id` matches a `templates[].id` in `config.json`, which says which
   indices and which categories to pull from. Categories are H2 headings in
   your index files.

```bash
plaud-template-sync --config config.json --dry-run    # see what would change
plaud-template-sync --config config.json              # rewrite the note
```

When you copy the templates note's contents to your Plaud account, the AI
on the device knows the canonical wikilink form for every entity in your
indices. Add a new person to your People Index, re-run the templater, and
the next Plaud summary will link them correctly.

The templater warns about:
- Configured template ids that have no matching marker in the templates note
  (you forgot to add the markers).
- Marker blocks whose id doesn't match any template config (left untouched,
  surfaced for review).
- `categories` entries in config that don't match any H2 section in the
  referenced index file (typo catcher — lists the available categories).

Optional `corrections` block in config applies find/replace pairs to every
rendered block — useful for normalising names that appear inconsistently
across your indices (e.g. `[[ACME]]` → `[[Acme Corp]]`).

## Relinker: fix unlinked mentions

The `plaud-relink` command finds plain-text mentions of note titles (and
their aliases) and converts them into `[[wikilinks]]`. Word-boundary
matching prevents partial-word false positives. Inline backticks, fenced
code blocks, headings, Dataview inline fields, and YAML frontmatter are all
protected — the relinker only touches body prose.

```bash
plaud-relink --config config.json --dry-run    # preview
plaud-relink --config config.json              # write
plaud-relink --config config.json --full       # ignore the incremental state
```

By default it runs incrementally — only files modified since the last
successful apply are scanned. A state file (`_Meta/.relinker-state.json` by
default) tracks the last-run timestamp plus optional skip rules: titles to
never link anywhere, or `(file, title)` pairs to skip in just one note.

The relinker reads `aliases:` from YAML frontmatter. If `Anna Schmidt.md`
declares `aliases: [Anna]`, then a plain-text mention of "Anna" elsewhere
becomes `[[Anna Schmidt]]` — the canonical target, not the alias. Use
`aliases: [[Other Name]]` to point at a wikilink-shaped alias; both forms
parse correctly.

Files protected by config (`relinker.protected_paths`), the templates note,
and notes whose titles start with a configured `skip_prefix` (`TPL `,
`Dashboard ` by default) are skipped automatically.

## Graph audit: read-only health check

The `plaud-graph-audit` command runs four analyses and prints them. Nothing
is written to the vault; the output is meant to drive a manual review
(or, for the skill-bundle users, an AI-assisted one).

```bash
plaud-graph-audit --config config.json              # human report
plaud-graph-audit --config config.json --json       # machine-readable
```

The four analyses, each skippable with a `--no-<name>` flag:

1. **Wikilinks missing from indices.** Targets referenced anywhere in the
   vault that aren't listed under any configured index. The fastest signal
   that an index has fallen behind.
2. **Index entries with no inbound reference.** The flip side: names in an
   index that no note actually links to. Could mean a person/project has
   gone quiet, or that the index entry was wrong to begin with.
3. **Concept candidates.** Broken wikilinks (explicit intent — someone
   linked to a note that doesn't exist) plus recurring multi-word
   Title-Case phrases that appear in N+ notes without their own note.
   Leading articles are normalised away so "The Acme Migration" and "Acme
   Migration" count as the same phrase.
4. **Stale notes.** Notes in your configured `semantic_folders` (e.g.
   `People/`, `Projects/`) with at most `max_stale_backlinks` references
   and no modification in the last `min_stale_age_days`. The vault's
   way of asking "do you still need this?"

## Inbox fallback

Any file that hits the ingester without a recognised `type`, or with an
unfilled `{{...}}` placeholder where a required field should be, gets parked
in `<vault>/<inbox_folder>/` with a `_Inbox_` filename. The principle is that
unroutable files should never sit invisible in the staging folder. They land
in the vault, they get a name, you triage them on your own time.

## State and idempotency

The ingester writes `.plaud_ingested.json` to your recordings folder. Each
entry records the source filename, the new vault filename, the target folder,
and a UTC timestamp. Re-running the ingester is cheap and safe — files
already in the log are skipped silently. If you ever need to re-process a
file, delete its entry from the log.

If a target filename already exists in the vault (either on disk or
elsewhere in the same run's plan), the new file gets `_2`, `_3`, … appended
to the stem.

## Architecture principles

These are the patterns from the [top-level tinkering
README](../README.md#philosophy) that this project specifically applies:

- **Chat fetches, artifact displays.** Doesn't apply here — this is a CLI.
  But the optional skill bundles in `skills/` follow the same separation:
  the skill is a thin wrapper, the CLI does the work.
- **Grounding before drafting.** The templater (Phase B) reads your real
  indices before regenerating any wikilink-rules block. You don't tell it
  about your people; it discovers them.
- **Config is load-bearing.** What gets routed where is your decision, not
  the tool's. The IR-flavoured `config.example.json` in this repo is one
  shape; yours might look completely different.

## What's intentionally not here

- **No Plaud account sync.** That's [plaud-api](https://github.com/till-hohmann/plaud-api).
- **No automatic upload to a cloud notes service.** This tool writes files
  to a folder on your disk. What syncs them to other devices is Obsidian's
  problem (or your file-sync service of choice).
- **No transcription editing or post-processing.** The summary that Plaud
  generates is the summary that lands in your vault. Cleanup is a separate
  problem.
- **No vendor lock-in.** Strip the routing config and the same pipeline
  works for any markdown-frontmatter input, not just Plaud. The Plaud-specific
  bits are the filename-prefix conventions and the field names — both
  configurable.

## License

MIT. See the top-level [LICENSE](../LICENSE).

## Status

Personal use. No CI. Endpoints in the underlying plaud-api will probably
break before this tool will. PRs welcome if you fork it and make it your own.
