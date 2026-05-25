from __future__ import annotations

from pathlib import Path

from app.services.chat.tool_validation import validate_write_tool_result, validation_error_result
from app.tools.office_documents import WRITE_PROJECT_OFFICE_DOCUMENT_TOOL_NAME
from app.tools.project_markdown import PROJECT_MARKDOWN_TOOL_NAME


def test_markdown_validation_requires_file_and_expected_content(tmp_path: Path):
    path = tmp_path / "projects" / "1" / "risk.md"
    path.parent.mkdir(parents=True)
    path.write_text("# 风险\n\n- 客户决策链未明确", encoding="utf-8")
    result = {"status": "success", "output": {"path": "projects/1/risk.md"}}

    ok, error = validate_write_tool_result(
        PROJECT_MARKDOWN_TOOL_NAME,
        result,
        {"content": "客户决策链未明确"},
        uploads_dir=tmp_path,
    )

    assert ok is True
    assert error == ""


def test_markdown_validation_fails_when_content_is_not_written(tmp_path: Path):
    path = tmp_path / "projects" / "1" / "risk.md"
    path.parent.mkdir(parents=True)
    path.write_text("# 其他内容", encoding="utf-8")
    result = {"status": "success", "output": {"path": "projects/1/risk.md"}}

    ok, error = validate_write_tool_result(
        PROJECT_MARKDOWN_TOOL_NAME,
        result,
        {"content": "客户决策链未明确"},
        uploads_dir=tmp_path,
    )

    assert ok is False
    assert "内容校验失败" in error


def test_office_validation_requires_non_empty_file(tmp_path: Path):
    result = {"ok": True, "path": "projects/1/deck.pptx"}

    ok, error = validate_write_tool_result(
        WRITE_PROJECT_OFFICE_DOCUMENT_TOOL_NAME,
        result,
        {},
        uploads_dir=tmp_path,
    )

    assert ok is False
    assert "不存在" in error


def test_validation_error_result_marks_failed_tool_result():
    payload = validation_error_result(
        PROJECT_MARKDOWN_TOOL_NAME,
        {"status": "success", "output": {"path": "projects/1/risk.md"}},
        "校验失败",
    )

    assert payload["status"] == "error"
    assert payload["success"] is False
    assert payload["validation_failed"] is True
    assert payload["output"]["validation_failed"] is True
