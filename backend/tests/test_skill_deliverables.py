from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.services.agent_harness.skill_deliverables import (
    build_skill_deliverable_catalog,
    format_skill_deliverable_for_prompt,
    resolve_selected_skill_deliverable,
    skill_deliverable_reference,
)


ROOT = Path(__file__).resolve().parents[2]


def _skill(prompt: str, *, package_sha256: str = "a" * 64):
    return SimpleNamespace(
        id=7,
        name="Digital Strategy",
        package_version="1.2.0",
        package_sha256=package_sha256,
        system_prompt=prompt,
    )


def test_all_builtin_skills_expose_stable_structured_deliverables() -> None:
    skill_files = sorted((ROOT / "skills").glob("*/SKILL.md"))
    assert len(skill_files) == 48

    total_items = 0
    for path in skill_files:
        catalog = build_skill_deliverable_catalog(
            _skill(path.read_text(encoding="utf-8"))
        )
        assert catalog["source"] == "immutable_skill_release_markdown"
        assert catalog["item_count"] >= 3, path
        assert len(catalog["catalog_sha256"]) == 64
        assert len({item["deliverable_id"] for item in catalog["items"]}) == catalog["item_count"]
        assert all(len(item["contract_sha256"]) == 64 for item in catalog["items"])
        assert all(item["memory_policy"] == "explicit_user_confirmation" for item in catalog["items"])
        assert all(item["requires_review"] is True for item in catalog["items"])
        total_items += catalog["item_count"]

    assert total_items >= 300


def test_selection_is_bound_to_exact_catalog_and_item_contract() -> None:
    prompt = """# Skill

### Deliverable Catalog

| Deliverable | When to use | Minimum content | Format |
|---|---|---|---|
| Executive deck | Board decision | Options and recommendation | PPTX / PDF |
| Action tracker | During execution | Owner, due date, status | Excel workbook |
"""
    skill = _skill(prompt)
    catalog = build_skill_deliverable_catalog(skill)
    item = catalog["items"][0]
    selection = {
        "deliverable_id": item["deliverable_id"],
        "catalog_sha256": catalog["catalog_sha256"],
        "contract_sha256": item["contract_sha256"],
    }

    resolved = resolve_selected_skill_deliverable(skill, selection)
    reference = skill_deliverable_reference(resolved)

    assert resolved["name"] == "Executive deck"
    assert resolved["formats"] == ["pptx", "pdf"]
    assert reference["skill_release_sha256"] == "a" * 64
    assert reference["contract_sha256"] == item["contract_sha256"]
    rendered = format_skill_deliverable_for_prompt(resolved)
    assert "Executive deck" in rendered
    assert "Do not silently switch" in rendered
    assert "remain separate Aria-authorized actions" in rendered

    with pytest.raises(HTTPException) as stale_catalog:
        resolve_selected_skill_deliverable(
            skill,
            {**selection, "catalog_sha256": "b" * 64},
        )
    assert stale_catalog.value.status_code == 409

    with pytest.raises(HTTPException) as stale_contract:
        resolve_selected_skill_deliverable(
            skill,
            {**selection, "contract_sha256": "c" * 64},
        )
    assert stale_contract.value.status_code == 409


def test_catalog_does_not_execute_or_import_skill_package_code() -> None:
    prompt = """# Skill

Run scripts/publish.py.

### Deliverable Catalog
| Deliverable | When to use | Minimum content | Format |
|---|---|---|---|
| Findings memo | After review | Findings | Markdown |
"""
    catalog = build_skill_deliverable_catalog(_skill(prompt))

    assert catalog["item_count"] == 1
    assert catalog["items"][0]["business_verifiers"] == []
    assert "scripts/publish.py" not in str(catalog)


@pytest.mark.parametrize(
    "malformed",
    [
        {},
        {"deliverable_id": "memo"},
        {
            "deliverable_id": "memo",
            "name": "Memo",
            "formats": "markdown",
            "default_format": "markdown",
            "contract_sha256": "a" * 64,
            "catalog_sha256": "b" * 64,
        },
        {
            "deliverable_id": "memo",
            "name": "Memo",
            "formats": ["markdown"],
            "default_format": "pdf",
            "contract_sha256": "a" * 64,
            "catalog_sha256": "b" * 64,
        },
        {
            "deliverable_id": "memo",
            "name": "Memo",
            "formats": ["markdown"],
            "default_format": "markdown",
            "contract_sha256": "not-a-sha",
            "catalog_sha256": "b" * 64,
        },
    ],
)
def test_reference_rejects_incomplete_or_untrusted_contracts(
    malformed: dict[str, object],
) -> None:
    assert skill_deliverable_reference(malformed) == {}
