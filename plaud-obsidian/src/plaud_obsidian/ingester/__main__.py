"""CLI entry point. `python -m plaud_obsidian.ingester [args]`.

The skill bundle for Claude Code / Cowork users invokes the same entry point;
all interactive logic (preview, confirmation) lives here so both surfaces
behave identically."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import List

from ..common.config import Config, load_config
from .log import already_ingested, load_state
from .plan import PlanEntry, build_plan
from .run import execute_plan


def _find_new_sources(cfg: Config) -> List[Path]:
    if not cfg.recordings_dir.exists():
        raise SystemExit(
            f"recordings directory does not exist: {cfg.recordings_dir}\n"
            f"Create it, or fix paths.recordings_dir in your config."
        )
    state = load_state(cfg.recordings_dir)
    done = already_ingested(state)
    candidates = sorted(p for p in cfg.recordings_dir.glob("*.md"))
    return [p for p in candidates if p.name not in done]


def _print_preview(plan: List[PlanEntry]) -> None:
    if not plan:
        print("No new Plaud recordings found.")
        return
    print(f"\nNew Plaud recordings to ingest ({len(plan)} files):\n")
    width_src = max(len(e.source_filename) for e in plan)
    width_dst = max(len(e.target_filename) for e in plan)
    header = (
        f"{'#':>3}  {'Original filename':<{width_src}}  "
        f"{'New name':<{width_dst}}  Folder / reason"
    )
    print(header)
    print("-" * len(header))
    for i, e in enumerate(plan, start=1):
        print(
            f"{i:>3}  {e.source_filename:<{width_src}}  "
            f"{e.target_filename:<{width_dst}}  {e.target_folder}  ({e.reason})"
        )
    print()


def _confirm() -> bool:
    try:
        ans = input("Proceed with ingestion? [y/N] ").strip().lower()
    except EOFError:
        return False
    return ans in ("y", "yes")


def main(argv: List[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="plaud-ingest",
        description="Ingest Plaud summary files into an Obsidian vault.",
    )
    parser.add_argument(
        "--config", type=Path, default=Path("config.json"),
        help="Path to config.json (default: ./config.json).",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Build and print the plan, but don't touch any files.",
    )
    parser.add_argument(
        "--yes", "-y", action="store_true",
        help="Skip the interactive confirmation prompt.",
    )
    parser.add_argument(
        "--keep-sources", action="store_true",
        help="Don't delete source files after a successful copy.",
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
    new_sources = _find_new_sources(cfg)
    plan = build_plan(new_sources, cfg)

    _print_preview(plan)
    if not plan:
        return 0
    if args.dry_run:
        print("(dry-run — no files were touched)")
        return 0
    if not args.yes and not _confirm():
        print("Aborted.")
        return 1

    result = execute_plan(
        plan, cfg, delete_sources=not args.keep_sources,
    )

    print(f"\nIngested {len(result.copied)} file(s).")
    by_folder: dict = {}
    for e in result.copied:
        by_folder.setdefault(e.target_folder, 0)
        by_folder[e.target_folder] += 1
    for folder in sorted(by_folder):
        print(f"  {by_folder[folder]:>3}  {folder}")
    if result.skipped:
        print(f"\nSkipped {len(result.skipped)}:")
        for entry, reason in result.skipped:
            print(f"  - {entry.source_filename}: {reason}")
    if result.delete_failed:
        print(f"\nSource files left in place ({len(result.delete_failed)}):")
        for entry, reason in result.delete_failed:
            print(f"  - {entry.source_filename}: {reason}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
