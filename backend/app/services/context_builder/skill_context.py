"""Skill context builder."""
from typing import Optional

from sqlmodel import Session

from app.models.db import Skill
from app.services.tool_executor import format_tools_for_claude
from app.services.context_builder.constants import (
    PROJECT_MARKDOWN_TOOL_NAMES,
    PROJECT_OFFICE_TOOL_NAMES,
)


class SkillContext:
    """Context for a skill including prompt, tools, and max_tokens."""
    def __init__(
        self,
        skill_prompt: str = "",
        tools: Optional[list] = None,
        max_tokens: Optional[int] = None,
    ):
        self.skill_prompt = skill_prompt
        self.tools = tools
        self.max_tokens = max_tokens


def _filter_skill_tools(skill: Skill, tool_defs: list[dict]) -> list[dict]:
    """Keep deliverable-only tool scopes for skills with strict output contracts."""
    skill_text = f"{skill.name}\n{skill.system_prompt or ''}".lower()
    if "digital-strategy" not in skill_text and "数字化战略" not in skill_text:
        return tool_defs
    return [tool for tool in tool_defs if tool.get("name") == "generate_ppt_from_skill"]


def build_skill_context(
    session: Session,
    skill_id: Optional[int],
    default_max_tokens: int = 4096,
    skill_override: Optional[Skill] = None,
) -> SkillContext:
    """Build context from a skill definition."""
    skill_prompt = ""
    tools = None
    max_tokens = default_max_tokens
    
    if skill_id:
        skill = (
            skill_override
            if skill_override is not None and skill_override.id == skill_id
            else session.get(Skill, skill_id)
        )
        if skill:
            skill_prompt = skill.system_prompt
            max_tokens = skill.max_tokens or max_tokens
            # Load tools from skill
            if skill.tools_definition_json and skill.tools_definition_json.strip():
                try:
                    tool_defs = __import__("json").loads(skill.tools_definition_json)
                    tools = format_tools_for_claude(_filter_skill_tools(skill, tool_defs))
                except Exception:
                    pass
    
    return SkillContext(
        skill_prompt=skill_prompt,
        tools=tools,
        max_tokens=max_tokens,
    )


def _merge_project_chat_tools(tools: Optional[list], project_id: Optional[int]) -> Optional[list]:
    if project_id is None:
        return tools
    project_tools = format_tools_for_claude(PROJECT_MARKDOWN_TOOL_NAMES + PROJECT_OFFICE_TOOL_NAMES)
    if not project_tools:
        return tools
    if not tools:
        return project_tools
    existing = {tool.get("name") for tool in tools if isinstance(tool, dict)}
    merged = list(tools)
    for tool in project_tools:
        if tool.get("name") not in existing:
            merged.append(tool)
    return merged
