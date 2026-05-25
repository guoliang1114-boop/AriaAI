"""Post-execution validation for tools that claim to write project state."""
from __future__ import annotations

from pathlib import Path
from typing import Any

from app.config import UPLOADS_DIR
from app.tools.office_documents import WRITE_PROJECT_OFFICE_DOCUMENT_TOOL_NAME
from app.tools.project_markdown import PROJECT_MARKDOWN_TOOL_NAME


def _tool_output(result: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(result, dict):
        return {}
    output = result.get("output")
    return output if isinstance(output, dict) else result


def _relative_path(output: dict[str, Any]) -> str:
    return str(output.get("path") or output.get("file_path") or "").strip()


def _validate_file_exists(output: dict[str, Any], *, uploads_dir: Path) -> tuple[bool, str]:
    path = _relative_path(output)
    if not path:
        return False, "工具没有返回文件路径。"
    full_path = uploads_dir / path
    if not full_path.is_file():
        return False, f"工具返回的文件不存在：{path}"
    if full_path.stat().st_size <= 0:
        return False, f"工具生成的文件为空：{path}"
    return True, ""


def validate_write_tool_result(
    tool_name: str,
    result: dict[str, Any] | None,
    tool_input: dict[str, Any] | None = None,
    *,
    uploads_dir: Path = UPLOADS_DIR,
) -> tuple[bool, str]:
    """Validate claims made by write tools before the UI marks them completed."""
    if not isinstance(result, dict):
        return False, "工具没有返回结构化结果。"
    if result.get("status") == "error" or result.get("success") is False or result.get("error"):
        return False, str(result.get("error") or "工具执行失败。")

    output = _tool_output(result)
    if tool_name == PROJECT_MARKDOWN_TOOL_NAME:
        ok, message = _validate_file_exists(output, uploads_dir=uploads_dir)
        if not ok:
            return ok, message
        expected = str((tool_input or {}).get("content") or "").strip()
        path = _relative_path(output)
        if expected and path:
            file_text = (uploads_dir / path).read_text(encoding="utf-8", errors="replace")
            if expected not in file_text:
                return False, "Markdown 文件内容校验失败：生成文件不包含本次应写入内容。"
        return True, ""

    if tool_name == WRITE_PROJECT_OFFICE_DOCUMENT_TOOL_NAME:
        return _validate_file_exists(output, uploads_dir=uploads_dir)

    return True, ""


def validation_error_result(tool_name: str, result: dict[str, Any] | None, error: str) -> dict[str, Any]:
    payload = dict(result or {})
    payload.update(
        {
            "type": payload.get("type") or "tool_result",
            "tool_name": tool_name,
            "status": "error",
            "success": False,
            "error": error,
            "validation_failed": True,
        }
    )
    output = payload.get("output")
    if isinstance(output, dict):
        output = dict(output)
        output["validation_failed"] = True
        output["error"] = error
        payload["output"] = output
    return payload
