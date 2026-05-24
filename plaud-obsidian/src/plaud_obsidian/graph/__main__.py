"""CLI for plaud-graph-audit. Read-only vault health check."""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict
from pathlib import Path
from typing import List

from ..common.config import load_config
from .audit import (
    AuditReport,
    build_audit_report,
)


def _print_human(report: AuditReport) -> None:
    print(f"\nNotes indexed: {len(report.note_index.notes)}")

    if report.missing_from_indices:
        print(
            f"\n── Wikilinks referenced in the vault but not in any index "
            f"({len(report.missing_from_indices)}) ──"
        )
        for i, e in enumerate(report.missing_from_indices, 1):
            print(f"  [{i:>3}] [[{e.name}]]  — referenced in {e.reference_count} note(s)")
            for f in e.sample_files:
                print(f"          - {f}")

    if report.stale_in_indices:
        print(
            f"\n── Index entries with no inbound reference "
            f"({len(report.stale_in_indices)}) ──"
        )
        by_index: dict = {}
        for e in report.stale_in_indices:
            by_index.setdefault(e.index_id, []).append(e)
        for idx_id, entries in sorted(by_index.items()):
            print(f"  {idx_id} ({len(entries)}):")
            for e in entries:
                print(f"    - [[{e.name}]]  ({e.index_path})")

    if report.concept_candidates:
        print(
            f"\n── Concept candidates  "
            f"({len(report.concept_candidates)}) ──"
        )
        for i, c in enumerate(report.concept_candidates, 1):
            srcs = ", ".join(c.sources)
            print(f"  [{i:>3}] {c.name}  — in {c.file_count} note(s)  [{srcs}]")
            for f in c.sample_files:
                print(f"          - {f}")

    if report.stale_notes:
        print(f"\n── Stale notes  ({len(report.stale_notes)}) ──")
        for i, s in enumerate(report.stale_notes, 1):
            bl = "no backlinks" if s.backlink_count == 0 else (
                f"{s.backlink_count} backlink"
                f"{'s' if s.backlink_count != 1 else ''}"
            )
            print(f"  [{i:>3}] {s.title}")
            print(
                f"          {bl}  |  last modified {s.last_modified_iso} "
                f"({s.age_days} days ago)"
            )
            print(f"          {s.rel_path}")

    if (
        not report.missing_from_indices
        and not report.stale_in_indices
        and not report.concept_candidates
        and not report.stale_notes
    ):
        print("\nNothing to report — the vault looks healthy.")


def _to_dict(report: AuditReport) -> dict:
    return {
        "note_count": len(report.note_index.notes),
        "missing_from_indices": [asdict(e) for e in report.missing_from_indices],
        "stale_in_indices": [asdict(e) for e in report.stale_in_indices],
        "concept_candidates": [asdict(c) for c in report.concept_candidates],
        "stale_notes": [asdict(s) for s in report.stale_notes],
    }


def main(argv: List[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="plaud-graph-audit",
        description=(
            "Read-only health check on an Obsidian vault. Surfaces "
            "wikilinks missing from indices, stale index entries, concept "
            "candidates, and stale semantic notes."
        ),
    )
    parser.add_argument(
        "--config", type=Path, default=Path("config.json"),
        help="Path to config.json (default: ./config.json).",
    )
    parser.add_argument(
        "--json", action="store_true",
        help="Emit machine-readable JSON instead of the human report.",
    )
    parser.add_argument(
        "--no-missing", action="store_true",
        help="Skip the missing-from-indices analysis.",
    )
    parser.add_argument(
        "--no-stale-index", action="store_true",
        help="Skip the stale-in-indices analysis.",
    )
    parser.add_argument(
        "--no-candidates", action="store_true",
        help="Skip the concept-candidates analysis.",
    )
    parser.add_argument(
        "--no-stale-notes", action="store_true",
        help="Skip the stale-notes analysis.",
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
    report = build_audit_report(
        cfg,
        run_missing=not args.no_missing,
        run_stale_index=not args.no_stale_index,
        run_candidates=not args.no_candidates,
        run_stale_notes=not args.no_stale_notes,
    )

    if args.json:
        print(json.dumps(_to_dict(report), indent=2, ensure_ascii=False))
    else:
        _print_human(report)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
