"""Deterministic artifact intent detection shared by chat routing and policy.

This module keeps side-effect decisions out of ad hoc prompt text.  It only
classifies explicit deliverable requests, and leaves analysis / how-to questions
as normal chat even when they mention file formats.
"""
from __future__ import annotations

from dataclasses import dataclass


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


def _normalize(content: str) -> str:
    return (content or "").strip().lower()


def _has_any(text: str, terms: tuple[str, ...]) -> bool:
    return any(term in text for term in terms)


def is_question_like(content: str) -> bool:
    return _normalize(content).startswith(QUESTION_PREFIXES)


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
