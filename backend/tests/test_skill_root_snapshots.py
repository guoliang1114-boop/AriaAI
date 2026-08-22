from __future__ import annotations

import os
from pathlib import Path

import pytest
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select
import yaml

from app.models.db import Skill
from app.routers import skills as skills_module
from app.services.agent_harness.skill_roots import (
    SkillRootLoader,
    SkillRootSpec,
)
from app.routers.chat_schemas import SendMessageRequest
from app.services.skill_router import (
    auto_select_skill,
    rank_published_skill_candidates,
)


def _write_skill(
    root: Path,
    key: str,
    *,
    name: str = "demo",
    description: str = "Demonstration workflow",
    body: str = "Follow the workflow.",
) -> Path:
    skill_dir = root / key
    skill_dir.mkdir(parents=True, exist_ok=True)
    skill_path = skill_dir / "SKILL.md"
    skill_path.write_text(
        f"---\nname: {name}\ndescription: {description}\n---\n{body}\n",
        encoding="utf-8",
    )
    return skill_path


def test_ordered_roots_use_first_valid_package_key(tmp_path: Path) -> None:
    high = tmp_path / "high"
    low = tmp_path / "low"
    _write_skill(high, "demo", body="High-priority instructions.")
    _write_skill(low, "demo", body="Low-priority instructions.")

    catalog = SkillRootLoader().load(
        [
            SkillRootSpec(low, priority=100, source="low"),
            SkillRootSpec(high, priority=10, source="high"),
        ]
    )

    assert str(catalog.prompt("demo")) == "High-priority instructions."
    assert any(issue.code == "shadowed_package" for issue in catalog.issues)


def test_unchanged_roots_hit_cache_and_only_changed_root_refreshes(tmp_path: Path) -> None:
    first_root = tmp_path / "first"
    second_root = tmp_path / "second"
    first_path = _write_skill(first_root, "alpha", body="Alpha v1.")
    _write_skill(second_root, "beta", body="Beta v1.")
    loader = SkillRootLoader()
    specs = [SkillRootSpec(first_root, priority=1), SkillRootSpec(second_root, priority=2)]

    first = loader.load(specs)
    second = loader.load(specs)
    first_path.write_text(
        "---\nname: alpha\ndescription: Alpha workflow\n---\nAlpha version two.\n",
        encoding="utf-8",
    )
    stat = first_path.stat()
    os.utime(first_path, ns=(stat.st_atime_ns, stat.st_mtime_ns + 1_000_000))
    third = loader.load(specs)

    assert first.refreshed_roots == 2
    assert second.cache_hits == 2
    assert second.refreshed_roots == 0
    assert third.cache_hits == 1
    assert third.refreshed_roots == 1
    assert first.fingerprint != third.fingerprint
    assert str(third.prompt("alpha")) == "Alpha version two."


def test_invalid_package_is_isolated_from_valid_sibling(tmp_path: Path) -> None:
    root = tmp_path / "skills"
    _write_skill(root, "good", body="Good instructions.")
    bad_dir = root / "bad"
    bad_dir.mkdir(parents=True)
    (bad_dir / "SKILL.md").write_text(
        "---\nname: bad\n---\nBad instructions.\n",
        encoding="utf-8",
    )

    catalog = SkillRootLoader().load([SkillRootSpec(root)])

    assert str(catalog.prompt("good")) == "Good instructions."
    assert catalog.get("bad") is None
    assert any(issue.code == "invalid_skill" and Path(issue.path).parent.name == "bad" for issue in catalog.issues)


@pytest.mark.skipif(not hasattr(os, "symlink"), reason="symlinks unavailable")
def test_symlinked_skill_file_is_not_loaded(tmp_path: Path) -> None:
    root = tmp_path / "skills"
    _write_skill(root, "good", body="Good instructions.")
    outside = tmp_path / "outside.md"
    outside.write_text(
        "---\nname: escaped\ndescription: Escaped workflow\n---\nSecret.\n",
        encoding="utf-8",
    )
    linked_dir = root / "linked"
    linked_dir.mkdir(parents=True)
    os.symlink(outside, linked_dir / "SKILL.md")

    catalog = SkillRootLoader().load([SkillRootSpec(root)])

    assert catalog.get("good") is not None
    assert catalog.get("linked") is None
    assert any(issue.code == "symlink_file_ignored" for issue in catalog.issues)


def test_catalog_prompt_is_frozen_until_incremental_refresh(tmp_path: Path) -> None:
    root = tmp_path / "skills"
    skill_path = _write_skill(root, "demo", body="Main instructions.")
    reference = skill_path.parent / "guide.md"
    reference.write_text("Reference v1.", encoding="utf-8")
    loader = SkillRootLoader()
    spec = [SkillRootSpec(root)]

    first = loader.load(spec)
    first_prompt = first.prompt("demo", ["guide.md"])
    reference.write_text("Reference version two.", encoding="utf-8")
    stat = reference.stat()
    os.utime(reference, ns=(stat.st_atime_ns, stat.st_mtime_ns + 1_000_000))

    assert "Reference v1." in first_prompt
    second = loader.load(spec)
    assert "Reference version two." in second.prompt("demo", ["guide.md"])
    assert first.fingerprint != second.fingerprint


def test_ambiguous_nested_basename_requires_full_package_key(tmp_path: Path) -> None:
    root = tmp_path / "skills"
    _write_skill(root, "team-a/demo", name="demo-a")
    _write_skill(root, "team-b/demo", name="demo-b")

    catalog = SkillRootLoader().load([SkillRootSpec(root)])

    assert catalog.get("demo") is None
    assert catalog.get("team-a/demo").document.name == "demo-a"
    assert catalog.get("team-b/demo").document.name == "demo-b"


def test_reference_traversal_fails_closed_without_breaking_catalog(tmp_path: Path) -> None:
    root = tmp_path / "skills"
    _write_skill(root, "demo")
    catalog = SkillRootLoader().load([SkillRootSpec(root)])

    prompt = catalog.prompt("demo", ["../secret.md"])

    assert prompt == ""
    assert "escapes skill package root" in prompt.load_error


def test_skill_selection_golden_cases_are_deterministic() -> None:
    cases_path = Path(__file__).parent / "golden_chat_set" / "skill_selection_cases.yaml"
    cases = yaml.safe_load(cases_path.read_text(encoding="utf-8"))["cases"]

    for case in cases:
        skills = [
            Skill(
                id=item["id"],
                name=item["name"],
                description=item["description"],
                category=item["category"],
            )
            for item in case["skills"]
        ]
        ranked, fingerprint = rank_published_skill_candidates(case["content"], skills)
        assert ranked, case["id"]
        assert ranked[0]["skill_id"] == case["expected_top_skill_id"], case["id"]
        assert ranked[0]["score"] >= case["expected_min_score"], case["id"]
        tied = len(ranked) > 1 and ranked[0]["score"] == ranked[1]["score"]
        assert tied is case["expected_tied"], case["id"]
        assert len(fingerprint) == 64


def test_auto_selection_rejects_ambiguous_high_confidence_tie() -> None:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    try:
        with Session(engine) as session:
            session.add(
                Skill(
                    name="presentation-builder-a",
                    description="PowerPoint generation skill.",
                    category="consulting",
                )
            )
            session.add(
                Skill(
                    name="presentation-builder-b",
                    description="PowerPoint generation skill.",
                    category="consulting",
                )
            )
            session.commit()

            selected, decision = auto_select_skill(
                session,
                SendMessageRequest(content="帮我制作一个 PPT。", project_id=7),
            )

        assert selected is None
        assert decision.apply is False
        assert decision.reason == "auto_skill_ambiguous_match"
        assert len(decision.top_candidates) == 2
        assert decision.catalog_fingerprint
        assert decision.candidate_count == 2
    finally:
        engine.dispose()


def test_publish_sync_refreshes_changed_high_priority_package(
    tmp_path: Path,
    monkeypatch,
) -> None:
    custom_root = tmp_path / "custom-skills"
    skill_path = _write_skill(
        custom_root,
        "office-document-editor",
        name="office-document-editor",
        description="Custom Office editing workflow",
        body="office-document-editor workflow custom-v1",
    )
    specs = (
        SkillRootSpec(custom_root, priority=0, source="test-custom"),
        SkillRootSpec(skills_module.SKILLS_DIR, priority=10_000, source="aria-bundled"),
    )
    monkeypatch.setattr(skills_module, "_configured_skill_root_specs", lambda: specs)
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)

    try:
        with Session(engine) as session:
            skills_module.ensure_builtin_pro_skills(session)
            published = session.exec(
                select(Skill).where(
                    Skill.name == skills_module.OFFICE_DOCUMENT_EDITOR_SKILL_NAME
                )
            ).one()
            first_hash = published.builtin_hash
            assert "custom-v1" in published.system_prompt

        skill_path.write_text(
            "---\nname: office-document-editor\n"
            "description: Custom Office editing workflow\n---\n"
            "office-document-editor workflow custom-version-two\n",
            encoding="utf-8",
        )
        stat = skill_path.stat()
        os.utime(skill_path, ns=(stat.st_atime_ns, stat.st_mtime_ns + 1_000_000))

        with Session(engine) as session:
            changed = skills_module.ensure_builtin_pro_skills(session)
            published = session.exec(
                select(Skill).where(
                    Skill.name == skills_module.OFFICE_DOCUMENT_EDITOR_SKILL_NAME
                )
            ).one()
            assert changed >= 1
            assert "custom-version-two" in published.system_prompt
            assert published.builtin_hash != first_hash
    finally:
        skills_module._skill_root_catalog = None
        skills_module._skill_root_loader.cache.clear()
        engine.dispose()
