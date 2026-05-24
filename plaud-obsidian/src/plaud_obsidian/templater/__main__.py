"""CLI for the templater. `python -m plaud_obsidian.templater [args]`."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import List

from ..common.config import load_config
from .run import build_report, write_report


def _print_summary(report) -> None:
    print(f"\nTemplates note: {report.templates_note_path}")
    print(f"Marker blocks found: {len(report.changes) + len(report.unmatched_blocks)}")
    if report.changes:
        print(f"\nRebuilt {len(report.changes)} block(s):")
        for c in report.changes:
            tag = "(changed)" if c.changed else "(unchanged)"
            print(f"  {c.template_id:<24}  {c.wikilink_count:>3} wikilinks  {tag}")
    if report.unmatched_blocks:
        print(
            f"\nFound marker blocks with no matching template in config "
            f"(left untouched): {report.unmatched_blocks}"
        )
    if report.unused_template_specs:
        print(
            f"\nConfigured templates with no matching marker block in the "
            f"templates note (skipped): {report.unused_template_specs}"
        )
    if report.warnings:
        print(f"\nWarnings ({len(report.warnings)}):")
        for w in report.warnings:
            print(f"  - {w}")


def main(argv: List[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="plaud-template-sync",
        description=(
            "Rewrite the wikilink-rules blocks of your Plaud templates note "
            "from your Obsidian indices."
        ),
    )
    parser.add_argument(
        "--config", type=Path, default=Path("config.json"),
        help="Path to config.json (default: ./config.json).",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Print the summary, don't write.",
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
    try:
        report = build_report(cfg)
    except (FileNotFoundError, ValueError) as e:
        print(f"templater error: {e}", file=sys.stderr)
        return 1

    _print_summary(report)

    if args.dry_run:
        print("\n(dry-run — templates note was not written)")
        return 0

    wrote = write_report(report)
    if wrote:
        print(f"\nWrote {report.templates_note_path}.")
    else:
        print("\nNo changes — templates note already up to date.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
