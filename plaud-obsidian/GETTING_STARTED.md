# Getting started

A walkthrough for non-developers. You'll have new Plaud recordings flowing
into the right folders of your Obsidian vault in about 30 minutes — most of
which is one-time setup.

If you're comfortable with a terminal, skip this and read the
[README](./README.md) instead.

## What you need

- A Plaud account, used at least once via [app.plaud.ai](https://app.plaud.ai).
- An Obsidian vault on your computer.
- Python 3.9 or newer. If you're on Mac, you already have it. On Windows,
  install it from [python.org](https://www.python.org/downloads/) — make sure
  to tick "Add Python to PATH" during install.
- A terminal. On Mac it's called Terminal; on Windows it's PowerShell. You'll
  paste commands into it.
- Optional but recommended: [Claude Code](https://docs.claude.com/en/docs/claude-code/overview)
  or [Cowork](https://docs.claude.com) — they can do almost all of the steps
  below for you. Skill bundles for both are in the `skills/` folder.

## Step 1 — Get plaud-api working

The Plaud account-sync layer lives in a separate repository because it's
useful by itself, independent of Obsidian.

Go to **[github.com/till-hohmann/plaud-api](https://github.com/till-hohmann/plaud-api)**
and follow the README there. You'll end up with:

- A folder somewhere on your disk that holds your downloaded Plaud summaries.
- A `.plaud_config.json` file inside that folder with your session token.
- The ability to run `python sync_plaud.py` and pull new recordings into that
  folder.

**Don't continue until that works.** This tool runs on top of what plaud-api
produces.

## Step 2 — Clone this repo

In your terminal:

```bash
git clone https://github.com/till-hohmann/tinkering.git
cd tinkering/plaud-obsidian
pip install -e .
```

The `pip install -e .` step installs a command called `plaud-ingest` that
you'll use in step 4.

## Step 3 — Make a config

```bash
cp config.example.json config.json
```

Open `config.json` in any text editor and edit four things:

1. **`paths.recordings_dir`** — set to the folder where your Plaud summaries
   land (the one you set up with plaud-api in step 1).
2. **`paths.vault_root`** — set to your Obsidian vault root.
3. **`paths.inbox_folder`** — leave as `"00_Inbox"` unless your vault uses
   a different parking-lot folder. The ingester will create this folder if it
   doesn't exist.
4. **`routing`** — this is the heart of it. Each entry says "when a Plaud
   summary has `type: X` in its frontmatter, send it to this vault folder
   with this filename prefix." The example file ships with three routes
   (`1on1`, `general`, `journal`); add or change them to match how your
   vault is organised.

If you're not sure what to put in `routing`, leave the defaults and try a
dry run — see what lands where, then adjust.

## Step 4 — Try a dry run

This previews what would happen without touching any files:

```bash
plaud-ingest --config config.json --dry-run
```

You should see a table like:

```
New Plaud recordings to ingest (3 files):

  #  Original filename                  New name                              Folder / reason
----------------------------------------------------------------------------------------------------
  1  04-15 1on1_ Alex-Summary.md        2026-04-15_1on1_Alex.md               10_Meetings/14_1on1  (routed via type '1on1')
  2  04-16 Meeting_ Board-Summary.md    2026-04-16_GEN_Board.md               10_Meetings/11_General  (routed via type 'general')
  3  04-17 Journal-Summary.md           2026-04-17_Journal.md                 20_Journal  (routed via type 'journal')
```

If the new names and folders look right, you're ready.

If something lands in the inbox you didn't expect, it usually means the
file's frontmatter doesn't have a `type` field, or the `type` value isn't in
your `routing` table. Open the file in the recordings folder and check.

## Step 5 — Run it for real

```bash
plaud-ingest --config config.json
```

You'll see the same preview, then a `Proceed with ingestion? [y/N]` prompt.
Type `y`. Each summary is copied into the right vault folder, an ingestion
log entry is appended, and the source file in the recordings folder is
deleted (so the next run only sees new files).

Want to keep the source files in the recordings folder? Add `--keep-sources`.

Want to skip the confirmation prompt (for automation)? Add `--yes`.

## Step 6 — Make it a habit

Run `plaud-ingest` whenever you've recorded new things. Pair it with the
`sync_plaud.py` script from plaud-api and you have a two-command workflow:

```bash
python /path/to/plaud-api/sync_plaud.py
plaud-ingest --config /path/to/your/config.json --yes
```

Drop both into a shell script (or a Windows batch file) and now it's a
one-command workflow. You're done.

## Doing it with Claude Code or Cowork

If you'd rather not run commands at all: this repo ships skill bundles in
`skills/`. Install them into Claude Code or Cowork, then say *"ingest my
Plaud recordings"* and the assistant will run the same pipeline against your
own config. The skills are thin wrappers around `plaud-ingest` — no separate
implementation, no second source of truth.

(Phase B and C of this stack add a wikilink templater and graph-hygiene
tools. Same idea: a CLI, a skill bundle, you choose which surface you want.)

## Things that can go wrong

| Symptom | What it usually means |
|---|---|
| `config not found: config.json` | You're running from the wrong folder, or you forgot to copy `config.example.json` to `config.json`. |
| Everything ends up in the inbox | Your Plaud templates aren't writing a `type` field into frontmatter, or the values they write don't match anything in your `routing` table. Check one of the source files. |
| A specific file is skipped with `target already exists` | Should be rare — the planner auto-suffixes. If it happens, a parallel process touched the vault during the run. Re-run. |
| `Operation not permitted` on the source delete | OS-level permission problem on the recordings folder. Try `--keep-sources` and clean up manually. |
| Tests fail with weird recursion errors | You're running pytest with `tmp_path` on a network-mounted folder. Set `TMPDIR=/tmp` (or a local path) and try again. |

If you hit something not in this table, open an issue on the repo with the
command you ran, the output, and your `config.json` (with the paths
redacted if you want).
