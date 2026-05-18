"""Unit tests for chat_streaming pure functions."""
from __future__ import annotations

import json
import unittest
from datetime import datetime
from typing import Optional

from app.services.chat_streaming import (
    OUTPUT_TRUNCATED_MARKER,
    ChatRuntime,
    _build_artifact_notice,
    _build_completed_skill_progress,
    _build_slides_from_strategy_text,
    _cap_max_tokens_for_model,
    _clean_slide_line,
    _extract_artifact,
    _has_ppt_artifact,
    _is_digital_strategy_runtime,
    _is_standalone_fast_path,
    _looks_like_digital_strategy_tool_input,
    _repair_digital_strategy_ppt_tool_input,
    _repair_project_office_tool_input,
    _resolve_runtime_model_and_tokens,
    _route_ppt_tool_for_skill,
    _should_apply_skill,
    _should_auto_generate_digital_strategy_ppt,
    _sse_event,
    _strip_truncation_marker,
    _summarize_tool_result,
    _task_payload_tool_calls,
    _to_user_friendly_error,
    _tool_progress_payload,
    _tool_start_progress_payload,
    _try_extract_tool_use_json,
)


class DummyRequest:
    """Lightweight stand-in for SendMessageRequest."""

    def __init__(
        self,
        content: str = "",
        project_id: Optional[int] = None,
        skill_id: Optional[int] = None,
        rag_doc_ids: Optional[list] = None,
        file_ids: Optional[list] = None,
        force_skill: bool = False,
    ):
        self.content = content
        self.project_id = project_id
        self.skill_id = skill_id
        self.rag_doc_ids = rag_doc_ids or []
        self.file_ids = file_ids or []
        self.force_skill = force_skill


class TryExtractToolUseJsonTests(unittest.TestCase):
    def test_extracts_valid_tool_use_block(self):
        text = 'Some text before {"type":"tool_use","name":"generate_ppt"} and after'
        result = _try_extract_tool_use_json(text)
        self.assertEqual(result, {"type": "tool_use", "name": "generate_ppt"})

    def test_returns_none_when_no_tool_use_type(self):
        text = 'Some text {"type":"other","name":"x"} more'
        result = _try_extract_tool_use_json(text)
        self.assertIsNone(result)

    def test_returns_none_for_plain_text(self):
        self.assertIsNone(_try_extract_tool_use_json("hello world"))

    def test_returns_none_for_invalid_json(self):
        text = 'text {"type": "tool_use", broken} end'
        self.assertIsNone(_try_extract_tool_use_json(text))

    def test_finds_nested_json(self):
        text = 'prefix {"type":"tool_use","input":{"a":1}} suffix'
        result = _try_extract_tool_use_json(text)
        self.assertEqual(result["type"], "tool_use")
        self.assertEqual(result["input"], {"a": 1})

    def test_skips_malformed_then_finds_valid(self):
        text = '{"type": bad} then {"type":"tool_use","name":"x"}'
        result = _try_extract_tool_use_json(text)
        self.assertEqual(result, {"type": "tool_use", "name": "x"})

    def test_empty_string(self):
        self.assertIsNone(_try_extract_tool_use_json(""))


class SseEventTests(unittest.TestCase):
    def test_serializes_datetime_payloads(self):
        raw = _sse_event({"type": "task_run", "created_at": datetime(2026, 5, 17, 19, 54, 59)})

        payload = json.loads(raw.removeprefix("data: ").strip())
        self.assertEqual(payload["created_at"], "2026-05-17 19:54:59")


class TaskPayloadToolCallsTests(unittest.TestCase):
    def test_builds_collapsible_step_details_from_task_events(self):
        calls = _task_payload_tool_calls(
            {
                "steps": [
                    {
                        "id": 10,
                        "key": "collect_context",
                        "title": "收集项目上下文",
                        "status": "completed",
                        "sort_order": 1,
                        "output": {"project_name": "东阿阿胶", "client": "东阿阿胶股份有限公司"},
                    },
                    {
                        "id": 11,
                        "key": "create_document",
                        "title": "生成访谈 Excel",
                        "status": "failed",
                        "sort_order": 2,
                        "output": {"file_type": "xlsx", "sheets": [{"name": "访谈计划"}]},
                        "error_message": "缺少 project_id",
                    },
                ],
                "events": [
                    {
                        "step_id": 10,
                        "event_type": "step_completed",
                        "message": "上下文已加载",
                        "payload": {"project": {"name": "东阿阿胶", "client": "东阿阿胶股份有限公司"}},
                        "created_at": "2026-05-17 14:21:29.816749",
                    },
                    {
                        "step_id": 11,
                        "event_type": "step_failed",
                        "message": "工具执行失败",
                        "payload": {"error_code": "missing_argument", "retryable": True},
                        "created_at": "2026-05-17 14:21:31.000000",
                    },
                ],
            }
        )

        self.assertEqual(calls[0]["status"], "completed")
        self.assertIn("上下文：东阿阿胶 / 东阿阿胶股份有限公司", calls[0]["details"])
        self.assertTrue(any("上下文已加载" in detail for detail in calls[0]["details"]))
        self.assertEqual(calls[1]["status"], "error")
        self.assertEqual(calls[1]["error"], "缺少 project_id")
        self.assertTrue(any("工作表：访谈计划" in detail for detail in calls[1]["details"]))
        self.assertTrue(any("missing_argument" in detail and "可重试" in detail for detail in calls[1]["details"]))


class CapMaxTokensForModelTests(unittest.TestCase):
    def test_kimi_k2_6_capped_at_32768(self):
        self.assertEqual(_cap_max_tokens_for_model("kimi-k2.6-latest", 50000), 32768)

    def test_kimi_k2_5_capped_at_32768(self):
        self.assertEqual(_cap_max_tokens_for_model("kimi-k2.5", 50000), 32768)

    def test_moonshot_8k_capped_at_4096(self):
        self.assertEqual(_cap_max_tokens_for_model("moonshot-v1-8k", 10000), 4096)

    def test_claude_capped_at_8192(self):
        self.assertEqual(_cap_max_tokens_for_model("claude-3-opus", 20000), 8192)

    def test_default_capped_at_8192(self):
        self.assertEqual(_cap_max_tokens_for_model("gpt-4", 20000), 8192)

    def test_respects_lower_requested_value(self):
        self.assertEqual(_cap_max_tokens_for_model("claude-3", 1000), 1000)

    def test_none_model_defaults(self):
        self.assertEqual(_cap_max_tokens_for_model(None, 5000), 5000)


class IsStandaloneFastPathTests(unittest.TestCase):
    def test_true_when_no_project_no_skill_no_rag_no_files_short_text(self):
        req = DummyRequest(content="hello", project_id=None, skill_id=None)
        self.assertTrue(_is_standalone_fast_path(req, None))

    def test_false_when_project_set(self):
        req = DummyRequest(content="hi", project_id=1)
        self.assertFalse(_is_standalone_fast_path(req, None))

    def test_false_when_skill_set(self):
        req = DummyRequest(content="hi", skill_id=1)
        self.assertFalse(_is_standalone_fast_path(req, 1))

    def test_false_when_rag_docs(self):
        req = DummyRequest(content="hi", rag_doc_ids=[1])
        self.assertFalse(_is_standalone_fast_path(req, None))

    def test_false_when_files(self):
        req = DummyRequest(content="hi", file_ids=[1])
        self.assertFalse(_is_standalone_fast_path(req, None))

    def test_false_when_long_text(self):
        req = DummyRequest(content="x" * 281)
        self.assertFalse(_is_standalone_fast_path(req, None))

    def test_false_when_portfolio_query(self):
        req = DummyRequest(content="所有项目总结")
        self.assertFalse(_is_standalone_fast_path(req, None))

    def test_false_when_workspace_inventory_query(self):
        req = DummyRequest(content="全部项目列表")
        self.assertFalse(_is_standalone_fast_path(req, None))


class ResolveRuntimeModelAndTokensTests(unittest.TestCase):
    def test_standalone_fast_path_kimi(self):
        req = DummyRequest(content="hello")
        model, tokens = _resolve_runtime_model_and_tokens(req, "kimi-k2.6", 8192, None)
        self.assertEqual(model, "moonshot-v1-8k")
        self.assertEqual(tokens, 1536)

    def test_client_portfolio_context_with_deepseek(self):
        req = DummyRequest(content="展示客户项目")
        model, tokens = _resolve_runtime_model_and_tokens(
            req, "kimi-k2.6", 8192, None, has_deepseek_api_key=True, project_context="# Client Project Portfolio Context\n..."
        )
        self.assertEqual(model, "deepseek-v4-flash")
        self.assertEqual(tokens, 4096)

    def test_client_portfolio_context_without_deepseek(self):
        req = DummyRequest(content="展示客户项目")
        model, tokens = _resolve_runtime_model_and_tokens(
            req, "some-model", 8192, None, has_deepseek_api_key=False, project_context="# Client Project Portfolio Context"
        )
        self.assertEqual(model, "some-model")
        self.assertEqual(tokens, 4096)

    def test_workspace_inventory_with_deepseek(self):
        req = DummyRequest(content="列出项目")
        model, tokens = _resolve_runtime_model_and_tokens(
            req, "kimi-k2.6", 10000, None, has_deepseek_api_key=True, project_context="# Workspace Project Inventory Context"
        )
        self.assertEqual(model, "deepseek-v4-flash")
        self.assertEqual(tokens, 6144)

    def test_no_project_no_skill_defaults_2048(self):
        req = DummyRequest(content="hello")
        model, tokens = _resolve_runtime_model_and_tokens(req, "gpt-4", 8192, None)
        self.assertEqual(model, "gpt-4")
        self.assertEqual(tokens, 2048)

    def test_with_project_returns_max_tokens(self):
        req = DummyRequest(content="hello", project_id=1)
        model, tokens = _resolve_runtime_model_and_tokens(req, "gpt-4", 8192, None)
        self.assertEqual(model, "gpt-4")
        self.assertEqual(tokens, 8192)

    def test_portfolio_query_with_deepseek(self):
        req = DummyRequest(content="所有项目总结")
        model, tokens = _resolve_runtime_model_and_tokens(
            req, "deepseek-v4-pro", 5000, None, has_deepseek_api_key=True
        )
        self.assertEqual(model, "deepseek-v4-flash")
        self.assertEqual(tokens, 4096)


class ShouldApplySkillTests(unittest.TestCase):
    def test_no_skill_returns_false(self):
        self.assertFalse(_should_apply_skill("生成PPT", None))

    def test_empty_content_returns_false(self):
        from app.models.db import Skill
        skill = Skill(name="test")
        self.assertFalse(_should_apply_skill("", skill))
        self.assertFalse(_should_apply_skill("   ", skill))

    def test_explicit_skill_keyword(self):
        from app.models.db import Skill
        skill = Skill(name="test")
        self.assertTrue(_should_apply_skill("@skill 生成PPT", skill))
        self.assertTrue(_should_apply_skill("使用skill", skill))
        self.assertTrue(_should_apply_skill("调用skill", skill))

    def test_deliverable_intent_without_casual(self):
        from app.models.db import Skill
        skill = Skill(name="test")
        self.assertTrue(_should_apply_skill("生成一份战略报告", skill))
        self.assertTrue(_should_apply_skill("制作PPT", skill))

    def test_casual_question_blocks_deliverable(self):
        from app.models.db import Skill
        skill = Skill(name="test")
        self.assertFalse(_should_apply_skill("为什么需要PPT", skill))
        self.assertFalse(_should_apply_skill("怎么生成报告", skill))

    def test_long_template_like(self):
        from app.models.db import Skill
        skill = Skill(name="test")
        long_text = "x" * 200 + "\n" + "some: value"
        self.assertTrue(_should_apply_skill(long_text, skill))


class ToolProgressPayloadTests(unittest.TestCase):
    def test_generate_ppt(self):
        result = _tool_progress_payload("generate_ppt", {"title": "My Deck", "slides": [1, 2, 3]})
        self.assertIn("My Deck", result["message"])
        self.assertEqual(result["total"], 3)
        self.assertEqual(result["current"], 0)

    def test_generate_ppt_from_skill(self):
        result = _tool_progress_payload("generate_ppt_from_skill", {"title": "X", "slides": []})
        self.assertIn("X", result["message"])
        self.assertEqual(result["total"], 0)

    def test_generate_docx(self):
        result = _tool_progress_payload("generate_docx", {"title": "Doc"})
        self.assertIn("Doc", result["message"])

    def test_generate_xlsx(self):
        result = _tool_progress_payload("generate_xlsx", {"sheets": [1, 2]})
        self.assertIn("2 sheets", result["message"])

    def test_generate_pdf(self):
        result = _tool_progress_payload("generate_pdf", {"title": "PDF"})
        self.assertIn("PDF", result["message"])

    def test_unknown_tool(self):
        result = _tool_progress_payload("custom_tool", {})
        self.assertIn("custom_tool", result["message"])


class ToolStartProgressPayloadTests(unittest.TestCase):
    def test_generate_ppt(self):
        result = _tool_start_progress_payload("generate_ppt")
        self.assertIn("slides", result["message"])

    def test_generate_docx(self):
        result = _tool_start_progress_payload("generate_docx")
        self.assertIn("document", result["message"])

    def test_generate_xlsx(self):
        result = _tool_start_progress_payload("generate_xlsx")
        self.assertIn("spreadsheet", result["message"])

    def test_generate_pdf(self):
        result = _tool_start_progress_payload("generate_pdf")
        self.assertIn("PDF", result["message"])

    def test_project_markdown(self):
        result = _tool_start_progress_payload("update_project_markdown_document")
        self.assertIn("写入", result["message"])

    def test_read_markdown(self):
        result = _tool_start_progress_payload("read_project_markdown_document")
        self.assertIn("读取", result["message"])

    def test_unknown_tool(self):
        result = _tool_start_progress_payload("other")
        self.assertIn("other", result["message"])


class ToUserFriendlyErrorTests(unittest.TestCase):
    def test_429_error(self):
        self.assertIn("繁忙", _to_user_friendly_error("429 too many requests"))

    def test_engine_overloaded(self):
        self.assertIn("繁忙", _to_user_friendly_error("engine_overloaded"))

    def test_no_api_key(self):
        self.assertIn("配置 API Key", _to_user_friendly_error("No Kimi API key"))

    def test_timeout(self):
        self.assertIn("超时", _to_user_friendly_error("Connection timeout"))

    def test_connection_refused(self):
        self.assertIn("超时", _to_user_friendly_error("Connection refused"))

    def test_rate_limit(self):
        self.assertIn("频率", _to_user_friendly_error("Rate limit exceeded"))

    def test_passthrough(self):
        self.assertEqual(_to_user_friendly_error("Unknown error"), "Unknown error")

    def test_kimi_busy_passthrough(self):
        msg = "Kimi 服务当前繁忙"
        self.assertEqual(_to_user_friendly_error(msg), msg)


class ExtractArtifactTests(unittest.TestCase):
    def test_full_source(self):
        result = _extract_artifact({"id": 42, "file_path": "/a/b.pptx", "file_name": "deck.pptx", "file_type": "pptx"})
        self.assertEqual(
            result,
            {"name": "deck.pptx", "file_type": "pptx", "path": "/a/b.pptx", "description": "", "project_file_id": 42},
        )

    def test_nested_output(self):
        result = _extract_artifact({"output": {"path": "/x", "name": "y", "file_type": "docx", "note": "n"}})
        self.assertEqual(result["name"], "y")
        self.assertEqual(result["description"], "n")

    def test_missing_fields_returns_none(self):
        self.assertIsNone(_extract_artifact({"file_path": "/a"}))
        self.assertIsNone(_extract_artifact({"file_name": "x"}))
        self.assertIsNone(_extract_artifact({"file_type": "pptx"}))

    def test_empty_dict(self):
        self.assertIsNone(_extract_artifact({}))

    def test_description_fallbacks(self):
        result = _extract_artifact({"file_path": "/a", "file_name": "x", "file_type": "pptx", "message": "m"})
        self.assertEqual(result["description"], "m")

    def test_markdown_extension_overrides_text_file_type(self):
        result = _extract_artifact({"file_path": "/a/meeting.md", "file_name": "meeting.md", "file_type": "txt"})
        self.assertEqual(result["file_type"], "md")


class RepairProjectOfficeToolInputTests(unittest.TestCase):
    def test_repairs_interview_excel_request(self):
        result, changes = _repair_project_office_tool_input("我想要准备一个访谈的excel", {})

        self.assertEqual(result["file_type"], "xlsx")
        self.assertTrue(result["file_name"].endswith(".xlsx"))
        self.assertEqual(result["sheets"][0]["name"], "访谈计划")
        self.assertIn("生成默认 Excel 工作表结构", changes)


class BuildArtifactNoticeTests(unittest.TestCase):
    def test_with_names(self):
        result = _build_artifact_notice([{"name": "a.pptx"}, {"name": "b.docx"}])
        self.assertIn("a.pptx", result)
        self.assertIn("b.docx", result)

    def test_empty_names(self):
        result = _build_artifact_notice([{"file_type": "pptx"}])
        self.assertIn("已生成附件", result)

    def test_empty_list(self):
        result = _build_artifact_notice([])
        self.assertIn("已生成附件", result)


class SummarizeToolResultTests(unittest.TestCase):
    def test_error(self):
        self.assertEqual(_summarize_tool_result({"error": "fail"}), "fail")

    def test_file_name(self):
        self.assertEqual(_summarize_tool_result({"file_name": "x.docx"}), "Created x.docx")

    def test_message(self):
        self.assertEqual(_summarize_tool_result({"message": "done"}), "done")

    def test_success_true(self):
        self.assertEqual(_summarize_tool_result({"success": True}), "Completed successfully")

    def test_empty(self):
        self.assertEqual(_summarize_tool_result({}), "")


class BuildCompletedSkillProgressTests(unittest.TestCase):
    def test_with_tool_events(self):
        events = [{"status": "completed", "tool_name": "gen_ppt"}]
        result = _build_completed_skill_progress(events, "response")
        self.assertEqual(len(result), 5)
        tools_step = [s for s in result if s["key"] == "tools"][0]
        self.assertIn("完成: gen_ppt", tools_step["logs"])

    def test_failed_tool_event(self):
        events = [{"status": "failed", "summary": "oops"}]
        result = _build_completed_skill_progress(events, "r")
        tools_step = [s for s in result if s["key"] == "tools"][0]
        self.assertIn("失败: oops", tools_step["logs"])

    def test_no_tool_events(self):
        result = _build_completed_skill_progress([], "response")
        tools_step = [s for s in result if s["key"] == "tools"][0]
        self.assertIn("未调用", tools_step["logs"][0])

    def test_final_step_has_text_length(self):
        result = _build_completed_skill_progress([], "hello world")
        final = [s for s in result if s["key"] == "final"][0]
        self.assertIn("11", final["logs"][0])


class HasPptArtifactTests(unittest.TestCase):
    def test_true_for_pptx(self):
        self.assertTrue(_has_ppt_artifact([{"file_type": "pptx"}]))

    def test_false_for_docx(self):
        self.assertFalse(_has_ppt_artifact([{"file_type": "docx"}]))

    def test_empty_list(self):
        self.assertFalse(_has_ppt_artifact([]))

    def test_case_insensitive(self):
        self.assertTrue(_has_ppt_artifact([{"file_type": "PPTX"}]))


class IsDigitalStrategyRuntimeTests(unittest.TestCase):
    def test_skill_name_match(self):
        runtime = ChatRuntime(
            conv_id=1, selected_model="m", llm=None, system="s",
            api_messages=[], rag_sources=[], tools=None, max_tokens=1, temperature=0.0,
            skill_name="digital-strategy",
        )
        self.assertTrue(_is_digital_strategy_runtime(runtime))

    def test_system_match(self):
        runtime = ChatRuntime(
            conv_id=1, selected_model="m", llm=None, system="数字化战略分析",
            api_messages=[], rag_sources=[], tools=None, max_tokens=1, temperature=0.0,
        )
        self.assertTrue(_is_digital_strategy_runtime(runtime))

    def test_no_match(self):
        runtime = ChatRuntime(
            conv_id=1, selected_model="m", llm=None, system="general",
            api_messages=[], rag_sources=[], tools=None, max_tokens=1, temperature=0.0,
            skill_name="other",
        )
        self.assertFalse(_is_digital_strategy_runtime(runtime))


class LooksLikeDigitalStrategyToolInputTests(unittest.TestCase):
    def test_digital_strategy_in_json(self):
        self.assertTrue(_looks_like_digital_strategy_tool_input({"title": "digital strategy"}))

    def test_chinese_marker(self):
        self.assertTrue(_looks_like_digital_strategy_tool_input({"title": "数字化转型"}))

    def test_three_horizon(self):
        self.assertTrue(_looks_like_digital_strategy_tool_input({"content": "three-horizon"}))

    def test_no_match(self):
        self.assertFalse(_looks_like_digital_strategy_tool_input({"title": "hello"}))


class ShouldAutoGenerateDigitalStrategyPptTests(unittest.TestCase):
    def test_true_when_skill_and_text_and_no_ppt(self):
        runtime = ChatRuntime(
            conv_id=1, selected_model="m", llm=None,
            system="数字化战略", api_messages=[], rag_sources=[], tools=None,
            max_tokens=1, temperature=0.0, skill_name="digital-strategy",
        )
        req = DummyRequest(content="some text", skill_id=1)
        self.assertTrue(_should_auto_generate_digital_strategy_ppt(runtime, req, "text", []))

    def test_false_when_no_skill(self):
        runtime = ChatRuntime(
            conv_id=1, selected_model="m", llm=None, system="",
            api_messages=[], rag_sources=[], tools=None, max_tokens=1, temperature=0.0,
        )
        req = DummyRequest(content="text", skill_id=None)
        self.assertFalse(_should_auto_generate_digital_strategy_ppt(runtime, req, "text", []))

    def test_false_when_empty_text(self):
        runtime = ChatRuntime(
            conv_id=1, selected_model="m", llm=None, system="数字化战略",
            api_messages=[], rag_sources=[], tools=None, max_tokens=1, temperature=0.0,
        )
        req = DummyRequest(content="", skill_id=1)
        self.assertFalse(_should_auto_generate_digital_strategy_ppt(runtime, req, "", []))

    def test_false_when_has_ppt_artifact(self):
        runtime = ChatRuntime(
            conv_id=1, selected_model="m", llm=None, system="数字化战略",
            api_messages=[], rag_sources=[], tools=None, max_tokens=1, temperature=0.0,
        )
        req = DummyRequest(content="text", skill_id=1)
        self.assertFalse(_should_auto_generate_digital_strategy_ppt(runtime, req, "text", [{"file_type": "pptx"}]))


class RoutePptToolForSkillTests(unittest.TestCase):
    def test_routes_digital_strategy(self):
        runtime = ChatRuntime(
            conv_id=1, selected_model="m", llm=None, system="数字化战略",
            api_messages=[], rag_sources=[], tools=None, max_tokens=1, temperature=0.0,
        )
        name, inp = _route_ppt_tool_for_skill(runtime, "generate_ppt", {"title": "x"})
        self.assertEqual(name, "generate_ppt_from_skill")
        self.assertEqual(inp["skill_name"], "digital-strategy")

    def test_no_route_for_non_ppt_tool(self):
        runtime = ChatRuntime(
            conv_id=1, selected_model="m", llm=None, system="",
            api_messages=[], rag_sources=[], tools=None, max_tokens=1, temperature=0.0,
        )
        name, inp = _route_ppt_tool_for_skill(runtime, "other_tool", {})
        self.assertEqual(name, "other_tool")

    def test_no_route_when_not_strategy(self):
        runtime = ChatRuntime(
            conv_id=1, selected_model="m", llm=None, system="general",
            api_messages=[], rag_sources=[], tools=None, max_tokens=1, temperature=0.0,
        )
        name, inp = _route_ppt_tool_for_skill(runtime, "generate_ppt", {"title": "x"})
        self.assertEqual(name, "generate_ppt")


class RepairDigitalStrategyPptToolInputTests(unittest.TestCase):
    def test_returns_unchanged_when_valid(self):
        runtime = ChatRuntime(
            conv_id=1, selected_model="m", llm=None, system="数字化战略",
            api_messages=[], rag_sources=[], tools=None, max_tokens=1, temperature=0.0,
        )
        inp = {"title": "T", "slides": [{"type": "content"}]}
        result = _repair_digital_strategy_ppt_tool_input(runtime, "generate_ppt_from_skill", inp, "text")
        self.assertEqual(result["title"], "T")
        self.assertEqual(result["slides"], [{"type": "content"}])

    def test_repairs_empty_title_and_slides(self):
        runtime = ChatRuntime(
            conv_id=1, selected_model="m", llm=None, system="数字化战略",
            api_messages=[], rag_sources=[], tools=None, max_tokens=1, temperature=0.0,
        )
        inp = {"title": ""}
        result = _repair_digital_strategy_ppt_tool_input(runtime, "generate_ppt_from_skill", inp, "# 方案\n\n内容")
        self.assertTrue(result["title"])
        self.assertTrue(result["slides"])
        self.assertEqual(result["skill_name"], "digital-strategy")

    def test_no_repair_for_non_strategy_tool(self):
        runtime = ChatRuntime(
            conv_id=1, selected_model="m", llm=None, system="数字化战略",
            api_messages=[], rag_sources=[], tools=None, max_tokens=1, temperature=0.0,
        )
        inp = {"title": ""}
        result = _repair_digital_strategy_ppt_tool_input(runtime, "generate_ppt", inp, "text")
        self.assertEqual(result, inp)

    def test_no_repair_for_non_strategy_runtime(self):
        runtime = ChatRuntime(
            conv_id=1, selected_model="m", llm=None, system="general",
            api_messages=[], rag_sources=[], tools=None, max_tokens=1, temperature=0.0,
        )
        inp = {"title": ""}
        result = _repair_digital_strategy_ppt_tool_input(runtime, "generate_ppt_from_skill", inp, "text")
        self.assertEqual(result, inp)

    def test_force_rebuild(self):
        runtime = ChatRuntime(
            conv_id=1, selected_model="m", llm=None, system="数字化战略",
            api_messages=[], rag_sources=[], tools=None, max_tokens=1, temperature=0.0,
        )
        inp = {"title": "T", "slides": [{"type": "content"}]}
        result = _repair_digital_strategy_ppt_tool_input(runtime, "generate_ppt_from_skill", inp, "text", force_rebuild=True)
        self.assertTrue(len(result["slides"]) > 1)

    def test_adds_subtitle(self):
        runtime = ChatRuntime(
            conv_id=1, selected_model="m", llm=None, system="数字化战略",
            api_messages=[], rag_sources=[], tools=None, max_tokens=1, temperature=0.0,
        )
        inp = {"title": "T"}
        result = _repair_digital_strategy_ppt_tool_input(runtime, "generate_ppt_from_skill", inp, "text")
        self.assertEqual(result.get("subtitle"), "Generated from the digital strategy response")


class CleanSlideLineTests(unittest.TestCase):
    def test_strips_bullets(self):
        self.assertEqual(_clean_slide_line("- bullet"), "bullet")
        self.assertEqual(_clean_slide_line("* bullet"), "bullet")
        self.assertEqual(_clean_slide_line("• bullet"), "bullet")

    def test_strips_numbering(self):
        self.assertEqual(_clean_slide_line("1. item"), "item")
        self.assertEqual(_clean_slide_line("2、item"), "item")
        self.assertEqual(_clean_slide_line("3) item"), "item")
        self.assertEqual(_clean_slide_line("4）item"), "item")

    def test_no_change_for_plain(self):
        self.assertEqual(_clean_slide_line("plain text"), "plain text")

    def test_strips_whitespace(self):
        self.assertEqual(_clean_slide_line("  text  "), "text")


class BuildSlidesFromStrategyTextTests(unittest.TestCase):
    def test_extracts_title_and_slides(self):
        text = "# 数字化转型战略\n\n一、现状分析\n- 问题1\n- 问题2\n\n二、解决方案\n- 方案1"
        title, slides = _build_slides_from_strategy_text(text)
        self.assertIn("战略", title)
        self.assertTrue(len(slides) >= 2)

    def test_uses_fallback_when_no_sections(self):
        text = "just some plain text without any structure"
        title, slides = _build_slides_from_strategy_text(text)
        self.assertEqual(title, "数字化战略方案")
        self.assertTrue(len(slides) >= 1)

    def test_falls_back_to_default_slides_for_short_text(self):
        text = "a\nb\nc\nd\ne\nf\ng\nh"
        title, slides = _build_slides_from_strategy_text(text)
        self.assertTrue(len(slides) > 0)

    def test_limits_to_14_sections(self):
        text = "\n".join(f"# Section {i}\n- point" for i in range(20))
        title, slides = _build_slides_from_strategy_text(text)
        self.assertLessEqual(len(slides), 16)


class SseEventTests(unittest.TestCase):
    def test_formats_dict(self):
        result = _sse_event({"type": "text", "content": "hello"})
        self.assertTrue(result.startswith("data: "))
        self.assertTrue(result.endswith("\n\n"))
        parsed = json.loads(result[6:].strip())
        self.assertEqual(parsed["content"], "hello")

    def test_unicode_preserved(self):
        result = _sse_event({"msg": "中文"})
        self.assertIn("中文", result)


class StripTruncationMarkerTests(unittest.TestCase):
    def test_no_marker(self):
        text, truncated = _strip_truncation_marker("hello world")
        self.assertEqual(text, "hello world")
        self.assertFalse(truncated)

    def test_with_marker(self):
        text, truncated = _strip_truncation_marker(f"hello {OUTPUT_TRUNCATED_MARKER} world")
        self.assertEqual(text, "hello  world")
        self.assertTrue(truncated)

    def test_empty_string(self):
        text, truncated = _strip_truncation_marker("")
        self.assertEqual(text, "")
        self.assertFalse(truncated)


if __name__ == "__main__":
    unittest.main()
