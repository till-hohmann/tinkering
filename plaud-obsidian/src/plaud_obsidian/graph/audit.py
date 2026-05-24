"""Read-only vault health analyses. Surfaces four signals so the user can
decide what to do about each:

1. missing_from_indices  — [[wikilink]] is referenced in the vault but not
                           listed under any configured index.
2. stale_in_indices      — index entry has no inbound reference anywhere
                           in the vault.
3. concept_candidates    — frequently-mentioned Title-Case phrase with no
                           dedicated note, OR broken wikilink target.
4. stale_notes           — note in a 'semantic' folder with few backlinks
                           and no recent modification.

Nothing here writes to the vault. Output is structured data; the CLI
formats it as a table or JSON depending on flags."""

from __future__ import annotations

import datetime as dt
import re
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Set

from ..common.config import Config
from ..common.indices import load_all_indices
from ..common.vault import NoteIndex, build_note_index, walk_md
from ..common.wikilinks import extract_wikilinks


# Capitalised-phrase regex: 2 to 4 consecutive Title-Case words, NOT inside [[...]]
_PHRASE_RE = re.compile(
    r"(?<!\[\[)"
    r"\b([A-Z][a-z]{1,}(?:\s+[A-Z][a-z]{1,}){1,3})\b"
    r"(?!\]\])"
)

# Title-Case words common enough that surfacing them as candidates is noise.
_PHRASE_STOPWORDS = {
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
    "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
    "The", "This", "That", "These", "Those", "There", "Their",
    "Also", "When", "Then", "With", "From", "Into", "About", "After",
    "Before", "During", "Between", "Through", "Over", "Under", "Above",
    "True", "False", "None", "Yes", "No", "Next", "Last", "New", "Old",
    "Today", "Tomorrow", "Yesterday", "Now", "Later", "Soon",
}

_FRONT_FENCE_RE = re.compile(r"^---\s*$")
_FENCE_RE = re.compile(r"^(```|~~~)")
_HEADING_RE = re.compile(r"^#{1,6}\s")
_DATAVIEW_INLINE_RE = re.compile(r"^[\w ]+::")


@dataclass
class MissingIndexEntry:
    name: str
    reference_count: int        # how many notes reference it
    sample_files: List[str]     # up to 4 representative paths


@dataclass
class StaleIndexEntry:
    name: str
    index_id: str
    index_path: str


@dataclass
class ConceptCandidate:
    name: str
    sources: List[str]          # {"broken_wikilink", "recurring_phrase"}
    file_count: int
    sample_files: List[str]


@dataclass
class StaleNote:
    title: str
    rel_path: str
    backlink_count: int
    last_modified_iso: str
    age_days: int


@dataclass
class AuditReport:
    note_index: NoteIndex
    missing_from_indices: List[MissingIndexEntry] = field(default_factory=list)
    stale_in_indices: List[StaleIndexEntry] = field(default_factory=list)
    concept_candidates: List[ConceptCandidate] = field(default_factory=list)
    stale_notes: List[StaleNote] = field(default_factory=list)


def _readable_lines(content: str):
    in_code = False
    in_front = False
    first = True
    for line in content.split("\n"):
        stripped = line.strip()
        if first and stripped == "---":
            in_front = True
            first = False
            continue
        first = False
        if in_front:
            if stripped == "---":
                in_front = False
            continue
        if _FENCE_RE.match(stripped):
            in_code = not in_code
            continue
        if in_code:
            continue
        if _HEADING_RE.match(line) or _DATAVIEW_INLINE_RE.match(line):
            continue
        yield line


def _index_wikilinks(cfg: Config) -> Dict[str, Set[str]]:
    """Return {index_id: {wikilink_target, ...}} — lowercase for matching,
    canonical casing stored separately."""
    indices = load_all_indices(cfg.vault_root, cfg.indices)
    result: Dict[str, Set[str]] = {}
    for idx_id, idx in indices.items():
        wikis: Set[str] = set()
        for cat in idx.all_categories():
            for target in idx.category(cat):
                wikis.add(target)
        result[idx_id] = wikis
    return result


def _vault_wikilink_references(
    cfg: Config, *, exclude_indices: bool = True,
) -> Dict[str, List[str]]:
    """Return {wikilink_target: [rel_paths_where_it_appears]} for every
    wikilink found anywhere in the vault. By default we skip the index
    files themselves (their wikilinks are the *definitions*, not references)
    and configured graph_audit.exclude_folders."""
    exclude = list(cfg.graph_audit.exclude_folders)
    index_paths: Set[str] = set()
    if exclude_indices:
        for ref in cfg.indices:
            index_paths.add(ref.path.replace("\\", "/"))
    refs: Dict[str, Set[str]] = defaultdict(set)
    for rel_path, abs_path in walk_md(cfg.vault_root, exclude_folders=exclude):
        if rel_path in index_paths:
            continue
        try:
            content = abs_path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        for target, _ in extract_wikilinks(content):
            refs[target].add(rel_path)
    return {t: sorted(files) for t, files in refs.items()}


def _find_missing_from_indices(
    cfg: Config,
    refs: Dict[str, List[str]],
    indexed_lc: Set[str],
    note_index: NoteIndex,
) -> List[MissingIndexEntry]:
    out: List[MissingIndexEntry] = []
    for target in sorted(refs):
        if target.lower() in indexed_lc:
            continue
        # Skip references that resolve to an actual note via alias — those
        # aren't "missing", just under-canonicalised. The relinker handles
        # those separately.
        if target.lower() in note_index.by_name_lc:
            continue
        # Skip date-shaped targets.
        if re.match(r"^\d{4}-\d{2}-\d{2}$", target):
            continue
        files = refs[target]
        out.append(MissingIndexEntry(
            name=target,
            reference_count=len(files),
            sample_files=files[:4],
        ))
    out.sort(key=lambda e: (-e.reference_count, e.name))
    return out


def _find_stale_in_indices(
    cfg: Config,
    index_wikis: Dict[str, Set[str]],
    referenced_lc: Set[str],
) -> List[StaleIndexEntry]:
    out: List[StaleIndexEntry] = []
    by_id = {ref.id: ref for ref in cfg.indices}
    for idx_id, wikis in index_wikis.items():
        ref = by_id.get(idx_id)
        idx_path = ref.path if ref else "(unknown)"
        for name in sorted(wikis):
            if name.lower() in referenced_lc:
                continue
            out.append(StaleIndexEntry(
                name=name,
                index_id=idx_id,
                index_path=idx_path,
            ))
    out.sort(key=lambda e: (e.index_id, e.name))
    return out


def _find_concept_candidates(
    cfg: Config,
    refs: Dict[str, List[str]],
    note_index: NoteIndex,
) -> List[ConceptCandidate]:
    min_count = cfg.graph_audit.min_phrase_count
    exclude = list(cfg.graph_audit.exclude_folders)

    # 1. Broken wikilinks (always include — explicit intent).
    candidates: Dict[str, ConceptCandidate] = {}
    for target, files in refs.items():
        if target.lower() in note_index.by_name_lc:
            continue
        if re.match(r"^\d{4}-\d{2}-\d{2}$", target):
            continue
        candidates[target] = ConceptCandidate(
            name=target,
            sources=["broken_wikilink"],
            file_count=len(files),
            sample_files=files[:4],
        )

    # 2. Recurring Title-Case phrases.
    phrase_files: Dict[str, Set[str]] = defaultdict(set)
    for rel_path, abs_path in walk_md(cfg.vault_root, exclude_folders=exclude):
        try:
            content = abs_path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        seen_here: Set[str] = set()
        for line in _readable_lines(content):
            # Drop wikilink contents so we don't double-count linked text.
            stripped_line = re.sub(r"\[\[[^\]]*\]\]", "", line)
            for m in _PHRASE_RE.finditer(stripped_line):
                phrase = m.group(1).strip()
                # Normalise leading stopwords so "The Acme Migration"
                # and "Acme Migration" count as the same phrase.
                words = phrase.split()
                while words and words[0] in _PHRASE_STOPWORDS:
                    words.pop(0)
                if len(words) < 2:
                    continue
                phrase = " ".join(words)
                if len(phrase) < 4:
                    continue
                if phrase.lower() in note_index.by_name_lc:
                    continue
                if phrase.isupper():
                    continue
                seen_here.add(phrase)
        for phrase in seen_here:
            phrase_files[phrase].add(rel_path)

    for phrase, files in phrase_files.items():
        if len(files) < min_count:
            continue
        files_sorted = sorted(files)
        if phrase in candidates:
            existing = candidates[phrase]
            existing.sources = sorted(set(existing.sources) | {"recurring_phrase"})
            seen = set(existing.sample_files)
            for f in files_sorted:
                if f not in seen:
                    existing.sample_files.append(f)
                    seen.add(f)
                    if len(existing.sample_files) >= 4:
                        break
            existing.file_count = max(existing.file_count, len(files_sorted))
        else:
            candidates[phrase] = ConceptCandidate(
                name=phrase,
                sources=["recurring_phrase"],
                file_count=len(files_sorted),
                sample_files=files_sorted[:4],
            )

    out = list(candidates.values())
    out.sort(key=lambda c: (-c.file_count, c.name))
    return out


def _find_stale_notes(
    cfg: Config,
    refs: Dict[str, List[str]],
    note_index: NoteIndex,
) -> List[StaleNote]:
    semantic = [s.replace("\\", "/") for s in cfg.graph_audit.semantic_folders]
    if not semantic:
        return []
    cutoff_age = dt.timedelta(days=cfg.graph_audit.min_stale_age_days)
    now = dt.datetime.utcnow()
    max_bl = cfg.graph_audit.max_stale_backlinks

    # Count backlinks per canonical note.
    backlinks: Dict[str, int] = defaultdict(int)
    for target, files in refs.items():
        info = note_index.get(target)
        if info is None:
            continue
        # Distinct sources, excluding self.
        unique = {f for f in files if f != info.rel_path}
        backlinks[info.rel_path] += len(unique)

    out: List[StaleNote] = []
    for note in note_index.notes:
        rel = note.rel_path
        if not any(rel == s or rel.startswith(s + "/") for s in semantic):
            continue
        # Skip dated journal-style notes.
        if re.match(r"^\d{4}-", note.title):
            continue
        bl = backlinks.get(rel, 0)
        if bl > max_bl:
            continue
        try:
            mtime = dt.datetime.utcfromtimestamp(note.abs_path.stat().st_mtime)
        except OSError:
            continue
        if (now - mtime) < cutoff_age:
            continue
        out.append(StaleNote(
            title=note.title,
            rel_path=rel,
            backlink_count=bl,
            last_modified_iso=mtime.date().isoformat(),
            age_days=(now - mtime).days,
        ))
    out.sort(key=lambda s: (s.backlink_count, -s.age_days))
    return out


def build_audit_report(
    cfg: Config,
    *,
    run_missing: bool = True,
    run_stale_index: bool = True,
    run_candidates: bool = True,
    run_stale_notes: bool = True,
) -> AuditReport:
    note_index = build_note_index(
        cfg.vault_root, exclude_folders=cfg.graph_audit.exclude_folders,
    )
    refs = _vault_wikilink_references(cfg)
    referenced_lc = {t.lower() for t in refs}

    index_wikis = _index_wikilinks(cfg) if cfg.indices else {}
    indexed_lc = {n.lower() for ws in index_wikis.values() for n in ws}

    report = AuditReport(note_index=note_index)

    if run_missing and cfg.indices:
        report.missing_from_indices = _find_missing_from_indices(
            cfg, refs, indexed_lc, note_index,
        )
    if run_stale_index and cfg.indices:
        report.stale_in_indices = _find_stale_in_indices(
            cfg, index_wikis, referenced_lc,
        )
    if run_candidates:
        report.concept_candidates = _find_concept_candidates(
            cfg, refs, note_index,
        )
    if run_stale_notes:
        report.stale_notes = _find_stale_notes(cfg, refs, note_index)

    return report
