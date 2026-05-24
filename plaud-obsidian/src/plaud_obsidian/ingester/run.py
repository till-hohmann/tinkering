"""Execute an ingestion plan: copy each source into the vault, append to the
state log, delete the source on success. Pure-Python file ops; nothing here
knows about Cowork's delete-permission gate (that lives in the skill bundle
wrapper)."""

from __future__ import annotations

import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import List, Tuple

from ..common.config import Config
from .log import IngestionEntry, load_state, now_iso, save_state
from .plan import PlanEntry


@dataclass
class IngestResult:
    copied: List[PlanEntry]
    skipped: List[Tuple[PlanEntry, str]]   # (entry, reason)
    deleted: List[PlanEntry]
    delete_failed: List[Tuple[PlanEntry, str]]


def execute_plan(
    plan: List[PlanEntry], cfg: Config, *, delete_sources: bool = True,
) -> IngestResult:
    copied: List[PlanEntry] = []
    skipped: List[Tuple[PlanEntry, str]] = []
    deleted: List[PlanEntry] = []
    delete_failed: List[Tuple[PlanEntry, str]] = []

    existing = load_state(cfg.recordings_dir)

    for entry in plan:
        target_dir = cfg.vault_root / entry.target_folder
        target_dir.mkdir(parents=True, exist_ok=True)
        target_path = target_dir / entry.target_filename

        if target_path.exists():
            # build_plan should have suffixed; this guards against races.
            skipped.append((entry, f"target already exists: {target_path}"))
            continue

        try:
            shutil.copy2(entry.source_path, target_path)
        except OSError as e:
            skipped.append((entry, f"copy failed: {e}"))
            continue

        if not target_path.exists():
            skipped.append((entry, "copy verification failed"))
            continue

        existing.append(IngestionEntry(
            source_filename=entry.source_filename,
            target_filename=entry.target_filename,
            target_folder=entry.target_folder,
            ingested_at=now_iso(),
        ))
        copied.append(entry)

    # Persist log after all copies; one fsync, not N.
    save_state(cfg.recordings_dir, existing)

    if delete_sources:
        for entry in copied:
            try:
                entry.source_path.unlink()
                deleted.append(entry)
            except OSError as e:
                delete_failed.append((entry, str(e)))

    return IngestResult(
        copied=copied,
        skipped=skipped,
        deleted=deleted,
        delete_failed=delete_failed,
    )
