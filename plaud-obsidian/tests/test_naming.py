"""Tests for the filename builders."""

from pathlib import Path

from plaud_obsidian.common.config import Config, NamingConfig, RouteRule
from plaud_obsidian.ingester.naming import (
    filename_inbox,
    filename_journal,
    filename_one_on_one,
    filename_titled,
    resolve_date,
    short_title,
)


def _cfg() -> Config:
    return Config(
        recordings_dir=Path("/tmp/rec"),
        vault_root=Path("/tmp/vault"),
        inbox_folder="00_Inbox",
        fields={
            "type": "type", "participant": "participant",
            "meeting_title": "meeting_title", "date": "date",
        },
        routing=[],
        naming=NamingConfig(),
        self_participant_names=["You", "Me"],
    )


def test_resolve_date_from_frontmatter():
    assert resolve_date({"date": "2026-04-15"}, "x.md") == "2026-04-15"


def test_resolve_date_fallback_to_filename():
    out = resolve_date({}, "04-15 Something-Summary.md")
    assert out and out.endswith("-04-15")


def test_resolve_date_handles_unfilled_placeholder():
    out = resolve_date(
        {"date": "{{date:YYYY-MM-DD}}"},
        "04-15 Something-Summary.md",
    )
    assert out and out.endswith("-04-15")


def test_short_title_drops_stopwords_and_caps():
    naming = NamingConfig()
    assert short_title("a quick chat about the roadmap", naming) == "Quick Chat About Roadmap"


def test_short_title_strips_summary_suffix():
    naming = NamingConfig()
    assert short_title("Q2 Planning Session-Summary", naming) == "Q2 Planning Session"


def test_short_title_caps_word_count():
    naming = NamingConfig(short_title_max_words=2)
    assert short_title("one two three four five", naming) == "One Two"


def test_filename_one_on_one_picks_non_self():
    cfg = _cfg()
    fm = {"date": "2026-04-15", "participant": "[[You]], [[Anna Schmidt]]"}
    out = filename_one_on_one(fm, "04-15 1on1_ Anna-Summary.md", cfg)
    assert out == "2026-04-15_1on1_Anna Schmidt.md"


def test_filename_one_on_one_missing_participant_returns_none():
    cfg = _cfg()
    fm = {"date": "2026-04-15", "participant": ""}
    assert filename_one_on_one(fm, "04-15.md", cfg) is None


def test_filename_titled_uses_prefix():
    cfg = _cfg()
    fm = {"date": "2026-04-16", "meeting_title": "Q2 Planning Session"}
    out = filename_titled(fm, "04-16 Q2.md", cfg, prefix="GEN")
    assert out == "2026-04-16_GEN_Q2 Planning Session.md"


def test_filename_titled_no_prefix():
    cfg = _cfg()
    fm = {"date": "2026-04-16", "meeting_title": "Strategy Review"}
    out = filename_titled(fm, "04-16 x.md", cfg, prefix="")
    assert out == "2026-04-16_Strategy Review.md"


def test_filename_titled_fallback_to_source_filename():
    cfg = _cfg()
    fm = {"date": "2026-04-16"}  # no meeting_title
    out = filename_titled(fm, "04-16 Meeting_ Board Sync-Summary.md", cfg, prefix="GEN")
    assert out == "2026-04-16_GEN_Board Sync.md"


def test_filename_journal_simple():
    cfg = _cfg()
    out = filename_journal({"date": "2026-04-17"}, "04-17.md", cfg)
    assert out == "2026-04-17_Journal.md"


def test_filename_inbox_uses_source_when_title_missing():
    cfg = _cfg()
    out = filename_inbox({}, "04-18 Untitled Recording-Summary.md", cfg)
    assert out and out.endswith("Untitled Recording.md")
    assert "_Inbox_" in out
