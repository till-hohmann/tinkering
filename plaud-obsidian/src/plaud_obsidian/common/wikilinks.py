"""Wikilink utilities. Extract `[[Name]]` and `[[Name|Display]]` tokens from
markdown text. Used by the templater and graph-hygiene tools, but kept in
common/ because the ingester also reads wikilink-shaped frontmatter values."""

from __future__ import annotations

import re
from typing import List, Tuple


_WIKILINK_RE = re.compile(r"\[\[([^\[\]\n|]+?)(?:\|([^\[\]\n]+))?\]\]")


def extract_wikilinks(text: str) -> List[Tuple[str, str]]:
    """Return [(target, display)] for every `[[wikilink]]` in text. For bare
    `[[Foo]]`, display equals target. Preserves order; allows duplicates."""
    out: List[Tuple[str, str]] = []
    for m in _WIKILINK_RE.finditer(text):
        target = m.group(1).strip()
        display = (m.group(2) or target).strip()
        if target:
            out.append((target, display))
    return out


def unique_targets(text: str) -> List[str]:
    """Distinct wikilink targets in first-occurrence order."""
    seen = set()
    out = []
    for target, _ in extract_wikilinks(text):
        if target not in seen:
            seen.add(target)
            out.append(target)
    return out
