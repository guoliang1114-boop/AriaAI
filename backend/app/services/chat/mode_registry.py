"""Explicit chat modes and action policies for the chat pipeline.

This module is intentionally small and dependency-light.  It gives the rest of
the chat runtime a stable vocabulary for "what kind of conversation is this?"
and "what is this turn allowed to do?" without spreading one-off keyword checks
through the streaming phases.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum


class ChatMode(str, Enum):
    STANDALONE_QA = "standalone_qa"
    PROJECT_DEEP_DIVE = "project_deep_dive"
    CROSS_PROJECT_PORTFOLIO = "cross_project_portfolio"
    WORKSPACE_INVENTORY = "workspace_inventory"
    SKILL_EXECUTION = "skill_execution"
    TASK_ORCHESTRATION = "task_orchestration"


class ActionPolicy(str, Enum):
    DIRECT_ANSWER = "direct_answer"
    READ_ONLY_TOOL = "read_only_tool"
    WRITE_ARTIFACT = "write_artifact"
    MODIFY_EXISTING_FILE = "modify_existing_file"
    DURABLE_TASK = "durable_task"
    DESTRUCTIVE_ACTION = "destructive_action"


class ToolAccessPolicy(str, Enum):
    NONE = "none"
    INJECTED_CONTEXT_ONLY = "injected_context_only"
    READ_ON_DEMAND = "read_on_demand"
    EXPLICIT_FILE_READ = "explicit_file_read"
    WRITE_ALLOWED = "write_allowed"


class HistoryStrategy(str, Enum):
    FULL = "full"
    RECENT = "recent"
    NONE = "none"


class ModelStrategy(str, Enum):
    USER_DEFAULT = "user_default"
    LENGTH_AWARE_FAST_PATH = "length_aware_fast_path"
    FAST_PORTFOLIO = "fast_portfolio"


@dataclass(frozen=True)
class ModeConfig:
    prompt_template: str
    model_strategy: ModelStrategy
    max_tokens: int
    history_window: int
    history_strategy: HistoryStrategy
    context_mode: str
    include_identity_preamble: bool = True
    allow_dynamic_tools: bool = False
    fast_model: str = ""
    fast_max_tokens: int = 0
    fast_source_models: tuple[str, ...] = field(default_factory=tuple)
    tool_pool: tuple[str, ...] = field(default_factory=tuple)


MODE_CONFIG: dict[ChatMode, ModeConfig] = {
    ChatMode.STANDALONE_QA: ModeConfig(
        prompt_template="modes/standalone_qa.md",
        model_strategy=ModelStrategy.LENGTH_AWARE_FAST_PATH,
        max_tokens=2048,
        history_window=96,
        history_strategy=HistoryStrategy.FULL,
        context_mode="workspace_brief",
        fast_model="moonshot-v1-8k",
        fast_max_tokens=1536,
        fast_source_models=("kimi-k3", "kimi-k2.6"),
    ),
    ChatMode.PROJECT_DEEP_DIVE: ModeConfig(
        prompt_template="modes/project_deep_dive.md",
        model_strategy=ModelStrategy.USER_DEFAULT,
        max_tokens=8192,
        history_window=96,
        history_strategy=HistoryStrategy.FULL,
        context_mode="project",
        tool_pool=(
            "read_project_markdown_document",
            "read_project_file",
            "update_project_markdown_document",
            "write_project_office_document",
            "manage_project_folders",
            "manage_project_files",
        ),
    ),
    ChatMode.CROSS_PROJECT_PORTFOLIO: ModeConfig(
        prompt_template="modes/cross_project_portfolio.md",
        model_strategy=ModelStrategy.FAST_PORTFOLIO,
        max_tokens=4096,
        history_window=6,
        history_strategy=HistoryStrategy.RECENT,
        context_mode="client_portfolio",
        include_identity_preamble=False,
        fast_model="deepseek-v4-flash",
        fast_max_tokens=4096,
        fast_source_models=("kimi-k3", "kimi-k2.6", "deepseek-v4-pro"),
        tool_pool=("read_project_markdown_document", "read_project_file"),
    ),
    ChatMode.WORKSPACE_INVENTORY: ModeConfig(
        prompt_template="modes/workspace_inventory.md",
        model_strategy=ModelStrategy.FAST_PORTFOLIO,
        max_tokens=6144,
        history_window=6,
        history_strategy=HistoryStrategy.RECENT,
        context_mode="workspace_inventory",
        include_identity_preamble=False,
        fast_model="deepseek-v4-flash",
        fast_max_tokens=6144,
        fast_source_models=("kimi-k3", "kimi-k2.6", "deepseek-v4-pro"),
    ),
    ChatMode.SKILL_EXECUTION: ModeConfig(
        prompt_template="modes/skill_execution.md",
        model_strategy=ModelStrategy.USER_DEFAULT,
        max_tokens=8192,
        history_window=96,
        history_strategy=HistoryStrategy.FULL,
        context_mode="skill",
        allow_dynamic_tools=True,
    ),
    ChatMode.TASK_ORCHESTRATION: ModeConfig(
        prompt_template="",
        model_strategy=ModelStrategy.USER_DEFAULT,
        max_tokens=8192,
        history_window=0,
        history_strategy=HistoryStrategy.NONE,
        context_mode="project",
        allow_dynamic_tools=True,
    ),
}


def mode_config_for(mode: ChatMode | str | None) -> ModeConfig:
    """Resolve a complete chat-mode contract with a conservative fallback."""

    try:
        normalized = mode if isinstance(mode, ChatMode) else ChatMode(str(mode or ""))
    except ValueError:
        # Unknown modes must not inherit a project write-capable tool pool.
        normalized = ChatMode.STANDALONE_QA
    return MODE_CONFIG[normalized]


def filter_tools_for_mode(
    tools: list[dict] | None,
    mode: ChatMode | str | None,
) -> list[dict] | None:
    """Apply the mode-level tool boundary before action-policy filtering.

    Skill and durable-task modes may consume their frozen dynamic tool set.
    Every other mode is restricted to its explicit ``tool_pool``. Unknown and
    malformed tools are dropped here and still fail closed in execution.
    """

    if not tools:
        return tools
    config = mode_config_for(mode)
    if config.allow_dynamic_tools:
        from app.tools.capabilities import builtin_tool_manifest  # noqa: PLC0415

        return [
            tool
            for tool in tools
            if isinstance(tool, dict)
            and builtin_tool_manifest(str(tool.get("name") or "").strip()) is not None
        ]
    allowed = set(config.tool_pool)
    return [
        tool
        for tool in tools
        if isinstance(tool, dict) and str(tool.get("name") or "").strip() in allowed
    ]
