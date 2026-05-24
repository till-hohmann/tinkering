"""Tests for the vault walker + note index, especially alias handling."""

from pathlib import Path

from plaud_obsidian.common.vault import build_note_index, walk_md


def _w(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def test_walk_md_skips_hidden_dirs_and_excludes(tmp_path: Path):
    _w(tmp_path / "a.md", "x")
    _w(tmp_path / ".obsidian" / "config.md", "should be skipped")
    _w(tmp_path / "_Meta" / "x.md", "excluded by config")
    _w(tmp_path / "subdir" / "b.md", "y")
    paths = sorted(p for p, _ in walk_md(tmp_path, exclude_folders=["_Meta"]))
    assert paths == ["a.md", "subdir/b.md"]


def test_note_index_picks_up_titles_and_aliases(tmp_path: Path):
    _w(tmp_path / "Anna Schmidt.md", "---\naliases: [Anna, A.S.]\n---\nbody")
    _w(tmp_path / "Bob Lee.md", "---\nrole: x\n---\nbody")
    idx = build_note_index(tmp_path)
    assert sorted(idx.all_titles()) == ["Anna Schmidt", "Bob Lee"]
    # Aliases resolve to the canonical note.
    assert idx.get("Anna").title == "Anna Schmidt"
    assert idx.get("anna").title == "Anna Schmidt"  # case-insensitive
    assert idx.get("A.S.").title == "Anna Schmidt"
    assert idx.get("Bob Lee").title == "Bob Lee"
    assert idx.get("does not exist") is None


def test_note_index_title_wins_over_alias_collision(tmp_path: Path):
    # If 'Anna' is both a note title and an alias of 'Anna Schmidt', the
    # standalone note wins (alias doesn't overwrite).
    _w(tmp_path / "Anna Schmidt.md", "---\naliases: [Anna]\n---\nx")
    _w(tmp_path / "Anna.md", "---\nrole: different person\n---\nx")
    idx = build_note_index(tmp_path)
    assert idx.get("anna").title == "Anna"
    assert idx.name_source_lc["anna"] == "title"


def test_aliases_singleton_scalar_works(tmp_path: Path):
    # Obsidian permits `aliases: bare-string` not just `aliases: [list]`.
    _w(tmp_path / "Anna Schmidt.md", "---\naliases: Anna\n---\nx")
    idx = build_note_index(tmp_path)
    assert idx.get("Anna").title == "Anna Schmidt"


def test_aliases_with_bracketed_wikilink_form(tmp_path: Path):
    # Some people write `aliases: [[Other Name]]`. Strip brackets.
    _w(tmp_path / "Anna Schmidt.md", "---\naliases: [[Anna]]\n---\nx")
    idx = build_note_index(tmp_path)
    assert idx.get("Anna").title == "Anna Schmidt"
