"""Filename builders. One pure function per naming style. Each takes the
extracted frontmatter dict + the source filename + the active config and
returns a `YYYY-MM-DD...md` filename. No filesystem side-effects."""

from __future__ import annotations

import datetime as dt
import re
from typing import Dict, List, Optional

from ..common.config import Config, NamingConfig
from ..common.frontmatter import (
    has_unfilled_placeholder,
    strip_wikilink_brackets,
)


# Plaud filenames begin with `MM-DD ` or `MM-DD_` followed by the title.
_PLAUD_DATE_PREFIX_RE = re.compile(r"^(\d{2})[-_](\d{2})\s+")
# Common Plaud meeting prefixes worth stripping when deriving a Short Title.
_TITLE_PREFIX_RE = re.compile(
    r"^(Weekly Meeting_|Weekly_|Meeting_|1on1_|Journal\s*)\s*",
    re.IGNORECASE,
)


def resolve_date(fm: Dict[str, str], source_filename: str) -> Optional[str]:
    """Return YYYY-MM-DD or None. Prefers frontmatter `date`; falls back to
    the `MM-DD` prefix of Plaud's filename + the current calendar year."""
    raw = fm.get("date", "").strip()
    if raw and not has_unfilled_placeholder(raw):
        # Tolerate a few common shapes.
        for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%d.%m.%Y"):
            try:
                return dt.datetime.strptime(raw, fmt).date().isoformat()
            except ValueError:
                continue
        # Last resort: if it already looks like YYYY-MM-DD, accept it.
        if re.match(r"^\d{4}-\d{2}-\d{2}$", raw):
            return raw

    m = _PLAUD_DATE_PREFIX_RE.match(source_filename)
    if m:
        mm, dd = m.group(1), m.group(2)
        year = dt.date.today().year
        try:
            return dt.date(year, int(mm), int(dd)).isoformat()
        except ValueError:
            return None
    return None


def short_title(raw_title: str, naming: NamingConfig) -> str:
    """Condense a meeting title to at most N substantive words, Title Case,
    no `-Summary`, no leading articles/conjunctions/prepositions. Returns
    'Untitled' rather than empty string."""
    if not raw_title:
        return "Untitled"
    s = raw_title.strip()

    # Remove Plaud's `-Summary` and similar suffixes.
    s = re.sub(r"[-_]?summary\.?\s*$", "", s, flags=re.IGNORECASE)
    s = re.sub(r"\.md$", "", s, flags=re.IGNORECASE)
    # Strip leading common Plaud prefixes.
    s = _TITLE_PREFIX_RE.sub("", s)

    # Tokenise on whitespace and a few punctuation marks that often separate
    # words in a title.
    tokens = re.split(r"[\s_\-/]+", s)
    strip = set(naming.strip_words)
    keep: List[str] = []
    for tok in tokens:
        cleaned = re.sub(r"[^\w&]", "", tok)
        if not cleaned:
            continue
        if cleaned.lower() in strip:
            continue
        keep.append(cleaned)
        if len(keep) >= naming.short_title_max_words:
            break

    if not keep:
        return "Untitled"
    return " ".join(w.capitalize() if not w.isupper() else w for w in keep)


def _title_from_source(source_filename: str) -> str:
    """Best-effort title from a Plaud source filename, with the date prefix
    stripped."""
    stem = re.sub(r"\.md$", "", source_filename, flags=re.IGNORECASE)
    stem = _PLAUD_DATE_PREFIX_RE.sub("", stem)
    return stem


def filename_one_on_one(
    fm: Dict[str, str], source_filename: str, cfg: Config,
) -> Optional[str]:
    date = resolve_date(fm, source_filename)
    if not date:
        return None
    raw_participant = fm.get(cfg.field_name("participant"), "")
    if not raw_participant or has_unfilled_placeholder(raw_participant):
        return None

    # Allow comma-separated lists. Pick first non-self participant.
    candidates = [strip_wikilink_brackets(p) for p in raw_participant.split(",")]
    candidates = [c for c in candidates if c]
    self_lc = {n.lower() for n in cfg.self_participant_names}
    other = next((c for c in candidates if c.lower() not in self_lc), None)
    other = other or (candidates[0] if candidates else None)
    if not other:
        return None
    return f"{date}_1on1_{other}.md"


def filename_titled(
    fm: Dict[str, str], source_filename: str, cfg: Config, prefix: str,
) -> Optional[str]:
    date = resolve_date(fm, source_filename)
    if not date:
        return None
    raw_title = fm.get(cfg.field_name("meeting_title"), "").strip()
    if not raw_title or has_unfilled_placeholder(raw_title):
        raw_title = _title_from_source(source_filename)
    title = short_title(raw_title, cfg.naming)
    bits = [date]
    if prefix:
        bits.append(prefix)
    bits.append(title)
    return "_".join(bits) + ".md"


def filename_journal(
    fm: Dict[str, str], source_filename: str, cfg: Config,
) -> Optional[str]:
    date = resolve_date(fm, source_filename)
    if not date:
        return None
    return f"{date}_Journal.md"


def filename_inbox(
    fm: Dict[str, str], source_filename: str, cfg: Config,
) -> Optional[str]:
    date = resolve_date(fm, source_filename) or dt.date.today().isoformat()
    raw_title = fm.get(cfg.field_name("meeting_title"), "").strip()
    if not raw_title or has_unfilled_placeholder(raw_title):
        raw_title = _title_from_source(source_filename)
    title = short_title(raw_title, cfg.naming) or "Unknown"
    return f"{date}_Inbox_{title}.md"


NAMING_DISPATCH = {
    "one_on_one": lambda fm, src, cfg, prefix: filename_one_on_one(fm, src, cfg),
    "titled":     lambda fm, src, cfg, prefix: filename_titled(fm, src, cfg, prefix),
    "journal":    lambda fm, src, cfg, prefix: filename_journal(fm, src, cfg),
    "inbox":      lambda fm, src, cfg, prefix: filename_inbox(fm, src, cfg),
}
