"""Tests for plaud-graph-audit. Build a tiny vault inline for each test
so we can assert exactly what each analysis surfaces."""

import json
import os
import time
from pathlib import Path

from plaud_obsidian.common.config import load_config
from plaud_obsidian.graph.audit import build_audit_report


REPO_ROOT = Path(__file__).resolve().parent.parent


def _w(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def _make_vault_and_cfg(tmp_path: Path, **cfg_over) -> Path:
    vault = tmp_path / "vault"
    vault.mkdir()
    (vault / "_Meta" / "Indices").mkdir(parents=True)
    (tmp_path / "recordings").mkdir()

    cfg_obj = {
        "paths": {
            "recordings_dir": str(tmp_path / "recordings"),
            "vault_root": str(vault),
        },
        "indices": [
            {"id": "people", "path": "_Meta/Indices/People Index.md"},
        ],
        "graph_audit": {
            "semantic_folders": ["People"],
            "exclude_folders": ["_Meta"],
            "min_phrase_count": 2,
            "max_stale_backlinks": 0,
            "min_stale_age_days": 0,
        },
    }
    cfg_obj.update(cfg_over)
    cfg_path = tmp_path / "config.json"
    cfg_path.write_text(json.dumps(cfg_obj, indent=2), encoding="utf-8")
    return cfg_path


def test_missing_from_indices_surfaces_unindexed_referenced_links(tmp_path: Path):
    cfg_path = _make_vault_and_cfg(tmp_path)
    vault = Path(json.loads(cfg_path.read_text())["paths"]["vault_root"])

    # People Index lists Anna only.
    _w(vault / "_Meta/Indices/People Index.md",
       "## Team\n- [[Anna Schmidt]]\n")
    # A note that references both Anna (indexed, fine) and Bob (NOT indexed,
    # and no Bob note exists).
    _w(vault / "Meeting.md",
       "Talked with [[Anna Schmidt]] and [[Bob Lee]] about the rollout.")

    cfg = load_config(cfg_path)
    report = build_audit_report(cfg)

    names = [e.name for e in report.missing_from_indices]
    assert "Bob Lee" in names
    assert "Anna Schmidt" not in names


def test_stale_in_indices_surfaces_unreferenced_index_entries(tmp_path: Path):
    cfg_path = _make_vault_and_cfg(tmp_path)
    vault = Path(json.loads(cfg_path.read_text())["paths"]["vault_root"])

    # Index lists Anna AND Carla. Only Anna is referenced.
    _w(vault / "_Meta/Indices/People Index.md",
       "## Team\n- [[Anna Schmidt]]\n- [[Carla Reyes]]\n")
    _w(vault / "Note.md", "About [[Anna Schmidt]] today.")

    cfg = load_config(cfg_path)
    report = build_audit_report(cfg)

    names = [e.name for e in report.stale_in_indices]
    assert "Carla Reyes" in names
    assert "Anna Schmidt" not in names


def test_concept_candidates_includes_broken_wikilinks(tmp_path: Path):
    cfg_path = _make_vault_and_cfg(tmp_path)
    vault = Path(json.loads(cfg_path.read_text())["paths"]["vault_root"])

    _w(vault / "_Meta/Indices/People Index.md", "## Team\n")  # empty
    _w(vault / "n1.md", "Discussed [[Project Phoenix]] with the team.")
    _w(vault / "n2.md", "[[Project Phoenix]] kicked off in Q1.")

    cfg = load_config(cfg_path)
    report = build_audit_report(cfg)
    names = [c.name for c in report.concept_candidates]
    assert "Project Phoenix" in names
    cand = next(c for c in report.concept_candidates if c.name == "Project Phoenix")
    assert "broken_wikilink" in cand.sources


def test_concept_candidates_includes_recurring_titlecase_phrase(tmp_path: Path):
    cfg_path = _make_vault_and_cfg(tmp_path)
    vault = Path(json.loads(cfg_path.read_text())["paths"]["vault_root"])

    _w(vault / "_Meta/Indices/People Index.md", "## Team\n")
    # Same Title-Case phrase in 2 notes (min_phrase_count=2 in test cfg),
    # no wikilink wrapper, no note with that title.
    _w(vault / "a.md", "The Acme Migration is going well.")
    _w(vault / "b.md", "Status of the Acme Migration: complete.")

    cfg = load_config(cfg_path)
    report = build_audit_report(cfg)
    names = [c.name for c in report.concept_candidates]
    assert "Acme Migration" in names


def test_stale_notes_flags_semantic_folder_with_no_backlinks(tmp_path: Path):
    cfg_path = _make_vault_and_cfg(tmp_path)
    vault = Path(json.loads(cfg_path.read_text())["paths"]["vault_root"])

    _w(vault / "_Meta/Indices/People Index.md", "## Team\n")
    _w(vault / "People" / "Forgotten Person.md", "An old note no one links to.")
    _w(vault / "Other.md", "Talks about something else entirely.")

    # Make the People note look older than the cutoff.
    p = vault / "People" / "Forgotten Person.md"
    old = time.time() - 60  # 60 seconds ago > min_stale_age_days=0 days
    os.utime(p, (old, old))

    cfg = load_config(cfg_path)
    report = build_audit_report(cfg)
    titles = [s.title for s in report.stale_notes]
    assert "Forgotten Person" in titles


def test_alias_reference_does_not_surface_as_missing(tmp_path: Path):
    """If a note has aliases, references via the alias resolve to the
    canonical note and must not count as 'missing from indices'."""
    cfg_path = _make_vault_and_cfg(tmp_path)
    vault = Path(json.loads(cfg_path.read_text())["paths"]["vault_root"])

    _w(vault / "_Meta/Indices/People Index.md",
       "## Team\n- [[Anna Schmidt]]\n")
    _w(vault / "Anna Schmidt.md", "---\naliases: [Anna]\n---\nbio")
    _w(vault / "Meeting.md", "Spoke to [[Anna]] about Q2.")

    cfg = load_config(cfg_path)
    report = build_audit_report(cfg)
    names = [e.name for e in report.missing_from_indices]
    # Anna resolves to Anna Schmidt via alias → not missing.
    assert "Anna" not in names
