"""Tool-input repair, JSON extraction, and office-document helpers."""
from __future__ import annotations

import json
from app.services.deliverable_naming import (
    file_name_for_deliverable,
    normalize_deliverable_title,
    slugify_deliverable_name,
)


def try_extract_tool_use_json(text: str) -> dict | None:
    """Try to extract a single ``{"type": "tool_use", ...}`` block from mixed text."""
    idx = text.find('{"type"')
    while idx != -1:
        depth = 0
        for i, ch in enumerate(text[idx:], start=idx):
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    try:
                        block = json.loads(text[idx : i + 1])
                        if block.get("type") == "tool_use":
                            return block
                    except json.JSONDecodeError:
                        break
        idx = text.find('{"type"', idx + 1)
    return None


def extract_tool_use_json_blocks(text: str) -> tuple[list[dict], str]:
    """Extract all complete ``tool_use`` JSON objects and return the remaining display text."""
    decoder = json.JSONDecoder()
    blocks: list[dict] = []
    spans: list[tuple[int, int]] = []
    idx = text.find("{")
    while idx != -1:
        try:
            block, end = decoder.raw_decode(text[idx:])
        except json.JSONDecodeError:
            idx = text.find("{", idx + 1)
            continue
        absolute_end = idx + end
        if isinstance(block, dict) and block.get("type") == "tool_use":
            blocks.append(block)
            spans.append((idx, absolute_end))
            idx = text.find("{", absolute_end)
        else:
            idx = text.find("{", idx + 1)

    if not spans:
        return [], text

    cleaned_parts: list[str] = []
    cursor = 0
    for start, end in spans:
        cleaned_parts.append(text[cursor:start])
        cursor = end
    cleaned_parts.append(text[cursor:])
    return blocks, "".join(cleaned_parts)


def _infer_office_file_type(content: str, tool_input: dict, *, infer_from_content: bool = False) -> str:
    """Resolve the desired office file type from explicit input or request text."""
    explicit = str(tool_input.get("file_type") or "").strip().lower()
    if explicit:
        return explicit
    text_parts = [
        tool_input.get("title"),
        tool_input.get("file_name"),
        tool_input.get("name"),
    ]
    if infer_from_content:
        text_parts.insert(0, content)
    text = " ".join(
        str(value or "")
        for value in text_parts
    ).lower()
    if any(term in text for term in ("excel", "xlsx", "xls", "spreadsheet", "表格", "工作簿", "访谈表")):
        return "xlsx"
    if any(term in text for term in ("ppt", "pptx", "powerpoint", "slides", "幻灯片", "演示文稿")):
        return "pptx"
    if "pdf" in text:
        return "pdf"
    if any(term in text for term in ("word", "docx", "doc", "document", "文档", "报告")):
        return "docx"
    return "docx"


def _default_xlsx_sheets_for_request(content: str, *, title: str = "") -> list[dict]:
    """Return a neutral sheet skeleton without inferring domain-specific columns."""
    sheet_name = str(title or "").strip() or "工作表"
    for char in "[]:*?/\\":
        sheet_name = sheet_name.replace(char, "_")
    return [{"name": sheet_name[:31] or "工作表", "headers": [], "data": []}]


def repair_project_office_tool_input(
    content: str,
    tool_input: dict,
    *,
    infer_file_type_from_content: bool = False,
) -> tuple[dict, list[str]]:
    """Ensure office-document tool inputs have file_type, file_name, title, and sheets (if xlsx)."""
    repaired = dict(tool_input or {})
    changes: list[str] = []
    file_type = _infer_office_file_type(content, repaired, infer_from_content=infer_file_type_from_content)
    if not repaired.get("file_type"):
        repaired["file_type"] = file_type
        changes.append(f"补齐文件类型：{file_type.upper()}")
    explicit_title = str(repaired.get("title") or "").strip()
    title = normalize_deliverable_title(
        content=content,
        explicit_title=explicit_title,
        file_type=file_type,
    )
    if not explicit_title:
        repaired["title"] = title
        changes.append("补齐标题")
    if not str(repaired.get("file_name") or "").strip():
        repaired["file_name"] = file_name_for_deliverable(title, file_type)
        changes.append(f"补齐文件名：{repaired['file_name']}")
    if file_type == "xlsx" and not repaired.get("sheets"):
        repaired["sheets"] = _default_xlsx_sheets_for_request(content, title=explicit_title)
        changes.append("生成默认 Excel 工作表结构")
    return repaired, changes


# Backward-compatible aliases for the legacy ``chat_streaming`` shim and tests.
_try_extract_tool_use_json = try_extract_tool_use_json
_extract_tool_use_json_blocks = extract_tool_use_json_blocks
_repair_project_office_tool_input = repair_project_office_tool_input
_slugify_deliverable_name = slugify_deliverable_name
