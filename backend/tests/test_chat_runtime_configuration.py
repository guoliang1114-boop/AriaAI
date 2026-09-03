from app.services.chat.config_validation import assert_chat_runtime_configuration
from app.services.chat.mode_registry import (
    MODE_CONFIG,
    ChatMode,
    filter_tools_for_mode,
    mode_config_for,
)
from app.services.chat.prompt_assembler import (
    build_prompt_layer_manifest,
    build_system_prompt_from_templates,
    validate_prompt_layer_manifest,
)
from app.tools import file_generators as _file_generators  # noqa: F401
from app.tools import office_documents as _office_documents  # noqa: F401
from app.tools import pdf_tools as _pdf_tools  # noqa: F401
from app.tools import pdf_translation as _pdf_translation  # noqa: F401
from app.tools import project_markdown as _project_markdown  # noqa: F401
from app.tools import registry


def test_chat_runtime_configuration_is_complete_and_safe():
    report = assert_chat_runtime_configuration(registry.list_tools())

    assert report["valid"] is True
    assert report["issues"] == []
    assert report["mode_count"] == len(ChatMode) == len(MODE_CONFIG)
    assert report["tool_count"] == 17
    assert len(report["config_sha256"]) == 64


def test_mode_tool_pool_blocks_tools_not_declared_for_regular_chat():
    tools = [
        {"name": "read_project_file"},
        {"name": "generate_ppt"},
        {"name": "update_project_markdown_document"},
        {"name": "unregistered_skill_tool"},
    ]

    assert [
        tool["name"]
        for tool in filter_tools_for_mode(tools, ChatMode.PROJECT_DEEP_DIVE) or []
    ] == ["read_project_file", "update_project_markdown_document"]
    assert filter_tools_for_mode(tools, ChatMode.STANDALONE_QA) == []
    assert filter_tools_for_mode(tools, ChatMode.SKILL_EXECUTION) == tools[:3]


def test_mode_config_fallback_is_conservative_and_complete():
    fallback = mode_config_for("not_a_real_mode")

    assert fallback == MODE_CONFIG[ChatMode.STANDALONE_QA]
    assert fallback.context_mode == "workspace_brief"
    assert fallback.max_tokens == 2048
    assert filter_tools_for_mode([{"name": "write_project_office_document"}], "invalid") == []


def test_prompt_layers_are_file_backed_and_content_free_in_manifest():
    prompt = build_system_prompt_from_templates(
        "private skill body",
        "private knowledge body",
        "private project body",
        chat_mode=ChatMode.SKILL_EXECUTION,
    )
    manifest = build_prompt_layer_manifest(
        skill_prompt="private skill body",
        rag_context="private knowledge body",
        project_context="private project body",
        chat_mode=ChatMode.SKILL_EXECUTION,
        runtime_fragment_paths=(
            "frames/turn_contract.md",
            "frames/capability_write_tools.md",
        ),
    )

    assert "## Response Discipline" in prompt
    assert "## Skill Context" in prompt
    assert "## Project Context" in prompt
    assert "## Relevant Knowledge Base Excerpts" in prompt
    assert manifest["layer_count"] == 8
    assert len(manifest["manifest_sha256"]) == 64
    assert "private skill body" not in str(manifest)
    assert "private knowledge body" not in str(manifest)
    assert "private project body" not in str(manifest)

    valid, reason = validate_prompt_layer_manifest(manifest)
    assert valid is True
    assert reason == "valid"

    tampered = {**manifest, "manifest_sha256": "0" * 64}
    valid, reason = validate_prompt_layer_manifest(tampered)
    assert valid is False
    assert reason == "prompt_layer_manifest_sha256_mismatch"
