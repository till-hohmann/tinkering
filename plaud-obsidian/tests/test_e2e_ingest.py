"""End-to-end test: load the example config, point it at the sample-recordings
fixtures + a temp sample vault, run the ingester, assert the resulting tree."""

import json
import shutil
from pathlib import Path

import pytest

from plaud_obsidian.common.config import load_config
from plaud_obsidian.ingester.plan import build_plan
from plaud_obsidian.ingester.run import execute_plan


REPO_ROOT = Path(__file__).resolve().parent.parent


@pytest.fixture()
def staged_env(tmp_path: Path):
    """Build an isolated test environment from the example fixtures."""
    recordings = tmp_path / "recordings"
    vault = tmp_path / "vault"
    shutil.copytree(REPO_ROOT / "examples" / "sample-recordings", recordings)
    shutil.copytree(REPO_ROOT / "examples" / "sample-vault", vault)

    cfg_path = tmp_path / "config.json"
    cfg_obj = json.loads(
        (REPO_ROOT / "config.example.json").read_text(encoding="utf-8")
    )
    cfg_obj["paths"]["recordings_dir"] = str(recordings)
    cfg_obj["paths"]["vault_root"] = str(vault)
    cfg_path.write_text(json.dumps(cfg_obj, indent=2), encoding="utf-8")

    return cfg_path, recordings, vault


def test_full_ingest_routes_correctly(staged_env):
    cfg_path, recordings, vault = staged_env
    cfg = load_config(cfg_path)

    sources = sorted(p for p in recordings.glob("*.md"))
    plan = build_plan(sources, cfg)
    result = execute_plan(plan, cfg, delete_sources=True)

    # 5 inputs, all copied successfully.
    assert len(result.copied) == 5
    assert result.skipped == []

    # Routing assertions.
    landed = {e.target_filename: e.target_folder for e in result.copied}

    assert "2026-04-15_1on1_Anna Schmidt.md" in landed
    assert landed["2026-04-15_1on1_Anna Schmidt.md"] == "10_Meetings/14_1on1"

    assert "2026-04-16_GEN_Q2 Planning Session.md" in landed
    assert landed["2026-04-16_GEN_Q2 Planning Session.md"] == "10_Meetings/11_General"

    assert "2026-04-19_GEN_Initech Labs Kickoff.md" in landed
    assert landed["2026-04-19_GEN_Initech Labs Kickoff.md"] == "10_Meetings/11_General"

    assert "2026-04-17_Journal.md" in landed
    assert landed["2026-04-17_Journal.md"] == "20_Journal"

    # The Untitled Recording has no 'type', should hit the inbox.
    inbox_hits = [n for n, f in landed.items() if f == "00_Inbox"]
    assert len(inbox_hits) == 1
    assert "Inbox" in inbox_hits[0]

    # State file recorded all five.
    state_path = recordings / ".plaud_ingested.json"
    assert state_path.exists()
    state = json.loads(state_path.read_text(encoding="utf-8"))
    assert len(state["ingested"]) == 5

    # Sources were deleted.
    remaining_md = [p for p in recordings.glob("*.md")]
    assert remaining_md == []

    # All targets exist on disk in the vault.
    for fname, folder in landed.items():
        assert (vault / folder / fname).exists(), f"missing: {folder}/{fname}"


def test_rerun_finds_nothing_new(staged_env):
    cfg_path, recordings, vault = staged_env
    cfg = load_config(cfg_path)

    sources = sorted(p for p in recordings.glob("*.md"))
    plan = build_plan(sources, cfg)
    execute_plan(plan, cfg, delete_sources=True)

    # Re-run with no new files staged.
    sources_after = sorted(p for p in recordings.glob("*.md"))
    plan_after = build_plan(sources_after, cfg)
    # Sources have been deleted, so there's literally nothing to plan.
    assert plan_after == []


def test_collision_appends_suffix(staged_env):
    cfg_path, recordings, vault = staged_env
    cfg = load_config(cfg_path)

    # Pre-create a file that will collide with the 1-on-1 target.
    target_dir = vault / "10_Meetings" / "14_1on1"
    target_dir.mkdir(parents=True, exist_ok=True)
    (target_dir / "2026-04-15_1on1_Anna Schmidt.md").write_text("pre-existing")

    sources = sorted(p for p in recordings.glob("*.md"))
    plan = build_plan(sources, cfg)
    one_on_one = next(e for e in plan if "1on1" in e.target_filename)
    assert one_on_one.target_filename == "2026-04-15_1on1_Anna Schmidt_2.md"
