"""Unit tests for the per-file relinker logic."""

from plaud_obsidian.common.vault import NoteInfo
from plaud_obsidian.relinker.linker import relink_file_text


def _notes(*specs):
    """specs is a list of (title, [aliases]) tuples."""
    out = []
    for title, aliases in specs:
        out.append(NoteInfo(
            title=title, rel_path=f"{title}.md", abs_path=None, aliases=list(aliases),
        ))
    return out


def _kwargs(notes, **over):
    base = dict(
        note_title="Source",
        rel_path="folder/Source.md",
        notes=notes,
        skip_prefixes=["TPL ", "Dashboard "],
        skip_exact=set(),
        skip_state_titles=set(),
        skip_occurrences=[],
        min_title_length=4,
    )
    base.update(over)
    return base


def test_basic_link_insertion():
    notes = _notes(("Anna Schmidt", []))
    new, changes = relink_file_text(
        "Met with Anna Schmidt today.",
        **_kwargs(notes),
    )
    assert new == "Met with [[Anna Schmidt]] today."
    assert len(changes) == 1
    assert changes[0].title == "Anna Schmidt"


def test_alias_links_to_canonical():
    notes = _notes(("Anna Schmidt", ["Anna"]))
    new, changes = relink_file_text(
        "Spoke to Anna about the cutover.",
        **_kwargs(notes),
    )
    assert new == "Spoke to [[Anna Schmidt]] about the cutover."
    assert changes[0].title == "Anna Schmidt"
    assert changes[0].matched_text == "Anna"


def test_does_not_double_link_existing_wikilinks():
    notes = _notes(("Anna Schmidt", []))
    new, _ = relink_file_text(
        "Already linked: [[Anna Schmidt]] should stay one pair.",
        **_kwargs(notes),
    )
    assert new == "Already linked: [[Anna Schmidt]] should stay one pair."


def test_skips_inside_fenced_code_blocks():
    notes = _notes(("Anna Schmidt", []))
    input_text = (
        "Outside: Anna Schmidt is mentioned.\n"
        "```\n"
        "code: Anna Schmidt should not be linked here\n"
        "```\n"
        "Outside again: Anna Schmidt.\n"
    )
    new, _ = relink_file_text(input_text, **_kwargs(notes))
    assert "code: [[Anna Schmidt]]" not in new
    assert new.count("[[Anna Schmidt]]") == 2


def test_skips_inside_inline_backticks():
    notes = _notes(("Anna Schmidt", []))
    new, _ = relink_file_text(
        "Use `Anna Schmidt` as the placeholder. Real ref: Anna Schmidt.",
        **_kwargs(notes),
    )
    assert "`Anna Schmidt`" in new
    assert "[[Anna Schmidt]]" in new
    assert new.count("[[Anna Schmidt]]") == 1


def test_skips_frontmatter():
    notes = _notes(("Anna Schmidt", []))
    new, _ = relink_file_text(
        "---\nrelated: Anna Schmidt\n---\n\nIn body: Anna Schmidt.\n",
        **_kwargs(notes),
    )
    assert "related: Anna Schmidt\n" in new  # untouched
    assert "[[Anna Schmidt]]" in new          # linked in body


def test_skips_headings_and_dataview_inline():
    notes = _notes(("Anna Schmidt", []))
    new, _ = relink_file_text(
        "# Anna Schmidt\n\nrelated:: Anna Schmidt\n\nBody Anna Schmidt.\n",
        **_kwargs(notes),
    )
    assert "# Anna Schmidt\n" in new
    assert "related:: Anna Schmidt" in new
    assert "Body [[Anna Schmidt]]" in new


def test_word_boundary_prevents_partial_match():
    notes = _notes(("Anna", []))
    # Should NOT link the "Anna" inside "Annapolis"
    new, _ = relink_file_text(
        "Annapolis is a city.",
        **_kwargs(notes, min_title_length=3),
    )
    assert new == "Annapolis is a city."


def test_longest_title_wins():
    notes = _notes(("Anna", []), ("Anna Schmidt", []))
    new, _ = relink_file_text(
        "Met with Anna Schmidt today.",
        **_kwargs(notes),
    )
    # Should bind 'Anna Schmidt' (longer), not 'Anna' partial.
    assert new == "Met with [[Anna Schmidt]] today."


def test_skip_title_via_state_titles():
    notes = _notes(("Anna Schmidt", []))
    new, changes = relink_file_text(
        "Met with Anna Schmidt today.",
        **_kwargs(notes, skip_state_titles={"Anna Schmidt"}),
    )
    assert new == "Met with Anna Schmidt today."
    assert changes == []


def test_skip_occurrence_for_specific_file():
    notes = _notes(("Anna Schmidt", []))
    new, _ = relink_file_text(
        "Met with Anna Schmidt today.",
        **_kwargs(notes, skip_occurrences=[
            {"file": "folder/Source.md", "title": "Anna Schmidt"},
        ]),
    )
    assert new == "Met with Anna Schmidt today."


def test_does_not_link_into_own_note():
    notes = _notes(("Source", []), ("Anna Schmidt", []))
    new, changes = relink_file_text(
        "I'm Source. Met with Anna Schmidt today.",
        **_kwargs(notes),
    )
    assert "[[Source]]" not in new
    assert "[[Anna Schmidt]]" in new


def test_min_title_length_filters_short_titles():
    notes = _notes(("Hi", []), ("Anna Schmidt", []))
    new, _ = relink_file_text(
        "Hi Anna Schmidt.",
        **_kwargs(notes, min_title_length=4),
    )
    assert "[[Hi]]" not in new
    assert "[[Anna Schmidt]]" in new


def test_dated_notes_are_not_used_as_link_targets():
    # 2026-04-15 looks like a journal note; shouldn't be turned into a link
    # if it happens to appear as plain text.
    notes = _notes(("2026-04-15", []), ("Anna Schmidt", []))
    new, _ = relink_file_text(
        "On 2026-04-15 I met Anna Schmidt.",
        **_kwargs(notes),
    )
    assert "[[2026-04-15]]" not in new
    assert "[[Anna Schmidt]]" in new
