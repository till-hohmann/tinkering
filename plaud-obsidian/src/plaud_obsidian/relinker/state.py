"""Relinker state file. Tracks last-run timestamp (for incremental scans)
and user-defined skip rules (titles to never link, occurrences to never link
in a specific file). Persistent across runs so resolved cases stay resolved."""

from __future__ import annotations

import datetime as dt
import json
import os
import tempfile
from pathlib import Path
from typing import Any, Dict


STATE_VERSION = "1.0"

DEFAULT_STATE: Dict[str, Any] = {
    "version": STATE_VERSION,
    "last_run_iso": None,
    "skip_titles": [],         # titles to never link anywhere
    "skip_occurrences": [],    # [{file, title}] — skip a title in one file
}


def load_state(state_path: Path) -> Dict[str, Any]:
    if not state_path.exists():
        return dict(DEFAULT_STATE)
    try:
        data = json.loads(state_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return dict(DEFAULT_STATE)
    # Back-fill any keys added in newer versions.
    for k, v in DEFAULT_STATE.items():
        data.setdefault(k, v)
    return data


def save_state(state_path: Path, state: Dict[str, Any]) -> None:
    state_path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(
        prefix=".relinker_state_", suffix=".tmp", dir=str(state_path.parent),
    )
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(state, f, indent=2, ensure_ascii=False)
    os.replace(tmp, state_path)


def stamp_last_run(state_path: Path) -> None:
    state = load_state(state_path)
    state["last_run_iso"] = (
        dt.datetime.utcnow().replace(microsecond=0).isoformat() + "Z"
    )
    save_state(state_path, state)
