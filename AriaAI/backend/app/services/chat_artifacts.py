"""Chat artifact extraction and PPT strategy helpers."""
from __future__ import annotations

import json
import re
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.services.chat_tools import ChatRuntime


def _extract_artifact(result: dict) -> dict | None:
    source = result
    if not (result.get("file_path") or result.get("path")) and isinstance(result.get("output"), dict):
        source = result["output"]

    artifact_path = source.get("file_path") or source.get("path")
    artifact_name = source.get("file_name") or source.get("name")
    artifact_type = source.get("file_type")
    if not artifact_path or not artifact_name or not artifact_type:
        return None

    return {
        "name": artifact_name,
        "file_type": artifact_type,
        "path": artifact_path,
        "description": source.get("note") or source.get("message") or source.get("description") or "",
    }


def _build_artifact_notice(artifacts: list[dict]) -> str:
    names = "\u3001".join(str(item.get("name")) for item in artifacts if item.get("name"))
    if not names:
        return "\u5df2\u751f\u6210\u9644\u4ef6\uff0c\u53ef\u5728\u672c\u6761\u56de\u590d\u4e2d\u7684\u4e0b\u8f7d\u5361\u7247\u91cc\u76f4\u63a5\u4e0b\u8f7d\u3002"
    return f"\u5df2\u751f\u6210\u9644\u4ef6\uff1a{names}\u3002\u53ef\u5728\u672c\u6761\u56de\u590d\u4e2d\u7684\u4e0b\u8f7d\u5361\u7247\u91cc\u76f4\u63a5\u4e0b\u8f7d\u3002"


def _has_ppt_artifact(artifacts: list[dict]) -> bool:
    return any(str(item.get("file_type") or "").lower() == "pptx" for item in artifacts)


def _should_auto_generate_digital_strategy_ppt(
    runtime: ChatRuntime,
    req,
    full_text: str,
    artifacts: list[dict],
) -> bool:
    if not req.skill_id or not full_text.strip():
        return False
    if _has_ppt_artifact(artifacts):
        return False
    return _is_digital_strategy_runtime(runtime)


def _is_digital_strategy_runtime(runtime: ChatRuntime) -> bool:
    text = f"{runtime.skill_name or ''}\n{runtime.system or ''}".lower()
    markers = (
        "digital-strategy",
        "\u6570\u5b57\u5316\u6218\u7565",
        "\u6570\u5b57\u5316\u8f6c\u578b\u6218\u7565",
        "\u6570\u5b57\u5316\u8d4b\u80fd",
        "\u6570\u5b57\u5316\u6210\u719f\u5ea6",
        "kimi_agent_\u6570\u5b57\u5316",
    )
    return any(marker in text for marker in markers)


def _looks_like_digital_strategy_tool_input(tool_input: dict) -> bool:
    text = json.dumps(tool_input, ensure_ascii=False).lower()
    markers = (
        "digital-strategy",
        "\u6570\u5b57\u5316\u6218\u7565",
        "\u6570\u5b57\u5316\u8f6c\u578b",
        "digital transformation",
        "digital strategy",
        "three-horizon",
        "horizon",
        "maturity",
    )
    return any(marker in text for marker in markers)


def _route_ppt_tool_for_skill(runtime: ChatRuntime, tool_name: str, tool_input: dict) -> tuple[str, dict]:
    should_route = _is_digital_strategy_runtime(runtime) or _looks_like_digital_strategy_tool_input(tool_input)
    if tool_name not in {"generate_ppt", "generate_ppt_from_skill"} or not should_route:
        return tool_name, tool_input
    routed_input = dict(tool_input)
    routed_input["skill_name"] = "digital-strategy"
    return "generate_ppt_from_skill", routed_input


def _repair_digital_strategy_ppt_tool_input(
    runtime: ChatRuntime,
    tool_name: str,
    tool_input: dict,
    source_text: str,
    force_rebuild: bool = False,
) -> dict:
    if tool_name != "generate_ppt_from_skill" or not _is_digital_strategy_runtime(runtime):
        return tool_input

    title = str(tool_input.get("title") or "").strip()
    slides = tool_input.get("slides")
    if title and isinstance(slides, list) and slides and not force_rebuild:
        return tool_input

    fallback_title, fallback_slides = _build_slides_from_strategy_text(source_text)
    repaired = dict(tool_input)
    repaired["skill_name"] = "digital-strategy"
    if not title:
        repaired["title"] = fallback_title
    if force_rebuild or not isinstance(slides, list) or not slides:
        repaired["slides"] = fallback_slides
    if not str(repaired.get("subtitle") or "").strip():
        repaired["subtitle"] = "Generated from the digital strategy response"
    return repaired


def _clean_slide_line(line: str) -> str:
    cleaned = line.strip()
    cleaned = cleaned.lstrip("-*\u2022 ").strip()
    return re.sub(r"^\d{1,2}[.、)）]\s*", "", cleaned).strip()


def _build_slides_from_strategy_text(full_text: str) -> tuple[str, list[dict]]:
    lines = [line.strip() for line in full_text.splitlines() if line.strip()]
    title = "\u6570\u5b57\u5316\u6218\u7565\u65b9\u6848"
    for line in lines[:10]:
        cleaned = line.strip("# ").strip()
        if (
            cleaned
            and len(cleaned) <= 60
            and not cleaned.startswith(">")
            and not cleaned[:1].isdigit()
            and not cleaned.startswith(("-", "*", "\u2022"))
            and ("\u65b9\u6848" in cleaned or "\u6218\u7565" in cleaned or "\u8f6c\u578b" in cleaned)
        ):
            title = cleaned
            break

    sections: list[tuple[str, list[str]]] = []
    current_title = ""
    current_lines: list[str] = []
    for line in lines:
        normalized = line.strip()
        heading = ""
        if normalized.startswith("#"):
            heading = normalized.strip("# ").strip()
        elif len(normalized) <= 40 and (
            normalized[:2] in ("\u4e00\u3001", "\u4e8c\u3001", "\u4e09\u3001", "\u56db\u3001", "\u4e94\u3001", "\u516d\u3001", "\u4e03\u3001", "\u516b\u3001", "\u4e5d\u3001")
            or normalized.lower().startswith(("executive", "strategic", "digital", "gap", "transformation", "governance"))
        ):
            heading = normalized

        if heading:
            if current_title:
                sections.append((current_title, current_lines))
            current_title = heading
            current_lines = []
        elif current_title:
            cleaned = _clean_slide_line(normalized)
            if cleaned:
                current_lines.append(cleaned)
    if current_title:
        sections.append((current_title, current_lines))

    parsed_sections_from_text = bool(sections)
    if not sections:
        chunks = ["\n".join(lines[i : i + 8]) for i in range(0, min(len(lines), 56), 8)]
        sections = [(f"\u6838\u5fc3\u5185\u5bb9 {index + 1}", chunk.splitlines()) for index, chunk in enumerate(chunks)]

    slides: list[dict] = []
    for section_title, content_lines in sections[:14]:
        bullets = [item for item in content_lines if item and item != section_title][:8]
        if not bullets:
            bullets = ["\u8be6\u89c1\u6218\u7565\u6b63\u6587\u3002"]
        slides.append(
            {
                "type": "content",
                "title": section_title[:80],
                "content": "\n".join(f"- {bullet[:160]}" for bullet in bullets),
            }
        )

    if len(slides) < 16 and not parsed_sections_from_text:
        fallback_plan = [
            (
                "Executive Summary",
                "- Strategic thesis: digital transformation must be anchored in business value, not system replacement\n- Value ambition: define growth, efficiency and risk-control targets before solution design\n- Priority moves: focus first on data foundation, customer/operations use cases and governance cadence\n- Leadership decisions: confirm scope, funding envelope, owners and first-wave pilots\n- Success condition: every initiative must map to a measurable business KPI",
            ),
            (
                "Strategic Context and Transformation Thesis",
                "- Market pressure: customers, competitors and regulators are raising expectations for speed and transparency\n- Internal pressure: fragmented processes and data reduce decision quality and execution pace\n- Opportunity window: AI, cloud and workflow automation can now unlock cross-functional productivity\n- Transformation thesis: build reusable capabilities instead of isolated digital projects\n- Management implication: treat digital as a portfolio of value bets with quarterly steering",
            ),
            (
                "Current Digital Maturity Diagnosis",
                "- Strategy: assess whether digital priorities are explicitly linked to business goals and budget choices\n- Customer: review journey coverage, channel integration and customer data completeness\n- Operations: identify manual handoffs, duplicated approvals and automation bottlenecks\n- Organization: test decision rights, product ownership, agile adoption and digital talent depth\n- Data and technology: score governance, architecture modularity, API maturity and legacy constraints",
            ),
            (
                "Pain Point Root Causes",
                "- Process pain points often come from unclear ownership, not only missing systems\n- Data pain points usually reflect weak master data, inconsistent definitions and low accountability\n- Technology pain points come from point-to-point integration and customized legacy platforms\n- Adoption pain points come from incentives and training gaps rather than tool availability\n- Root-cause view should separate symptoms, structural causes and required management actions",
            ),
            (
                "Digital Vision and Target Ambition",
                "- Vision: become a data-driven enterprise where decisions, operations and customer engagement are continuously optimized\n- North-star metrics: revenue uplift, operating-cost reduction, cycle-time compression and risk reduction\n- Target ambition: move priority domains from L2/L3 maturity to L4 managed capability within 3 years\n- Design principle: standardize core platforms while allowing business-led innovation at the edge\n- Leadership implication: align ambition to funding and talent capacity before roadmap approval",
            ),
            (
                "Capability Blueprint",
                "- Customer intelligence: unified profiles, segmentation, journey orchestration and next-best-action triggers\n- Digital operations: workflow automation, exception management, process mining and SLA visibility\n- Data foundation: master data, data quality rules, governance roles and analytics-ready data products\n- AI decision support: forecasting, recommendation, knowledge retrieval and assisted execution\n- Platform architecture: API integration, cloud-native services, security controls and reusable components",
            ),
            (
                "Use-Case Portfolio",
                "- Growth use cases: precision marketing, sales productivity, retention prediction and pricing optimization\n- Efficiency use cases: automated reporting, workflow routing, demand planning and service operations\n- Risk use cases: compliance monitoring, anomaly detection, access governance and early-warning dashboards\n- Employee use cases: knowledge assistant, document generation, training recommendation and expert matching\n- Portfolio rule: balance quick wins, foundation enablers and strategic differentiators",
            ),
            (
                "Gap Prioritization Matrix",
                "- Quick wins: high value, low complexity and visible within 90-180 days\n- Foundations: data, architecture and governance enablers required before scaled rollout\n- Differentiators: capabilities that create customer, cost or ecosystem advantage\n- Defer items: low-value automation or technology experiments without business sponsorship\n- Decision rule: prioritize by value, feasibility, dependency and change readiness",
            ),
            (
                "Three-Horizon Roadmap",
                "- Horizon 1 Foundation: stabilize data, launch pilots, set governance and prove value\n- Horizon 2 Scale: extend validated use cases across business units and integrate platforms\n- Horizon 3 Lead: build AI-native operations, ecosystem integration and continuous innovation loops\n- Roadmap dependency: do not scale AI or advanced analytics before data ownership is working\n- Review cadence: quarterly value review and semi-annual roadmap refresh",
            ),
            (
                "Initiative Portfolio and Milestones",
                "- Each initiative should define owner, value KPI, user group, data dependency and delivery milestone\n- Year 1 milestones: maturity baseline, data governance launch, 3-5 pilots and first value dashboard\n- Year 2 milestones: platform integration, scaled workflows, business-unit rollout and talent academy\n- Year 3 milestones: AI operating model, ecosystem collaboration and continuous optimization\n- Governance checkpoint: stop, scale or redesign initiatives based on measured adoption and value",
            ),
            (
                "Target Operating Model",
                "- Steering committee owns priorities, funding trade-offs and cross-functional escalation\n- Transformation PMO manages portfolio rhythm, benefits tracking and dependency resolution\n- Product owners translate business pain points into roadmaps and adoption plans\n- Data owners govern definitions, quality, access and lifecycle management\n- Technology teams provide reusable platforms, standards and security guardrails",
            ),
            (
                "Investment and Business Case",
                "- Investment envelope should cover technology, data, talent, change and partner support\n- Suggested split: 40% technology, 30% talent/change, 20% data, 10% ecosystem experimentation\n- Benefit pools: revenue uplift, working-capital improvement, cost reduction and risk avoidance\n- Stage-gate funding: release scale investment only after pilots prove adoption and KPI movement\n- CFO view: present base, upside and downside cases with explicit assumptions",
            ),
            (
                "KPI Dashboard",
                "- Business KPIs: revenue conversion, retention, gross margin, cycle time, service cost and risk incidents\n- Adoption KPIs: active users, workflow coverage, automation rate and decision usage frequency\n- Data KPIs: completeness, accuracy, timeliness, ownership coverage and issue resolution SLA\n- Delivery KPIs: milestone hit rate, dependency closure, budget burn and value realization\n- Review mechanism: monthly PMO dashboard and quarterly executive value review",
            ),
            (
                "Risk Controls",
                "- Legacy risk: integration complexity, hidden customization and migration downtime\n- Data risk: inconsistent definitions, privacy exposure and weak ownership\n- Adoption risk: low frontline usage, insufficient incentives and training fatigue\n- Vendor risk: lock-in, unclear accountability and capability transfer gaps\n- Mitigation: phased rollout, architecture guardrails, change champions and exit criteria",
            ),
            (
                "90-Day Action Plan",
                "- Week 1-2: confirm ambition, scope, sponsor, decision forum and baseline assumptions\n- Week 3-5: run leadership interviews, maturity assessment and data/platform diagnostic\n- Week 6-8: prioritize use cases, estimate benefits and define first-wave pilots\n- Week 9-11: design operating model, investment case, KPI dashboard and roadmap dependencies\n- Week 12: align steering committee on launch plan, funding and owners",
            ),
            (
                "Appendix: Assessment and Interview Guide",
                "- Interview executives on strategic priorities, pain points, decision bottlenecks and value ambition\n- Interview business owners on process friction, customer impact and adoption barriers\n- Interview IT/data teams on architecture, data quality, security and integration constraints\n- Collect evidence: KPI baselines, process maps, system inventory, data dictionary and project portfolio\n- Use findings to replace assumptions in the next deck version",
            ),
        ]
        existing = {slide["title"] for slide in slides}
        for fallback_title, fallback_content in fallback_plan:
            if fallback_title not in existing:
                slides.append(
                    {
                        "type": "content",
                        "title": fallback_title,
                        "content": fallback_content,
                    }
                )
            if len(slides) >= 16:
                break

    return title, slides
