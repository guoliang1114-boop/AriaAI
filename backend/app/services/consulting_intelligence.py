"""Consulting-domain turn framing for AriaAI chat.

The generic intent router decides mode and permissions.  This module adds a
business-facing layer: what kind of consulting work the user is really asking
for, which project memory should matter, and what response shape will make the
answer useful in front of a client.
"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class ConsultingTurnFrame:
    job_type: str
    client_moment: str
    memory_focus: tuple[str, ...] = field(default_factory=tuple)
    response_shape: tuple[str, ...] = field(default_factory=tuple)
    agent_protocol: tuple[str, ...] = field(default_factory=tuple)
    confidence: float = 0.72
    reason: str = "default_consulting_frame"

    def to_prompt_lines(self) -> list[str]:
        lines = [
            f"- consulting_job_type: {self.job_type}",
            f"- client_moment: {self.client_moment}",
            f"- consulting_frame_confidence: {round(self.confidence, 3)}",
            f"- consulting_frame_reason: {self.reason}",
        ]
        if self.memory_focus:
            lines.append(f"- memory_focus: {', '.join(self.memory_focus)}")
        if self.response_shape:
            lines.append(f"- response_shape: {' -> '.join(self.response_shape)}")
        if self.agent_protocol:
            lines.append(f"- agent_protocol: {' -> '.join(self.agent_protocol)}")
        return lines


def _has_any(text: str, terms: tuple[str, ...]) -> bool:
    return any(term in text for term in terms)


def build_consulting_turn_frame(content: str, *, project_id: int | None = None, skill_name: str = "") -> ConsultingTurnFrame:
    text = (content or "").strip().lower()
    if not text:
        return ConsultingTurnFrame(
            job_type="general_consulting_answer",
            client_moment="conversation",
            response_shape=("direct_answer", "practical_next_step"),
            agent_protocol=("understand_user_intent", "use_available_context", "answer_concisely"),
            confidence=0.6,
            reason="empty_or_missing_content",
        )

    if _has_any(text, ("会议纪要", "会议记录", "行动项", "待办", "决策", "转写", "minutes", "transcript")):
        return ConsultingTurnFrame(
            job_type="meeting_intelligence",
            client_moment="after_meeting",
            memory_focus=("decisions", "action_items", "risks", "stakeholder_positions", "follow_ups"),
            response_shape=("meeting_summary", "decisions", "actions", "risks", "follow_up_message"),
            agent_protocol=("parse_unstructured_notes", "separate_fact_from_inference", "assign_owners_and_dates", "persist_if_requested"),
            confidence=0.88,
            reason="meeting_intelligence_terms",
        )

    if _has_any(text, ("会前", "见客户", "拜访客户", "客户会议准备", "开场", "30秒", "30 秒", "pre-meeting", "meeting prep")):
        return ConsultingTurnFrame(
            job_type="pre_meeting_brief",
            client_moment="before_client_meeting",
            memory_focus=("client_profile", "stakeholders", "recent_project_progress", "risks", "open_actions"),
            response_shape=("opening_line", "client_priorities", "watch-outs", "recommended_push", "follow-up_actions"),
            agent_protocol=("observe_project_memory", "infer_meeting_objective", "produce_decision_brief", "flag_assumptions"),
            confidence=0.9,
            reason="pre_meeting_terms",
        )

    if _has_any(text, ("提案", "建议书", "报价", "sow", "proposal", "商业案例", "business case")):
        return ConsultingTurnFrame(
            job_type="proposal_or_business_case",
            client_moment="pursuit_or_scope_alignment",
            memory_focus=("client_pain_points", "decision_makers", "scope", "value_logic", "risks"),
            response_shape=("why_now", "diagnosis", "recommended_solution", "roadmap", "value_and_risks", "next_step"),
            agent_protocol=("extract_known_facts", "state_assumptions", "build_persuasion_chain", "suggest_artifact_when_requested"),
            confidence=0.88,
            reason="proposal_terms",
        )

    if _has_any(text, ("ppt", "pptx", "演示文稿", "幻灯片", "deck", "汇报材料", "路演")):
        return ConsultingTurnFrame(
            job_type="client_ready_presentation",
            client_moment="executive_communication",
            memory_focus=("audience", "decision_question", "evidence", "storyline", "next_decision"),
            response_shape=("executive_answer", "storyline", "slide_plan_or_artifact", "quality_check"),
            agent_protocol=("clarify_audience_if_missing", "create_conclusion_led_titles", "avoid_generic_slides", "verify_deliverable_scope"),
            confidence=0.87,
            reason="presentation_terms",
        )

    if _has_any(text, ("风险", "阻塞", "延迟", "问题", "风险诊断", "risk", "blocker", "delay")):
        return ConsultingTurnFrame(
            job_type="project_risk_diagnosis",
            client_moment="delivery_control",
            memory_focus=("milestones", "risks", "dependencies", "owners", "financial_or_scope_impact"),
            response_shape=("top_risks", "root_cause", "impact", "mitigation", "decision_needed"),
            agent_protocol=("observe_current_project_state", "prioritize_by_client_impact", "recommend_control_actions", "state_confidence"),
            confidence=0.84,
            reason="risk_terms",
        )

    if _has_any(text, ("干系人", "利益相关", "张总", "李总", "负责人", "stakeholder", "decision maker", "决策人")):
        return ConsultingTurnFrame(
            job_type="stakeholder_intelligence",
            client_moment="relationship_management",
            memory_focus=("stakeholder_roles", "preferences", "concerns", "influence", "relationship_history"),
            response_shape=("stakeholder_map", "likely_position", "engagement_strategy", "talking_points", "risks"),
            agent_protocol=("use_stakeholder_memory", "avoid_overclaiming", "translate_signals_into_actions", "protect_sensitive_context"),
            confidence=0.84,
            reason="stakeholder_terms",
        )

    if project_id:
        return ConsultingTurnFrame(
            job_type="project_deep_dive",
            client_moment="project_execution",
            memory_focus=("project_context", "client_memory", "documents", "milestones", "open_actions"),
            response_shape=("answer", "evidence", "implication", "next_step"),
            agent_protocol=("understand_user_intent", "inspect_available_context", "use_tools_only_if_needed", "verify_against_project_facts"),
            confidence=0.72,
            reason="project_context_available",
        )

    if skill_name:
        return ConsultingTurnFrame(
            job_type="skill_workflow",
            client_moment="methodology_execution",
            memory_focus=("skill_methodology", "user_request", "available_context"),
            response_shape=("skill_output", "assumptions", "validation", "next_step"),
            agent_protocol=("follow_skill_contract", "do_not_switch_workflow", "validate_output_quality"),
            confidence=0.78,
            reason="skill_context_available",
        )

    return ConsultingTurnFrame(
        job_type="general_consulting_answer",
        client_moment="conversation",
        response_shape=("direct_answer", "practical_next_step"),
        agent_protocol=("understand_user_intent", "answer_as_consultant", "avoid_generic_filler"),
        confidence=0.66,
        reason="fallback",
    )
