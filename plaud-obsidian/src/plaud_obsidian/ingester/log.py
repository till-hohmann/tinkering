"""Ingestion state file. Tracks which source filenames have already been
processed so re-runs are idempotent. Format is intentionally simple so a user
can edit it by hand if something goes wrong."""

from __future__ import annotations

import datetime as dt
import json
import os
import tempfile
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import List, Set


STATE_VERSION = "1.0"
STATE_FILENAME = ".plaud_ingested.json"


@dataclass
class IngestionEntry:
    source_filename: str
    target_filename: str
    target_folder: str
    ingested_at: str  # ISO 8601 UTC


def state_path(recordings_dir: Path) -> Path:
    return recordings_dir / STATE_FILENAME


def load_state(recordings_dir: Path) -> List[IngestionEntry]:
    p = state_path(recordings_dir)
    if not p.exists():
        return []
    try:
        raw = json.loads(p.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return []
    entries = []
    for e in raw.get("ingested", []):
        entries.append(IngestionEntry(
            source_filename=e.get("source_filename", ""),
            target_filename=e.get("target_filename", ""),
            target_folder=e.get("target_folder", ""),
            ingested_at=e.get("ingested_at", ""),
        ))
    return entries


def already_ingested(entries: List[IngestionEntry]) -> Set[str]:
    return {e.source_filename for e in entries}


def save_state(recordings_dir: Path, entries: List[IngestionEntry]) -> None:
    """Atomic write: tmp file + replace."""
    p = state_path(recordings_dir)
    payload = {
        "version": STATE_VERSION,
        "ingested": [asdict(e) for e in entries],
    }
    fd, tmp = tempfile.mkstemp(
        prefix=".plaud_ingested_", suffix=".tmp", dir=str(p.parent),
    )
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)
    os.replace(tmp, p)


def now_iso() -> str:
    return dt.datetime.utcnow().replace(microsecond=0).isoformat() + "Z"
