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

- **Ingester** — routes Plaud summaries into vault subfolders with clean,
  consistent filenames. Config-driven; no IR-specific routing knowledge baked
  in. *(Phase A — this commit.)*
- **Templater** *(Phase B, coming next)* — keeps the wikilink-reference block
  of your Plaud-side templates in sync with your Obsidian indices, so the AI
  on the device knows the canonical link format for every person, company,
  and project you care about.
- **Graph hygiene** *(Phase C, coming next)* — finds plain-text mentions of
  notes that should be wikilinks, and surfaces wikilinks not yet in any
  index.

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
| `routing` | The whole story. Each entry maps a `type` value in the frontmatter to a vault folder, a filename prefix, and a naming style. First match wins. Unknown `type` → inbox. |
| `naming` | Knobs for the short-title rule (max words, stopwords to strip). |
| `self_participant_names` | Names that count as "you" in a 1-on-1, so the *other* participant ends up in the filename. |

Four naming styles are supported per route:

- `one_on_one` → `YYYY-MM-DD_<prefix>_<Participant>.md`
- `titled` → `YYYY-MM-DD_<prefix>_<Short Title>.md`
- `journal` → `YYYY-MM-DD_Journal.md` (one per day; numbered if multiple)
- `inbox` → `YYYY-MM-DD_Inbox_<Short Title>.md` (parking lot for the unroutable)

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
