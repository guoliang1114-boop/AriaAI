"""Content-first names for generated deliverables."""
from __future__ import annotations

import re
from pathlib import Path


_TYPE_LABELS = {
    "docx": "建议书",
    "pdf": "建议书",
    "pptx": "方案建议书",
    "xlsx": "清单",
    "md": "文档",
}

_INSTRUCTION_ONLY_MARKERS = (
    "内容不够",
    "不够丰富",
    "对这个",
    "全面丰富",
    "页数要求",
    "修改",
    "优化",
    "完善",
)


def slugify_deliverable_name(value: str, fallback: str = "project-deliverable") -> str:
    slug = re.sub(r"[^A-Za-z0-9\u4e00-\u9fa5._-]+", "-", str(value or "").strip()).strip("-")
    return slug[:80].strip("-") or fallback


def clean_deliverable_topic(value: str) -> str:
    text = re.sub(r"\s+", " ", str(value or "").strip())
    if not text:
        return ""
    cleanup_patterns = [
        r"^(好的?|请|麻烦|帮我|帮忙|给我|我打算|我想要|我要|需要|可以)\s*",
        r"(给客户|为客户|客户准备|准备给客户|准备一份|准备一个|起草一份|起草一个|写一份|写一个|写个|起草|撰写|编写)",
        r"(帮我|帮忙|给我|请|麻烦|生成|制作|输出|创建|整理|保存|导出|准备|写)",
        r"(全面而丰富|全面|丰富|完整|详细|系统化)",
        r"(一份|一个|一下|版本|版)",
        r"(pptx|powerpoint|ppt|PPT|docx|word|pdf|xlsx|excel|markdown|md|文档|文件)",
        r"的",
        r"(。|，|,|；|;|：|:)",
    ]
    for pattern in cleanup_patterns:
        text = re.sub(pattern, " ", text, flags=re.IGNORECASE)
    text = re.sub(r"\s+", "", text).strip("-_｜|/ ")
    generic_values = {"", "客户", "项目", "方案", "建议", "材料", "交付物", "沟通", "初稿"}
    if any(marker in text for marker in _INSTRUCTION_ONLY_MARKERS):
        return ""
    return "" if text in generic_values or len(text) < 2 else text[:60]


def normalize_deliverable_title(
    *,
    content: str = "",
    explicit_title: str = "",
    file_type: str = "",
    client_name: str = "",
) -> str:
    """Return a title based on the deliverable topic, not the chat command."""
    topic = ""
    for candidate in (explicit_title, content):
        topic = clean_deliverable_topic(candidate)
        if topic:
            break

    label = _TYPE_LABELS.get(file_type.lower(), "交付物")
    if not topic:
        topic = label
    elif label not in topic and not any(token in topic for token in ("建议书", "建议", "方案", "报告", "清单", "问卷", "纪要", "计划")):
        topic = f"{topic}{label}"

    client = client_name.strip()
    if client and client not in topic and len(topic) <= 40:
        return f"{client}-{topic}"
    return topic


def file_name_for_deliverable(title: str, file_type: str, fallback: str = "project-deliverable") -> str:
    suffix = file_type.lower().lstrip(".") or "md"
    stem = slugify_deliverable_name(Path(title).stem, fallback)
    return f"{stem}.{suffix}"
