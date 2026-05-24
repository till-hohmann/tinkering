"""Tests for the index file parser."""

from pathlib import Path

from plaud_obsidian.common.indices import parse_index, UNCATEGORISED


def test_parses_h2_categories(tmp_path: Path):
    p = tmp_path / "People.md"
    p.write_text(
        "# People\n\n"
        "## Team\n\n"
        "- [[Anna Schmidt]] — eng\n"
        "- [[Bob Lee]] — product\n\n"
        "## External\n\n"
        "- [[Dilan Ozkan]]\n",
        encoding="utf-8",
    )
    idx = parse_index("people", p)
    assert idx.all_categories() == ["Team", "External"]
    assert idx.category("Team") == ["Anna Schmidt", "Bob Lee"]
    assert idx.category("External") == ["Dilan Ozkan"]


def test_dedupes_within_category(tmp_path: Path):
    p = tmp_path / "P.md"
    p.write_text(
        "## Team\n\n- [[Anna Schmidt]]\n- [[Anna Schmidt]]\n- [[Bob Lee]]\n",
        encoding="utf-8",
    )
    idx = parse_index("people", p)
    assert idx.category("Team") == ["Anna Schmidt", "Bob Lee"]


def test_skips_yaml_frontmatter(tmp_path: Path):
    p = tmp_path / "P.md"
    p.write_text(
        "---\n"
        "type: index\n"
        "tags: [[ShouldBeIgnored]]\n"
        "---\n\n"
        "## Team\n\n- [[Real Person]]\n",
        encoding="utf-8",
    )
    idx = parse_index("people", p)
    assert idx.category("Team") == ["Real Person"]
    # The frontmatter wikilink-shaped string must not leak in as
    # uncategorised content.
    assert UNCATEGORISED not in idx.categories


def test_handles_wikilinks_above_first_h2(tmp_path: Path):
    p = tmp_path / "P.md"
    p.write_text(
        "Intro text mentioning [[Loose Reference]] before any heading.\n\n"
        "## Team\n\n- [[Anna]]\n",
        encoding="utf-8",
    )
    idx = parse_index("people", p)
    assert idx.category("Team") == ["Anna"]
    assert idx.category(UNCATEGORISED) == ["Loose Reference"]


def test_missing_file_returns_empty(tmp_path: Path):
    idx = parse_index("people", tmp_path / "does-not-exist.md")
    assert idx.all_categories() == []


def test_wikilink_with_alias_pipe(tmp_path: Path):
    p = tmp_path / "P.md"
    p.write_text(
        "## Team\n\n- [[Real Name|Display Name]] — note\n",
        encoding="utf-8",
    )
    idx = parse_index("people", p)
    # Target wins over display; the templater renders by target.
    assert idx.category("Team") == ["Real Name"]
