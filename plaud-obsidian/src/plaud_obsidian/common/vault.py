"""Vault walker + note index. Shared by the relinker and graph-audit so
both see the same notion of 'what notes live in this vault, and what
alternate names do they answer to'."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

from .frontmatter import read_frontmatter, strip_wikilink_brackets


@dataclass
class NoteInfo:
    """One note in the vault."""
    title: str             # filename without .md
    rel_path: str          # vault-relative, forward-slash
    abs_path: Path
    aliases: List[str] = field(default_factory=list)


@dataclass
class NoteIndex:
    """A view of every note in the vault, keyed by lowercase title and
    lowercase alias so lookups are case-insensitive but values keep
    canonical casing."""
    notes: List[NoteInfo] = field(default_factory=list)
    # lowercase-name → canonical NoteInfo (covers titles AND aliases)
    by_name_lc: Dict[str, NoteInfo] = field(default_factory=dict)
    # lowercase-name → "title" or "alias", for reporting
    name_source_lc: Dict[str, str] = field(default_factory=dict)

    def __contains__(self, name: str) -> bool:
        return name.lower() in self.by_name_lc

    def get(self, name: str) -> Optional[NoteInfo]:
        return self.by_name_lc.get(name.lower())

    def all_titles(self) -> List[str]:
        return [n.title for n in self.notes]


def _rel(abs_path: Path, vault_root: Path) -> str:
    return abs_path.relative_to(vault_root).as_posix()


def _is_excluded(rel_path: str, exclude_folders: Iterable[str]) -> bool:
    """rel_path uses forward slashes. Exclude if it starts with any of
    exclude_folders + '/' (or equals one)."""
    for ex in exclude_folders:
        ex_clean = ex.strip("/").replace("\\", "/")
        if not ex_clean:
            continue
        if rel_path == ex_clean or rel_path.startswith(ex_clean + "/"):
            return True
    return False


def walk_md(
    vault_root: Path, *, exclude_folders: Iterable[str] = (),
) -> Iterable[Tuple[str, Path]]:
    """Yield (rel_path, abs_path) for every .md file in the vault, skipping
    hidden directories and any folder in exclude_folders."""
    exclude_folders = list(exclude_folders)
    for root, dirs, files in os.walk(vault_root):
        # Skip dotfile directories outright.
        dirs[:] = [d for d in dirs if not d.startswith(".")]
        for f in files:
            if not f.endswith(".md"):
                continue
            abs_path = Path(root) / f
            rel_path = _rel(abs_path, vault_root)
            if _is_excluded(rel_path, exclude_folders):
                continue
            yield rel_path, abs_path


def _extract_aliases(frontmatter: Dict[str, str]) -> List[str]:
    """Read the YAML `aliases` field. Obsidian permits a flow list
    (`aliases: [a, b]`), a wikilink scalar (`aliases: [[Name]]`), or a
    bare scalar (`aliases: Name`). Our frontmatter parser returns the
    raw string after the colon; we tolerate all three."""
    raw = frontmatter.get("aliases", "").strip()
    if not raw:
        return []
    # Wikilink scalar: must be checked BEFORE flow-list, since `[[X]]`
    # also matches `[...]` at the outer level.
    if raw.startswith("[[") and raw.endswith("]]"):
        return [strip_wikilink_brackets(raw)]
    if raw.startswith("[") and raw.endswith("]"):
        inner = raw[1:-1]
        parts = [p.strip().strip("'\"") for p in inner.split(",")]
        return [strip_wikilink_brackets(p) for p in parts if p]
    return [strip_wikilink_brackets(raw)]


def build_note_index(
    vault_root: Path, *, exclude_folders: Iterable[str] = (),
) -> NoteIndex:
    """Walk the vault and build an in-memory index keyed by lowercase
    title + alias.

    Two-pass: first register every title, then aliases. This guarantees
    a real note's title always wins over another note's alias if they
    happen to collide."""
    idx = NoteIndex()
    for rel_path, abs_path in walk_md(vault_root, exclude_folders=exclude_folders):
        title = abs_path.stem
        fm = read_frontmatter(abs_path)
        aliases = _extract_aliases(fm)
        idx.notes.append(NoteInfo(
            title=title,
            rel_path=rel_path,
            abs_path=abs_path,
            aliases=aliases,
        ))
    # Pass 1: titles.
    for note in idx.notes:
        idx.by_name_lc[note.title.lower()] = note
        idx.name_source_lc[note.title.lower()] = "title"
    # Pass 2: aliases that don't collide with a title.
    for note in idx.notes:
        for alias in note.aliases:
            lc = alias.lower()
            if lc not in idx.by_name_lc:
                idx.by_name_lc[lc] = note
                idx.name_source_lc[lc] = "alias"
    return idx
