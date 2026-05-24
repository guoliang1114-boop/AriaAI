"""Unit tests for context_builder sub-modules."""
from __future__ import annotations

import json
import unittest

from app.services.context_builder.constants import (
    MAX_FILE_CONTENT_CHARS,
    MAX_SINGLE_FILE_CHARS,
    PROJECT_FILE_QUERY_MARKERS,
    PROJECT_MARKDOWN_TOOL_NAMES,
    PROJECT_OFFICE_TOOL_NAMES,
)
from app.services.context_builder.query_classifiers import (
    _is_project_review_query,
    _normalize_client_match_text,
    is_client_project_portfolio_query,
    is_workspace_project_inventory_query,
)
from app.services.context_builder.memory_formatters import _memory_items_for_portfolio
from app.services.context_builder.skill_context import _filter_skill_tools
from app.services.chat.tool_repair import (
    extract_tool_use_json_blocks,
    repair_project_office_tool_input,
    try_extract_tool_use_json,
)
from app.services.chat.truncation import strip_truncation_marker


# ---------------------------------------------------------------------------
# Query classifiers
# ---------------------------------------------------------------------------
class NormalizeClientMatchTextTests(unittest.TestCase):
    def test_lowercases_and_removes_whitespace(self):
        self.assertEqual(_normalize_client_match_text("Hello World"), "helloworld")
        self.assertEqual(_normalize_client_match_text("  A  B  "), "ab")


class IsClientProjectPortfolioQueryTests(unittest.TestCase):
    def test_true_for_portfolio_summary(self):
        self.assertTrue(is_client_project_portfolio_query("全部项目的情况和风险总结"))

    def test_true_for_all_projects_summary(self):
        self.assertTrue(is_client_project_portfolio_query("所有项目总结"))

    def test_false_for_single_project(self):
        self.assertFalse(is_client_project_portfolio_query("这个项目的状态"))

    def test_false_for_empty(self):
        self.assertFalse(is_client_project_portfolio_query(""))

    def test_true_for_english_portfolio(self):
        self.assertTrue(is_client_project_portfolio_query("project portfolio summary"))


class IsWorkspaceProjectInventoryQueryTests(unittest.TestCase):
    def test_true_for_inventory(self):
        self.assertTrue(is_workspace_project_inventory_query("全部项目清单"))

    def test_true_for_workspace_inventory(self):
        self.assertTrue(is_workspace_project_inventory_query("workspace projects inventory"))

    def test_false_for_single_project(self):
        self.assertFalse(is_workspace_project_inventory_query("一个项目的情况"))


class IsProjectReviewQueryTests(unittest.TestCase):
    def test_true_for_project_summary(self):
        self.assertTrue(_is_project_review_query("项目总结"))

    def test_true_for_project_risks(self):
        self.assertTrue(_is_project_review_query("project risks"))

    def test_false_for_random(self):
        self.assertFalse(_is_project_review_query("hello world"))


# ---------------------------------------------------------------------------
# Memory formatters
# ---------------------------------------------------------------------------
class MemoryItemsForPortfolioTests(unittest.TestCase):
    def test_empty_dict_returns_empty(self):
        self.assertEqual(_memory_items_for_portfolio({}, "key_risks"), [])

    def test_list_input(self):
        memory = {"key_risks": ["Risk A", "Risk B"]}
        self.assertEqual(_memory_items_for_portfolio(memory, "key_risks"), ["Risk A", "Risk B"])

    def test_dict_with_pinned_and_ai(self):
        memory = {"key_risks": {"pinned": ["Pinned Risk"], "ai": ["AI Risk"]}}
        result = _memory_items_for_portfolio(memory, "key_risks")
        self.assertIn("Pinned Risk", result)
        self.assertIn("AI Risk", result)

    def test_limit_respected(self):
        memory = {"key_risks": [f"Risk {i}" for i in range(10)]}
        result = _memory_items_for_portfolio(memory, "key_risks", limit=3)
        self.assertEqual(len(result), 3)

    def test_non_list_non_dict_returns_empty(self):
        self.assertEqual(_memory_items_for_portfolio({"key_risks": "string"}, "key_risks"), [])


# ---------------------------------------------------------------------------
# Skill context
# ---------------------------------------------------------------------------
class FilterSkillToolsTests(unittest.TestCase):
    def test_non_digital_strategy_returns_all(self):
        class FakeSkill:
            name = "general-analysis"
            system_prompt = "Analyze data"

        tool_defs = [{"name": "tool_a"}, {"name": "tool_b"}]
        result = _filter_skill_tools(FakeSkill(), tool_defs)
        self.assertEqual(len(result), 2)

    def test_digital_strategy_returns_only_ppt(self):
        class FakeSkill:
            name = "digital-strategy"
            system_prompt = "Digital strategy"

        tool_defs = [{"name": "tool_a"}, {"name": "generate_ppt_from_skill"}]
        result = _filter_skill_tools(FakeSkill(), tool_defs)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["name"], "generate_ppt_from_skill")

    def test_chinese_digital_strategy(self):
        class FakeSkill:
            name = "分析"
            system_prompt = "数字化战略"

        tool_defs = [{"name": "generate_ppt_from_skill"}, {"name": "other_tool"}]
        result = _filter_skill_tools(FakeSkill(), tool_defs)
        self.assertEqual(len(result), 1)


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
class ConstantsTests(unittest.TestCase):
    def test_max_file_content_chars_is_positive(self):
        self.assertGreater(MAX_FILE_CONTENT_CHARS, 0)

    def test_max_single_file_chars_is_positive(self):
        self.assertGreater(MAX_SINGLE_FILE_CHARS, 0)

    def test_project_markdown_tool_names_not_empty(self):
        self.assertTrue(len(PROJECT_MARKDOWN_TOOL_NAMES) > 0)

    def test_project_office_tool_names_not_empty(self):
        self.assertTrue(len(PROJECT_OFFICE_TOOL_NAMES) > 0)

    def test_project_file_query_markers_has_chinese(self):
        self.assertTrue(any("\u4e00" <= m <= "\u9fff" for m in PROJECT_FILE_QUERY_MARKERS))


# ---------------------------------------------------------------------------
# Tool repair (from chat/tool_repair module - re-exported via shim)
# ---------------------------------------------------------------------------
class TryExtractToolUseJsonTests(unittest.TestCase):
    def test_empty_returns_none(self):
        self.assertIsNone(try_extract_tool_use_json(""))

    def test_extracts_valid_tool_use(self):
        text = 'Some text {"type": "tool_use", "name": "test_tool"} more'
        result = try_extract_tool_use_json(text)
        self.assertIsNotNone(result)
        self.assertEqual(result["type"], "tool_use")

    def test_returns_none_for_non_tool_use(self):
        text = '{"type": "other", "name": "test"}'
        self.assertIsNone(try_extract_tool_use_json(text))


class ExtractToolUseJsonBlocksTests(unittest.TestCase):
    def test_empty_returns_empty(self):
        blocks, remaining = extract_tool_use_json_blocks("")
        self.assertEqual(blocks, [])
        self.assertEqual(remaining, "")

    def test_extracts_and_cleans(self):
        text = 'Hello {"type": "tool_use", "name": "a"} World'
        blocks, remaining = extract_tool_use_json_blocks(text)
        self.assertEqual(len(blocks), 1)
        self.assertEqual(blocks[0]["name"], "a")
        self.assertEqual(remaining.strip(), "Hello  World")


class StripTruncationMarkerTests(unittest.TestCase):
    def test_no_marker_returns_unchanged(self):
        result, was_truncated = strip_truncation_marker("Hello world")
        self.assertEqual(result, "Hello world")
        self.assertFalse(was_truncated)

    def test_strips_marker(self):
        result, was_truncated = strip_truncation_marker("Hello[OUTPUT_TRUNCATED]")
        self.assertEqual(result, "Hello")
        self.assertTrue(was_truncated)


class RepairProjectOfficeToolInputTests(unittest.TestCase):
    def test_defaults_file_type_to_docx_without_explicit_input(self):
        content = "Create an excel file"
        tool_input = {"title": "Report"}
        repaired, changes = repair_project_office_tool_input(content, tool_input)
        self.assertEqual(repaired["file_type"], "docx")
        self.assertTrue(any("文件类型" in c for c in changes))

    def test_preserves_explicit_xlsx_file_type(self):
        content = "Create an excel file"
        tool_input = {"title": "Report", "file_type": "xlsx"}
        repaired, _ = repair_project_office_tool_input(content, tool_input)
        self.assertEqual(repaired["file_type"], "xlsx")
        self.assertIn("sheets", repaired)

    def test_adds_file_name(self):
        content = "我打算给客户准备一个 CRM 迁移的方案建议书，帮我起草 PPT"
        tool_input = {"file_type": "pptx"}
        repaired, changes = repair_project_office_tool_input(content, tool_input)
        self.assertEqual(repaired["title"], "CRM迁移方案建议书")
        self.assertEqual(repaired["file_name"], "CRM迁移方案建议书.pptx")

    def test_adds_title(self):
        content = "Create report"
        tool_input = {"file_type": "docx", "file_name": "report.docx"}
        repaired, changes = repair_project_office_tool_input(content, tool_input)
        self.assertTrue(len(repaired["title"]) > 0)

    def test_xlsx_gets_neutral_sheet_skeleton(self):
        content = "Create interview excel"
        tool_input = {"file_type": "xlsx"}
        repaired, changes = repair_project_office_tool_input(content, tool_input)
        self.assertEqual(repaired["file_type"], "xlsx")
        self.assertIn("sheets", repaired)
        self.assertEqual(repaired["sheets"], [{"name": "工作表", "headers": [], "data": []}])


if __name__ == "__main__":
    unittest.main()
