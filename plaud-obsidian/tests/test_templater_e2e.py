"""End-to-end templater test: load example config + sample vault, run the
templater, assert the templates note got the wikilinks spliced in."""

import json
import shutil
from pathlib import Path

import pytest

from plaud_obsidian.common.config import load_config
from plaud_obsidian.templater.run import build_report, write_report


REPO_ROOT = Path(__file__).resolve().parent.parent


@pytest.fixture()
def staged_env(tmp_path: Path):
    vault = tmp_path / "vault"
    shutil.copytree(REPO_ROOT / "examples" / "sample-vault", vault)
    recordings = tmp_path / "recordings"
    recordings.mkdir()

    cfg_path = tmp_path / "config.json"
    cfg_obj = json.loads(
        (REPO_ROOT / "config.example.json").read_text(encoding="utf-8")
    )
    cfg_obj["paths"]["recordings_dir"] = str(recordings)
    cfg_obj["paths"]["vault_root"] = str(vault)
    cfg_path.write_text(json.dumps(cfg_obj, indent=2), encoding="utf-8")
    return cfg_path, vault


def test_templater_fills_both_blocks(staged_env):
    cfg_path, vault = staged_env
    cfg = load_config(cfg_path)

    report = build_report(cfg)
    assert len(report.changes) == 2
    ids = {c.template_id for c in report.changes}
    assert ids == {"1on1", "project_meeting"}

    # 1on1 pulls people (all categories) + Customers from companies.
    # People Index: Team(3) + External(2) + Personal(1) = 6
    # Companies Index Customers = Acme Corp + Globex Inc = 2 → 8
    one_on_one = next(c for c in report.changes if c.template_id == "1on1")
    assert one_on_one.wikilink_count == 8

    # project_meeting pulls Team from people + all categories from companies.
    # People.Team = 3, Companies.* = Customers(2) + Partners(1) + Tools(2) = 5 → 8
    project = next(c for c in report.changes if c.template_id == "project_meeting")
    assert project.wikilink_count == 8

    # Writing produces a real file change on disk.
    wrote = write_report(report)
    assert wrote is True

    final = (vault / "_Meta" / "PlaudTemplates.md").read_text(encoding="utf-8")
    assert "[[Anna Schmidt]]" in final
    assert "[[Acme Corp]]" in final
    # Static content outside the markers should still be there.
    assert "## 1-on-1 template" in final
    assert "## Project meeting template" in final


def test_templater_idempotent_on_second_run(staged_env):
    cfg_path, vault = staged_env
    cfg = load_config(cfg_path)

    write_report(build_report(cfg))
    # Second run shouldn't change anything.
    report2 = build_report(cfg)
    wrote = write_report(report2)
    assert wrote is False


def test_templater_warns_on_unmatched_block(staged_env):
    cfg_path, vault = staged_env
    note_path = vault / "_Meta" / "PlaudTemplates.md"
    # Inject a marker that no template config matches.
    extra = (
        "\n\n## Orphan template\n\n"
        "<!-- WIKILINK-RULES:orphan_id -->\n"
        "(should be left alone)\n"
        "<!-- /WIKILINK-RULES:orphan_id -->\n"
    )
    note_path.write_text(
        note_path.read_text(encoding="utf-8") + extra,
        encoding="utf-8",
    )
    cfg = load_config(cfg_path)
    report = build_report(cfg)
    assert "orphan_id" in report.unmatched_blocks
    # The unmatched block's inner content must be preserved verbatim.
    assert "(should be left alone)" in report.new_text


def test_templater_reports_unused_template_spec(tmp_path: Path):
    # Vault with empty templates note → all template specs unused.
    vault = tmp_path / "vault"
    shutil.copytree(REPO_ROOT / "examples" / "sample-vault", vault)
    note = vault / "_Meta" / "PlaudTemplates.md"
    note.write_text("# Empty\n\nNo markers here.\n", encoding="utf-8")
    recordings = tmp_path / "recordings"
    recordings.mkdir()

    cfg_obj = json.loads(
        (REPO_ROOT / "config.example.json").read_text(encoding="utf-8")
    )
    cfg_obj["paths"]["recordings_dir"] = str(recordings)
    cfg_obj["paths"]["vault_root"] = str(vault)
    cfg_path = tmp_path / "config.json"
    cfg_path.write_text(json.dumps(cfg_obj, indent=2), encoding="utf-8")

    cfg = load_config(cfg_path)
    report = build_report(cfg)
    assert set(report.unused_template_specs) == {"1on1", "project_meeting"}
    assert report.changes == []
