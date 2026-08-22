"""Chat tool execution helpers — progress payloads, error messages, result summaries."""
from __future__ import annotations

import re
from dataclasses import dataclass

from app.services.artifact_intent import ArtifactContract
from app.tools.project_markdown import PROJECT_MARKDOWN_TOOL_NAME, READ_MARKDOWN_TOOL_NAME

_TOOL_DISPLAY_NAMES = {
    "manage_project_files": "管理项目文件",
    "manage_project_folders": "管理项目文件夹",
    "read_project_file": "读取项目文件",
    READ_MARKDOWN_TOOL_NAME: "读取项目文档",
    PROJECT_MARKDOWN_TOOL_NAME: "写入项目 Markdown 文档",
    "write_project_office_document": "生成项目文档",
}


@dataclass
class ChatRuntime:
    conv_id: int
    selected_model: str
    llm: object
    system: str
    api_messages: list[dict]
    rag_sources: list
    tools: list | None
    max_tokens: int
    temperature: float
    project_id: int | None = None
    skill_name: str = ""
    prepare_metrics: dict | None = None
    chat_mode: str = "standalone_qa"
    # Default to the strictest policy. Real runtime always overrides via
    # intent_decision.action_policy; this default exists only as a safety net so
    # that any code path that forgets to set it does not silently open write tools.
    action_policy: str = "direct_answer"
    tool_access_policy: str = "none"
    intent_reason: str = ""
    intent_method: str = ""
    intent_trace: dict | None = None
    intent_task_route: object | None = None
    artifact_contract: ArtifactContract | None = None
    working_memory: dict | None = None
    intent_prepared_async: bool = False
    # Per-turn context budgeting. Production runtime construction always sets
    # these values; zero keeps direct test/recovery constructors backward
    # compatible without guessing a provider window.
    context_window_tokens: int = 0
    context_safety_margin_percent: int = 8
    context_history_summary_tokens: int = 1_024
    # One initial model request plus at most two safe retries. The Agent Loop
    # retries only before receiving any model event; provider adapters must not
    # replay streams internally because they cannot see Aria's commit barrier.
    model_turn_max_attempts: int = 2
    model_turn_retry_base_delay_ms: int = 500
    model_turn_retry_max_delay_ms: int = 5_000
    # Consecutive tools explicitly declared parallel-safe may share a batch.
    # Mutating, approval-gated, unknown, and unmarked tools remain serial.
    tool_parallel_max_concurrency: int = 4

    def __post_init__(self) -> None:
        """Keep explicitly selected Skill runtimes executable on fallback paths.

        The normal runtime builder always writes deterministic intent policy
        onto ChatRuntime. Some tests and recovery paths construct ChatRuntime
        directly, though; if they provide a Skill and its tools while leaving
        the strict default policy in place, P1/P2 will suppress every planned
        tool call. Promote that narrow case to read-on-demand access. This
        still blocks modify/destructive tools unless the regular intent router
        grants a higher action policy.
        """
        if self.skill_name and self.tools and str(self.action_policy or "") == "direct_answer":
            self.action_policy = "read_only_tool"
        if self.skill_name and self.tools and str(self.tool_access_policy or "") == "none":
            self.tool_access_policy = "read_on_demand"


def _tool_progress_payload(tool_name: str, tool_input: dict) -> dict:
    if tool_name in ("generate_ppt", "generate_ppt_from_skill"):
        slides = tool_input.get("slides", [])
        title = tool_input.get("title", "Untitled")
        return {
            "message": f"Generating \"{title}\" ({len(slides)} slides)\u2026",
            "total": len(slides),
            "current": 0,
        }
    if tool_name == "generate_docx":
        return {"message": f"Generating document \"{tool_input.get('title', 'Untitled')}\"\u2026"}
    if tool_name == "generate_xlsx":
        return {"message": f"Generating spreadsheet ({len(tool_input.get('sheets', []))} sheets)\u2026"}
    if tool_name == "generate_pdf":
        return {"message": f"Generating PDF \"{tool_input.get('title', 'Untitled')}\"\u2026"}
    return {"message": f"正在执行{_TOOL_DISPLAY_NAMES.get(tool_name, tool_name)}…"}


def _tool_start_progress_payload(tool_name: str) -> dict | None:
    if tool_name in ("generate_ppt", "generate_ppt_from_skill"):
        return {"message": "Generating slides... (this may take 1-2 minutes)"}
    if tool_name == PROJECT_MARKDOWN_TOOL_NAME:
        return {"message": "\u6b63\u5728\u5199\u5165\u9879\u76ee Markdown \u6587\u4ef6..."}
    if tool_name == READ_MARKDOWN_TOOL_NAME:
        return {"message": "\u6b63\u5728\u8bfb\u53d6\u9879\u76ee\u6587\u6863\u2026"}
    if tool_name == "generate_docx":
        return {"message": "Generating document..."}
    if tool_name == "generate_xlsx":
        return {"message": "Generating spreadsheet..."}
    if tool_name == "generate_pdf":
        return {"message": "Generating PDF..."}
    return {"message": f"正在执行{_TOOL_DISPLAY_NAMES.get(tool_name, tool_name)}..."}


def _user_requested_project_markdown_write(content: str) -> bool:
    """Compatibility wrapper around the centralized Policy Guard.

    Lazy import keeps the chat_tools module free of the policy_guards import
    chain at module load time, avoiding a circular dependency between
    ``policy_guards`` (which imports ``chat.mode_registry``, triggering
    ``chat/__init__.py``) and ``chat_tools`` (imported by that same init).
    """
    from app.services.policy_guards import user_requested_project_markdown_write
    return user_requested_project_markdown_write(content)


def _strip_internal_tool_markers(text: str) -> str:
    """Remove internal textual tool markers that should never be persisted."""
    if not text:
        return text
    return re.sub(r"\n?\[TOOL_START:[^\]\n]+\]\s*", "\n", text)


def _to_user_friendly_error(error_msg: str) -> str:
    if "429" in error_msg or "engine_overloaded" in error_msg:
        return "AI \u670d\u52a1\u5f53\u524d\u7e41\u5fd9\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5\u3002\u8fd9\u662f\u4e34\u65f6\u72b6\u51b5\uff0c\u51e0\u79d2\u949f\u540e\u518d\u8bd5\u5373\u53ef\u3002"
    if "Kimi \u670d\u52a1\u5f53\u524d\u7e41\u5fd9" in error_msg or "BigModel \u670d\u52a1\u5f53\u524d\u7e41\u5fd9" in error_msg:
        return error_msg
    if "No Kimi API key" in error_msg or "No Claude API key" in error_msg or "No BigModel API key" in error_msg or "No MiMo API key" in error_msg:
        return "\u8bf7\u5148\u914d\u7f6e API Key\u3002\u524d\u5f80\u300c\u8bbe\u7f6e\u300d\u9875\u9762\u6dfb\u52a0\u60a8\u7684 API Key\u3002"
    if "timeout" in error_msg.lower() or "Connection refused" in error_msg:
        return "\u8fde\u63a5\u8d85\u65f6\uff0c\u8bf7\u68c0\u67e5\u7f51\u7edc\u6216\u7a0d\u540e\u91cd\u8bd5\u3002"
    if "rate limit" in error_msg.lower():
        return "\u8bf7\u6c42\u9891\u7387\u8fc7\u9ad8\uff0c\u8bf7\u7a0d\u7b49\u7247\u523b\u540e\u91cd\u8bd5\u3002"
    return error_msg


def _summarize_tool_result(result: dict) -> str:
    if result.get("error"):
        return str(result.get("error"))
    output = result.get("output")
    if isinstance(output, dict):
        if output.get("error"):
            return str(output.get("error"))
        if output.get("message"):
            return str(output.get("message"))
        if output.get("file_name"):
            return f"已生成 {output.get('file_name')}"
    if result.get("file_name"):
        return f"已生成 {result.get('file_name')}"
    if result.get("message"):
        return str(result.get("message"))
    if result.get("success") is True:
        return "已成功完成"
    return ""


def _build_completed_skill_progress(tool_call_events: list[dict], full_text: str) -> list[dict]:
    tool_logs = []
    if tool_call_events:
        for event in tool_call_events:
            status = "\u5b8c\u6210" if event.get("status") == "completed" else "\u5931\u8d25"
            message = event.get("summary") or event.get("message") or event.get("tool_name") or "\u5de5\u5177\u6267\u884c"
            tool_logs.append(f"{status}: {message}")
    else:
        tool_logs.append("\u672c\u6b21\u672a\u8c03\u7528\u6587\u4ef6\u751f\u6210\u5de5\u5177\uff0c\u6a21\u578b\u76f4\u63a5\u751f\u6210\u6b63\u6587\u7ed3\u679c\u3002")

    return [
        {
            "key": "prepare",
            "label": "\u51c6\u5907\u4e0a\u4e0b\u6587",
            "description": "\u6574\u7406\u4f1a\u8bdd\u3001\u9879\u76ee\u4e0e Skill \u4fe1\u606f",
            "status": "done",
            "logs": ["\u5df2\u51c6\u5907\u4f1a\u8bdd\u3001\u9879\u76ee\u4e0e Skill \u4e0a\u4e0b\u6587\u3002"],
        },
        {
            "key": "thinking",
            "label": "\u6a21\u578b\u89c4\u5212",
            "description": "\u5206\u6790\u9700\u6c42\u5e76\u5224\u65ad\u662f\u5426\u9700\u8981\u8c03\u7528\u5de5\u5177",
            "status": "done",
            "logs": ["\u6a21\u578b\u5df2\u5b8c\u6210\u9700\u6c42\u7406\u89e3\u4e0e\u6267\u884c\u89c4\u5212\u3002"],
        },
        {
            "key": "tools",
            "label": "\u6267\u884c\u5de5\u5177",
            "description": "\u751f\u6210 PPT / \u6587\u6863 / \u8868\u683c\u7b49\u4ea4\u4ed8\u7269",
            "status": "done",
            "logs": tool_logs,
        },
        {
            "key": "final",
            "label": "\u6574\u7406\u7b54\u590d",
            "description": "\u6c47\u603b\u5de5\u5177\u7ed3\u679c\u5e76\u5f62\u6210\u6700\u7ec8\u56de\u590d",
            "status": "done",
            "logs": [f"\u6700\u7ec8\u7b54\u590d\u5df2\u751f\u6210\uff0c\u6b63\u6587\u957f\u5ea6\u7ea6 {len(full_text)} \u5b57\u3002"],
        },
        {
            "key": "saving",
            "label": "\u4fdd\u5b58\u7ed3\u679c",
            "description": "\u4fdd\u5b58\u56de\u590d\u4e0e\u751f\u6210\u7684\u9644\u4ef6",
            "status": "done",
            "logs": ["\u6b63\u5728\u4fdd\u5b58\u672c\u6b21\u56de\u590d...", "\u56de\u590d\u5df2\u4fdd\u5b58\uff0c\u6267\u884c\u5b8c\u6210\u3002"],
        },
    ]
