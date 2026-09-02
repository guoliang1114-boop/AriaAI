from types import SimpleNamespace

from app.services.agent_harness.skill_runtime_contract import (
    build_skill_runtime_contract,
    finalize_skill_runtime_contract,
    format_skill_runtime_contract_for_prompt,
    skill_runtime_contract_warnings,
)


def test_skill_runtime_contract_binds_selected_release_resources_and_policy_tools():
    skill = SimpleNamespace(
        builtin_key="digital-strategy",
        package_version="2.4.1",
        package_status="stable",
        package_sha256="a" * 64,
        tools_definition_json=(
            '[{"name":"read_project"},{"name":"write_project"}]'
        ),
        system_prompt=(
            "# Skill\n\nInstructions.\n\n---\n\n"
            "## Bundled Reference: references/quality-checklist.md\n\n"
            "# Quality Checklist\n\n- [ ] Cite sources\n- [ ] Check totals\n\n"
            "## Bundled Reference: examples/standard.md\n\nExample content"
        ),
    )

    contract = build_skill_runtime_contract(
        skill,
        release_id=17,
        granted_tools=[{"name": "read_project"}, {"name": "project_context"}],
    )

    assert contract["load_status"] == "loaded"
    assert contract["package_kind"] == "bundled"
    assert contract["release_id"] == "17"
    assert contract["release_sha256"] == "a" * 64
    assert contract["resource_names"] == [
        "references/quality-checklist.md",
        "examples/standard.md",
    ]
    assert contract["declared_tool_count"] == 2
    assert contract["granted_tool_count"] == 1
    assert contract["policy_filtered_tool_count"] == 1
    assert contract["verification_status"] == "available"
    assert contract["verification_step_count"] == 2
    assert contract["instruction_complete"] is True
    assert contract["verification_context_complete"] is True
    assert contract["scripts_executable"] is False


def test_skill_runtime_contract_does_not_treat_mentioned_scripts_as_executable():
    skill = SimpleNamespace(
        builtin_key="proposal",
        package_version="1.0.0",
        package_status="stable",
        package_sha256="b" * 64,
        tools_definition_json="[]",
        system_prompt="Use scripts/verify.py offline.\n\n## Completion Criteria\n- Review output",
    )

    contract = build_skill_runtime_contract(skill, granted_tools=[])

    assert contract["resource_count"] == 0
    assert contract["script_resource_count"] == 0
    assert contract["scripts_executable"] is False
    rendered = format_skill_runtime_contract_for_prompt(contract)
    assert "Package scripts are never executable" in rendered
    assert "b" * 64 not in rendered
    assert "scripts/verify.py" not in rendered


def test_skill_runtime_contract_surfaces_degraded_legacy_contract_without_content():
    skill = SimpleNamespace(
        builtin_key="",
        package_version="",
        package_status="preview",
        package_sha256="not-a-hash",
        tools_definition_json="{invalid",
        system_prompt="",
    )

    contract = build_skill_runtime_contract(skill)

    assert contract["load_status"] == "degraded"
    assert contract["package_kind"] == "custom"
    assert contract["release_sha256"] == ""
    assert skill_runtime_contract_warnings(contract) == [
        "skill_instructions_missing",
        "skill_tool_contract_invalid",
        "skill_verification_not_declared",
    ]


def test_skill_runtime_contract_reports_final_context_compaction_without_losing_release_identity():
    prepared = build_skill_runtime_contract(
        SimpleNamespace(
            builtin_key="proposal",
            package_version="1.0.0",
            package_status="stable",
            package_sha256="f" * 64,
            tools_definition_json="[]",
            system_prompt="# Skill\n\n## Quality Checklist\n- [ ] Review",
        )
    )

    finalized = finalize_skill_runtime_contract(
        prepared,
        instruction_complete=False,
    )

    assert finalized["load_status"] == "compacted"
    assert finalized["release_sha256"] == "f" * 64
    assert finalized["instruction_loaded"] is True
    assert finalized["instruction_complete"] is False
    assert finalized["verification_context_complete"] is False
    assert "skill_instructions_compacted" in skill_runtime_contract_warnings(finalized)
