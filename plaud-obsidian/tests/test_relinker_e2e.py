"""End-to-end relinker test: build a tiny vault on tmp_path, run the
report+apply cycle, verify the writes."""

import json
import shutil
import time
from pathlib import Path

import pytest

from plaud_obsidian.common.config import load_config
from plaud_obsidian.relinker.run import apply_report, build_report
from plaud_obsidian.relinker.state import load_state


REPO_ROOT = Path(__file__).resolve().parent.parent


def _make_cfg(tmp_path: Path, vault: Path) -> Path:
    cfg_obj = json.loads(
        (REPO_ROOT / "config.example.json").read_text(encoding="utf-8")
    )
    cfg_obj["paths"]["recordings_dir"] = str(tmp_path / "recordings")
    cfg_obj["paths"]["vault_root"] = str(vault)
    (tmp_path / "recordings").mkdir(exist_ok=True)
    cfg_path = tmp_path / "config.json"
    cfg_path.write_text(json.dumps(cfg_obj, indent=2), encoding="utf-8")
    return cfg_path


def test_relinker_against_sample_vault(tmp_path: Path):
    vault = tmp_path / "vault"
    shutil.copytree(REPO_ROOT / "examples" / "sample-vault", vault)

    # Drop a note in the vault that mentions Anna Schmidt + Anna (alias) +
    # Acme Corp in plain text, in a folder the relinker scans.
    journal_dir = vault / "20_Journal"
    journal_dir.mkdir(parents=True, exist_ok=True)
    note = journal_dir / "test-note.md"
    note.write_text(
        "Today I met Anna Schmidt and her colleague Bob Lee.\n"
        "Anna mentioned Acme Corp is renewing.\n",
        encoding="utf-8",
    )

    cfg_path = _make_cfg(tmp_path, vault)
    cfg = load_config(cfg_path)
    report = build_report(cfg, full=True)
    assert any(fc.rel_path == "20_Journal/test-note.md" for fc in report.files_changed)

    apply_report(cfg, report, stamp=True)
    after = note.read_text(encoding="utf-8")
    assert "[[Anna Schmidt]]" in after
    assert "[[Bob Lee]]" in after
    assert "[[Acme Corp]]" in after
    # "Anna mentioned..." — the bare 'Anna' should resolve via alias.
    assert after.count("[[Anna Schmidt]]") == 2

    # State file got stamped.
    state = load_state(vault / cfg.relinker.state_file)
    assert state["last_run_iso"] is not None


def test_relinker_respects_protected_paths(tmp_path: Path):
    vault = tmp_path / "vault"
    shutil.copytree(REPO_ROOT / "examples" / "sample-vault", vault)

    journal_dir = vault / "20_Journal"
    journal_dir.mkdir(parents=True, exist_ok=True)
    protected = journal_dir / "do-not-touch.md"
    protected.write_text("Met Anna Schmidt.", encoding="utf-8")

    cfg_obj = json.loads(
        (REPO_ROOT / "config.example.json").read_text(encoding="utf-8")
    )
    cfg_obj["paths"]["recordings_dir"] = str(tmp_path / "recordings")
    cfg_obj["paths"]["vault_root"] = str(vault)
    cfg_obj["relinker"] = {
        "protected_paths": ["20_Journal/do-not-touch.md"],
    }
    (tmp_path / "recordings").mkdir(exist_ok=True)
    cfg_path = tmp_path / "config.json"
    cfg_path.write_text(json.dumps(cfg_obj, indent=2), encoding="utf-8")

    cfg = load_config(cfg_path)
    report = build_report(cfg, full=True)
    # Protected file should not appear in the changeset.
    assert all(
        fc.rel_path != "20_Journal/do-not-touch.md"
        for fc in report.files_changed
    )


def test_relinker_skips_templates_note(tmp_path: Path):
    """The templater owns the templates note; the relinker must never write
    to it (would corrupt the WIKILINK-RULES markers)."""
    vault = tmp_path / "vault"
    shutil.copytree(REPO_ROOT / "examples" / "sample-vault", vault)

    # PlaudTemplates.md already lives in _Meta which is excluded — but if
    # the user moves it elsewhere, the templates_note path-skip should
    # still protect it. Test that.
    moved = vault / "10_Meetings" / "Templates.md"
    moved.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy(vault / "_Meta" / "PlaudTemplates.md", moved)

    cfg_obj = json.loads(
        (REPO_ROOT / "config.example.json").read_text(encoding="utf-8")
    )
    cfg_obj["paths"]["recordings_dir"] = str(tmp_path / "recordings")
    cfg_obj["paths"]["vault_root"] = str(vault)
    cfg_obj["templates_note"] = "10_Meetings/Templates.md"
    (tmp_path / "recordings").mkdir(exist_ok=True)
    cfg_path = tmp_path / "config.json"
    cfg_path.write_text(json.dumps(cfg_obj, indent=2), encoding="utf-8")

    cfg = load_config(cfg_path)
    report = build_report(cfg, full=True)
    assert all(
        fc.rel_path != "10_Meetings/Templates.md"
        for fc in report.files_changed
    )


def test_relinker_incremental_mode_only_scans_changed_files(tmp_path: Path):
    vault = tmp_path / "vault"
    shutil.copytree(REPO_ROOT / "examples" / "sample-vault", vault)

    journal_dir = vault / "20_Journal"
    journal_dir.mkdir(parents=True, exist_ok=True)
    old = journal_dir / "old.md"
    old.write_text("Met Anna Schmidt.", encoding="utf-8")

    cfg_path = _make_cfg(tmp_path, vault)
    cfg = load_config(cfg_path)
    # First full pass writes 'old.md' and stamps the state.
    report1 = build_report(cfg, full=True)
    apply_report(cfg, report1, stamp=True)
    assert any(fc.rel_path == "20_Journal/old.md" for fc in report1.files_changed)

    # Wait a beat so subsequent mtimes are reliably after the stamp.
    time.sleep(1.1)

    # Make a NEW file that needs relinking. Old file is unchanged.
    new_file = journal_dir / "new.md"
    new_file.write_text("Met Bob Lee.", encoding="utf-8")

    report2 = build_report(cfg, full=False)
    rels = {fc.rel_path for fc in report2.files_changed}
    assert "20_Journal/new.md" in rels
    assert "20_Journal/old.md" not in rels
