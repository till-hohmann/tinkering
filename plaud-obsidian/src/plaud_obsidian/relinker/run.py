"""Relinker orchestrator + CLI. Scans the vault (incremental by default,
full with --full), proposes link insertions, writes them on confirm."""

from __future__ import annotations

import argparse
import datetime as dt
import os
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Tuple

from ..common.config import Config, load_config
from ..common.vault import build_note_index, walk_md
from .linker import LinkChange, relink_file_text
from .state import load_state, save_state, stamp_last_run


@dataclass
class FileChange:
    rel_path: str
    abs_path: Path
    new_content: str
    changes: List[LinkChange]


@dataclass
class RelinkReport:
    mode: str
    files_scanned: int
    files_changed: List[FileChange] = field(default_factory=list)

    @property
    def total_changes(self) -> int:
        return sum(len(fc.changes) for fc in self.files_changed)


def _is_protected(rel_path: str, cfg: Config) -> bool:
    rel_norm = rel_path.replace("\\", "/")
    protected = {p.replace("\\", "/") for p in cfg.relinker.protected_paths}
    if rel_norm in protected:
        return True
    title = os.path.basename(rel_path)[:-3]
    if any(title.startswith(p) for p in cfg.relinker.skip_prefixes):
        return True
    # Also don't write into the templates note — its WIKILINK-RULES blocks
    # are owned by the templater.
    if cfg.templates_note and rel_norm == cfg.templates_note.replace("\\", "/"):
        return True
    return False


def _files_to_scan(
    cfg: Config, last_run_iso: str | None, full: bool,
) -> List[Tuple[str, Path]]:
    cutoff: dt.datetime | None = None
    if not full and last_run_iso:
        try:
            # Tolerate trailing 'Z'.
            iso = last_run_iso.rstrip("Z")
            cutoff = dt.datetime.fromisoformat(iso)
        except ValueError:
            cutoff = None

    out: List[Tuple[str, Path]] = []
    for rel_path, abs_path in walk_md(
        cfg.vault_root, exclude_folders=cfg.relinker.exclude_folders,
    ):
        if _is_protected(rel_path, cfg):
            continue
        if cutoff is not None:
            mtime = dt.datetime.utcfromtimestamp(abs_path.stat().st_mtime)
            if mtime <= cutoff:
                continue
        out.append((rel_path, abs_path))
    return out


def build_report(cfg: Config, *, full: bool = False) -> RelinkReport:
    state = load_state(cfg.vault_root / cfg.relinker.state_file)
    last_run_iso = state.get("last_run_iso")
    skip_state_titles = set(state.get("skip_titles") or [])
    skip_occurrences = state.get("skip_occurrences") or []

    note_index = build_note_index(
        cfg.vault_root, exclude_folders=cfg.relinker.exclude_folders,
    )
    notes = note_index.notes

    targets = _files_to_scan(cfg, last_run_iso, full)
    mode = "FULL" if full or not last_run_iso else f"INCREMENTAL since {last_run_iso[:10]}"

    changes: List[FileChange] = []
    for rel_path, abs_path in targets:
        try:
            content = abs_path.read_text(encoding="utf-8")
        except OSError:
            continue
        note_title = abs_path.stem
        new_content, file_changes = relink_file_text(
            content,
            note_title=note_title,
            rel_path=rel_path,
            notes=notes,
            skip_prefixes=cfg.relinker.skip_prefixes,
            skip_exact=set(cfg.relinker.skip_exact),
            skip_state_titles=skip_state_titles,
            skip_occurrences=skip_occurrences,
            min_title_length=cfg.relinker.min_title_length,
        )
        if file_changes:
            changes.append(FileChange(
                rel_path=rel_path,
                abs_path=abs_path,
                new_content=new_content,
                changes=file_changes,
            ))

    return RelinkReport(
        mode=mode,
        files_scanned=len(targets),
        files_changed=changes,
    )


def apply_report(cfg: Config, report: RelinkReport, *, stamp: bool = True) -> int:
    written = 0
    for fc in report.files_changed:
        fc.abs_path.write_text(fc.new_content, encoding="utf-8")
        written += 1
    if stamp and written:
        stamp_last_run(cfg.vault_root / cfg.relinker.state_file)
    return written


def _print_summary(report: RelinkReport, *, dry_run: bool) -> None:
    print(f"\nMode          : {report.mode}")
    print(f"Files scanned : {report.files_scanned}")
    verb = "Would modify" if dry_run else "Modified"
    print(
        f"{verb:<14}: {len(report.files_changed)} file(s), "
        f"{report.total_changes} link insertion(s)"
    )
    if not report.files_changed:
        return
    for fc in sorted(report.files_changed, key=lambda f: f.rel_path):
        print(f"\n  {fc.rel_path}  ({len(fc.changes)} change(s))")
        for ch in fc.changes:
            old = (ch.old_line[:100] + "...") if len(ch.old_line) > 100 else ch.old_line
            new = (ch.new_line[:100] + "...") if len(ch.new_line) > 100 else ch.new_line
            tag = ch.title if ch.matched_text == ch.title else f"{ch.matched_text} → {ch.title}"
            print(f"    L{ch.line_num:>4}  [{tag}]")
            print(f"          - {old}")
            print(f"          + {new}")


def main(argv: List[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="plaud-relink",
        description=(
            "Fix plain-text mentions of note titles in your Obsidian vault, "
            "turning them into [[wikilinks]]."
        ),
    )
    parser.add_argument(
        "--config", type=Path, default=Path("config.json"),
        help="Path to config.json (default: ./config.json).",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Preview changes without writing files.",
    )
    parser.add_argument(
        "--full", action="store_true",
        help="Scan every file (ignore the incremental state).",
    )
    parser.add_argument(
        "--yes", "-y", action="store_true",
        help="Skip the interactive confirmation prompt.",
    )
    parser.add_argument(
        "--no-stamp", action="store_true",
        help="Don't update the state file's last_run timestamp after apply.",
    )
    args = parser.parse_args(argv)

    if not args.config.exists():
        print(
            f"config not found: {args.config}\n"
            f"Copy config.example.json to config.json and edit it.",
            file=sys.stderr,
        )
        return 2

    cfg = load_config(args.config)
    report = build_report(cfg, full=args.full)
    _print_summary(report, dry_run=args.dry_run)

    if not report.files_changed:
        return 0
    if args.dry_run:
        print("\n(dry-run — no files were written)")
        return 0

    if not args.yes:
        try:
            ans = input("\nProceed with writing changes? [y/N] ").strip().lower()
        except EOFError:
            ans = ""
        if ans not in ("y", "yes"):
            print("Aborted.")
            return 1

    n = apply_report(cfg, report, stamp=not args.no_stamp)
    print(f"\nWrote {n} file(s).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
