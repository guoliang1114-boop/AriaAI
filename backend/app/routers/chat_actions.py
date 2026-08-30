"""Chat action confirmation endpoints — Human-in-the-Loop tool approval."""
from __future__ import annotations

import json
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import update
from sqlmodel import Session, select

from app.database import get_session
from app.models.db import Conversation, Message, PendingToolAction, User
from app.routers.auth import get_current_user, require_admin
from app.routers.chat_security import require_conversation_access
from app.services.agent_harness.approval_envelope import (
    ApprovalEnvelopeError,
    RECOVERY_HITAS_ACTION_TYPE,
    verify_approval_envelope,
)
from app.services.agent_harness.project_world_state import build_project_world_state_manifest
from app.services.chat.action_background import schedule_background_job, should_execute_in_background
from app.services.chat.action_executor import execute_tool_by_name
from app.services.chat.action_metrics import build_hitas_action_metrics
from app.services.chat.action_project_writes import (
    FINAL_AUTH_PROJECT_WRITE_TOOLS,
    cleanup_prepared_project_write,
    persist_prepared_project_write,
    prepare_pending_project_write,
)
from app.services.chat.pending_actions import (
    RECOVERY_ACTION_GUARD_KEY,
    RecoveryActionGuardError,
    positive_project_scope,
    split_recovery_action_guard,
)
from app.services.project_core import lock_and_require_project_write
from app.services.time_utils import utc_now_naive
from app.tools.capabilities import tool_is_mutating, tool_is_project_scoped

router = APIRouter(tags=["chat-actions"])


class ConfirmActionRequest(BaseModel):
    approved: bool = True
    reason: Optional[str] = None


class ConfirmActionResponse(BaseModel):
    status: str
    result: Optional[dict[str, Any]] = None
    error_message: Optional[str] = None
    message_id: Optional[int] = None
    approval_batch_id: Optional[str] = None
    action_ids: Optional[list[int]] = None


class PendingActionItem(BaseModel):
    id: int
    trace_id: str
    conversation_id: int
    message_id: Optional[int] = None
    project_id: Optional[int] = None
    tool_name: str
    tool_input: dict[str, Any]
    action_type: str
    risk_level: str = "medium"
    policy_at_creation: str = ""
    tool_input_hash: str = ""
    approval_batch_id: str = ""
    sequence_index: int = 0
    title: str
    description: str
    details: list[str]
    status: str
    result: Optional[dict[str, Any]] = None
    error_message: Optional[str] = None
    created_at: str
    expires_at: Optional[str] = None


class PendingActionsResponse(BaseModel):
    items: list[PendingActionItem]
    has_pending: bool


class ActionMetricsResponse(BaseModel):
    window_minutes: int
    stale_after_minutes: int
    total_actions: int
    resolved_actions: int
    failed_actions: int
    confirmation_failure_rate: float
    stale_executing_actions: int
    partial_failed_batches: int
    by_status: dict[str, int]
    by_risk_level: dict[str, int]
    alerts: list[dict[str, Any]]


def _pending_action_item(action: PendingToolAction) -> PendingActionItem:
    payload = action.get_payload()
    public_tool_input = dict(payload["tool_input"])
    public_tool_input.pop(RECOVERY_ACTION_GUARD_KEY, None)
    return PendingActionItem(
        id=payload["id"],
        trace_id=payload["trace_id"],
        conversation_id=payload["conversation_id"],
        message_id=payload.get("message_id"),
        project_id=payload.get("project_id"),
        tool_name=payload["tool_name"],
        tool_input=public_tool_input,
        action_type=payload["action_type"],
        risk_level=payload.get("risk_level") or "medium",
        policy_at_creation=payload.get("policy_at_creation") or "",
        tool_input_hash=payload.get("tool_input_hash") or "",
        approval_batch_id=payload.get("approval_batch_id") or "",
        sequence_index=int(payload.get("sequence_index") or 0),
        title=payload["title"],
        description=payload["description"],
        details=payload["details"],
        status=payload["status"],
        result=payload.get("result"),
        error_message=payload.get("error_message"),
        created_at=payload["created_at"] or "",
        expires_at=payload.get("expires_at"),
    )


@router.get("/conversations/{conversation_id}/pending-actions")
async def list_pending_actions(
    conversation_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> PendingActionsResponse:
    """List all pending tool actions for a conversation."""
    _authorize_conversation(session, conversation_id, current_user)
    now = utc_now_naive()
    actions = session.exec(
        select(PendingToolAction)
        .where(PendingToolAction.conversation_id == conversation_id)
        .where(PendingToolAction.status == "pending")
        .order_by(PendingToolAction.created_at.desc())
    ).all()

    items: list[PendingActionItem] = []
    expired: list[PendingToolAction] = []
    seen_legacy_duplicates: set[tuple[str, str, str]] = set()
    for action in actions:
        if action.expires_at and action.expires_at < now:
            action.status = "failed"
            action.error_message = "Action expired"
            expired.append(action)
            continue
        if not action.approval_batch_id:
            dedupe_key = (action.tool_name, action.tool_input_hash or action.tool_input_json, action.action_type)
            if dedupe_key in seen_legacy_duplicates:
                action.status = "superseded"
                action.error_message = "Superseded by a newer identical pending action"
                expired.append(action)
                continue
            seen_legacy_duplicates.add(dedupe_key)
        items.append(_pending_action_item(action))
    if expired:
        session.commit()

    return PendingActionsResponse(items=items, has_pending=len(items) > 0)


@router.get("/actions/metrics")
def get_action_metrics(
    window_minutes: int = 24 * 60,
    stale_after_minutes: int = 30,
    session: Session = Depends(get_session),
    _admin: User = Depends(require_admin),
) -> ActionMetricsResponse:
    """Return admin-facing HITAS runtime metrics and alert candidates."""
    return ActionMetricsResponse(
        **build_hitas_action_metrics(
            session,
            window_minutes=window_minutes,
            stale_after_minutes=stale_after_minutes,
        )
    )


@router.post("/actions/{action_id}/confirm")
async def confirm_action(
    action_id: int,
    req: ConfirmActionRequest,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> ConfirmActionResponse:
    """Confirm a pending tool action and execute it directly."""
    action = session.get(PendingToolAction, action_id)
    if action is None:
        raise HTTPException(status_code=404, detail="Action not found")
    _authorize_action(session, action, current_user, require_write=True)
    if not req.approved:
        raise HTTPException(status_code=400, detail="Use /reject to reject a pending action")
    if action.approval_batch_id:
        return await _confirm_batch(action.approval_batch_id, req, session, current_user)
    if action.status != "pending":
        return _existing_action_response(action)
    if action.expires_at and action.expires_at < utc_now_naive():
        action.status = "failed"
        action.error_message = "Action expired"
        session.commit()
        raise HTTPException(status_code=400, detail="Action expired")

    try:
        tool_input = _validated_execution_tool_input(session, action)
    except HTTPException as exc:
        action.status = "failed"
        action.error_message = str(exc.detail)
        session.commit()
        raise

    claim = session.execute(
        update(PendingToolAction)
        .where(PendingToolAction.id == action_id)
        .where(PendingToolAction.status == "pending")
        .values(status="executing", confirmed_at=utc_now_naive(), confirmed_by_user_id=current_user.id)
    )
    session.commit()
    if getattr(claim, "rowcount", 0) != 1:
        latest = session.get(PendingToolAction, action_id)
        if latest is None:
            raise HTTPException(status_code=404, detail="Action not found")
        return _existing_action_response(latest)

    bind = session.get_bind()
    tool_name = action.tool_name
    approval_batch_id = action.approval_batch_id or None
    session.close()

    boundary_error = _action_boundary_error_before_execution(
        bind,
        action_id=action_id,
        expected_tool_name=tool_name,
        expected_tool_input=tool_input,
    )
    if boundary_error:
        return _persist_action_failure(bind, action_id, RuntimeError(boundary_error))
    recovery_boundary_error = _atomic_write_boundary_error_before_execution(
        bind,
        action_id=action_id,
        expected_tool_name=tool_name,
        expected_tool_input=tool_input,
    )
    if recovery_boundary_error:
        return _persist_action_failure(
            bind,
            action_id,
            RuntimeError(recovery_boundary_error),
        )

    if should_execute_in_background(tool_name, tool_input):
        schedule_background_job(
            f"hitas-action-{action_id}",
            lambda: _execute_action_in_background(bind, action_id, tool_name, tool_input),
        )
        return ConfirmActionResponse(
            status="executing",
            result={"success": True, "queued": True, "background": True},
            approval_batch_id=approval_batch_id,
            action_ids=[action_id],
        )

    if tool_name in FINAL_AUTH_PROJECT_WRITE_TOOLS:
        finalized = await _execute_final_authorized_project_write(
            bind,
            action_id,
            tool_name,
            tool_input,
            emit_message=True,
        )
        return _finalized_action_response(finalized)

    try:
        result = await execute_tool_by_name(tool_name, tool_input)
        return _persist_action_result(bind, action_id, result)
    except Exception as exc:
        return _persist_action_failure(bind, action_id, exc)


@router.post("/actions/batches/{batch_id}/confirm")
async def confirm_action_batch(
    batch_id: str,
    req: ConfirmActionRequest,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> ConfirmActionResponse:
    """Confirm an approval batch and execute its frozen tool actions."""
    if not req.approved:
        raise HTTPException(status_code=400, detail="Use /reject to reject a pending action")
    return await _confirm_batch(batch_id, req, session, current_user)


@router.post("/actions/{action_id}/reject")
async def reject_action(
    action_id: int,
    req: Optional[ConfirmActionRequest] = None,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> ConfirmActionResponse:
    """Reject a pending tool action."""
    action = session.get(PendingToolAction, action_id)
    if action is None:
        raise HTTPException(status_code=404, detail="Action not found")
    _authorize_action(session, action, current_user, require_write=True)
    if action.approval_batch_id:
        return _reject_batch(action.approval_batch_id, req, session, current_user)
    if action.status != "pending":
        return _existing_action_response(action)

    action.status = "rejected"
    action.confirmed_at = utc_now_naive()
    action.confirmed_by_user_id = current_user.id
    if req and req.reason:
        action.error_message = req.reason
    result = {
        "success": False,
        "rejected": True,
        "reason": action.error_message or "",
    }
    action.result_json = json.dumps(result, ensure_ascii=False, default=str)
    result_message = Message(
        conversation_id=action.conversation_id,
        role="assistant",
        content=_format_action_rejected_message(action),
        metadata_json=json.dumps(
            {
                "tool_action_result": {
                    "pending_action_id": action.id,
                    "tool_name": action.tool_name,
                    "status": action.status,
                    "result": result,
                }
            },
            ensure_ascii=False,
            default=str,
        ),
    )
    session.add(result_message)
    session.commit()
    session.refresh(result_message)

    return ConfirmActionResponse(
        status="rejected",
        result=result,
        error_message=action.error_message,
        message_id=result_message.id,
    )


@router.post("/actions/batches/{batch_id}/reject")
async def reject_action_batch(
    batch_id: str,
    req: Optional[ConfirmActionRequest] = None,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> ConfirmActionResponse:
    """Reject all pending actions in an approval batch."""
    return _reject_batch(batch_id, req, session, current_user)


@router.get("/actions/{action_id}")
async def get_action(
    action_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> PendingActionItem:
    """Get a single pending tool action by ID."""
    action = session.get(PendingToolAction, action_id)
    if action is None:
        raise HTTPException(status_code=404, detail="Action not found")
    _authorize_action(session, action, current_user)
    if action.status == "pending" and action.expires_at and action.expires_at < utc_now_naive():
        action.status = "failed"
        action.error_message = "Action expired"
        session.commit()
        session.refresh(action)

    return _pending_action_item(action)


def _format_action_result_message(action: PendingToolAction, result: dict[str, Any]) -> str:
    title = action.title or action.tool_name or "工具操作"
    if result.get("success"):
        pieces = [f"已执行：{title}。"]
        if result.get("trash") and result.get("deleted_count") is not None:
            pieces.append(f"已移入回收站 {result.get('deleted_count')} 个文件，可从项目文件回收站恢复。")
        direct_message = result.get("message") or result.get("summary")
        if isinstance(direct_message, str) and direct_message.strip():
            pieces.append(direct_message.strip())
        if result.get("rollback_available") and result.get("rollback_version_id") is not None:
            pieces.append(f"可回滚版本 ID：{result.get('rollback_version_id')}。回滚仍需再次确认。")
        output = result.get("output") or result.get("result")
        if isinstance(output, dict):
            message = output.get("message") or output.get("summary")
            if message:
                pieces.append(str(message))
        elif isinstance(output, str) and output.strip():
            pieces.append(output.strip())
        return "\n\n".join(pieces)
    error = result.get("error") or action.error_message or "未知错误"
    return f"{title} 执行失败：{error}"


def _format_action_rejected_message(action: PendingToolAction) -> str:
    title = action.title or action.tool_name or "工具操作"
    pieces = [f"已取消：{title}。"]
    if action.error_message:
        pieces.append(f"原因：{action.error_message}")
    return "\n\n".join(pieces)


def _result_summary(result: dict[str, Any]) -> str:
    if result.get("success"):
        if result.get("trash") and result.get("deleted_count") is not None:
            return f"已移入回收站 {result.get('deleted_count')} 个文件。"
        direct_message = result.get("message") or result.get("summary")
        if isinstance(direct_message, str) and direct_message.strip():
            return direct_message.strip()
        output = result.get("output") or result.get("result")
        if isinstance(output, dict):
            return str(output.get("message") or output.get("summary") or "已完成")
        if isinstance(output, str) and output.strip():
            return output.strip()
        return "已完成"
    return str(result.get("error") or "执行失败")


def _format_batch_action_result_message(actions: list[PendingToolAction], batch_result: dict[str, Any]) -> str:
    action_results = batch_result.get("actions") if isinstance(batch_result.get("actions"), list) else []
    if len(actions) == 1 and action_results:
        result = action_results[0].get("result") if isinstance(action_results[0], dict) else {}
        return _format_action_result_message(actions[0], result if isinstance(result, dict) else {})

    completed_count = int(batch_result.get("completed_count") or 0)
    failed_count = int(batch_result.get("failed_count") or 0)
    skipped_count = int(batch_result.get("skipped_count") or 0)
    total = len(actions)
    pieces = [f"已执行本次确认流程：{completed_count}/{total} 个操作完成。"]
    if failed_count or skipped_count:
        skipped_text = f"，{skipped_count} 个已跳过" if skipped_count else ""
        pieces[0] = f"本次确认流程部分失败：{completed_count}/{total} 个操作完成，{failed_count} 个失败{skipped_text}。"

    action_by_id = {action.id: action for action in actions}
    lines: list[str] = []
    for index, item in enumerate(action_results, start=1):
        if not isinstance(item, dict):
            continue
        action = action_by_id.get(item.get("pending_action_id"))
        title = action.title if action else str(item.get("tool_name") or "工具操作")
        result = item.get("result") if isinstance(item.get("result"), dict) else {}
        status = "跳过" if result.get("skipped") else "完成" if result.get("success") else "失败"
        lines.append(f"{index}. {title}：{status}，{_result_summary(result)}")
    if lines:
        pieces.append("\n".join(lines))
    return "\n\n".join(pieces)


def _format_batch_action_rejected_message(actions: list[PendingToolAction], reason: str = "") -> str:
    if len(actions) == 1:
        action = actions[0]
        action.error_message = reason or action.error_message
        return _format_action_rejected_message(action)
    pieces = [f"已取消本次确认流程，共 {len(actions)} 个待执行操作。"]
    if reason:
        pieces.append(f"原因：{reason}")
    return "\n\n".join(pieces)


def _load_json_object(value: str | None) -> dict[str, Any]:
    if not value:
        return {}
    try:
        loaded = json.loads(value)
    except json.JSONDecodeError:
        return {}
    return loaded if isinstance(loaded, dict) else {}


def _load_tool_input(action: PendingToolAction) -> dict[str, Any]:
    try:
        loaded = json.loads(action.tool_input_json or "{}")
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="Invalid stored tool input") from exc
    if not isinstance(loaded, dict):
        raise HTTPException(status_code=400, detail="Stored tool input must be an object")
    return loaded


def _validate_tool_input_scope(action: PendingToolAction, tool_input: dict[str, Any]) -> None:
    if tool_is_project_scoped(action.tool_name):
        action_project_id = positive_project_scope(action.project_id)
        if action_project_id is None:
            raise HTTPException(
                status_code=400,
                detail="Project-scoped action is missing a valid project scope",
            )
        input_project_id = positive_project_scope(tool_input.get("project_id"))
        if input_project_id is None:
            raise HTTPException(
                status_code=400,
                detail="Stored tool input has invalid project scope",
            )
        if input_project_id != action_project_id:
            raise HTTPException(status_code=403, detail="Stored tool input project scope mismatch")
        return
    # Project-independent generators can still be approved from a project
    # conversation (and therefore have a project-bound PendingToolAction).  The
    # signed approval envelope and, for recovery, the hidden world-state guard
    # bind that scope without passing a model-controlled project_id to the
    # handler.  Presence is forbidden regardless of value/type so an unknown
    # extension tool cannot smuggle project authority through **kwargs.
    if "project_id" in tool_input:
        raise HTTPException(
            status_code=400,
            detail="Non-project-scoped action input cannot include project_id",
        )


def _validate_approval_snapshot(
    action: PendingToolAction,
    tool_input: dict[str, Any],
) -> None:
    try:
        verify_approval_envelope(
            stored_fingerprint=action.tool_input_hash,
            tool_name=action.tool_name,
            tool_input=tool_input,
            project_id=action.project_id,
            action_type=action.action_type,
            risk_level=action.risk_level,
            policy_at_creation=action.policy_at_creation,
            approval_batch_id=action.approval_batch_id,
            sequence_index=action.sequence_index,
        )
    except ApprovalEnvelopeError as exc:
        raise HTTPException(
            status_code=409,
            detail=(
                f"Approval snapshot validation failed ({exc.code}); "
                "regenerate the action preview before confirming."
            ),
        ) from exc


_RECOVERY_PROJECT_STATE_CONFLICT = (
    "Recovery project state changed after approval preview; regenerate the action before confirming."
)
_RECOVERY_MULTI_ACTION_BATCH_UNSAFE = (
    "Recovery approval batch is review-only and cannot execute writes; after human review, "
    "start fresh non-recovery actions against current project state."
)
_RECOVERY_WRITE_REQUIRES_FRESH_ACTION = (
    "Recovery approval is review-only and cannot execute a new write; "
    "after human review, start a fresh non-recovery action against current project state."
)
_PROJECT_ACTION_NON_ATOMIC_UNSAFE = (
    "Project-scoped approval cannot execute through a legacy or external write boundary; "
    "start a fresh action supported by an Aria final-authorized project writer."
)


def _validated_execution_tool_input(
    session: Session,
    action: PendingToolAction,
) -> dict[str, Any]:
    """Verify the signed stored input and recovery CAS, then strip control data."""

    stored_tool_input = _load_tool_input(action)
    _validate_tool_input_scope(action, stored_tool_input)
    _validate_approval_snapshot(action, stored_tool_input)
    try:
        execution_input, recovery_guard = split_recovery_action_guard(stored_tool_input)
    except RecoveryActionGuardError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if not recovery_guard:
        if action.action_type == RECOVERY_HITAS_ACTION_TYPE:
            raise HTTPException(
                status_code=409,
                detail="Recovery approval is missing its project-state CAS; regenerate the action.",
            )
        if action.project_id is not None and action.message_id is not None:
            source_message = session.get(Message, int(action.message_id))
            source_metadata = source_message.get_metadata() if source_message is not None else {}
            if isinstance(source_metadata.get("turn_recovery"), dict):
                raise HTTPException(
                    status_code=409,
                    detail="Recovery approval is missing its project-state CAS; regenerate the action.",
                )
        return execution_input
    if (
        action.project_id is None
        or recovery_guard.get("project_id") != int(action.project_id)
    ):
        raise HTTPException(status_code=409, detail=_RECOVERY_PROJECT_STATE_CONFLICT)
    current = build_project_world_state_manifest(session, int(action.project_id))
    if (
        not current
        or str(current.get("fingerprint") or "").lower()
        != str(recovery_guard.get("project_fingerprint") or "").lower()
    ):
        raise HTTPException(status_code=409, detail=_RECOVERY_PROJECT_STATE_CONFLICT)
    return execution_input


_ACTION_BOUNDARY_VERIFICATION_FAILED = (
    "Action authorization and recovery state could not be verified immediately before execution."
)


def _action_boundary_error_before_execution(
    bind,
    *,
    action_id: int,
    expected_tool_name: str,
    expected_tool_input: dict[str, Any],
    expected_batch_id: str | None = None,
    expected_batch_scope: tuple[int, int | None, int] | None = None,
) -> str:
    """Re-authorize the actor and re-check recovery CAS before HITAS work.

    Final-authorized project writers repeat these checks in the transaction
    that persists their project change.  Legacy registry handlers open their
    own transaction after this helper returns, so this boundary deliberately
    narrows but cannot eliminate their remaining check-to-act window (or an
    external provider's own execution window).
    """

    try:
        with Session(bind) as session:
            locator = session.exec(
                select(PendingToolAction)
                .where(PendingToolAction.id == action_id)
                .execution_options(populate_existing=True)
            ).first()
            if locator is None:
                return "Action not found"
            if locator.status != "executing" or locator.tool_name != expected_tool_name:
                return "Action is no longer executable"
            if locator.project_id is not None:
                if locator.confirmed_by_user_id is None:
                    return "Executing project action is missing its confirmed actor"
                # Shared repository lock order: actor/project authorization rows
                # precede the PendingToolAction child row.
                lock_and_require_project_write(
                    session,
                    int(locator.project_id),
                    actor_user_id=int(locator.confirmed_by_user_id),
                )
            session.expire(locator)
            action = session.exec(
                select(PendingToolAction)
                .where(PendingToolAction.id == action_id)
                .execution_options(populate_existing=True)
                .with_for_update()
            ).first()
            if action is None:
                return "Action not found"
            if action.status != "executing" or action.tool_name != expected_tool_name:
                return "Action is no longer executable"
            if expected_batch_id is not None and action.approval_batch_id != expected_batch_id:
                return "Action approval batch changed before execution"
            if expected_batch_scope is not None and (
                int(action.conversation_id) != expected_batch_scope[0]
                or action.project_id != expected_batch_scope[1]
                or action.confirmed_by_user_id != expected_batch_scope[2]
            ):
                return "Action approval scope changed before execution"
            execution_input = _validated_execution_tool_input(session, action)
            if execution_input != expected_tool_input:
                return "Stored action input changed before execution"
    except HTTPException as exc:
        return str(exc.detail)
    except Exception:
        return _ACTION_BOUNDARY_VERIFICATION_FAILED
    return ""


def _atomic_write_boundary_error_before_execution(
    bind,
    *,
    action_id: int,
    expected_tool_name: str,
    expected_tool_input: dict[str, Any],
) -> str:
    """Fail closed where Aria cannot keep authorization and writes atomic."""

    try:
        with Session(bind) as session:
            action = session.exec(
                select(PendingToolAction)
                .where(PendingToolAction.id == action_id)
                .execution_options(populate_existing=True)
                .with_for_update()
            ).first()
            if action is None:
                return "Action not found"
            if action.status != "executing" or action.tool_name != expected_tool_name:
                return "Action is no longer executable"
            _execution_input, recovery_guard = split_recovery_action_guard(
                _load_tool_input(action)
            )
            recovery_action = bool(recovery_guard) or (
                action.action_type == RECOVERY_HITAS_ACTION_TYPE
            )
            if recovery_action and tool_is_mutating(
                action.tool_name,
                expected_tool_input,
            ):
                # Recovery proposals are a review surface only. Even Aria's
                # final-authorized writers must be launched by a fresh turn so
                # recovery never claims a cross-resource world-state CAS.
                return _RECOVERY_WRITE_REQUIRES_FRESH_ACTION
            if recovery_action:
                return ""
            if (
                tool_is_project_scoped(action.tool_name)
                and tool_is_mutating(action.tool_name, expected_tool_input)
                and action.tool_name not in FINAL_AUTH_PROJECT_WRITE_TOOLS
            ):
                # Registry and external handlers start their own transaction
                # after this lock scope ends. A project-bound approval cannot
                # cross that check-to-act gap.
                return _PROJECT_ACTION_NON_ATOMIC_UNSAFE
    except HTTPException as exc:
        return str(exc.detail)
    except Exception:
        return _ACTION_BOUNDARY_VERIFICATION_FAILED
    return ""


def _existing_action_response(action: PendingToolAction) -> ConfirmActionResponse:
    return ConfirmActionResponse(
        status=action.status,
        result=_load_json_object(action.result_json),
        error_message=action.error_message,
        approval_batch_id=action.approval_batch_id or None,
        action_ids=[action.id] if action.id else None,
    )


def _load_batch_actions(session: Session, batch_id: str) -> list[PendingToolAction]:
    actions = session.exec(
        select(PendingToolAction)
        .where(PendingToolAction.approval_batch_id == batch_id)
        .order_by(PendingToolAction.sequence_index.asc(), PendingToolAction.id.asc())
    ).all()
    if not actions:
        raise HTTPException(status_code=404, detail="Action batch not found")
    return actions


def _batch_status(actions: list[PendingToolAction]) -> str:
    statuses = {action.status for action in actions}
    if "executing" in statuses:
        return "executing"
    if "pending" in statuses:
        return "pending"
    if "failed" in statuses:
        return "failed"
    if "skipped" in statuses:
        return "failed"
    if statuses == {"rejected"}:
        return "rejected"
    if statuses.issubset({"completed", "superseded"}):
        return "completed"
    return next(iter(statuses), "unknown")


def _existing_batch_response(actions: list[PendingToolAction]) -> ConfirmActionResponse:
    status = _batch_status(actions)
    result = {
        "success": status == "completed",
        "actions": [
            {
                "pending_action_id": action.id,
                "tool_name": action.tool_name,
                "status": action.status,
                "result": _load_json_object(action.result_json),
                "error_message": action.error_message,
            }
            for action in actions
        ],
    }
    return ConfirmActionResponse(
        status=status,
        result=result,
        error_message=next((action.error_message for action in actions if action.error_message), None),
        approval_batch_id=actions[0].approval_batch_id or None,
        action_ids=[action.id for action in actions if action.id],
    )


async def _confirm_batch(
    batch_id: str,
    req: ConfirmActionRequest,
    session: Session,
    current_user: User,
) -> ConfirmActionResponse:
    if not req.approved:
        raise HTTPException(status_code=400, detail="Use /reject to reject a pending action")
    actions = _load_batch_actions(session, batch_id)
    for action in actions:
        _authorize_action(session, action, current_user, require_write=True)

    pending_actions = [action for action in actions if action.status == "pending"]
    if not pending_actions:
        return _existing_batch_response(actions)

    now = utc_now_naive()
    expired_actions = [action for action in pending_actions if action.expires_at and action.expires_at < now]
    if expired_actions:
        for action in expired_actions:
            action.status = "failed"
            action.error_message = "Action expired"
            session.add(action)
        session.commit()
        raise HTTPException(status_code=400, detail="Action expired")

    execution_specs: list[dict[str, Any]] = []
    for action in pending_actions:
        try:
            tool_input = _validated_execution_tool_input(session, action)
            _stored_input, recovery_guard = split_recovery_action_guard(_load_tool_input(action))
        except HTTPException as exc:
            batch_error = (
                f"Approval batch validation failed before execution: {exc.detail}"
            )
            for pending_action in pending_actions:
                pending_action.status = "failed"
                pending_action.error_message = batch_error
                session.add(pending_action)
            session.commit()
            raise
        execution_specs.append(
            {
                "id": action.id,
                "tool_name": action.tool_name,
                "tool_input": tool_input,
                "conversation_id": action.conversation_id,
                "project_id": action.project_id,
                "confirmed_by_user_id": current_user.id,
                "recovery_guarded": bool(recovery_guard),
            }
        )

    action_ids = [spec["id"] for spec in execution_specs if spec["id"] is not None]
    claim = session.execute(
        update(PendingToolAction)
        .where(PendingToolAction.id.in_(action_ids))
        .where(PendingToolAction.status == "pending")
        .values(status="executing", confirmed_at=utc_now_naive(), confirmed_by_user_id=current_user.id)
    )
    session.commit()
    if getattr(claim, "rowcount", 0) != len(action_ids):
        latest = _load_batch_actions(session, batch_id)
        return _existing_batch_response(latest)

    bind = session.get_bind()
    session.close()
    if len(execution_specs) > 1 and any(spec["recovery_guarded"] for spec in execution_specs):
        return await _execute_batch_actions(bind, batch_id, execution_specs)
    if any(should_execute_in_background(str(spec["tool_name"]), spec["tool_input"]) for spec in execution_specs):
        schedule_background_job(
            f"hitas-batch-{batch_id}",
            lambda: _execute_batch_actions_in_background(bind, batch_id, execution_specs),
        )
        return ConfirmActionResponse(
            status="executing",
            result={"success": True, "queued": True, "background": True},
            approval_batch_id=batch_id,
            action_ids=action_ids,
        )
    return await _execute_batch_actions(bind, batch_id, execution_specs)


async def _execute_action_in_background(bind, action_id: int, tool_name: str, tool_input: dict[str, Any]) -> None:
    boundary_error = _action_boundary_error_before_execution(
        bind,
        action_id=action_id,
        expected_tool_name=tool_name,
        expected_tool_input=tool_input,
    )
    if boundary_error:
        _persist_action_failure(bind, action_id, RuntimeError(boundary_error))
        return
    recovery_boundary_error = _atomic_write_boundary_error_before_execution(
        bind,
        action_id=action_id,
        expected_tool_name=tool_name,
        expected_tool_input=tool_input,
    )
    if recovery_boundary_error:
        _persist_action_failure(bind, action_id, RuntimeError(recovery_boundary_error))
        return
    if tool_name in FINAL_AUTH_PROJECT_WRITE_TOOLS:
        await _execute_final_authorized_project_write(
            bind,
            action_id,
            tool_name,
            tool_input,
            emit_message=True,
        )
        return
    try:
        result = await execute_tool_by_name(tool_name, tool_input)
        _persist_action_result(bind, action_id, result)
    except Exception as exc:
        _persist_action_failure(bind, action_id, exc)


async def _execute_batch_actions_in_background(
    bind,
    batch_id: str,
    execution_specs: list[dict[str, Any]],
) -> None:
    await _execute_batch_actions(bind, batch_id, execution_specs)


async def _execute_batch_actions(bind, batch_id: str, execution_specs: list[dict[str, Any]]) -> ConfirmActionResponse:
    executions: list[dict[str, Any]] = []
    if len(execution_specs) > 1 and any(spec.get("recovery_guarded") for spec in execution_specs):
        for index, spec in enumerate(execution_specs):
            result: dict[str, Any]
            if index == 0:
                result = {"success": False, "error": _RECOVERY_MULTI_ACTION_BATCH_UNSAFE}
            else:
                result = {
                    "success": False,
                    "skipped": True,
                    "error": "Skipped because recovery writes require fresh non-recovery actions.",
                }
            executions.append(
                {
                    "pending_action_id": spec["id"],
                    "tool_name": spec["tool_name"],
                    "result": result,
                }
            )
        return _persist_batch_action_results(bind, batch_id, executions)

    previous_failed = False
    for spec in execution_specs:
        if previous_failed:
            result = {
                "success": False,
                "skipped": True,
                "error": "Skipped because a previous action in this approval batch failed.",
            }
        else:
            tool_name = str(spec["tool_name"])
            boundary_error = _action_boundary_error_before_execution(
                bind,
                action_id=int(spec["id"]),
                expected_tool_name=tool_name,
                expected_tool_input=spec["tool_input"],
                expected_batch_id=batch_id,
                expected_batch_scope=(
                    int(spec["conversation_id"]),
                    int(spec["project_id"]) if spec.get("project_id") is not None else None,
                    int(spec["confirmed_by_user_id"]),
                ),
            )
            if boundary_error:
                result = {"success": False, "error": boundary_error}
            else:
                recovery_boundary_error = _atomic_write_boundary_error_before_execution(
                    bind,
                    action_id=int(spec["id"]),
                    expected_tool_name=tool_name,
                    expected_tool_input=spec["tool_input"],
                )
                if recovery_boundary_error:
                    result = {"success": False, "error": recovery_boundary_error}
                elif tool_name in FINAL_AUTH_PROJECT_WRITE_TOOLS:
                    finalized = await _execute_final_authorized_project_write(
                        bind,
                        int(spec["id"]),
                        tool_name,
                        spec["tool_input"],
                        emit_message=False,
                    )
                    result = finalized.get("result") if isinstance(finalized.get("result"), dict) else {}
                    result = {
                        "success": finalized.get("status") == "completed",
                        **result,
                    }
                    if finalized.get("suppress_followup_receipt"):
                        result["_action_terminal_without_receipt"] = True
                    if not result.get("success") and not result.get("error"):
                        result["error"] = finalized.get("error_message") or "Action is no longer executable"
                else:
                    try:
                        result = await execute_tool_by_name(tool_name, spec["tool_input"])
                    except Exception as exc:
                        result = {"success": False, "error": str(exc) or exc.__class__.__name__}
        if not result.get("success"):
            previous_failed = True
        executions.append(
            {
                "pending_action_id": spec["id"],
                "tool_name": spec["tool_name"],
                "result": result,
            }
        )
    return _persist_batch_action_results(bind, batch_id, executions)


def _finalized_action_response(finalized: dict[str, Any]) -> ConfirmActionResponse:
    return ConfirmActionResponse(
        status=str(finalized.get("status") or "failed"),
        result=finalized.get("result") if isinstance(finalized.get("result"), dict) else None,
        error_message=str(finalized.get("error_message") or "") or None,
        message_id=finalized.get("message_id"),
        approval_batch_id=str(finalized.get("approval_batch_id") or "") or None,
        action_ids=[int(finalized["action_id"])] if finalized.get("action_id") is not None else None,
    )


def _action_finalization_payload(
    action: PendingToolAction,
    *,
    message_id: int | None = None,
    transient_error: str = "",
    suppress_followup_receipt: bool = False,
) -> dict[str, Any]:
    return {
        "status": action.status,
        "result": _load_json_object(action.result_json),
        "error_message": transient_error or action.error_message or "",
        "message_id": message_id,
        "approval_batch_id": action.approval_batch_id or "",
        "action_id": action.id,
        "suppress_followup_receipt": suppress_followup_receipt,
    }


def _latest_action_finalization_payload(
    bind,
    action_id: int,
    *,
    transient_error: str = "",
) -> dict[str, Any]:
    with Session(bind) as session:
        action = session.get(PendingToolAction, action_id)
        if action is None:
            return {
                "status": "failed",
                "result": {},
                "error_message": transient_error or "Action not found",
                "message_id": None,
                "approval_batch_id": "",
                "action_id": action_id,
                "suppress_followup_receipt": True,
            }
        return _action_finalization_payload(
            action,
            transient_error=transient_error,
            suppress_followup_receipt=True,
        )


_ACTION_GENERATION_FIELDS = (
    "conversation_id",
    "message_id",
    "project_id",
    "tool_name",
    "tool_input_json",
    "action_type",
    "risk_level",
    "policy_at_creation",
    "tool_input_hash",
    "approval_batch_id",
    "sequence_index",
    "confirmed_by_user_id",
    "confirmed_at",
)


def _capture_action_execution_generation(
    bind,
    *,
    action_id: int,
    expected_tool_name: str,
    expected_tool_input: dict[str, Any],
) -> dict[str, Any]:
    """Freeze the exact control-plane generation before expensive prepare."""

    with Session(bind) as session:
        action = session.exec(
            select(PendingToolAction)
            .where(PendingToolAction.id == action_id)
            .execution_options(populate_existing=True)
        ).first()
        if action is None:
            raise HTTPException(404, "Action not found")
        if action.status != "executing" or action.tool_name != expected_tool_name:
            raise HTTPException(409, "Action is no longer executing")
        execution_input = _validated_execution_tool_input(session, action)
        if execution_input != expected_tool_input:
            raise HTTPException(409, "Stored action input changed before prepare")
        return {
            "id": int(action.id or action_id),
            **{field: getattr(action, field) for field in _ACTION_GENERATION_FIELDS},
        }


def _terminalize_failed_exact_action_generation(
    bind,
    generation: dict[str, Any],
    exc: Exception,
    *,
    emit_message: bool,
) -> dict[str, Any]:
    """CAS the same still-executing generation to failed without business writes."""

    action_id = int(generation["id"])
    error = str(getattr(exc, "detail", "") or str(exc) or exc.__class__.__name__)
    result = {"success": False, "error": error}
    with Session(bind) as session:
        statement = (
            update(PendingToolAction)
            .where(PendingToolAction.id == action_id)
            .where(PendingToolAction.status == "executing")
        )
        for field in _ACTION_GENERATION_FIELDS:
            statement = statement.where(
                getattr(PendingToolAction, field) == generation.get(field)
            )
        cas = session.execute(
            statement.values(
                status="failed",
                result_json=json.dumps(result, ensure_ascii=False, default=str),
                error_message=error,
            )
        )
        if getattr(cas, "rowcount", 0) != 1:
            session.rollback()
            return _latest_action_finalization_payload(
                bind,
                action_id,
                transient_error=error,
            )
        action = session.exec(
            select(PendingToolAction)
            .where(PendingToolAction.id == action_id)
            .execution_options(populate_existing=True)
        ).one()
        message_id: int | None = None
        if emit_message:
            result_message = Message(
                conversation_id=action.conversation_id,
                role="assistant",
                content=_format_action_result_message(action, result),
                metadata_json=json.dumps(
                    {
                        "tool_action_result": {
                            "pending_action_id": action.id,
                            "tool_name": action.tool_name,
                            "status": action.status,
                            "result": result,
                        }
                    },
                    ensure_ascii=False,
                    default=str,
                ),
            )
            session.add(result_message)
            session.flush()
            message_id = result_message.id
        session.commit()
        return _action_finalization_payload(action, message_id=message_id)


def _lock_final_authorized_project_action(
    session: Session,
    *,
    action_id: int,
    expected_tool_name: str,
    expected_tool_input: dict[str, Any],
) -> tuple[PendingToolAction, Any, User]:
    """Lock actor/project permission rows before the pending-action child row."""

    locator = session.exec(
        select(PendingToolAction)
        .where(PendingToolAction.id == action_id)
        .execution_options(populate_existing=True)
    ).first()
    if locator is None:
        raise HTTPException(404, "Action not found")
    if locator.status != "executing":
        raise HTTPException(409, "Action is no longer executing")
    if locator.project_id is None or locator.confirmed_by_user_id is None:
        raise HTTPException(409, "Executing project action is missing its confirmed actor or project")
    expected_project_id = int(locator.project_id)
    expected_actor_id = int(locator.confirmed_by_user_id)

    # Repository-wide order: client identity namespace -> active User ->
    # Project -> exact ProjectMember -> PendingToolAction -> ProjectFile.
    project, actor = lock_and_require_project_write(
        session,
        expected_project_id,
        actor_user_id=expected_actor_id,
    )
    session.expire(locator)
    action = session.exec(
        select(PendingToolAction)
        .where(PendingToolAction.id == action_id)
        .execution_options(populate_existing=True)
        .with_for_update()
    ).first()
    if action is None:
        raise HTTPException(404, "Action not found")
    if action.status != "executing":
        raise HTTPException(409, "Action is no longer executing")
    if (
        action.project_id != expected_project_id
        or action.confirmed_by_user_id != expected_actor_id
        or action.tool_name != expected_tool_name
    ):
        raise HTTPException(409, "Action execution generation changed; discard the prepared result")
    locked_input = _validated_execution_tool_input(session, action)
    if locked_input != expected_tool_input:
        raise HTTPException(409, "Stored action input changed; discard the prepared result")
    return action, project, actor


def _persist_final_authorized_project_action_failure(
    bind,
    action_id: int,
    tool_name: str,
    tool_input: dict[str, Any],
    generation: dict[str, Any],
    exc: Exception,
    *,
    emit_message: bool,
) -> dict[str, Any]:
    """Fail the exact action generation without granting business authority."""

    error = str(getattr(exc, "detail", "") or str(exc) or exc.__class__.__name__)
    result = {"success": False, "error": error}
    with Session(bind) as session:
        try:
            action, _project, actor = _lock_final_authorized_project_action(
                session,
                action_id=action_id,
                expected_tool_name=tool_name,
                expected_tool_input=tool_input,
            )
        except Exception as auth_exc:
            session.rollback()
            # Business authorization must not be bypassed just to close the
            # control-plane row. The exact-generation CAS below writes no
            # ProjectFile or other domain state.
            return _terminalize_failed_exact_action_generation(
                bind,
                generation,
                auth_exc,
                emit_message=emit_message,
            )

        statement = (
            update(PendingToolAction)
            .where(PendingToolAction.id == action_id)
            .where(PendingToolAction.status == "executing")
            .where(PendingToolAction.confirmed_by_user_id == actor.id)
            .where(PendingToolAction.project_id == action.project_id)
            .where(PendingToolAction.tool_name == tool_name)
        )
        for field in _ACTION_GENERATION_FIELDS:
            statement = statement.where(
                getattr(PendingToolAction, field) == generation.get(field)
            )
        cas = session.execute(
            statement.values(
                status="failed",
                result_json=json.dumps(result, ensure_ascii=False, default=str),
                error_message=error,
            )
        )
        if getattr(cas, "rowcount", 0) != 1:
            session.rollback()
            return _latest_action_finalization_payload(bind, action_id, transient_error=error)
        session.expire(action)
        action = session.exec(
            select(PendingToolAction)
            .where(PendingToolAction.id == action_id)
            .execution_options(populate_existing=True)
        ).one()
        message_id: int | None = None
        if emit_message:
            result_message = Message(
                conversation_id=action.conversation_id,
                role="assistant",
                content=_format_action_result_message(action, result),
                metadata_json=json.dumps(
                    {
                        "tool_action_result": {
                            "pending_action_id": action.id,
                            "tool_name": action.tool_name,
                            "status": action.status,
                            "result": result,
                        }
                    },
                    ensure_ascii=False,
                    default=str,
                ),
            )
            session.add(result_message)
            session.flush()
            message_id = result_message.id
        session.commit()
        return _action_finalization_payload(action, message_id=message_id)


def _persist_final_authorized_project_action_success(
    bind,
    action_id: int,
    tool_name: str,
    tool_input: dict[str, Any],
    generation: dict[str, Any],
    prepared: dict[str, Any],
    *,
    emit_message: bool,
) -> dict[str, Any]:
    with Session(bind) as session:
        try:
            action, project, actor = _lock_final_authorized_project_action(
                session,
                action_id=action_id,
                expected_tool_name=tool_name,
                expected_tool_input=tool_input,
            )
        except Exception as exc:
            session.rollback()
            return _terminalize_failed_exact_action_generation(
                bind,
                generation,
                exc,
                emit_message=emit_message,
            )

        finalized_payload: dict[str, Any]
        try:
            with persist_prepared_project_write(
                session,
                project=project,
                tool_name=tool_name,
                prepared=prepared,
            ) as result:
                normalized_result = {"success": True, **result}
                result_json = json.dumps(normalized_result, ensure_ascii=False, default=str)
                statement = (
                    update(PendingToolAction)
                    .where(PendingToolAction.id == action_id)
                    .where(PendingToolAction.status == "executing")
                    .where(PendingToolAction.confirmed_by_user_id == actor.id)
                    .where(PendingToolAction.project_id == project.id)
                    .where(PendingToolAction.tool_name == tool_name)
                )
                for field in _ACTION_GENERATION_FIELDS:
                    statement = statement.where(
                        getattr(PendingToolAction, field) == generation.get(field)
                    )
                cas = session.execute(
                    statement.values(
                        status="completed",
                        result_json=result_json,
                        error_message=None,
                    )
                )
                if getattr(cas, "rowcount", 0) != 1:
                    raise HTTPException(409, "Action execution lease changed before persist")
                session.expire(action)
                action = session.exec(
                    select(PendingToolAction)
                    .where(PendingToolAction.id == action_id)
                    .execution_options(populate_existing=True)
                ).one()
                _mark_duplicate_pending_actions_superseded(session, action)

                message_id: int | None = None
                if emit_message:
                    result_message = Message(
                        conversation_id=action.conversation_id,
                        role="assistant",
                        content=_format_action_result_message(action, normalized_result),
                        metadata_json=json.dumps(
                            {
                                "tool_action_result": {
                                    "pending_action_id": action.id,
                                    "tool_name": action.tool_name,
                                    "status": action.status,
                                    "result": normalized_result,
                                }
                            },
                            ensure_ascii=False,
                            default=str,
                        ),
                    )
                    session.add(result_message)
                    session.flush()
                    message_id = result_message.id
                # Freeze the response before commit. SQLAlchemy expires ORM
                # instances on commit; reading ``action`` afterwards could
                # issue a second query and, if that query failed, incorrectly
                # trigger filesystem compensation after the durable database
                # transaction had already committed.
                finalized_payload = _action_finalization_payload(
                    action,
                    message_id=message_id,
                )
                # ProjectFile, disk copy/edit, action CAS, and completion
                # receipt become visible in one transaction.
                session.commit()
        except Exception:
            session.rollback()
            raise
        return finalized_payload


async def _execute_final_authorized_project_write(
    bind,
    action_id: int,
    tool_name: str,
    tool_input: dict[str, Any],
    *,
    emit_message: bool,
) -> dict[str, Any]:
    prepared: dict[str, Any] | None = None
    try:
        generation = _capture_action_execution_generation(
            bind,
            action_id=action_id,
            expected_tool_name=tool_name,
            expected_tool_input=tool_input,
        )
    except HTTPException as exc:
        return _latest_action_finalization_payload(
            bind,
            action_id,
            transient_error=str(exc.detail),
        )
    try:
        prepared = await prepare_pending_project_write(bind, tool_name, tool_input)
        return _persist_final_authorized_project_action_success(
            bind,
            action_id,
            tool_name,
            tool_input,
            generation,
            prepared,
            emit_message=emit_message,
        )
    except Exception as exc:
        return _persist_final_authorized_project_action_failure(
            bind,
            action_id,
            tool_name,
            tool_input,
            generation,
            exc,
            emit_message=emit_message,
        )
    finally:
        cleanup_prepared_project_write(prepared)


def _reject_batch(
    batch_id: str,
    req: Optional[ConfirmActionRequest],
    session: Session,
    current_user: User,
) -> ConfirmActionResponse:
    actions = _load_batch_actions(session, batch_id)
    for action in actions:
        _authorize_action(session, action, current_user, require_write=True)
    pending_actions = [action for action in actions if action.status == "pending"]
    if not pending_actions:
        return _existing_batch_response(actions)

    reason = req.reason if req and req.reason else ""
    result = {
        "success": False,
        "rejected": True,
        "reason": reason,
        "actions": [
            {"pending_action_id": action.id, "tool_name": action.tool_name, "status": "rejected"}
            for action in pending_actions
        ],
    }
    for action in pending_actions:
        action.status = "rejected"
        action.confirmed_at = utc_now_naive()
        action.confirmed_by_user_id = current_user.id
        action.error_message = reason
        action.result_json = json.dumps(result, ensure_ascii=False, default=str)
        session.add(action)
    result_message = Message(
        conversation_id=actions[0].conversation_id,
        role="assistant",
        content=_format_batch_action_rejected_message(actions, reason),
        metadata_json=json.dumps(
            {
                "tool_action_batch_result": {
                    "approval_batch_id": batch_id,
                    "pending_action_ids": [action.id for action in actions if action.id],
                    "status": "rejected",
                    "result": result,
                }
            },
            ensure_ascii=False,
            default=str,
        ),
    )
    session.add(result_message)
    session.commit()
    session.refresh(result_message)
    return ConfirmActionResponse(
        status="rejected",
        result=result,
        error_message=reason or None,
        message_id=result_message.id,
        approval_batch_id=batch_id,
        action_ids=[action.id for action in actions if action.id],
    )


def _authorize_conversation(session: Session, conversation_id: int, current_user: User) -> Conversation:
    return require_conversation_access(session, conversation_id, current_user)


def _authorize_action(
    session: Session,
    action: PendingToolAction,
    current_user: User,
    *,
    require_write: bool = False,
) -> None:
    conversation = require_conversation_access(
        session,
        action.conversation_id,
        current_user,
        require_write=require_write,
    )
    if action.project_id is not None and conversation.project_id != action.project_id:
        raise HTTPException(status_code=403, detail="Action project scope mismatch")


def _persist_batch_action_results(
    bind,
    batch_id: str,
    executions: list[dict[str, Any]],
) -> ConfirmActionResponse:
    with Session(bind) as session:
        action_ids = [item.get("pending_action_id") for item in executions if item.get("pending_action_id") is not None]
        actions = session.exec(
            select(PendingToolAction)
            .where(PendingToolAction.approval_batch_id == batch_id)
            .order_by(PendingToolAction.sequence_index.asc(), PendingToolAction.id.asc())
            .execution_options(populate_existing=True)
            .with_for_update()
        ).all()
        actions_by_id = {action.id: action for action in actions if action.id is not None}
        if not actions:
            raise HTTPException(status_code=404, detail="Action batch not found")
        result_by_id = {item.get("pending_action_id"): item for item in executions}
        completed_count = 0
        failed_count = 0
        skipped_count = 0
        suppress_result_message = False
        action_results: list[dict[str, Any]] = []
        for action in actions:
            item = result_by_id.get(action.id) or {}
            raw_result = (
                item.get("result")
                if isinstance(item.get("result"), dict)
                else {
                    "success": False,
                    "error": "Missing execution result; action status unknown.",
                    "requires_manual_verification": True,
                }
            )
            result = dict(raw_result)
            terminal_without_receipt = bool(result.pop("_action_terminal_without_receipt", False))
            if terminal_without_receipt:
                # A revoked actor or lost action generation invalidates this
                # worker.  Do not turn that observation into another terminal
                # row or assistant receipt; the cancel/reaper transaction is
                # the sole owner of the action's externally visible outcome.
                suppress_result_message = True
                failed_count += 1
                action_results.append(
                    {
                        "pending_action_id": action.id,
                        "tool_name": action.tool_name,
                        "status": action.status,
                        "result": result,
                        "error_message": str(result.get("error") or action.error_message or "Action is no longer executable"),
                    }
                )
                continue

            if action.status != "executing":
                stored_result = _load_json_object(action.result_json)
                if stored_result:
                    result = stored_result
                if action.status == "completed":
                    completed_count += 1
                elif action.status == "skipped":
                    skipped_count += 1
                else:
                    failed_count += 1
                action_results.append(
                    {
                        "pending_action_id": action.id,
                        "tool_name": action.tool_name,
                        "status": action.status,
                        "result": result,
                        "error_message": action.error_message,
                    }
                )
                continue

            action.result_json = json.dumps(result, ensure_ascii=False, default=str)
            if result.get("success"):
                action.status = "completed"
                completed_count += 1
            elif result.get("skipped"):
                action.status = "skipped"
                action.error_message = str(result.get("error") or "Skipped because a previous action failed")
                skipped_count += 1
            else:
                action.status = "failed"
                action.error_message = str(result.get("error") or "Unknown error")
                failed_count += 1
            action_results.append(
                {
                    "pending_action_id": action.id,
                    "tool_name": action.tool_name,
                    "status": action.status,
                    "result": result,
                    "error_message": action.error_message,
                }
            )
            session.add(action)
        missing_action_ids = [action_id for action_id in action_ids if action_id not in actions_by_id]
        for missing_action_id in missing_action_ids:
            result = {
                "success": False,
                "error": "Execution result could not be attached because the pending action record is missing.",
                "requires_manual_verification": True,
            }
            failed_count += 1
            action_results.append(
                {
                    "pending_action_id": missing_action_id,
                    "tool_name": "unknown",
                    "status": "failed",
                    "result": result,
                    "error_message": result["error"],
                }
            )

        batch_status = "completed" if failed_count == 0 and skipped_count == 0 else "failed"
        batch_result = {
            "success": failed_count == 0 and skipped_count == 0,
            "completed_count": completed_count,
            "failed_count": failed_count,
            "skipped_count": skipped_count,
            "actions": action_results,
        }
        result_message: Message | None = None
        if not suppress_result_message:
            result_message = Message(
                conversation_id=actions[0].conversation_id,
                role="assistant",
                content=_format_batch_action_result_message(actions, batch_result),
                metadata_json=json.dumps(
                    {
                        "tool_action_batch_result": {
                            "approval_batch_id": batch_id,
                            "pending_action_ids": [action.id for action in actions if action.id],
                            "status": batch_status,
                            "result": batch_result,
                        },
                        "tool_action_result": {
                            "pending_action_id": actions[0].id,
                            "tool_name": actions[0].tool_name,
                            "status": actions[0].status,
                            "result": action_results[0]["result"] if action_results else batch_result,
                        },
                    },
                    ensure_ascii=False,
                    default=str,
                ),
            )
            session.add(result_message)
        session.commit()
        if result_message is not None:
            session.refresh(result_message)
        return ConfirmActionResponse(
            status=batch_status,
            result=batch_result,
            error_message=next((item.get("error_message") for item in action_results if item.get("error_message")), None),
            message_id=result_message.id if result_message is not None else None,
            approval_batch_id=batch_id,
            action_ids=[action.id for action in actions if action.id],
        )


def _mark_duplicate_pending_actions_superseded(session: Session, action: PendingToolAction) -> None:
    if not action.tool_input_hash:
        return
    duplicates = session.exec(
        select(PendingToolAction)
        .where(PendingToolAction.id != action.id)
        .where(PendingToolAction.conversation_id == action.conversation_id)
        .where(PendingToolAction.tool_name == action.tool_name)
        .where(PendingToolAction.tool_input_hash == action.tool_input_hash)
        .where(PendingToolAction.status == "pending")
    ).all()
    for duplicate in duplicates:
        duplicate.status = "superseded"
        duplicate.error_message = "Superseded by an identical confirmed action"
        session.add(duplicate)


def _persist_action_result(bind, action_id: int, result: dict[str, Any]) -> ConfirmActionResponse:
    with Session(bind) as session:
        action = session.exec(
            select(PendingToolAction)
            .where(PendingToolAction.id == action_id)
            .execution_options(populate_existing=True)
            .with_for_update()
        ).first()
        if action is None:
            raise HTTPException(status_code=404, detail="Action not found")
        if action.status != "executing":
            return _existing_action_response(action)
        action.result_json = json.dumps(result, ensure_ascii=False, default=str)
        if result.get("success"):
            action.status = "completed"
        else:
            action.status = "failed"
            action.error_message = str(result.get("error") or "Unknown error")
        _mark_duplicate_pending_actions_superseded(session, action)

        result_message = Message(
            conversation_id=action.conversation_id,
            role="assistant",
            content=_format_action_result_message(action, result),
            metadata_json=json.dumps(
                {
                    "tool_action_result": {
                        "pending_action_id": action.id,
                        "tool_name": action.tool_name,
                        "status": action.status,
                        "result": result,
                    }
                },
                ensure_ascii=False,
                default=str,
            ),
        )
        session.add(result_message)
        session.commit()
        session.refresh(result_message)
        return ConfirmActionResponse(
            status=action.status,
            result=result,
            error_message=action.error_message,
            message_id=result_message.id,
            approval_batch_id=action.approval_batch_id or None,
            action_ids=[action.id] if action.id else None,
        )


def _persist_action_failure(bind, action_id: int, exc: Exception) -> ConfirmActionResponse:
    error = str(exc) or exc.__class__.__name__
    result = {"success": False, "error": error}
    with Session(bind) as session:
        action = session.exec(
            select(PendingToolAction)
            .where(PendingToolAction.id == action_id)
            .execution_options(populate_existing=True)
            .with_for_update()
        ).first()
        if action is None:
            raise HTTPException(status_code=404, detail="Action not found")
        if action.status != "executing":
            return _existing_action_response(action)
        action.status = "failed"
        action.error_message = error
        action.result_json = json.dumps(result, ensure_ascii=False, default=str)
        _mark_duplicate_pending_actions_superseded(session, action)
        result_message = Message(
            conversation_id=action.conversation_id,
            role="assistant",
            content=_format_action_result_message(action, result),
            metadata_json=json.dumps(
                {
                    "tool_action_result": {
                        "pending_action_id": action.id,
                        "tool_name": action.tool_name,
                        "status": action.status,
                        "result": result,
                    }
                },
                ensure_ascii=False,
                default=str,
            ),
        )
        session.add(result_message)
        session.commit()
        session.refresh(result_message)
        return ConfirmActionResponse(
            status="failed",
            result=result,
            error_message=error,
            message_id=result_message.id,
            approval_batch_id=action.approval_batch_id or None,
            action_ids=[action.id] if action.id else None,
        )
