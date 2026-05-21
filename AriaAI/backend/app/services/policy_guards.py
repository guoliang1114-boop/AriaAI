"""Central policy guards for chat-mode and tool-permission decisions."""
from __future__ import annotations

from dataclasses import dataclass
from enum import IntEnum
from typing import Any

from app.services.chat.mode_registry import ActionPolicy, ChatMode
from app.services.context_builder.query_classifiers import (
    is_client_project_portfolio_query,
    is_workspace_project_inventory_query,
)
from app.services.artifact_intent import detect_artifact_intent, is_question_like
from app.services.tool_descriptions import tool_required_policy
from app.tools.office_documents import (
    MANAGE_PROJECT_FOLDERS_TOOL_NAME,
    MANAGE_PROJECT_FILES_TOOL_NAME,
    READ_PROJECT_FILE_TOOL_NAME,
    WRITE_PROJECT_OFFICE_DOCUMENT_TOOL_NAME,
)
from app.tools.project_markdown import PROJECT_MARKDOWN_TOOL_NAME, READ_MARKDOWN_TOOL_NAME


class PolicyRank(IntEnum):
    DIRECT_ANSWER = 0
    READ_ONLY_TOOL = 1
    WRITE_ARTIFACT = 2
    MODIFY_EXISTING_FILE = 3
    DURABLE_TASK = 4
    DESTRUCTIVE_ACTION = 5


POLICY_RANK: dict[ActionPolicy, PolicyRank] = {
    ActionPolicy.DIRECT_ANSWER: PolicyRank.DIRECT_ANSWER,
    ActionPolicy.READ_ONLY_TOOL: PolicyRank.READ_ONLY_TOOL,
    ActionPolicy.WRITE_ARTIFACT: PolicyRank.WRITE_ARTIFACT,
    ActionPolicy.MODIFY_EXISTING_FILE: PolicyRank.MODIFY_EXISTING_FILE,
    ActionPolicy.DURABLE_TASK: PolicyRank.DURABLE_TASK,
    ActionPolicy.DESTRUCTIVE_ACTION: PolicyRank.DESTRUCTIVE_ACTION,
}


IDENTITY_KEYWORDS = (
    "你是谁",
    "你叫什么",
    "你是什么",
    "你是哪个",
    "你是什么模型",
    "介绍一下你自己",
    "介绍下你自己",
    "自我介绍",
    "你能做什么",
    "你的功能",
    "你有什么能力",
    "who are you",
    "what are you",
    "what model",
    "introduce yourself",
)

DESTRUCTIVE_TERMS = (
    "删除",
    "清理",
    "清除",
    "清空",
    "移除",
    "丢弃",
    "彻底删",
    "delete",
    "remove",
    "drop",
    "wipe",
)

# When any of these appear in the user's message, treat destructive keywords as
# discussion rather than command. Keeps "如何避免删除"/"don't delete X" out of the
# DESTRUCTIVE_ACTION branch.
DESTRUCTIVE_NEGATION_TERMS = (
    "不删除",
    "不要删除",
    "避免删除",
    "如何删除",
    "怎么删除",
    "可不可以删",
    "能不能删",
    "为什么删",
    "do not delete",
    "don't delete",
    "avoid delete",
    "how to delete",
    "how do i delete",
    "why delete",
)

# Destructive intent must also reference a concrete object class — otherwise
# "remove the obstacle" or "drop the topic" trigger the wrong policy.
DESTRUCTIVE_OBJECT_TERMS = (
    "文件",
    "文档",
    "markdown",
    " md",
    ".md",
    "项目空间",
    "记忆",
    "对话",
    "记录",
    "里程碑",
    "客户",
    "干系人",
    "file",
    "document",
    "folder",
    "directory",
    "memory",
    "conversation",
    "milestone",
)

WRITE_TERMS = (
    "保存",
    "保存到",
    "保存为",
    "存到",
    "写入",
    "新建",
    "创建",
    "导出",
    "下载",
    "生成文件",
    "输出文件",
    "保存成文档",
    "保存为文档",
    "create file",
    "save as",
    "export",
)

DOCUMENT_TERMS = (
    "文档",
    "文件",
    "markdown",
    " md",
    ".md",
    "报告",
    "材料",
    "清单",
    "交付物",
    "项目空间",
    "document",
    "file",
    "deliverable",
)

MODIFY_TERMS = (
    "修改",
    "更新",
    "替换",
    "追加",
    "重写",
    "修正",
    "矫正",
    "改一下",
    "调整",
    "覆盖",
    "update",
    "modify",
    "replace",
    "append",
    "rewrite",
    "fix",
)

OFFICE_ARTIFACT_TERMS = (
    "ppt",
    "pptx",
    "powerpoint",
    "演示文稿",
    "幻灯片",
    "word",
    "docx",
    "excel",
    "xlsx",
    "xls",
    "pdf",
)

READ_FILE_TERMS = (
    "读取",
    "查看",
    "打开",
    "引用",
    "基于文件",
    "基于文档",
    "read",
    "open",
    "inspect",
)

CONCISE_SUMMARY_TERMS = (
    "概览摘要",
    "简短摘要",
    "5 条以内",
    "5条以内",
    "几条",
    "一句话",
    "简要总结",
    "简单总结",
    "summary",
    "brief summary",
)


@dataclass(frozen=True)
class IntentDecision:
    chat_mode: ChatMode
    action_policy: ActionPolicy
    confidence: float
    reason: str
    method: str = "policy_guard"


def _normalize(content: str) -> str:
    return (content or "").strip().lower()


def is_identity_request(content: str) -> bool:
    text = _normalize(content)
    return bool(text) and any(term in text for term in IDENTITY_KEYWORDS)


def _has_any(text: str, terms: tuple[str, ...]) -> bool:
    return any(term in text for term in terms)


def _is_destructive_request(text: str) -> bool:
    """Detect explicit destructive intent.

    Requires three conditions to avoid false positives:
    1. Contains a destructive verb (DESTRUCTIVE_TERMS)
    2. References a concrete object class (DESTRUCTIVE_OBJECT_TERMS)
    3. Is not in a negation / how-to / why context (DESTRUCTIVE_NEGATION_TERMS)
    """
    if not _has_any(text, DESTRUCTIVE_TERMS):
        return False
    if _has_any(text, DESTRUCTIVE_NEGATION_TERMS):
        return False
    if not _has_any(text, DESTRUCTIVE_OBJECT_TERMS):
        return False
    return True


def detect_action_policy(content: str, *, project_id: int | None = None, force_skill: bool = False) -> tuple[ActionPolicy, str, float]:
    """Return the strictest explicit policy suggested by the user message."""
    text = _normalize(content)
    if not text:
        return ActionPolicy.DIRECT_ANSWER, "empty", 0.99
    if _is_destructive_request(text):
        return ActionPolicy.DESTRUCTIVE_ACTION, "destructive_terms", 0.98
    if is_question_like(content):
        return (ActionPolicy.READ_ONLY_TOOL if project_id else ActionPolicy.DIRECT_ANSWER), "question", 0.86
    explicit_modify = _has_any(text, MODIFY_TERMS) and (
        _has_any(text, DOCUMENT_TERMS)
        or _has_any(text, OFFICE_ARTIFACT_TERMS)
        or _has_any(text, ("刚才的", "现有", "已有", "previous", "existing", "last"))
    )
    if explicit_modify:
        return ActionPolicy.MODIFY_EXISTING_FILE, "explicit_modify", 0.93
    explicit_write = _has_any(text, WRITE_TERMS) or (
        _has_any(text, ("生成", "制作", "整理一份", "做一份", "准备一份", "输出", "create", "write", "generate"))
        and (_has_any(text, DOCUMENT_TERMS) or _has_any(text, OFFICE_ARTIFACT_TERMS))
    )
    artifact_intent = detect_artifact_intent(content)
    if artifact_intent.requested:
        return ActionPolicy.WRITE_ARTIFACT, artifact_intent.reason, artifact_intent.confidence
    if explicit_write:
        return ActionPolicy.WRITE_ARTIFACT, "explicit_write", 0.9
    if project_id and _has_any(text, CONCISE_SUMMARY_TERMS):
        return ActionPolicy.DIRECT_ANSWER, "concise_project_summary", 0.88
    if project_id and _has_any(text, READ_FILE_TERMS):
        return ActionPolicy.READ_ONLY_TOOL, "explicit_read", 0.84
    if force_skill:
        return ActionPolicy.READ_ONLY_TOOL, "forced_skill", 0.86
    return (ActionPolicy.READ_ONLY_TOOL if project_id else ActionPolicy.DIRECT_ANSWER), "default", 0.72


def classify_chat_mode_and_policy(
    content: str,
    *,
    project_id: int | None = None,
    skill_id: int | None = None,
    force_skill: bool = False,
) -> IntentDecision:
    policy, reason, confidence = detect_action_policy(content, project_id=project_id, force_skill=force_skill)
    if force_skill or skill_id:
        return IntentDecision(ChatMode.SKILL_EXECUTION, policy, max(confidence, 0.9), f"skill:{reason}")
    if project_id:
        if is_client_project_portfolio_query(content):
            return IntentDecision(ChatMode.CROSS_PROJECT_PORTFOLIO, ActionPolicy.READ_ONLY_TOOL, 0.78, "rule:client_portfolio", "rule_fallback")
        if is_workspace_project_inventory_query(content):
            return IntentDecision(ChatMode.WORKSPACE_INVENTORY, ActionPolicy.DIRECT_ANSWER, 0.78, "rule:workspace_inventory", "rule_fallback")
        return IntentDecision(ChatMode.PROJECT_DEEP_DIVE, policy, confidence, reason)
    if is_workspace_project_inventory_query(content):
        return IntentDecision(ChatMode.WORKSPACE_INVENTORY, ActionPolicy.DIRECT_ANSWER, 0.78, "rule:workspace_inventory", "rule_fallback")
    return IntentDecision(ChatMode.STANDALONE_QA, ActionPolicy.DIRECT_ANSWER, confidence, reason)


def _required_policy_for_tool(tool_name: str, tool_input: dict[str, Any] | None = None) -> ActionPolicy:
    tool_input = tool_input or {}
    operation = str(
        tool_input.get("action")
        or tool_input.get("mode")
        or tool_input.get("file_type")
        or tool_input.get("document_type")
        or "default"
    ).lower()
    configured_policy = tool_required_policy(tool_name, operation)
    if configured_policy:
        try:
            return ActionPolicy(configured_policy)
        except ValueError:
            pass
    if tool_name in {READ_MARKDOWN_TOOL_NAME, READ_PROJECT_FILE_TOOL_NAME}:
        return ActionPolicy.READ_ONLY_TOOL
    if tool_name == PROJECT_MARKDOWN_TOOL_NAME:
        mode = str(tool_input.get("mode") or "").lower()
        if mode in {"replace", "append"}:
            return ActionPolicy.MODIFY_EXISTING_FILE
        return ActionPolicy.WRITE_ARTIFACT
    if tool_name == WRITE_PROJECT_OFFICE_DOCUMENT_TOOL_NAME:
        return ActionPolicy.WRITE_ARTIFACT
    if tool_name == MANAGE_PROJECT_FOLDERS_TOOL_NAME:
        action = str(tool_input.get("action") or "").lower()
        if action in {"list"}:
            return ActionPolicy.READ_ONLY_TOOL
        if action in {"delete"}:
            return ActionPolicy.DESTRUCTIVE_ACTION
        if action in {"rename", "move_file"}:
            return ActionPolicy.MODIFY_EXISTING_FILE
        return ActionPolicy.WRITE_ARTIFACT
    if tool_name == MANAGE_PROJECT_FILES_TOOL_NAME:
        action = str(tool_input.get("action") or "").lower()
        if action == "list":
            return ActionPolicy.READ_ONLY_TOOL
        if action == "delete":
            return ActionPolicy.DESTRUCTIVE_ACTION
        return ActionPolicy.DESTRUCTIVE_ACTION
    return ActionPolicy.READ_ONLY_TOOL


def policy_allows_tool(
    action_policy: ActionPolicy | str,
    tool_name: str,
    tool_input: dict[str, Any] | None = None,
) -> tuple[bool, str, ActionPolicy]:
    """Check if the current ActionPolicy grants permission to invoke a tool.

    Permission is a strict rank comparison: ``POLICY_RANK[current] >= POLICY_RANK[required]``.
    Higher-rank policies (e.g. ``DESTRUCTIVE_ACTION``) implicitly cover lower-rank
    actions, but we no longer short-circuit them to "always allow" — that
    bypassed the rank comparison entirely and let any destructive-flavored user
    turn (real or false positive) green-light every write tool.

    Callers that need higher-level gating (UI confirmation for destructive /
    modify actions, P0 hand-off for durable tasks) should layer that on top of
    this check, not replace it.
    """
    current = ActionPolicy(action_policy) if isinstance(action_policy, str) else action_policy
    required = _required_policy_for_tool(tool_name, tool_input)
    if POLICY_RANK[current] >= POLICY_RANK[required]:
        return True, "allowed", required
    return False, f"policy_blocked: need={required.value} got={current.value}", required


def filter_tools_for_policy(tools: list[dict] | None, action_policy: ActionPolicy | str) -> list[dict] | None:
    if not tools:
        return tools
    current = ActionPolicy(action_policy) if isinstance(action_policy, str) else action_policy
    filtered: list[dict] = []
    for tool in tools:
        name = str(tool.get("name") or "")
        if not name:
            continue
        allowed, _, _ = policy_allows_tool(current, name, {})
        if allowed:
            filtered.append(tool)
    return filtered


def user_requested_project_markdown_write(content: str) -> bool:
    policy, _, _ = detect_action_policy(content, project_id=1)
    return policy in {
        ActionPolicy.WRITE_ARTIFACT,
        ActionPolicy.MODIFY_EXISTING_FILE,
        ActionPolicy.DESTRUCTIVE_ACTION,
        ActionPolicy.DURABLE_TASK,
    }
