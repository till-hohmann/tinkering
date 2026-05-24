"""Index file parser. An index file is a plain markdown file that uses H2
headings (`## Category`) to group canonical [[wikilinks]] by category.

Used by the templater to discover, for each index, what wikilinks live in
which category, so the per-template wikilink-rules block can be assembled
from a config like 'people.Team + companies.*'.

Frontmatter (if any) is ignored. Wikilinks above the first H2 are placed in
the synthetic category '_uncategorised'."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List

from .wikilinks import extract_wikilinks


_H2_RE = re.compile(r"^##\s+(?P<title>.+?)\s*$")
_FENCE_RE = re.compile(r"^---\s*$")

UNCATEGORISED = "_uncategorised"


@dataclass
class Index:
    id: str
    path: Path
    # category name (preserving first-seen H2 text) -> ordered list of
    # wikilink targets, deduped per-category.
    categories: Dict[str, List[str]] = field(default_factory=dict)

    def all_categories(self) -> List[str]:
        return list(self.categories.keys())

    def category(self, name: str) -> List[str]:
        return list(self.categories.get(name, []))


def parse_index(idx_id: str, path: Path) -> Index:
    """Parse a single index file. Returns an Index with categories keyed by
    H2 heading text. Missing file → empty Index (not an error — the user may
    not have populated it yet)."""
    out = Index(id=idx_id, path=path, categories={})
    if not path.exists():
        return out

    text = path.read_text(encoding="utf-8", errors="replace")
    lines = text.splitlines()

    # Skip YAML frontmatter if present.
    start = 0
    if lines and _FENCE_RE.match(lines[0]):
        for i in range(1, len(lines)):
            if _FENCE_RE.match(lines[i]):
                start = i + 1
                break

    current_category = UNCATEGORISED
    # Buffer per category so we can run extract_wikilinks once per category
    # instead of once per line.
    buffers: Dict[str, List[str]] = {}

    for line in lines[start:]:
        m = _H2_RE.match(line)
        if m:
            current_category = m.group("title").strip()
            buffers.setdefault(current_category, [])
            continue
        buffers.setdefault(current_category, []).append(line)

    for category, body_lines in buffers.items():
        joined = "\n".join(body_lines)
        seen = set()
        ordered: List[str] = []
        for target, _ in extract_wikilinks(joined):
            if target not in seen:
                seen.add(target)
                ordered.append(target)
        if ordered:
            # Skip empty synthetic uncategorised bucket; keep real H2s
            # even when empty so the user can see they were detected.
            out.categories[category] = ordered
        elif category != UNCATEGORISED:
            out.categories[category] = []

    return out


def load_all_indices(vault_root: Path, refs) -> Dict[str, Index]:
    """Load every IndexRef into a {id: Index} dict."""
    result: Dict[str, Index] = {}
    for ref in refs:
        full = vault_root / ref.path
        result[ref.id] = parse_index(ref.id, full)
    return result
