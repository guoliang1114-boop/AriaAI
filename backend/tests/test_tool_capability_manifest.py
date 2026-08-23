from __future__ import annotations

from unittest.mock import patch

import pytest

from app.routers.chat_schemas import SendMessageRequest
from app.services.chat.mode_registry import ActionPolicy
from app.services.chat.state import ChatSessionState
from app.services.chat.tool_executor import execute_tool_with_policy
from app.services.chat.persist import _has_successful_mutation
from app.services.chat_tools import ChatRuntime
from app.services.policy_guards import policy_allows_tool
from app.tools import ToolRegistry, registry
from app.tools import file_generators, office_documents, pdf_tools, pdf_translation, project_markdown  # noqa: F401
from app.tools.capabilities import (
    TOOL_CAPABILITY_MANIFEST_VERSION,
    ToolEffect,
    ToolProductEvent,
    ToolResultKind,
    ToolRetryMode,
    all_builtin_tool_manifests,
    builtin_tool_manifest,
    resolve_tool_capability,
    resolve_tool_manifest,
)


EXPECTED_BUILTIN_TOOLS = {
    "generate_html_deck_from_skill",
    "generate_ppt",
    "generate_ppt_from_skill",
    "generate_docx",
    "generate_xlsx",
    "generate_pdf",
    "save_json",
    "save_text",
    "manage_project_folders",
    "manage_project_files",
    "read_project_file",
    "write_project_office_document",
    "edit_project_office_document",
    "manage_pdf",
    "translate_document",
    "update_project_markdown_document",
    "read_project_markdown_document",
}


def test_every_builtin_handler_has_one_explicit_versioned_manifest() -> None:
    registered = {tool.name for tool in registry.list_tools()}
    manifested = {manifest.name for manifest in all_builtin_tool_manifests()}

    assert registered == EXPECTED_BUILTIN_TOOLS
    assert manifested == EXPECTED_BUILTIN_TOOLS
    assert all(builtin_tool_manifest(name) is not None for name in registered)
    assert all(
        registry.get_manifest(name).manifest_version == TOOL_CAPABILITY_MANIFEST_VERSION
        for name in registered
    )


def test_manifest_resolves_operation_specific_security_and_execution_semantics() -> None:
    pdf_read = resolve_tool_capability("manage_pdf", {"action": "read"})
    pdf_merge = resolve_tool_capability("manage_pdf", {"action": "merge"})
    markdown_create = resolve_tool_capability(
        "update_project_markdown_document", {"mode": "create"}
    )
    markdown_patch = resolve_tool_capability(
        "update_project_markdown_document", {"mode": "patch"}
    )

    assert pdf_read.required_policy == ActionPolicy.READ_ONLY_TOOL.value
    assert pdf_read.effect is ToolEffect.READ
    assert pdf_merge.required_policy == ActionPolicy.WRITE_ARTIFACT.value
    assert pdf_merge.effect is ToolEffect.CREATE
    assert pdf_merge.retry_mode is ToolRetryMode.NEVER
    assert pdf_merge.product_event is ToolProductEvent.ARTIFACT_READY
    assert markdown_create.retry_mode is ToolRetryMode.ARTIFACT
    assert markdown_patch.required_policy == ActionPolicy.MODIFY_EXISTING_FILE.value
    assert markdown_patch.retry_mode is ToolRetryMode.NEVER


def test_previously_unclassified_mutating_tools_no_longer_fall_back_to_read_only() -> None:
    cases = (
        ("edit_project_office_document", {}, ActionPolicy.MODIFY_EXISTING_FILE),
        ("manage_pdf", {"action": "merge"}, ActionPolicy.WRITE_ARTIFACT),
        ("translate_document", {}, ActionPolicy.WRITE_ARTIFACT),
    )
    for name, tool_input, required_policy in cases:
        allowed, _, required = policy_allows_tool(
            ActionPolicy.READ_ONLY_TOOL,
            name,
            tool_input,
        )
        assert allowed is False
        assert required is required_policy


def test_unknown_tool_manifest_is_fail_closed_serial_and_non_retryable() -> None:
    manifest = resolve_tool_manifest("new_external_tool")
    capability = manifest.resolve({"action": "list"})

    assert capability.required_policy == ActionPolicy.DESTRUCTIVE_ACTION.value
    assert capability.effect is ToolEffect.EXTERNAL
    assert capability.result_kind is ToolResultKind.MUTATION
    assert capability.retry_mode is ToolRetryMode.NEVER
    assert capability.parallel_safe is False


def test_completion_evidence_uses_resolved_effect_not_only_tool_name() -> None:
    read_state = ChatSessionState()
    read_state.record_tool_execution(
        {
            "tool_name": "manage_project_files",
            "tool_use_id": "list-files",
            "tool_input": {"action": "list"},
            "status": "completed",
        }
    )
    unknown_state = ChatSessionState()
    unknown_state.record_tool_execution(
        {
            "tool_name": "unregistered_tool",
            "tool_use_id": "unknown",
            "status": "completed",
        }
    )
    write_state = ChatSessionState()
    write_state.record_tool_execution(
        {
            "tool_name": "generate_docx",
            "tool_use_id": "create-docx",
            "status": "completed",
        }
    )

    assert _has_successful_mutation(read_state) is False
    assert _has_successful_mutation(unknown_state) is False
    assert _has_successful_mutation(write_state) is True


def test_registry_rejects_duplicate_names_and_binds_schema_fingerprint() -> None:
    local = ToolRegistry()

    @local.register(
        name="sample_tool",
        description="A sufficiently clear sample tool description.",
        input_schema={
            "type": "object",
            "properties": {"query": {"type": "string"}},
            "required": ["query"],
        },
    )
    async def sample_tool(query: str) -> dict:
        return {"query": query}

    with pytest.raises(ValueError, match="already registered"):

        @local.register(
            name="sample_tool",
            description="Duplicate sample tool.",
            input_schema={"type": "object", "properties": {}, "required": []},
        )
        async def duplicate_tool() -> dict:
            return {}

    snapshot = local.get_capability_manifests()
    assert len(snapshot) == 1
    assert snapshot[0]["name"] == "sample_tool"
    assert snapshot[0]["default"]["required_policy"] == "destructive_action"
    assert len(snapshot[0]["input_schema_sha256"]) == 64
    assert "handler" not in snapshot[0]


@pytest.mark.asyncio
async def test_project_scope_and_manifest_fields_flow_through_real_executor_boundary() -> None:
    seen: dict = {}

    async def fake_execute(name: str, input_data: dict) -> dict:
        seen.update({"name": name, "input": input_data})
        return {
            "type": "tool_result",
            "tool_name": name,
            "status": "success",
            "output": {"ok": True},
        }

    runtime = ChatRuntime(
        conv_id=1,
        selected_model="test-model",
        llm=object(),
        system="system",
        api_messages=[],
        rag_sources=[],
        tools=[],
        max_tokens=128,
        temperature=0.0,
        project_id=42,
        action_policy=ActionPolicy.WRITE_ARTIFACT.value,
        tool_access_policy="write_allowed",
    )
    state = ChatSessionState(run_id="run_manifest_test")
    req = SendMessageRequest(content="合并项目里的 PDF", project_id=42)

    with patch.object(registry, "execute", side_effect=fake_execute):
        await execute_tool_with_policy(
            runtime,
            state,
            {
                "type": "tool_use",
                "id": "tool-pdf-1",
                "name": "manage_pdf",
                "input": {"action": "merge", "file_ids": [1, 2]},
            },
            req=req,
            step_text="",
            step_truncated=False,
            step_index=0,
        )

    assert seen["name"] == "manage_pdf"
    assert seen["input"]["project_id"] == 42
    record = state.tool_call_events[-1]
    assert record["capability_version"] == TOOL_CAPABILITY_MANIFEST_VERSION
    assert record["tool_effect"] == ToolEffect.CREATE.value
    assert record["result_kind"] == ToolResultKind.ARTIFACT.value
    assert record["retry_mode"] == ToolRetryMode.NEVER.value
    assert record["product_event"] == ToolProductEvent.ARTIFACT_READY.value
    assert "tool_input" not in record
    assert "input" not in record
