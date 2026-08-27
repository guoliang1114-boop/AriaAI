"""Immutable Skill release snapshots and Aria-native traffic governance.

The separation between immutable records and a reconstructed active view follows
the snapshot/rollout boundary used by OpenAI Codex in
``codex-rs/rollout/src/recorder.rs`` and
``codex-rs/core/src/session/rollout_reconstruction.rs`` at upstream commit
``343074d4207d572809bd8cea15f4be1d09d98e0b`` (Apache License 2.0).

Modified for AriaAI on 2026-08-27: this module snapshots DB-backed Skill
contracts, assigns project-sticky deterministic rollout buckets, records only
content-free release identities on ChatRun, and fails back to a known baseline
when a candidate exceeds its configured failure threshold. It does not use a
Codex process, protocol, account, or runtime.
"""
from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
from typing import Any

from sqlmodel import Session, select

from app.models.db import ChatRun, Skill, SkillRelease, SkillRollout
from app.services.time_utils import utc_now_naive


@dataclass(frozen=True)
class SkillReleaseAssignment:
    release_id: int | None = None
    rollout_id: int | None = None
    variant: str = "legacy"
    bucket: int | None = None


def skill_release_payload(value: Any) -> dict[str, Any]:
    return {
        "name": str(getattr(value, "name", "") or ""),
        "category": str(getattr(value, "category", "") or ""),
        "description": str(getattr(value, "description", "") or ""),
        "system_prompt": str(getattr(value, "system_prompt", "") or ""),
        "user_template": str(getattr(value, "user_template", "") or ""),
        "estimated_time": str(getattr(value, "estimated_time", "") or ""),
        "max_tokens": int(getattr(value, "max_tokens", 0) or 0),
        "tools_definition_json": str(getattr(value, "tools_definition_json", "[]") or "[]"),
        "tools_json": str(getattr(value, "tools_json", "[]") or "[]"),
        "package_version": str(getattr(value, "package_version", "") or ""),
        "package_status": str(getattr(value, "package_status", "") or ""),
    }


def skill_release_sha256(value: Any) -> str:
    encoded = json.dumps(
        skill_release_payload(value),
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def snapshot_skill_release(
    session: Session,
    skill: Skill,
    *,
    source: str,
    created_by_user_id: int | None = None,
    activate: bool = False,
    rollback_of_release_id: int | None = None,
) -> SkillRelease:
    """Create or reuse the immutable snapshot for ``skill`` without committing."""

    if skill.id is None:
        session.add(skill)
        session.flush()
    digest = skill_release_sha256(skill)
    skill.package_sha256 = digest
    release = session.exec(
        select(SkillRelease).where(
            SkillRelease.skill_id == skill.id,
            SkillRelease.package_sha256 == digest,
        )
    ).first()
    if release is None:
        payload = skill_release_payload(skill)
        release = SkillRelease(
            skill_id=skill.id,
            skill_name=skill.name,
            **payload,
            package_sha256=digest,
            source=source,
            rollback_of_release_id=rollback_of_release_id,
            created_by_user_id=created_by_user_id,
        )
        session.add(release)
        session.flush()
    if activate or skill.active_release_id is None:
        skill.active_release_id = release.id
    session.add(skill)
    return release


def release_as_runtime_skill(skill: Skill, release: SkillRelease) -> Skill:
    """Overlay an immutable release onto a transient Skill used by one turn."""

    return Skill(
        id=skill.id,
        builtin_key=skill.builtin_key,
        builtin_hash=skill.builtin_hash,
        active_release_id=skill.active_release_id,
        package_sha256=release.package_sha256,
        **skill_release_payload(release),
    )


def active_skill_view(session: Session, skill: Skill) -> Skill:
    """Return the live release view used for routing and non-rollout traffic."""

    release = session.get(SkillRelease, skill.active_release_id) if skill.active_release_id else None
    if release is None or release.skill_id != skill.id:
        return skill
    return release_as_runtime_skill(skill, release)


def skill_rollout_bucket(
    rollout_id: int,
    *,
    skill_id: int,
    project_id: int | None,
    conversation_id: int | None,
    owner_user_id: int | None,
) -> int:
    if project_id:
        scope = f"project:{project_id}"
    elif conversation_id:
        scope = f"conversation:{conversation_id}"
    elif owner_user_id:
        scope = f"owner:{owner_user_id}"
    else:
        scope = f"skill:{skill_id}"
    digest = hashlib.sha256(f"skill-rollout-v1:{rollout_id}:{scope}".encode()).digest()
    return int.from_bytes(digest[:8], "big") % 100


def resolve_skill_release(
    session: Session,
    skill: Skill,
    *,
    project_id: int | None,
    conversation_id: int | None,
    owner_user_id: int | None,
) -> tuple[Skill, SkillReleaseAssignment]:
    """Select one exact release; the same project always receives one bucket."""

    if skill.id is None:
        return skill, SkillReleaseAssignment()
    active_release = session.get(SkillRelease, skill.active_release_id) if skill.active_release_id else None
    rollout = session.exec(
        select(SkillRollout)
        .where(SkillRollout.skill_id == skill.id, SkillRollout.status == "active")
        .order_by(SkillRollout.created_at.desc(), SkillRollout.id.desc())
    ).first()
    if rollout is None:
        if active_release is None:
            return skill, SkillReleaseAssignment(variant="legacy")
        return (
            release_as_runtime_skill(skill, active_release),
            SkillReleaseAssignment(release_id=active_release.id, variant="active"),
        )

    baseline = session.get(SkillRelease, rollout.baseline_release_id)
    candidate = session.get(SkillRelease, rollout.candidate_release_id)
    if baseline is None or candidate is None:
        fallback = baseline or active_release
        if fallback is None:
            return skill, SkillReleaseAssignment(rollout_id=rollout.id, variant="legacy")
        return (
            release_as_runtime_skill(skill, fallback),
            SkillReleaseAssignment(
                release_id=fallback.id,
                rollout_id=rollout.id,
                variant="baseline",
            ),
        )
    bucket = skill_rollout_bucket(
        int(rollout.id or 0),
        skill_id=int(skill.id),
        project_id=project_id,
        conversation_id=conversation_id,
        owner_user_id=owner_user_id,
    )
    variant = "candidate" if bucket < max(0, min(100, rollout.percentage)) else "baseline"
    release = candidate if variant == "candidate" else baseline
    return (
        release_as_runtime_skill(skill, release),
        SkillReleaseAssignment(
            release_id=release.id,
            rollout_id=rollout.id,
            variant=variant,
            bucket=bucket,
        ),
    )


def rollout_health(session: Session, rollout: SkillRollout) -> dict[str, Any]:
    run_states = session.exec(
        select(ChatRun.skill_rollout_variant, ChatRun.status).where(
            ChatRun.skill_rollout_id == rollout.id
        )
    ).all()

    def summarize(variant: str) -> dict[str, Any]:
        selected = [status for selected_variant, status in run_states if selected_variant == variant]
        completed = sum(status == "completed" for status in selected)
        failed = sum(status == "failed" for status in selected)
        cancelled = sum(status == "cancelled" for status in selected)
        terminal = completed + failed + cancelled
        return {
            "run_count": len(selected),
            "terminal_count": terminal,
            "completed_count": completed,
            "failed_count": failed,
            "cancelled_count": cancelled,
            "completion_rate": round(completed / terminal, 4) if terminal else None,
            "failure_rate": round(failed / terminal, 4) if terminal else None,
        }

    return {
        "baseline": summarize("baseline"),
        "candidate": summarize("candidate"),
        "privacy": {
            "reads_message_content": False,
            "stores_prompt_content": False,
            "stores_user_identity": False,
        },
    }


def evaluate_rollout_stop_loss(session: Session, rollout: SkillRollout) -> dict[str, Any]:
    """Fail closed to baseline once a candidate exceeds its failure threshold."""

    if rollout.id is not None:
        locked_rollout = session.exec(
            select(SkillRollout)
            .where(SkillRollout.id == rollout.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        ).one_or_none()
        if locked_rollout is not None:
            rollout = locked_rollout

    health = rollout_health(session, rollout)
    candidate = health["candidate"]
    failure_rate = candidate["failure_rate"]
    if (
        rollout.status == "active"
        and rollout.auto_stop
        and candidate["terminal_count"] >= max(1, rollout.min_sample_size)
        and failure_rate is not None
        and failure_rate > rollout.max_failure_rate
    ):
        rollout.status = "rolled_back"
        rollout.stop_reason = "candidate_failure_rate_exceeded"
        rollout.stopped_at = utc_now_naive()
        rollout.updated_at = rollout.stopped_at
        skill = session.get(Skill, rollout.skill_id) if rollout.skill_id else None
        if skill is not None:
            skill.active_release_id = rollout.baseline_release_id
            session.add(skill)
        session.add(rollout)
        health["auto_stopped"] = True
    else:
        health["auto_stopped"] = False
    return health


def release_summary(release: SkillRelease, *, active_release_id: int | None = None) -> dict[str, Any]:
    return {
        "id": release.id,
        "skill_id": release.skill_id,
        "skill_name": release.skill_name,
        "version": release.package_version,
        "status": release.package_status,
        "sha256": release.package_sha256,
        "source": release.source,
        "rollback_of_release_id": release.rollback_of_release_id,
        "is_active": release.id == active_release_id,
        "created_at": release.created_at.isoformat(),
    }


def rollout_summary(session: Session, rollout: SkillRollout) -> dict[str, Any]:
    baseline = session.get(SkillRelease, rollout.baseline_release_id)
    candidate = session.get(SkillRelease, rollout.candidate_release_id)
    return {
        "id": rollout.id,
        "skill_id": rollout.skill_id,
        "baseline_release": release_summary(baseline) if baseline else None,
        "candidate_release": release_summary(candidate) if candidate else None,
        "percentage": rollout.percentage,
        "status": rollout.status,
        "min_sample_size": rollout.min_sample_size,
        "max_failure_rate": rollout.max_failure_rate,
        "auto_stop": rollout.auto_stop,
        "stop_reason": rollout.stop_reason or None,
        "health": rollout_health(session, rollout),
        "created_at": rollout.created_at.isoformat(),
        "updated_at": rollout.updated_at.isoformat(),
        "stopped_at": rollout.stopped_at.isoformat() if rollout.stopped_at else None,
    }
