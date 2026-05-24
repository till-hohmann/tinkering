"""Block renderer. Given a TemplateSpec and a set of loaded indices, produce
the markdown content that lives between the WIKILINK-RULES markers.

Output shape:

    \\n
    <!-- generated YYYY-MM-DD by plaud-obsidian templater -->
    \\n
    ### People — Team
    - [[Anna Schmidt]]
    - [[Bob Lee]]
    \\n
    ### Companies — Customers
    - [[Acme Corp]]
    \\n

Section headings are `<index_id_titled> — <category_name>` so a single
template can pull from multiple indices without category collisions.

Corrections (find/replace pairs) are applied to the final string. Useful for
canonicalising names that appear inconsistently across indices."""

from __future__ import annotations

import datetime as dt
from typing import Dict, List

from ..common.config import Correction, TemplateSpec
from ..common.indices import Index


def _title(s: str) -> str:
    # 'people' -> 'People'; leave existing capitalisation otherwise.
    if s.islower():
        return s.capitalize()
    return s


def _resolve_categories(idx: Index, spec) -> List[str]:
    if spec == "*":
        return idx.all_categories()
    # Preserve the order the user listed, but skip categories that don't
    # actually exist in the index file (helpful for catching typos via the
    # report rather than crashing).
    out = []
    for cat in spec:
        if cat in idx.categories:
            out.append(cat)
    return out


def render_block(
    spec: TemplateSpec,
    indices: Dict[str, Index],
    corrections: List[Correction],
    *,
    today: dt.date | None = None,
) -> str:
    today = today or dt.date.today()
    lines: List[str] = []
    lines.append("")
    lines.append(
        f"<!-- generated {today.isoformat()} by plaud-obsidian templater -->"
    )

    for include in spec.include:
        idx = indices.get(include.index)
        if idx is None:
            continue
        for category in _resolve_categories(idx, include.categories):
            wikilinks = idx.category(category)
            if not wikilinks:
                continue
            lines.append("")
            lines.append(f"### {_title(include.index)} — {category}")
            for target in wikilinks:
                lines.append(f"- [[{target}]]")

    lines.append("")
    out = "\n".join(lines)

    for c in corrections:
        out = out.replace(c.from_, c.to)
    return out


def warn_missing_categories(
    spec: TemplateSpec, indices: Dict[str, Index],
) -> List[str]:
    """Return human-readable warnings for include entries whose categories
    or index ids didn't resolve, so the CLI can surface typos."""
    warnings: List[str] = []
    for include in spec.include:
        idx = indices.get(include.index)
        if idx is None:
            warnings.append(
                f"template {spec.id!r}: index id {include.index!r} not loaded"
            )
            continue
        if include.categories == "*":
            continue
        for cat in include.categories:
            if cat not in idx.categories:
                warnings.append(
                    f"template {spec.id!r}: index {include.index!r} has no "
                    f"category {cat!r} (available: {idx.all_categories()})"
                )
    return warnings
