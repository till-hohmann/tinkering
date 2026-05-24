"""Build the ingestion plan: for each new source file, decide where it goes
and what it gets called. No filesystem side-effects beyond reading source
files — execution is in `run.py`."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional

from ..common.config import Config, RouteRule
from ..common.frontmatter import read_frontmatter
from .naming import NAMING_DISPATCH


@dataclass
class PlanEntry:
    source_path: Path
    target_folder: str   # vault-relative
    target_filename: str
    reason: str          # routed via type 'X', or 'inbox: <why>'

    @property
    def source_filename(self) -> str:
        return self.source_path.name


def _inbox_route(cfg: Config) -> RouteRule:
    return RouteRule(
        type="__inbox__",
        folder=cfg.inbox_folder,
        prefix="",
        naming="inbox",
    )


def _build_filename(
    fm: dict, source_path: Path, cfg: Config, route: RouteRule,
) -> Optional[str]:
    builder = NAMING_DISPATCH[route.naming]
    return builder(fm, source_path.name, cfg, route.prefix)


def _collision_free(
    vault_root: Path, folder: str, candidate: str, taken_in_run: set,
) -> str:
    """If a target file already exists (on disk or in the in-progress plan),
    append _2, _3, ... to the stem until clear."""
    target_dir = vault_root / folder
    stem, dot, ext = candidate.rpartition(".")
    if not dot:
        stem, ext = candidate, ""
    name = candidate
    i = 2
    while (target_dir / name).exists() or name in taken_in_run:
        name = f"{stem}_{i}.{ext}" if ext else f"{stem}_{i}"
        i += 1
    return name


def build_plan(
    new_source_files: List[Path], cfg: Config,
) -> List[PlanEntry]:
    plan: List[PlanEntry] = []
    # Track (folder, filename) to avoid two new files clashing within one run.
    taken: dict = {}
    for src in sorted(new_source_files):
        fm = read_frontmatter(src)
        type_val = fm.get(cfg.field_name("type"), "")
        route = cfg.route_for(type_val)
        reason: str

        if route is None:
            route = _inbox_route(cfg)
            reason = (
                f"inbox: unknown type {type_val!r}"
                if type_val else
                "inbox: no type field"
            )
        else:
            reason = f"routed via type {route.type!r}"

        filename = _build_filename(fm, src, cfg, route)
        if filename is None:
            # Naming rule couldn't produce a name (e.g. 1on1 with no
            # participant). Park in inbox instead of dropping the file.
            inbox = _inbox_route(cfg)
            filename = _build_filename(fm, src, cfg, inbox)
            route = inbox
            reason = "inbox: required frontmatter missing (date/participant/title)"
            if filename is None:
                # Truly nothing usable — final fallback: use source stem.
                filename = f"unrouted_{src.stem}.md"

        per_folder = taken.setdefault(route.folder, set())
        filename = _collision_free(cfg.vault_root, route.folder, filename, per_folder)
        per_folder.add(filename)

        plan.append(PlanEntry(
            source_path=src,
            target_folder=route.folder,
            target_filename=filename,
            reason=reason,
        ))
    return plan
