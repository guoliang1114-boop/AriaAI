"""Workflow status builders and task-event normalizers."""
from __future__ import annotations

TOOL_WORKFLOW_STEP_TOTAL = 4


def workflow_status(
    *,
    step_index: int,
    step_total: int,
    title: str,
    message: str,
    stage: str,
    status: str = "running",
) -> dict:
    """Build a standard workflow status SSE payload."""
    return {
        "type": "status",
        "stage": stage,
        "message": message,
        "step_index": step_index,
        "step_total": step_total,
        "step_title": title,
        "step_status": status,
    }


def workflow_status_from_task_event(task_event: dict) -> dict | None:
    """Convert a task-orchestrator event into a workflow status dict."""
    step = task_event.get("step") or {}
    if not step:
        return None
    task = task_event.get("task") or {}
    steps = task.get("steps") or []
    step_total = len(steps) or int(step.get("sort_order") or 1)
    event_type = str(task_event.get("event_type") or "")
    status = "running"
    if event_type == "step_completed":
        status = "completed"
    elif event_type == "step_failed":
        status = "error"
    return workflow_status(
        step_index=int(step.get("sort_order") or 1),
        step_total=step_total,
        title=str(step.get("title") or step.get("key") or "执行步骤"),
        stage="tools",
        status=status,
        message=str(task_event.get("message") or ""),
    )


def _task_event_time(value) -> str:
    """Extract a short HH:MM:SS timestamp from an ISO-like string."""
    text = str(value or "")
    if " " in text and len(text) >= 19:
        return text.split(" ", 1)[1][:8]
    if "T" in text and len(text) >= 19:
        return text.split("T", 1)[1][:8]
    return text[:8] if text else ""


def _task_event_payload_summary(payload: dict | None) -> str:
    """Human-readable summary of a task-event payload."""
    payload = payload or {}
    details: list[str] = []

    project = payload.get("project")
    if isinstance(project, dict):
        name = str(project.get("name") or "").strip()
        client = str(project.get("client") or "").strip()
        if name or client:
            details.append(f"项目：{' / '.join(item for item in (name, client) if item)}")

    task_type = str(payload.get("task_type") or "").strip()
    if task_type:
        details.append(f"任务类型：{task_type}")

    file_type = str(payload.get("file_type") or "").strip()
    if file_type:
        details.append(f"文件类型：{file_type.upper()}")

    file_name = str(payload.get("file_name") or payload.get("name") or "").strip()
    if file_name:
        details.append(f"文件：{file_name}")

    required_sections = payload.get("required_sections")
    if isinstance(required_sections, list):
        section_names = [str(item).strip() for item in required_sections if str(item).strip()]
        if section_names:
            details.append(f"必需章节：{'、'.join(section_names[:6])}")

    duration_ms = payload.get("duration_ms")
    if isinstance(duration_ms, int):
        details.append(f"耗时：{duration_ms}ms")

    slide_count = payload.get("slide_count")
    if isinstance(slide_count, int):
        details.append(f"页数：{slide_count}")

    sheets = payload.get("sheets")
    if isinstance(sheets, list):
        sheet_names = [
            str(sheet.get("name") if isinstance(sheet, dict) else sheet).strip()
            for sheet in sheets
        ]
        sheet_names = [name for name in sheet_names if name]
        if sheet_names:
            details.append(f"工作表：{'、'.join(sheet_names[:4])}")

    error_code = str(payload.get("error_code") or "").strip()
    if error_code:
        details.append(f"错误：{error_code}")

    if "retryable" in payload:
        details.append("可重试" if payload.get("retryable") else "不可重试")

    message = str(payload.get("message") or "").strip()
    if message:
        details.append(message)

    return "；".join(details)


def task_event_detail(event: dict) -> str:
    """Format a task event as a single human-readable line."""
    prefix = _task_event_time(event.get("created_at"))
    message = str(event.get("message") or event.get("event_type") or "任务状态更新").strip()
    raw_payload = event.get("payload")
    payload = raw_payload if isinstance(raw_payload, dict) else {}
    payload_summary = _task_event_payload_summary(payload)
    detail = f"{message}（{payload_summary}）" if payload_summary else message
    return f"[{prefix}] {detail}" if prefix else detail


def task_step_output_details(output: dict | None) -> list[str]:
    """Extract human-readable details from a task-step output dict."""
    output = output or {}
    details: list[str] = []

    project_name = str(output.get("project_name") or "").strip()
    client = str(output.get("client") or "").strip()
    if project_name or client:
        details.append(f"上下文：{' / '.join(item for item in (project_name, client) if item)}")

    file_type = str(output.get("file_type") or "").strip()
    if file_type:
        details.append(f"输出类型：{file_type.upper()}")

    file_name = str(output.get("file_name") or "").strip()
    if file_name:
        details.append(f"输出文件：{file_name}")

    title = str(output.get("title") or "").strip()
    if title:
        details.append(f"标题：{title}")

    sections_count = output.get("sections_count")
    if isinstance(sections_count, int):
        details.append(f"章节数：{sections_count}")

    required_sections = output.get("required_sections")
    if isinstance(required_sections, list):
        section_names = [str(item).strip() for item in required_sections if str(item).strip()]
        if section_names:
            details.append(f"必需章节：{'、'.join(section_names[:6])}")

    text_spec = output.get("text_spec")
    if isinstance(text_spec, dict):
        spec_sections = text_spec.get("sections")
        if isinstance(spec_sections, list) and spec_sections:
            details.append(f"校验章节：{'、'.join(str(item) for item in spec_sections[:6])}")

    duration_ms = output.get("duration_ms")
    if isinstance(duration_ms, int):
        details.append(f"耗时：{duration_ms}ms")

    slide_count = output.get("slide_count")
    if isinstance(slide_count, int):
        details.append(f"页数：{slide_count}")

    sheets = output.get("sheets")
    if isinstance(sheets, list):
        sheet_names = [
            str(sheet.get("name") if isinstance(sheet, dict) else sheet).strip()
            for sheet in sheets
        ]
        sheet_names = [name for name in sheet_names if name]
        if sheet_names:
            details.append(f"工作表：{'、'.join(sheet_names[:4])}")

    return details


def task_payload_tool_calls(task_payload: dict) -> list[dict]:
    """Convert a serialized TaskRun payload into a list of tool-call event dicts."""
    steps = task_payload.get("steps") or []
    events = task_payload.get("events") or []
    total = len(steps)

    status_map = {
        "completed": "completed",
        "skipped": "completed",
        "failed": "error",
        "running": "running",
        "pending": "pending",
    }

    events_by_step_id: dict[int, list[dict]] = {}
    for event in events:
        step_id = event.get("step_id") if isinstance(event, dict) else None
        if isinstance(step_id, int):
            events_by_step_id.setdefault(step_id, []).append(event)

    calls: list[dict] = []
    for step in steps:
        if not isinstance(step, dict):
            continue
        sort_order = int(step.get("sort_order") or len(calls) + 1)
        title = str(step.get("title") or step.get("key") or "执行步骤")
        status = status_map.get(str(step.get("status") or "running"), "running")
        details = task_step_output_details(
            step.get("output") if isinstance(step.get("output"), dict) else {}
        )
        step_id = step.get("id")
        if isinstance(step_id, int):
            details.extend(task_event_detail(event) for event in events_by_step_id.get(step_id, []))
        error_message = str(step.get("error_message") or "").strip()
        calls.append(
            {
                "tool_name": f"步骤 {sort_order}/{total or sort_order}：{title}",
                "status": status,
                "message": (
                    "该步骤已完成。"
                    if status == "completed"
                    else error_message or "该步骤执行失败，请打开任务面板处理。"
                    if status == "error"
                    else "该步骤正在执行。"
                    if status == "running"
                    else "该步骤等待前序步骤完成。"
                ),
                "error": error_message if status == "error" and error_message else None,
                "details": details,
                "step_index": sort_order,
                "step_total": total or sort_order,
                "step_title": title,
            }
        )
    return calls


def workflow_plan_events(*, step_total: int = TOOL_WORKFLOW_STEP_TOTAL) -> list[dict]:
    """Return the first two (completed) workflow steps for a tool-execution plan."""
    return [
        workflow_status(
            step_index=1,
            step_total=step_total,
            title="判断执行方式",
            stage="planning",
            status="completed",
            message="第 1 步：已判断这是需要读取上下文或调用工具的任务。",
        ),
        workflow_status(
            step_index=2,
            step_total=step_total,
            title="准备参数与上下文",
            stage="planning",
            status="completed",
            message="第 2 步：项目上下文、历史对话和工具参数已准备。",
        ),
    ]


# Backward-compatible aliases for the legacy ``chat_streaming`` shim and tests.
_workflow_status = workflow_status
_workflow_status_from_task_event = workflow_status_from_task_event
_task_event_time = _task_event_time
_task_event_payload_summary = _task_event_payload_summary
_task_event_detail = task_event_detail
_task_step_output_details = task_step_output_details
_task_payload_tool_calls = task_payload_tool_calls
_workflow_plan_events = workflow_plan_events
