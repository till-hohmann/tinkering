"""Frontmatter parser. Handles both YAML frontmatter (between --- fences) and
Dataview-style inline fields (`key:: value`). Returns a flat dict of strings.

Deliberately not a full YAML parser. We only need top-level key: value pairs,
which is what Plaud summary frontmatter produces in practice. Anything more
exotic (nested mappings, multi-line strings) is ignored rather than crashing.

No third-party dependencies — pure stdlib."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Dict


# Captures: key, optional colon doubling for dataview (key:: value), value.
# Restricts keys to bareword identifiers to avoid catching prose lines.
_KEY_VALUE_RE = re.compile(r"^\s*([A-Za-z_][A-Za-z0-9_-]*)\s*::?\s*(.*?)\s*$")


def parse_frontmatter(text: str) -> Dict[str, str]:
    """Parse a markdown document's frontmatter and Dataview inline fields.

    Strategy:
      1. If the document begins with `---`, parse everything between that and
         the next `---` as YAML-ish key: value lines.
      2. Then scan the rest of the document for `key:: value` Dataview inline
         fields (Obsidian convention).
      3. Frontmatter values win when a key appears in both.

    Returns a dict of stripped string values. Empty if nothing was found.
    """
    result: Dict[str, str] = {}
    lines = text.splitlines()

    body_start = 0
    if lines and lines[0].strip() == "---":
        # Find closing fence.
        for i in range(1, len(lines)):
            if lines[i].strip() == "---":
                body_start = i + 1
                # Parse the block between fences.
                for fm_line in lines[1:i]:
                    m = _KEY_VALUE_RE.match(fm_line)
                    if m:
                        key, value = m.group(1), m.group(2)
                        result.setdefault(key, value)
                break

    # Then scan body for `key:: value` (Dataview inline).
    for line in lines[body_start:]:
        # Dataview inline requires the doubled colon; the regex permits both,
        # so we only accept matches whose source line actually contains `::`.
        if "::" not in line:
            continue
        m = _KEY_VALUE_RE.match(line)
        if m:
            key, value = m.group(1), m.group(2)
            result.setdefault(key, value)

    return result


def read_frontmatter(path: Path, max_lines: int = 60) -> Dict[str, str]:
    """Read just the first `max_lines` of a file and parse frontmatter from
    them. Plaud summaries put all metadata at the top; we don't need to scan
    the entire (potentially long) transcript body."""
    try:
        with path.open("r", encoding="utf-8", errors="replace") as f:
            buf = []
            for i, line in enumerate(f):
                if i >= max_lines:
                    break
                buf.append(line.rstrip("\n"))
            return parse_frontmatter("\n".join(buf))
    except OSError:
        return {}


def strip_wikilink_brackets(value: str) -> str:
    """Turn `[[Foo Bar]]` or `[[Foo|Bar]]` into `Foo Bar` / `Bar` (the display
    form). Leaves bare text untouched."""
    s = value.strip()
    if s.startswith("[[") and s.endswith("]]"):
        inner = s[2:-2]
        if "|" in inner:
            return inner.split("|", 1)[1].strip()
        return inner.strip()
    return s


def has_unfilled_placeholder(value: str) -> bool:
    """True if the value contains an unfilled `{{...}}` template placeholder.
    Plaud sometimes ships a summary where the AI didn't substitute everything."""
    return "{{" in value and "}}" in value
