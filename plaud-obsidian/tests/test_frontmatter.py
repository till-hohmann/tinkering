"""Tests for the YAML + Dataview frontmatter parser."""

from plaud_obsidian.common.frontmatter import (
    has_unfilled_placeholder,
    parse_frontmatter,
    strip_wikilink_brackets,
)


def test_yaml_frontmatter():
    text = """---
type: 1on1
participant: [[Anna Schmidt]]
date: 2026-04-15
---

# Heading
body line
"""
    fm = parse_frontmatter(text)
    assert fm["type"] == "1on1"
    assert fm["participant"] == "[[Anna Schmidt]]"
    assert fm["date"] == "2026-04-15"


def test_dataview_inline_fields():
    text = """# Heading

type:: general
meeting_title:: Q2 Planning Session
date:: 2026-04-16

Body text here.
"""
    fm = parse_frontmatter(text)
    assert fm["type"] == "general"
    assert fm["meeting_title"] == "Q2 Planning Session"
    assert fm["date"] == "2026-04-16"


def test_yaml_wins_over_dataview():
    text = """---
type: 1on1
---

type:: general
"""
    fm = parse_frontmatter(text)
    assert fm["type"] == "1on1"


def test_no_frontmatter():
    fm = parse_frontmatter("just some prose\nno fields here")
    assert fm == {}


def test_strip_wikilink_brackets():
    assert strip_wikilink_brackets("[[Anna Schmidt]]") == "Anna Schmidt"
    assert strip_wikilink_brackets("[[Anna Schmidt|Anna]]") == "Anna"
    assert strip_wikilink_brackets("Anna Schmidt") == "Anna Schmidt"
    assert strip_wikilink_brackets("  [[Foo]]  ") == "Foo"


def test_unfilled_placeholder():
    assert has_unfilled_placeholder("{{date:YYYY-MM-DD}}")
    assert has_unfilled_placeholder("{{participant}}")
    assert not has_unfilled_placeholder("2026-04-15")
    assert not has_unfilled_placeholder("Anna Schmidt")
