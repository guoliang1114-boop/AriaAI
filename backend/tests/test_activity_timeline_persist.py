"""Unit tests for the persist-time activity-timeline serializer
(``app.services.chat.activity_timeline_persist.build_activity_timeline``)."""
from __future__ import annotations

import unittest
from types import SimpleNamespace

from app.services.chat.activity_timeline_persist import build_activity_timeline


def _step(*, index, tool_calls=None, duration_ms=0, truncated=False):
    return SimpleNamespace(
        index=index,
        tool_calls=tool_calls or [],
        duration_ms=duration_ms,
        truncated=truncated,
    )


def _state(
    *,
    run_id="run_x",
    steps=None,
    tool_call_events=None,
    artifacts=None,
    full_text="",
    confirmation_requested=False,
    run_evaluation=None,
):
    return SimpleNamespace(
        run_id=run_id,
        steps=steps or [],
        tool_call_events=tool_call_events or [],
        artifacts=artifacts or [],
        full_text=full_text,
        confirmation_requested=confirmation_requested,
        run_evaluation=run_evaluation or {},
    )


def _runtime(*, skill_name="", skill_id=None, skill_activation_source="", prepare_metrics=None):
    return SimpleNamespace(
        skill_name=skill_name,
        skill_id=skill_id,
        skill_activation_source=skill_activation_source,
        prepare_metrics=prepare_metrics or {},
    )


class BuildActivityTimelineTest(unittest.TestCase):
    def test_returns_none_when_run_id_empty(self):
        self.assertIsNone(build_activity_timeline(_state(run_id=""), _runtime()))

    def test_text_only_turn_no_steps_no_artifacts(self):
        timeline = build_activity_timeline(
            _state(steps=[], tool_call_events=[], artifacts=[], full_text="hello"),
            _runtime(),
            full_text="hello",
        )
        assert timeline is not None
        self.assertEqual(timeline["run_id"], "run_x")
        self.assertEqual(timeline["steps"], [])
        self.assertEqual(timeline["artifacts"], [])
        self.assertEqual(timeline["final_status"], "completed")
        self.assertEqual(timeline["text"], "hello")
        self.assertNotIn("skill", timeline)

    def test_final_status_uses_completion_evaluation_verdict(self):
        waiting = build_activity_timeline(
            _state(
                confirmation_requested=True,
                run_evaluation={"verdict": "waiting_confirmation"},
            ),
            _runtime(),
        )
        failed = build_activity_timeline(
            _state(run_evaluation={"verdict": "failed"}),
            _runtime(),
        )

        assert waiting is not None
        assert failed is not None
        self.assertEqual(waiting["final_status"], "waiting_confirmation")
        self.assertEqual(failed["final_status"], "failed")

    def test_step_with_tool_and_matching_event_marks_completed(self):
        timeline = build_activity_timeline(
            _state(
                steps=[
                    _step(
                        index=0,
                        tool_calls=[{"name": "read_project_markdown_document"}],
                        duration_ms=180,
                    ),
                ],
                tool_call_events=[
                    {
                        "tool_name": "read_project_markdown_document",
                        "status": "completed",
                        "summary": "已读取 3 个文件",
                    }
                ],
            ),
            _runtime(),
        )
        assert timeline is not None
        self.assertEqual(len(timeline["steps"]), 1)
        step = timeline["steps"][0]
        self.assertEqual(step["index"], 1)  # 1-based for the frontend
        self.assertEqual(step["title"], "read_project_markdown_document")
        self.assertEqual(step["status"], "completed")
        self.assertEqual(step["duration_ms"], 180)
        self.assertEqual(step["items"], [
            {"tool_name": "read_project_markdown_document", "status": "completed", "detail": "已读取 3 个文件"},
        ])

    def test_failed_event_flips_step_status_to_failed(self):
        timeline = build_activity_timeline(
            _state(
                steps=[_step(index=0, tool_calls=[{"name": "generate_ppt"}])],
                tool_call_events=[{"tool_name": "generate_ppt", "status": "failed"}],
            ),
            _runtime(),
        )
        assert timeline is not None
        self.assertEqual(timeline["steps"][0]["status"], "failed")
        self.assertEqual(timeline["steps"][0]["items"][0]["status"], "failed")

    def test_step_without_planned_tools_uses_generic_title(self):
        timeline = build_activity_timeline(
            _state(steps=[_step(index=1)]),
            _runtime(),
        )
        assert timeline is not None
        self.assertEqual(timeline["steps"][0]["title"], "第 2 步")

    def test_artifact_filetype_maps_md_to_markdown_and_passes_pptx(self):
        timeline = build_activity_timeline(
            _state(
                artifacts=[
                    {"id": 7, "file_type": "pptx"},
                    {"project_file_id": 11, "file_type": "md"},
                    {"id": 13, "file_type": "unknown"},
                ]
            ),
            _runtime(),
        )
        assert timeline is not None
        self.assertEqual(
            timeline["artifacts"],
            [
                {"id": "7", "type": "pptx"},
                {"id": "11", "type": "markdown"},
            ],
        )

    def test_truncated_step_carries_flag(self):
        timeline = build_activity_timeline(
            _state(steps=[_step(index=0, truncated=True)]),
            _runtime(),
        )
        assert timeline is not None
        self.assertTrue(timeline["steps"][0].get("truncated"))

    def test_skill_block_present_when_runtime_has_skill_name(self):
        timeline = build_activity_timeline(
            _state(),
            _runtime(
                skill_name="数字化战略",
                skill_activation_source="auto",
                prepare_metrics={"effective_skill_id": "digital-strategy"},
            ),
        )
        assert timeline is not None
        self.assertEqual(
            timeline["skill"],
            {"name": "数字化战略", "id": "digital-strategy", "source": "auto"},
        )


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
