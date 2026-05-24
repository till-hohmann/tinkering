"""Config loader. Reads the user's `config.json`, expands paths, validates the
shape just enough to fail loudly on the obvious mistakes. Returns a
plain dataclass so callers can rely on attribute access."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Union


VALID_NAMING = {"one_on_one", "titled", "journal", "inbox"}

# A template's `categories` list can be the literal string "*" (all) or a list
# of H2 section names from the referenced index file.
CategoriesSpec = Union[str, List[str]]


@dataclass
class RouteRule:
    type: str
    folder: str
    prefix: str
    naming: str


@dataclass
class NamingConfig:
    short_title_max_words: int = 4
    strip_words: List[str] = field(default_factory=lambda: [
        "a", "an", "the", "and", "or",
        "with", "for", "in", "on", "at", "of", "to",
    ])


@dataclass
class IndexRef:
    id: str
    path: str   # vault-relative


@dataclass
class TemplateInclude:
    index: str                  # references IndexRef.id
    categories: CategoriesSpec  # "*" or list of H2 section names


@dataclass
class TemplateSpec:
    id: str
    include: List[TemplateInclude]


@dataclass
class Correction:
    from_: str
    to: str


@dataclass
class Config:
    recordings_dir: Path
    vault_root: Path
    inbox_folder: str
    fields: Dict[str, str]
    routing: List[RouteRule]
    naming: NamingConfig
    self_participant_names: List[str]
    indices: List[IndexRef] = field(default_factory=list)
    templates_note: Optional[str] = None
    templates: List[TemplateSpec] = field(default_factory=list)
    corrections: List[Correction] = field(default_factory=list)
    source_path: Optional[Path] = None

    def field_name(self, key: str) -> str:
        """Look up the frontmatter field name the user configured for a
        canonical role (`type`, `participant`, `meeting_title`, `date`)."""
        return self.fields.get(key, key)

    def route_for(self, type_value: str) -> Optional[RouteRule]:
        """First matching route by 'type', case-insensitive."""
        if not type_value:
            return None
        needle = type_value.strip().lower()
        for r in self.routing:
            if r.type.lower() == needle:
                return r
        return None


def _expand(path_str: str) -> Path:
    return Path(os.path.expanduser(os.path.expandvars(path_str))).resolve()


def load_config(path: Path) -> Config:
    raw = json.loads(path.read_text(encoding="utf-8"))
    # Strip _comment_* documentation keys so they don't trip validation.
    raw = {k: v for k, v in raw.items() if not k.startswith("_comment")}

    try:
        paths = raw["paths"]
        recordings_dir = _expand(paths["recordings_dir"])
        vault_root = _expand(paths["vault_root"])
        inbox_folder = paths.get("inbox_folder", "00_Inbox")
    except KeyError as e:
        raise ValueError(f"config missing required key under 'paths': {e}") from e

    fields = raw.get("fields") or {}
    for required in ("type", "participant", "meeting_title", "date"):
        fields.setdefault(required, required)

    routes_raw = raw.get("routing") or []
    routes: List[RouteRule] = []
    for entry in routes_raw:
        naming = entry.get("naming", "titled")
        if naming not in VALID_NAMING:
            raise ValueError(
                f"route '{entry.get('type')}' has invalid naming '{naming}'. "
                f"Must be one of: {sorted(VALID_NAMING)}"
            )
        routes.append(RouteRule(
            type=entry["type"],
            folder=entry.get("folder", inbox_folder),
            prefix=entry.get("prefix", ""),
            naming=naming,
        ))

    naming_raw = raw.get("naming") or {}
    naming = NamingConfig(
        short_title_max_words=int(naming_raw.get("short_title_max_words", 4)),
        strip_words=[w.lower() for w in (
            naming_raw.get("strip_words") or NamingConfig().strip_words
        )],
    )

    self_names = raw.get("self_participant_names") or []

    indices = [
        IndexRef(id=e["id"], path=e["path"])
        for e in (raw.get("indices") or [])
    ]
    valid_index_ids = {i.id for i in indices}

    templates: List[TemplateSpec] = []
    for t in (raw.get("templates") or []):
        includes: List[TemplateInclude] = []
        for inc in t.get("include", []):
            idx_id = inc["index"]
            if idx_id not in valid_index_ids:
                raise ValueError(
                    f"template {t.get('id')!r} references unknown index "
                    f"{idx_id!r}. Valid ids: {sorted(valid_index_ids)}"
                )
            cats = inc.get("categories", "*")
            if not (cats == "*" or isinstance(cats, list)):
                raise ValueError(
                    f"template {t.get('id')!r} include for index {idx_id!r}: "
                    f"'categories' must be '*' or a list"
                )
            includes.append(TemplateInclude(index=idx_id, categories=cats))
        templates.append(TemplateSpec(id=t["id"], include=includes))

    corrections = [
        Correction(from_=c["from"], to=c["to"])
        for c in (raw.get("corrections") or [])
    ]

    return Config(
        recordings_dir=recordings_dir,
        vault_root=vault_root,
        inbox_folder=inbox_folder,
        fields=fields,
        routing=routes,
        naming=naming,
        self_participant_names=list(self_names),
        indices=indices,
        templates_note=raw.get("templates_note"),
        templates=templates,
        corrections=corrections,
        source_path=path.resolve(),
    )
