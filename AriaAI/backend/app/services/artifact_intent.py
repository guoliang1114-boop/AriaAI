"""Deterministic artifact intent detection shared by chat routing and policy.

This module keeps side-effect decisions out of ad hoc prompt text.  It only
classifies explicit deliverable requests, and leaves analysis / how-to questions
as normal chat even when they mention file formats.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.tools.office_documents import WRITE_PROJECT_OFFICE_DOCUMENT_TOOL_NAME
from app.tools.project_markdown import PROJECT_MARKDOWN_TOOL_NAME


FORMAT_TERMS: dict[str, tuple[str, ...]] = {
    "pptx": ("ppt", "pptx", "powerpoint", "deck", "slides", "幻灯片", "演示文稿", "演示材料", "客户介绍"),
    "xlsx": ("excel", "xlsx", "xls", "spreadsheet", "表格", "工作簿", "访谈表", "问卷excel", "台账"),
    "docx": ("word", "docx", "文档", "报告", "方案", "材料"),
    "pdf": ("pdf",),
    "md": ("markdown", ".md", " md", "md ", "md文档", "markdown文档"),
}

CREATE_TERMS = (
    "准备",
    "生成",
    "创建",
    "制作",
    "输出",
    "导出",
    "整理",
    "整理成",
    "形成",
    "起草",
    "撰写",
    "编写",
    "写一份",
    "写一个",
    "写个",
    "帮我写",
    "给我写",
    "请写",
    "做一份",
    "做一个",
    "做个",
    "prepare",
    "create",
    "generate",
    "make",
    "export",
    "draft",
    "write",
)

QUESTION_PREFIXES = (
    "为什么",
    "怎么",
    "如何",
    "是否",
    "是不是",
    "解释",
    "介绍一下",
    "这个",
    "你觉得",
    "how ",
    "why ",
    "what ",
)


@dataclass(frozen=True)
class ArtifactIntent:
    requested: bool
    output_kind: str = ""
    confidence: float = 0.0
    reason: str = ""


@dataclass(frozen=True)
class ArtifactContract:
    """Execution contract for turns that must produce a durable deliverable."""

    delivery_required: bool = False
    output_kind: str = ""
    title: str = ""
    allowed_tools: tuple[str, ...] = ()
    confidence: float = 0.0
    reason: str = ""
    source: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "delivery_required": self.delivery_required,
            "output_kind": self.output_kind,
            "title": self.title,
            "allowed_tools": list(self.allowed_tools),
            "confidence": self.confidence,
            "reason": self.reason,
            "source": self.source,
        }


_OUTPUT_KIND_ALIASES = {
    "ppt": "pptx",
    "powerpoint": "pptx",
    "slides": "pptx",
    "xls": "xlsx",
    "spreadsheet": "xlsx",
    "excel": "xlsx",
    "word": "docx",
    "document": "docx",
    "markdown": "md",
    "text": "md",
}

_SUPPORTED_OUTPUT_KINDS = {"pptx", "xlsx", "docx", "pdf", "md"}


def _normalize(content: str) -> str:
    return (content or "").strip().lower()


def _has_any(text: str, terms: tuple[str, ...]) -> bool:
    return any(term in text for term in terms)


def is_question_like(content: str) -> bool:
    return _normalize(content).startswith(QUESTION_PREFIXES)


def normalize_output_kind(value: Any) -> str:
    kind = str(value or "").strip().lower().lstrip(".")
    kind = _OUTPUT_KIND_ALIASES.get(kind, kind)
    return kind if kind in _SUPPORTED_OUTPUT_KINDS else ""


def allowed_tools_for_output_kind(output_kind: str) -> tuple[str, ...]:
    if output_kind == "md":
        return (PROJECT_MARKDOWN_TOOL_NAME,)
    if output_kind in {"pptx", "xlsx", "docx", "pdf"}:
        return (WRITE_PROJECT_OFFICE_DOCUMENT_TOOL_NAME,)
    return ()


def contract_from_artifact_intent(intent: ArtifactIntent, *, title: str = "", source: str = "rule") -> ArtifactContract:
    output_kind = normalize_output_kind(intent.output_kind)
    if not intent.requested or not output_kind:
        return ArtifactContract()
    return ArtifactContract(
        delivery_required=True,
        output_kind=output_kind,
        title=str(title or "").strip(),
        allowed_tools=allowed_tools_for_output_kind(output_kind),
        confidence=intent.confidence,
        reason=intent.reason,
        source=source,
    )


def contract_from_llm_payload(payload: dict[str, Any]) -> ArtifactContract:
    raw = payload.get("artifact_contract")
    contract_data = raw if isinstance(raw, dict) else {}
    delivery_required = bool(
        contract_data.get("delivery_required")
        or payload.get("delivery_required")
        or payload.get("response_mode") in {"artifact", "orchestrated", "workflow"}
    )
    output_kind = normalize_output_kind(
        contract_data.get("output_kind")
        or contract_data.get("artifact_type")
        or payload.get("output_kind")
    )
    if not delivery_required or not output_kind:
        return ArtifactContract()
    confidence = contract_data.get("confidence", payload.get("confidence", 0))
    try:
        confidence_value = max(0.0, min(1.0, float(confidence)))
    except (TypeError, ValueError):
        confidence_value = 0.0
    allowed_tools_raw = contract_data.get("allowed_tools")
    allowed_tools = tuple(str(item) for item in allowed_tools_raw if item) if isinstance(allowed_tools_raw, list) else ()
    if not allowed_tools:
        allowed_tools = allowed_tools_for_output_kind(output_kind)
    return ArtifactContract(
        delivery_required=True,
        output_kind=output_kind,
        title=str(contract_data.get("title") or payload.get("title") or "").strip(),
        allowed_tools=allowed_tools,
        confidence=confidence_value,
        reason=str(contract_data.get("reason") or payload.get("reason") or "llm_artifact_contract"),
        source="llm_router",
    )


def detect_artifact_intent(content: str) -> ArtifactIntent:
    """Detect explicit file deliverable requests.

    Format mentions alone are not enough: "如何写 Excel 公式" should remain a
    direct answer.  A request must include a supported artifact format and a
    creation verb such as "写一个", "生成", "导出", or "create".
    """
    text = _normalize(content)
    if not text:
        return ArtifactIntent(False, reason="empty")
    if is_question_like(content):
        return ArtifactIntent(False, reason="question_prefix")

    output_kind = ""
    for kind, terms in FORMAT_TERMS.items():
        if _has_any(text, terms):
            output_kind = kind
            break
    if not output_kind:
        return ArtifactIntent(False, reason="no_format")
    if not _has_any(text, CREATE_TERMS):
        return ArtifactIntent(False, output_kind=output_kind, reason="format_without_create")
    return ArtifactIntent(True, output_kind=output_kind, confidence=0.9, reason=f"explicit_{output_kind}_artifact")
