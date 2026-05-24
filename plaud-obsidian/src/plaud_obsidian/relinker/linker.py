"""Per-file relinking. Pure functions — no filesystem side effects beyond
reading the input note. Skips frontmatter, fenced code blocks, headings,
Dataview inline fields, and inline backtick code spans. Word-boundary
matching prevents partial-word false positives."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import List, Set, Tuple

from ..common.vault import NoteInfo


_HEADING_RE = re.compile(r"^#{1,6}\s")
_DATAVIEW_INLINE_RE = re.compile(r"^[\w ]+::")
_FENCE_RE = re.compile(r"^(```|~~~)")
_FRONT_FENCE_RE = re.compile(r"^---\s*$")
# Splits a line on inline `code spans`, keeping the delimiters as their own
# segments. Odd-indexed segments after splitting are 'inside backticks'.
_INLINE_CODE_RE = re.compile(r"(`[^`]+`)")


@dataclass
class LinkChange:
    line_num: int          # 1-indexed
    title: str             # canonical title that was linked
    matched_text: str      # text that matched (may equal title or an alias)
    old_line: str          # whitespace-stripped
    new_line: str          # whitespace-stripped


def _build_linkable_titles(
    notes: List[NoteInfo],
    *,
    skip_prefixes: List[str],
    skip_exact: Set[str],
    skip_state_titles: Set[str],
    min_title_length: int,
    own_title: str,
) -> List[Tuple[str, str]]:
    """Return [(matchable_name, canonical_title)] entries — one per title
    AND per alias — sorted longest-first so 'Anna Schmidt' matches before
    'Anna'. Filters: dated notes (YYYY-...), skip-prefixes, exact skips,
    min length, and self-link to own_title."""
    pairs: List[Tuple[str, str]] = []
    dated = re.compile(r"^\d{4}-")
    skip_exact_lc = {s.lower() for s in skip_exact}
    skip_state_lc = {s.lower() for s in skip_state_titles}
    for note in notes:
        title = note.title
        if title == own_title:
            continue
        if dated.match(title):
            continue
        if any(title.startswith(p) for p in skip_prefixes):
            continue
        if title.lower() in skip_exact_lc:
            continue
        if title.lower() in skip_state_lc:
            continue
        if len(title) < min_title_length:
            continue
        pairs.append((title, title))
        for alias in note.aliases:
            if (
                len(alias) >= min_title_length
                and alias.lower() not in skip_state_lc
                and alias.lower() not in skip_exact_lc
            ):
                pairs.append((alias, title))
    # Longest first so the regex pass binds to the most specific match.
    pairs.sort(key=lambda p: len(p[0]), reverse=True)
    return pairs


def _file_skip_titles(
    skip_occurrences: list, rel_path: str,
) -> Set[str]:
    rel_norm = rel_path.replace("\\", "/")
    out: Set[str] = set()
    for entry in skip_occurrences:
        f = (entry.get("file") or "").replace("\\", "/")
        if f == rel_norm:
            out.add(entry.get("title", ""))
    return out


def relink_file_text(
    content: str,
    *,
    note_title: str,
    rel_path: str,
    notes: List[NoteInfo],
    skip_prefixes: List[str],
    skip_exact: Set[str],
    skip_state_titles: Set[str],
    skip_occurrences: list,
    min_title_length: int,
) -> Tuple[str, List[LinkChange]]:
    """Return (new_content, changes)."""
    file_skip = _file_skip_titles(skip_occurrences, rel_path)
    skip_state = set(skip_state_titles) | file_skip

    pairs = _build_linkable_titles(
        notes,
        skip_prefixes=skip_prefixes,
        skip_exact=skip_exact,
        skip_state_titles=skip_state,
        min_title_length=min_title_length,
        own_title=note_title,
    )

    new_lines: List[str] = []
    changes: List[LinkChange] = []
    in_code = False
    in_meta = False
    first_line = True

    for idx, line in enumerate(content.split("\n")):
        line_num = idx + 1
        stripped = line.strip()

        # YAML frontmatter — only valid if it starts on line 1.
        if first_line and _FRONT_FENCE_RE.match(line):
            in_meta = True
            first_line = False
            new_lines.append(line)
            continue
        first_line = False
        if in_meta:
            if _FRONT_FENCE_RE.match(line):
                in_meta = False
            new_lines.append(line)
            continue

        # Fenced code blocks.
        if _FENCE_RE.match(stripped):
            in_code = not in_code
            new_lines.append(line)
            continue
        if in_code:
            new_lines.append(line)
            continue

        # Skip headings + Dataview inline-field lines.
        if _HEADING_RE.match(line) or _DATAVIEW_INLINE_RE.match(line):
            new_lines.append(line)
            continue

        # Split into segments so we can protect inline code spans.
        segments = _INLINE_CODE_RE.split(line)
        new_segments: List[str] = []
        for seg_idx, segment in enumerate(segments):
            if seg_idx % 2 == 1:  # inside backticks
                new_segments.append(segment)
                continue
            new_seg = segment
            for matchable, canonical in pairs:
                if not matchable:
                    continue
                pattern = re.compile(
                    r"(?<!\[)(?<!\w)" + re.escape(matchable) + r"(?!\w)(?!\])"
                )
                replaced, count = pattern.subn(
                    lambda m, c=canonical: f"[[{c}]]", new_seg,
                )
                if count:
                    changes.append(LinkChange(
                        line_num=line_num,
                        title=canonical,
                        matched_text=matchable,
                        old_line=line.strip(),
                        new_line=replaced.strip(),
                    ))
                    new_seg = replaced
            new_segments.append(new_seg)
        new_lines.append("".join(new_segments))

    # Deduplicate by (line, matched_text). Same matched text twice on one
    # line collapses to one entry; canonical-vs-alias matches against the
    # same title both surface (different matched_text).
    seen = set()
    deduped: List[LinkChange] = []
    for ch in changes:
        key = (ch.line_num, ch.matched_text)
        if key in seen:
            continue
        seen.add(key)
        deduped.append(ch)

    return "\n".join(new_lines), deduped
