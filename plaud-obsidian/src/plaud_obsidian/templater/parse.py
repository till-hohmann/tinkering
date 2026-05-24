"""Templates-note parser. Finds <!-- WIKILINK-RULES:<id> --> /
<!-- /WIKILINK-RULES:<id> --> marker pairs in the templates note and returns
their positions so the renderer can splice new content between them.

The user owns everything outside the markers; the templater never touches it.
Unpaired markers (open without close, close without open) are a hard error —
the renderer needs unambiguous boundaries."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import List


_OPEN_RE = re.compile(
    r"<!--\s*WIKILINK-RULES:(?P<id>[A-Za-z0-9_\-]+)\s*-->"
)
_CLOSE_RE = re.compile(
    r"<!--\s*/WIKILINK-RULES:(?P<id>[A-Za-z0-9_\-]+)\s*-->"
)


@dataclass
class MarkerBlock:
    template_id: str
    # Character offsets into the templates note text, exclusive of the
    # markers themselves. inner_start points at the first char after the
    # opening marker (including its trailing newline if any).
    open_marker_end: int
    close_marker_start: int

    def slice_inner(self, text: str) -> str:
        return text[self.open_marker_end:self.close_marker_start]


def find_marker_blocks(text: str) -> List[MarkerBlock]:
    """Return all WIKILINK-RULES blocks in source order. Raises ValueError
    on mismatched / nested / duplicate markers."""
    opens = [(m.start(), m.end(), m.group("id")) for m in _OPEN_RE.finditer(text)]
    closes = [(m.start(), m.end(), m.group("id")) for m in _CLOSE_RE.finditer(text)]

    if len(opens) != len(closes):
        raise ValueError(
            f"templates note has {len(opens)} opening markers but "
            f"{len(closes)} closing markers"
        )

    blocks: List[MarkerBlock] = []
    seen_ids = set()
    for (o_start, o_end, o_id), (c_start, c_end, c_id) in zip(opens, closes):
        if o_id != c_id:
            raise ValueError(
                f"marker pair mismatch: opened {o_id!r} but closed {c_id!r}"
            )
        if c_start < o_end:
            raise ValueError(
                f"close marker for {o_id!r} appears before its open marker"
            )
        if o_id in seen_ids:
            raise ValueError(
                f"duplicate WIKILINK-RULES block id {o_id!r}; each template "
                f"id may only appear once in the templates note"
            )
        seen_ids.add(o_id)
        blocks.append(MarkerBlock(
            template_id=o_id,
            open_marker_end=o_end,
            close_marker_start=c_start,
        ))
    return blocks


def splice_blocks(text: str, blocks: List[MarkerBlock], new_contents: List[str]) -> str:
    """Replace each block's inner text with the matching new_contents entry.
    blocks and new_contents must be the same length and ordered identically."""
    if len(blocks) != len(new_contents):
        raise ValueError("blocks and new_contents length mismatch")

    # Splice from the end so earlier offsets remain valid.
    out = text
    for block, content in reversed(list(zip(blocks, new_contents))):
        out = (
            out[:block.open_marker_end]
            + content
            + out[block.close_marker_start:]
        )
    return out
