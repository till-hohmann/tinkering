"""Tests for the templates-note marker parser + splicer."""

import pytest

from plaud_obsidian.templater.parse import (
    find_marker_blocks,
    splice_blocks,
)


def test_finds_paired_blocks():
    text = (
        "intro\n\n"
        "<!-- WIKILINK-RULES:1on1 -->\nold A\n<!-- /WIKILINK-RULES:1on1 -->\n\n"
        "middle\n\n"
        "<!-- WIKILINK-RULES:project -->\nold B\n<!-- /WIKILINK-RULES:project -->\n"
    )
    blocks = find_marker_blocks(text)
    assert [b.template_id for b in blocks] == ["1on1", "project"]
    assert blocks[0].slice_inner(text) == "\nold A\n"
    assert blocks[1].slice_inner(text) == "\nold B\n"


def test_empty_block():
    text = (
        "<!-- WIKILINK-RULES:empty -->"
        "<!-- /WIKILINK-RULES:empty -->"
    )
    blocks = find_marker_blocks(text)
    assert len(blocks) == 1
    assert blocks[0].slice_inner(text) == ""


def test_unbalanced_markers_raise():
    with pytest.raises(ValueError):
        find_marker_blocks(
            "<!-- WIKILINK-RULES:a -->\nx\n"
            # missing close
        )
    with pytest.raises(ValueError):
        find_marker_blocks(
            "<!-- WIKILINK-RULES:a -->\nx\n<!-- /WIKILINK-RULES:b -->"
        )


def test_duplicate_ids_raise():
    text = (
        "<!-- WIKILINK-RULES:dup -->\nA\n<!-- /WIKILINK-RULES:dup -->\n"
        "<!-- WIKILINK-RULES:dup -->\nB\n<!-- /WIKILINK-RULES:dup -->\n"
    )
    with pytest.raises(ValueError):
        find_marker_blocks(text)


def test_splice_replaces_only_inner_content():
    text = (
        "PREFIX\n"
        "<!-- WIKILINK-RULES:x -->OLD<!-- /WIKILINK-RULES:x -->\n"
        "SUFFIX"
    )
    blocks = find_marker_blocks(text)
    new = splice_blocks(text, blocks, ["NEW"])
    assert new == (
        "PREFIX\n"
        "<!-- WIKILINK-RULES:x -->NEW<!-- /WIKILINK-RULES:x -->\n"
        "SUFFIX"
    )


def test_splice_handles_multiple_blocks_in_order():
    text = (
        "<!-- WIKILINK-RULES:a -->A<!-- /WIKILINK-RULES:a -->\n"
        "<!-- WIKILINK-RULES:b -->B<!-- /WIKILINK-RULES:b -->\n"
        "<!-- WIKILINK-RULES:c -->C<!-- /WIKILINK-RULES:c -->\n"
    )
    blocks = find_marker_blocks(text)
    new = splice_blocks(text, blocks, ["AA", "BB", "CC"])
    assert "<!-- WIKILINK-RULES:a -->AA<!-- /WIKILINK-RULES:a -->" in new
    assert "<!-- WIKILINK-RULES:b -->BB<!-- /WIKILINK-RULES:b -->" in new
    assert "<!-- WIKILINK-RULES:c -->CC<!-- /WIKILINK-RULES:c -->" in new
