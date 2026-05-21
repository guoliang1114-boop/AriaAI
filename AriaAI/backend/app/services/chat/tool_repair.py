"""Tool-input repair, JSON extraction, and office-document helpers."""
from __future__ import annotations

import json
import re


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


def _slugify_deliverable_name(value: str, fallback: str) -> str:
    slug = re.sub(r"[^A-Za-z0-9\u4e00-\u9fa5._-]+", "-", str(value or "").strip()).strip("-")
    return slug[:48].strip("-") or fallback


def _infer_office_file_type(content: str, tool_input: dict) -> str:
    """Resolve the desired office file type from explicit tool input only."""
    explicit = str(tool_input.get("file_type") or "").strip().lower()
    if explicit:
        return explicit
    return "docx"


def _default_xlsx_sheets_for_request(content: str) -> list[dict]:
    """Return a neutral sheet skeleton without inferring domain-specific columns."""
    return [{"name": "工作表", "headers": [], "data": []}]


def repair_project_office_tool_input(content: str, tool_input: dict) -> tuple[dict, list[str]]:
    """Ensure office-document tool inputs have file_type, file_name, title, and sheets (if xlsx)."""
    repaired = dict(tool_input or {})
    changes: list[str] = []
    file_type = _infer_office_file_type(content, repaired)
    if not repaired.get("file_type"):
        repaired["file_type"] = file_type
        changes.append(f"补齐文件类型：{file_type.upper()}")
    if not str(repaired.get("file_name") or "").strip():
        title_for_name = str(repaired.get("title") or content or "project-deliverable")
        repaired["file_name"] = f"{_slugify_deliverable_name(title_for_name, 'project-deliverable')}.{file_type}"
        changes.append(f"补齐文件名：{repaired['file_name']}")
    if not str(repaired.get("title") or "").strip():
        repaired["title"] = str(content or repaired["file_name"]).strip()[:80]
        changes.append("补齐标题")
    if file_type == "xlsx" and not repaired.get("sheets"):
        repaired["sheets"] = _default_xlsx_sheets_for_request(content)
        changes.append("生成默认 Excel 工作表结构")
    return repaired, changes


# Backward-compatible aliases for the legacy ``chat_streaming`` shim and tests.
_try_extract_tool_use_json = try_extract_tool_use_json
_extract_tool_use_json_blocks = extract_tool_use_json_blocks
_repair_project_office_tool_input = repair_project_office_tool_input
