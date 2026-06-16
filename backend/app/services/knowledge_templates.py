from __future__ import annotations

import json
from typing import Any

from sqlmodel import Session, select

from app.models.knowledge import KnowledgeTemplate
from app.services.time_utils import utc_now_naive


BUILTIN_KNOWLEDGE_TEMPLATES: list[dict[str, Any]] = [
    {
        "key": "consulting_case",
        "name": "咨询案例",
        "description": "用于历史项目案例、复盘、客户成功案例。",
        "supported_file_types": ["pptx", "pdf", "docx"],
        "required_fields": ["case_title", "business_problem", "solution_summary"],
        "optional_fields": ["diagnosis", "results", "lessons_learned"],
    },
    {
        "key": "methodology",
        "name": "方法论",
        "description": "用于框架、模型、方法、checklist 和 playbook。",
        "supported_file_types": ["pptx", "pdf", "docx", "md"],
        "required_fields": ["method_title", "method_type", "description"],
        "optional_fields": ["applicable_stages", "key_components", "limitations"],
    },
    {
        "key": "deliverable_template",
        "name": "交付模板",
        "description": "用于提案、汇报、SOW、路线图和计划表结构复用。",
        "supported_file_types": ["pptx", "pdf", "docx", "xlsx"],
        "required_fields": ["template_title", "template_type", "deliverable_format"],
        "optional_fields": ["storyline", "required_inputs", "reusable_pages"],
    },
    {
        "key": "general_document",
        "name": "通用文档",
        "description": "模板识别置信度不足时使用的基础文档模板。",
        "supported_file_types": ["pptx", "pdf", "docx", "md", "txt"],
        "required_fields": ["title", "summary"],
        "optional_fields": ["keywords", "industries", "service_lines"],
    },
    {
        "key": "research_report",
        "name": "行业研究",
        "description": "用于行业趋势、政策、标杆和市场研究。",
        "supported_file_types": ["pptx", "pdf", "docx"],
        "required_fields": ["title", "summary"],
        "optional_fields": ["industries", "keywords", "source_org"],
    },
    {
        "key": "meeting_notes",
        "name": "会议/访谈材料",
        "description": "用于纪要、访谈提纲、客户观点和行动项。",
        "supported_file_types": ["docx", "pdf", "md", "txt"],
        "required_fields": ["title", "summary"],
        "optional_fields": ["participants", "open_questions", "next_actions"],
    },
    {
        "key": "client_profile",
        "name": "客户资料",
        "description": "用于客户背景、组织、业务和历史信息。",
        "supported_file_types": ["pptx", "pdf", "docx"],
        "required_fields": ["title", "summary"],
        "optional_fields": ["industry", "stakeholders", "business_units"],
    },
    {
        "key": "risk_playbook",
        "name": "风险经验",
        "description": "用于风险清单、应对动作和项目经验教训。",
        "supported_file_types": ["docx", "pdf", "md"],
        "required_fields": ["title", "summary"],
        "optional_fields": ["key_risks", "mitigations", "lessons_learned"],
    },
]


def _json_list(values: list[str]) -> str:
    return json.dumps(values, ensure_ascii=False)


def seed_builtin_templates(session: Session) -> list[KnowledgeTemplate]:
    """Idempotently upsert built-in knowledge templates."""
    templates: list[KnowledgeTemplate] = []
    for item in BUILTIN_KNOWLEDGE_TEMPLATES:
        existing = session.exec(select(KnowledgeTemplate).where(KnowledgeTemplate.key == item["key"])).first()
        template = existing or KnowledgeTemplate(key=item["key"], name=item["name"])
        template.name = item["name"]
        template.description = item["description"]
        template.supported_file_types = _json_list(item["supported_file_types"])
        template.required_fields = _json_list(item["required_fields"])
        template.optional_fields = _json_list(item["optional_fields"])
        template.extraction_schema_json = json.dumps(
            {
                "required": item["required_fields"],
                "optional": item["optional_fields"],
            },
            ensure_ascii=False,
        )
        template.status = "active"
        template.updated_at = utc_now_naive()
        session.add(template)
        templates.append(template)
    session.commit()
    for template in templates:
        session.refresh(template)
    return templates


def template_to_dict(template: KnowledgeTemplate) -> dict[str, Any]:
    def parse_list(raw: str) -> list[str]:
        try:
            value = json.loads(raw or "[]")
        except json.JSONDecodeError:
            return []
        return value if isinstance(value, list) else []

    return {
        "id": template.id,
        "key": template.key,
        "name": template.name,
        "description": template.description,
        "supported_file_types": parse_list(template.supported_file_types),
        "required_fields": parse_list(template.required_fields),
        "optional_fields": parse_list(template.optional_fields),
        "status": template.status,
    }


def identify_template(file_type: str, text: str) -> tuple[str, float]:
    """Small deterministic classifier for v1; LLM extraction can replace this later."""
    body = (text or "").lower()
    if any(term in body for term in ("案例", "case", "客户成功", "复盘", "项目背景")):
        return "consulting_case", 0.72
    if any(term in body for term in ("方法论", "framework", "模型", "checklist", "playbook")):
        return "methodology", 0.72
    if any(term in body for term in ("模板", "sow", "storyline", "提案", "汇报结构")):
        return "deliverable_template", 0.7
    if any(term in body for term in ("行业", "研究", "趋势", "政策", "标杆")):
        return "research_report", 0.64
    if any(term in body for term in ("会议", "访谈", "纪要", "行动项", "next action")):
        return "meeting_notes", 0.64
    if any(term in body for term in ("风险", "应对", "经验教训", "lessons learned")):
        return "risk_playbook", 0.64
    if file_type in {"pptx", "pdf", "docx", "md", "txt"}:
        return "general_document", 0.45
    return "general_document", 0.3


def extract_template_fields(template_key: str, text: str, title: str) -> dict[str, Any]:
    summary = " ".join((text or "").strip().split())[:500]
    common = {
        "template_key": template_key,
        "title": title,
        "summary": summary,
        "keywords": [],
        "confidential_level": "public_internal",
        "reuse_policy": "reference_only",
    }
    if template_key == "consulting_case":
        return {
            **common,
            "case_title": title,
            "client_profile": "",
            "industry": "",
            "service_line": "",
            "project_type": "",
            "business_problem": summary,
            "solution_summary": "",
            "diagnosis": [],
            "deliverables": [],
            "methods_used": [],
            "results": [],
            "key_risks": [],
            "lessons_learned": [],
            "reusable_assets": [],
            "similarity_hints": [],
        }
    if template_key == "methodology":
        return {
            **common,
            "method_title": title,
            "method_type": "framework",
            "description": summary,
            "applicable_stages": [],
            "applicable_scenarios": [],
            "key_components": [],
            "inputs_required": [],
            "outputs_expected": [],
            "usage_steps": [],
            "limitations": [],
            "example_cases": [],
        }
    if template_key == "deliverable_template":
        return {
            **common,
            "template_title": title,
            "template_type": "document_structure",
            "deliverable_format": "",
            "service_line": "",
            "applicable_scenarios": [],
            "storyline": [],
            "required_inputs": [],
            "output_sections": [],
            "reusable_pages": [],
            "generation_notes": "",
        }
    return common
