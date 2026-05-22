"""Chat action confirmation endpoints — Human-in-the-Loop tool approval."""
from __future__ import annotations

import json
import hashlib
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import update
from sqlmodel import Session, select

from app.database import get_session
from app.models.db import Conversation, Message, PendingToolAction, ProjectMember, User
from app.routers.auth import get_current_user
from app.services.chat.action_executor import execute_tool_by_name
from app.services.time_utils import utc_now_naive

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
    created_at: str
    expires_at: Optional[str] = None


class PendingActionsResponse(BaseModel):
    items: list[PendingActionItem]
    has_pending: bool


def _pending_action_item(action: PendingToolAction) -> PendingActionItem:
    payload = action.get_payload()
    return PendingActionItem(
        id=payload["id"],
        trace_id=payload["trace_id"],
        conversation_id=payload["conversation_id"],
        message_id=payload.get("message_id"),
        project_id=payload.get("project_id"),
        tool_name=payload["tool_name"],
        tool_input=payload["tool_input"],
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
        tool_input = _load_tool_input(action)
        _validate_tool_input_scope(action, tool_input)
    except HTTPException as exc:
        action.status = "failed"
        action.error_message = str(exc.detail)
        session.commit()
        raise
    if not action.tool_input_hash:
        action.tool_input_hash = _hash_tool_input(tool_input)
        session.add(action)

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
    session.close()

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
    total = len(actions)
    pieces = [f"已执行本次确认流程：{completed_count}/{total} 个操作完成。"]
    if failed_count:
        pieces[0] = f"本次确认流程部分失败：{completed_count}/{total} 个操作完成，{failed_count} 个失败。"

    action_by_id = {action.id: action for action in actions}
    lines: list[str] = []
    for index, item in enumerate(action_results, start=1):
        if not isinstance(item, dict):
            continue
        action = action_by_id.get(item.get("pending_action_id"))
        title = action.title if action else str(item.get("tool_name") or "工具操作")
        result = item.get("result") if isinstance(item.get("result"), dict) else {}
        status = "完成" if result.get("success") else "失败"
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


def _hash_tool_input(tool_input: dict[str, Any]) -> str:
    normalized = json.dumps(tool_input or {}, ensure_ascii=False, sort_keys=True, default=str)
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def _validate_tool_input_scope(action: PendingToolAction, tool_input: dict[str, Any]) -> None:
    if action.project_id is None:
        return
    raw_project_id = tool_input.get("project_id")
    try:
        input_project_id = int(raw_project_id)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="Stored tool input is missing project scope") from exc
    if input_project_id != action.project_id:
        raise HTTPException(status_code=403, detail="Stored tool input project scope mismatch")


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
            tool_input = _load_tool_input(action)
            _validate_tool_input_scope(action, tool_input)
        except HTTPException as exc:
            action.status = "failed"
            action.error_message = str(exc.detail)
            session.add(action)
            session.commit()
            raise
        if not action.tool_input_hash:
            action.tool_input_hash = _hash_tool_input(tool_input)
            session.add(action)
        execution_specs.append(
            {
                "id": action.id,
                "tool_name": action.tool_name,
                "tool_input": tool_input,
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
    return await _execute_batch_actions(bind, batch_id, execution_specs)


async def _execute_batch_actions(bind, batch_id: str, execution_specs: list[dict[str, Any]]) -> ConfirmActionResponse:
    executions: list[dict[str, Any]] = []
    for spec in execution_specs:
        try:
            result = await execute_tool_by_name(str(spec["tool_name"]), spec["tool_input"])
        except Exception as exc:
            result = {"success": False, "error": str(exc) or exc.__class__.__name__}
        executions.append(
            {
                "pending_action_id": spec["id"],
                "tool_name": spec["tool_name"],
                "result": result,
            }
        )
    return _persist_batch_action_results(bind, batch_id, executions)


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
    conversation = session.get(Conversation, conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    if current_user.is_admin:
        return conversation
    if conversation.project_id is None:
        raise HTTPException(status_code=403, detail="Project membership required")
    member = session.exec(
        select(ProjectMember).where(
            ProjectMember.project_id == conversation.project_id,
            ProjectMember.user_id == current_user.id,
        )
    ).first()
    if member is None:
        raise HTTPException(status_code=403, detail="Project membership required")
    return conversation


def _member_can_write(member: ProjectMember) -> bool:
    return (member.role or "editor").lower() in {"owner", "editor"}


def _authorize_action(
    session: Session,
    action: PendingToolAction,
    current_user: User,
    *,
    require_write: bool = False,
) -> None:
    if current_user.is_admin:
        return
    project_id = action.project_id
    if project_id is None:
        conversation = session.get(Conversation, action.conversation_id)
        project_id = conversation.project_id if conversation else None
    if project_id is None:
        raise HTTPException(status_code=403, detail="Project membership required")
    member = session.exec(
        select(ProjectMember).where(
            ProjectMember.project_id == project_id,
            ProjectMember.user_id == current_user.id,
        )
    ).first()
    if member is None:
        raise HTTPException(status_code=403, detail="Project membership required")
    if require_write and not _member_can_write(member):
        raise HTTPException(status_code=403, detail="Project write permission required")


def _persist_batch_action_results(
    bind,
    batch_id: str,
    executions: list[dict[str, Any]],
) -> ConfirmActionResponse:
    with Session(bind) as session:
        action_ids = [item.get("pending_action_id") for item in executions if item.get("pending_action_id") is not None]
        actions = session.exec(
            select(PendingToolAction)
            .where(PendingToolAction.id.in_(action_ids))
            .order_by(PendingToolAction.sequence_index.asc(), PendingToolAction.id.asc())
        ).all()
        if not actions:
            raise HTTPException(status_code=404, detail="Action batch not found")
        result_by_id = {item.get("pending_action_id"): item for item in executions}
        completed_count = 0
        failed_count = 0
        action_results: list[dict[str, Any]] = []
        for action in actions:
            item = result_by_id.get(action.id) or {}
            result = item.get("result") if isinstance(item.get("result"), dict) else {"success": False, "error": "Missing result"}
            action.result_json = json.dumps(result, ensure_ascii=False, default=str)
            if result.get("success"):
                action.status = "completed"
                completed_count += 1
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

        batch_status = "completed" if failed_count == 0 else "failed"
        batch_result = {
            "success": failed_count == 0,
            "completed_count": completed_count,
            "failed_count": failed_count,
            "actions": action_results,
        }
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
        session.refresh(result_message)
        return ConfirmActionResponse(
            status=batch_status,
            result=batch_result,
            error_message=next((item.get("error_message") for item in action_results if item.get("error_message")), None),
            message_id=result_message.id,
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
        action = session.get(PendingToolAction, action_id)
        if action is None:
            raise HTTPException(status_code=404, detail="Action not found")
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
        action = session.get(PendingToolAction, action_id)
        if action is None:
            raise HTTPException(status_code=404, detail="Action not found")
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
