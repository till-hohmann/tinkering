"""Orchestrate a single templater run: load indices, parse the templates
note, render new content for each marker block, splice back. Returns a
report with per-template counts and any warnings."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from ..common.config import Config, TemplateSpec
from ..common.indices import Index, load_all_indices
from .parse import find_marker_blocks, splice_blocks
from .render import render_block, warn_missing_categories


@dataclass
class TemplateChange:
    template_id: str
    wikilink_count: int
    before: str
    after: str

    @property
    def changed(self) -> bool:
        return self.before.strip() != self.after.strip()


@dataclass
class TemplaterReport:
    templates_note_path: Path
    new_text: str
    changes: List[TemplateChange] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    unmatched_blocks: List[str] = field(default_factory=list)
    unused_template_specs: List[str] = field(default_factory=list)

    @property
    def any_changes(self) -> bool:
        return any(c.changed for c in self.changes)


def _count_wikilinks(rendered: str) -> int:
    return rendered.count("- [[")


def build_report(
    cfg: Config, *, indices: Optional[Dict[str, Index]] = None,
) -> TemplaterReport:
    if not cfg.templates_note:
        raise ValueError(
            "config has no 'templates_note' set — nothing for the templater "
            "to operate on"
        )
    note_path = cfg.vault_root / cfg.templates_note
    if not note_path.exists():
        raise FileNotFoundError(
            f"templates note not found: {note_path}\n"
            f"Create it with WIKILINK-RULES marker blocks before running "
            f"the templater."
        )

    indices = indices or load_all_indices(cfg.vault_root, cfg.indices)
    text = note_path.read_text(encoding="utf-8")
    blocks = find_marker_blocks(text)
    specs_by_id: Dict[str, TemplateSpec] = {t.id: t for t in cfg.templates}

    changes: List[TemplateChange] = []
    warnings: List[str] = []
    unmatched: List[str] = []
    new_contents: List[str] = []

    for block in blocks:
        spec = specs_by_id.get(block.template_id)
        if spec is None:
            # Leave the block alone; surface as warning.
            unmatched.append(block.template_id)
            new_contents.append(block.slice_inner(text))
            continue
        warnings.extend(warn_missing_categories(spec, indices))
        rendered = render_block(spec, indices, cfg.corrections)
        new_contents.append(rendered)
        changes.append(TemplateChange(
            template_id=block.template_id,
            wikilink_count=_count_wikilinks(rendered),
            before=block.slice_inner(text),
            after=rendered,
        ))

    new_text = splice_blocks(text, blocks, new_contents)

    found_ids = {b.template_id for b in blocks}
    unused = [t.id for t in cfg.templates if t.id not in found_ids]

    return TemplaterReport(
        templates_note_path=note_path,
        new_text=new_text,
        changes=changes,
        warnings=warnings,
        unmatched_blocks=unmatched,
        unused_template_specs=unused,
    )


def write_report(report: TemplaterReport) -> bool:
    """Persist the new templates-note text. Returns True if a write actually
    happened (i.e. content changed)."""
    current = report.templates_note_path.read_text(encoding="utf-8")
    if current == report.new_text:
        return False
    report.templates_note_path.write_text(report.new_text, encoding="utf-8")
    return True
