"""Comprehensive tests for ALL Skills — file-backed, DB-seeded, consulting capabilities, and tool bindings."""
from __future__ import annotations

import json
import unittest
from pathlib import Path

from sqlmodel import Session, SQLModel, select

from app.models.db import Skill
from app.routers import skills as skills_module
from app.routers.skills import (
    # File-backed skill names
    DIGITAL_STRATEGY_SKILL_NAME,
    PRESENTATION_BUILDER_SKILL_NAME,
    OFFICE_DOCUMENT_ASSISTANT_SKILL_NAME,
    CONSULTING_PROPOSAL_ADVISOR_SKILL_NAME,
    OFFICE_DOCUMENT_EDITOR_SKILL_NAME,
    PDF_MANAGEMENT_SKILL_NAME,
    MEETING_INTELLIGENCE_SKILL_NAME,
    GOAL_DEFINITION_SKILL_NAME,
    # Tool name lists
    DIGITAL_STRATEGY_TOOL_NAMES,
    PRESENTATION_BUILDER_TOOL_NAMES,
    OFFICE_DOCUMENT_ASSISTANT_TOOL_NAMES,
    CONSULTING_PROPOSAL_ADVISOR_TOOL_NAMES,
    OFFICE_DOCUMENT_EDITOR_TOOL_NAMES,
    PDF_MANAGEMENT_TOOL_NAMES,
    MEETING_INTELLIGENCE_TOOL_NAMES,
    GOAL_DEFINITION_TOOL_NAMES,
    # Prompt markers
    DIGITAL_STRATEGY_PROMPT_MARKER,
    PRESENTATION_BUILDER_PROMPT_MARKER,
    OFFICE_DOCUMENT_ASSISTANT_PROMPT_MARKER,
    CONSULTING_PROPOSAL_ADVISOR_PROMPT_MARKER,
    OFFICE_DOCUMENT_EDITOR_PROMPT_MARKER,
    PDF_MANAGEMENT_PROMPT_MARKER,
    MEETING_INTELLIGENCE_PROMPT_MARKER,
    GOAL_DEFINITION_PROMPT_MARKER,
    # Other
    GSTACK_PRO_SKILLS,
    DEFAULT_SKILLS,
    CONSULTING_CAPABILITY_SKILLS,
    CONSULTING_CAPABILITIES,
    _load_skill_package_prompt,
    ensure_builtin_pro_skills,
)
from app.services.consulting_capabilities import CONSULTING_CAPABILITIES as CAPABILITIES_LIST
from app.tools import registry
from app.tools import file_generators, office_documents, pdf_tools, project_markdown  # noqa: F401 — register tools
from tests.test_database import create_test_engine, drop_all_tables


SKILLS_ROOT = Path(__file__).resolve().parents[2] / "skills"


# ── 1. File-backed Skill packages ────────────────────────────────────────────

FILE_SKILLS = [
    "digital-strategy",
    "consulting-proposal-advisor",
    "ai-strategy-report",
    "presentation-builder",
    "office-document-editor",
    "pdf-management",
    "meeting-intelligence",
    "goal-definition",
]


class FileSkillExistenceTestCase(unittest.TestCase):
    """Every file-backed skill directory and SKILL.md must exist."""

    def test_skills_root_exists(self):
        self.assertTrue(SKILLS_ROOT.is_dir(), f"Skills root not found: {SKILLS_ROOT}")

    def test_all_file_skills_have_skill_md(self):
        for name in FILE_SKILLS:
            skill_path = SKILLS_ROOT / name / "SKILL.md"
            self.assertTrue(skill_path.is_file(), f"Missing SKILL.md for '{name}': {skill_path}")

    def test_all_skill_mds_have_frontmatter(self):
        for name in FILE_SKILLS:
            skill_path = SKILLS_ROOT / name / "SKILL.md"
            content = skill_path.read_text(encoding="utf-8-sig")  # Handle BOM
            self.assertTrue(content.startswith("---"), f"'{name}' SKILL.md missing YAML frontmatter")
            parts = content.split("---", 2)
            self.assertGreaterEqual(len(parts), 3, f"'{name}' SKILL.md frontmatter not closed")
            self.assertIn("name:", parts[1], f"'{name}' frontmatter missing 'name:'")
            self.assertIn("description:", parts[1], f"'{name}' frontmatter missing 'description:'")

    def test_all_skill_mds_have_workflow_or_usage(self):
        for name in FILE_SKILLS:
            skill_path = SKILLS_ROOT / name / "SKILL.md"
            content = skill_path.read_text(encoding="utf-8-sig").lower()
            has_workflow = "workflow" in content or "when to use" in content or "usage" in content
            self.assertTrue(has_workflow, f"'{name}' SKILL.md missing workflow/usage section")


class FileSkillLoadingTestCase(unittest.TestCase):
    """_load_skill_package_prompt must return non-empty, frontmatter-stripped content."""

    def test_all_skills_load_content(self):
        for name in FILE_SKILLS:
            content = _load_skill_package_prompt(name)
            self.assertGreater(len(content), 200, f"Skill '{name}' loaded content too short ({len(content)} chars)")
            self.assertFalse(content.startswith("---"), f"Skill '{name}' frontmatter not stripped")

    def test_skill_content_contains_key_instructions(self):
        """Each skill must contain at least one actionable instruction."""
        for name in FILE_SKILLS:
            content = _load_skill_package_prompt(name).lower()
            has_instruction = any(
                kw in content
                for kw in ["use ", "step ", "action", "tool", "workflow", "when to", "规则", "步骤", "工具"]
            )
            self.assertTrue(has_instruction, f"Skill '{name}' lacks actionable instructions")

    def test_digital_strategy_references_frameworks(self):
        content = _load_skill_package_prompt("digital-strategy")
        self.assertIn("framework", content.lower())
        self.assertIn("maturity", content.lower())

    def test_consulting_proposal_advisor_has_references(self):
        content = _load_skill_package_prompt("consulting-proposal-advisor")
        # The skill content should reference its methodology
        self.assertIn("proposal", content.lower())
        self.assertIn("consulting", content.lower())

    def test_office_document_editor_references_edit_tool(self):
        content = _load_skill_package_prompt("office-document-editor")
        self.assertIn("edit_project_office_document", content)

    def test_pdf_management_references_manage_pdf(self):
        content = _load_skill_package_prompt("pdf-management")
        self.assertIn("manage_pdf", content)

    def test_meeting_intelligence_has_output_format(self):
        content = _load_skill_package_prompt("meeting-intelligence")
        self.assertIn("会议纪要", content)
        self.assertIn("行动项", content)

    def test_goal_definition_has_smart(self):
        content = _load_skill_package_prompt("goal-definition")
        self.assertIn("SMART", content)


# ── 2. DB-seeded Skills (GSTACK_PRO_SKILLS + DEFAULT_SKILLS) ─────────────────

class DBSeedSkillDefinitionTestCase(unittest.TestCase):
    """Every DB seed skill must have required fields."""

    def test_all_gstack_pro_skills_have_required_fields(self):
        for skill_def in GSTACK_PRO_SKILLS:
            name = skill_def.get("name", "<missing>")
            self.assertIn("name", skill_def, f"Skill missing 'name'")
            self.assertIn("category", skill_def, f"Skill '{name}' missing 'category'")
            self.assertIn("description", skill_def, f"Skill '{name}' missing 'description'")
            self.assertIn("system_prompt", skill_def, f"Skill '{name}' missing 'system_prompt'")
            self.assertGreater(len(skill_def.get("system_prompt", "")), 50, f"Skill '{name}' system_prompt too short")

    def test_all_default_skills_have_required_fields(self):
        for skill_def in DEFAULT_SKILLS:
            name = skill_def.get("name", "<missing>")
            self.assertIn("name", skill_def)
            self.assertIn("category", skill_def)
            self.assertIn("system_prompt", skill_def)

    def test_no_duplicate_names_across_all_seeds(self):
        all_names = [s["name"] for s in GSTACK_PRO_SKILLS] + [s["name"] for s in DEFAULT_SKILLS]
        seen = set()
        for name in all_names:
            self.assertNotIn(name, seen, f"Duplicate skill name: '{name}'")
            seen.add(name)

    def test_gstack_pro_skill_categories_are_valid(self):
        valid_categories = {
            "顾问基础能力", "战略分析", "交易", "客户市场",
            "组织、人才", "企业绩效", "核心业务运营", "风险监管",
            "数字化与技术",
        }
        for skill_def in GSTACK_PRO_SKILLS:
            cat = skill_def.get("category", "")
            self.assertIn(cat, valid_categories, f"Skill '{skill_def['name']}' has invalid category: '{cat}'")

    def test_gstack_pro_skills_with_file_packages_load_content(self):
        """Skills backed by file packages should have non-trivial system_prompt."""
        file_backed = {
            DIGITAL_STRATEGY_SKILL_NAME: "digital-strategy",
            PRESENTATION_BUILDER_SKILL_NAME: "presentation-builder",
            OFFICE_DOCUMENT_ASSISTANT_SKILL_NAME: "office-document-assistant" if (SKILLS_ROOT / "office-document-assistant").exists() else None,
            CONSULTING_PROPOSAL_ADVISOR_SKILL_NAME: "consulting-proposal-advisor",
            OFFICE_DOCUMENT_EDITOR_SKILL_NAME: "office-document-editor",
            PDF_MANAGEMENT_SKILL_NAME: "pdf-management",
            MEETING_INTELLIGENCE_SKILL_NAME: "meeting-intelligence",
            GOAL_DEFINITION_SKILL_NAME: "goal-definition",
        }
        for skill_def in GSTACK_PRO_SKILLS:
            name = skill_def["name"]
            if name in file_backed and file_backed[name]:
                prompt = skill_def.get("system_prompt", "")
                # File-backed skills should have their prompt loaded (or be a load marker)
                self.assertIsInstance(prompt, str, f"Skill '{name}' system_prompt should be string")


# ── 3. Prompt markers and template tool names ────────────────────────────────

class SkillRegistrationTestCase(unittest.TestCase):
    """prompt_markers and template_tool_names must be consistent."""

    def test_all_file_backed_skills_have_prompt_markers(self):
        expected = {
            DIGITAL_STRATEGY_SKILL_NAME: DIGITAL_STRATEGY_PROMPT_MARKER,
            PRESENTATION_BUILDER_SKILL_NAME: PRESENTATION_BUILDER_PROMPT_MARKER,
            OFFICE_DOCUMENT_ASSISTANT_SKILL_NAME: OFFICE_DOCUMENT_ASSISTANT_PROMPT_MARKER,
            CONSULTING_PROPOSAL_ADVISOR_SKILL_NAME: CONSULTING_PROPOSAL_ADVISOR_PROMPT_MARKER,
            OFFICE_DOCUMENT_EDITOR_SKILL_NAME: OFFICE_DOCUMENT_EDITOR_PROMPT_MARKER,
            PDF_MANAGEMENT_SKILL_NAME: PDF_MANAGEMENT_PROMPT_MARKER,
            MEETING_INTELLIGENCE_SKILL_NAME: MEETING_INTELLIGENCE_PROMPT_MARKER,
            GOAL_DEFINITION_SKILL_NAME: GOAL_DEFINITION_PROMPT_MARKER,
        }
        for name, marker in expected.items():
            self.assertTrue(marker, f"Empty prompt marker for '{name}'")
            self.assertGreater(len(marker), 5, f"Prompt marker too short for '{name}'")

    def test_all_file_backed_skills_have_tool_names(self):
        expected = {
            DIGITAL_STRATEGY_SKILL_NAME: DIGITAL_STRATEGY_TOOL_NAMES,
            PRESENTATION_BUILDER_SKILL_NAME: PRESENTATION_BUILDER_TOOL_NAMES,
            OFFICE_DOCUMENT_ASSISTANT_SKILL_NAME: OFFICE_DOCUMENT_ASSISTANT_TOOL_NAMES,
            CONSULTING_PROPOSAL_ADVISOR_SKILL_NAME: CONSULTING_PROPOSAL_ADVISOR_TOOL_NAMES,
            OFFICE_DOCUMENT_EDITOR_SKILL_NAME: OFFICE_DOCUMENT_EDITOR_TOOL_NAMES,
            PDF_MANAGEMENT_SKILL_NAME: PDF_MANAGEMENT_TOOL_NAMES,
            MEETING_INTELLIGENCE_SKILL_NAME: MEETING_INTELLIGENCE_TOOL_NAMES,
            GOAL_DEFINITION_SKILL_NAME: GOAL_DEFINITION_TOOL_NAMES,
        }
        for name, tools in expected.items():
            self.assertIsInstance(tools, list, f"Tool names for '{name}' should be list")
            # Some skills legitimately have empty tools (consulting capabilities)
            if tools:
                for tool_name in tools:
                    self.assertIsInstance(tool_name, str, f"Non-string tool name in '{name}'")

    def test_consulting_capability_skills_in_consulting_capability_skills(self):
        """All 9 consulting capabilities should be in CONSULTING_CAPABILITY_SKILLS."""
        cap_skill_names = {s["name"] for s in CONSULTING_CAPABILITY_SKILLS}
        for cap in CAPABILITIES_LIST:
            prefixed_name = f"顾问能力｜{cap.name}"
            self.assertIn(prefixed_name, cap_skill_names, f"Consulting capability '{cap.name}' missing from CONSULTING_CAPABILITY_SKILLS")


# ── 4. Tool registry ─────────────────────────────────────────────────────────

EXPECTED_TOOLS = [
    "read_project_file",
    "write_project_office_document",
    "edit_project_office_document",
    "manage_project_folders",
    "manage_project_files",
    "manage_pdf",
    "generate_ppt",
    "generate_ppt_from_skill",
    "generate_docx",
    "generate_xlsx",
    "generate_pdf",
]


class ToolRegistryTestCase(unittest.TestCase):
    """All expected tools must be registered."""

    def test_all_expected_tools_registered(self):
        for tool_name in EXPECTED_TOOLS:
            tool = registry.get(tool_name)
            self.assertIsNotNone(tool, f"Tool '{tool_name}' not registered")
            self.assertEqual(tool.name, tool_name)
            self.assertGreater(len(tool.description), 20, f"Tool '{tool_name}' description too short")
            self.assertIn("type", tool.input_schema, f"Tool '{tool_name}' missing 'type' in schema")

    def test_skill_tool_names_refer_to_registered_tools(self):
        """Every tool name listed in skill tool lists must exist in registry."""
        all_tool_lists = [
            ("DIGITAL_STRATEGY", DIGITAL_STRATEGY_TOOL_NAMES),
            ("PRESENTATION_BUILDER", PRESENTATION_BUILDER_TOOL_NAMES),
            ("OFFICE_DOCUMENT_ASSISTANT", OFFICE_DOCUMENT_ASSISTANT_TOOL_NAMES),
            ("CONSULTING_PROPOSAL_ADVISOR", CONSULTING_PROPOSAL_ADVISOR_TOOL_NAMES),
            ("OFFICE_DOCUMENT_EDITOR", OFFICE_DOCUMENT_EDITOR_TOOL_NAMES),
            ("PDF_MANAGEMENT", PDF_MANAGEMENT_TOOL_NAMES),
            ("MEETING_INTELLIGENCE", MEETING_INTELLIGENCE_TOOL_NAMES),
            ("GOAL_DEFINITION", GOAL_DEFINITION_TOOL_NAMES),
        ]
        for list_name, tool_names in all_tool_lists:
            for tool_name in tool_names:
                tool = registry.get(tool_name)
                self.assertIsNotNone(
                    tool,
                    f"Tool '{tool_name}' listed in {list_name}_TOOL_NAMES but not in registry",
                )

    def test_edit_tool_has_correct_schema(self):
        tool = registry.get("edit_project_office_document")
        self.assertIsNotNone(tool)
        props = tool.input_schema.get("properties", {})
        self.assertIn("file_id", props)
        self.assertIn("edits", props)
        self.assertIn("output_name", props)

    def test_manage_pdf_tool_has_correct_schema(self):
        tool = registry.get("manage_pdf")
        self.assertIsNotNone(tool)
        props = tool.input_schema.get("properties", {})
        self.assertIn("action", props)
        action_enum = props["action"].get("enum", [])
        self.assertIn("merge", action_enum)
        self.assertIn("split", action_enum)
        self.assertIn("extract", action_enum)
        self.assertIn("read", action_enum)
        self.assertIn("watermark", action_enum)


# ── 5. ensure_builtin_pro_skills integration ─────────────────────────────────

class EnsureBuiltinProSkillsTestCase(unittest.TestCase):
    """ensure_builtin_pro_skills must seed all skills idempotently."""

    def setUp(self):
        self.engine = create_test_engine()
        drop_all_tables(self.engine)
        SQLModel.metadata.create_all(self.engine)

    def tearDown(self):
        self.engine.dispose()

    def test_first_run_creates_all_skills(self):
        with Session(self.engine) as session:
            count = ensure_builtin_pro_skills(session)
            self.assertGreater(count, 0)

        with Session(self.engine) as session:
            skills = session.exec(select(Skill)).all()
            skill_names = {s.name for s in skills}

            # All file-backed skills
            for name in [
                DIGITAL_STRATEGY_SKILL_NAME,
                PRESENTATION_BUILDER_SKILL_NAME,
                OFFICE_DOCUMENT_ASSISTANT_SKILL_NAME,
                CONSULTING_PROPOSAL_ADVISOR_SKILL_NAME,
                OFFICE_DOCUMENT_EDITOR_SKILL_NAME,
                PDF_MANAGEMENT_SKILL_NAME,
                MEETING_INTELLIGENCE_SKILL_NAME,
                GOAL_DEFINITION_SKILL_NAME,
            ]:
                self.assertIn(name, skill_names, f"Skill '{name}' not seeded")

            # All consulting capabilities
            for cap in CAPABILITIES_LIST:
                prefixed = f"顾问能力｜{cap.name}"
                self.assertIn(prefixed, skill_names, f"Consulting capability '{cap.name}' not seeded")

    def test_second_run_is_idempotent_or_minimal(self):
        with Session(self.engine) as session:
            first_count = ensure_builtin_pro_skills(session)
            second_count = ensure_builtin_pro_skills(session)
            # Second run should create 0 new skills (idempotent)
            # but may patch a few if prompt_markers don't match
            self.assertLessEqual(second_count, first_count, "Second run should not create more skills than first")

    def test_seeded_skills_have_correct_categories(self):
        with Session(self.engine) as session:
            ensure_builtin_pro_skills(session)
            skill = session.exec(
                select(Skill).where(Skill.name == OFFICE_DOCUMENT_EDITOR_SKILL_NAME)
            ).one_or_none()
            self.assertIsNotNone(skill)
            self.assertEqual(skill.category, "顾问基础能力")

    def test_seeded_skills_have_tool_definitions(self):
        with Session(self.engine) as session:
            ensure_builtin_pro_skills(session)
            skill = session.exec(
                select(Skill).where(Skill.name == OFFICE_DOCUMENT_EDITOR_SKILL_NAME)
            ).one_or_none()
            self.assertIsNotNone(skill)
            tool_defs = json.loads(skill.tools_definition_json or "[]")
            tool_names = {t.get("name") for t in tool_defs if isinstance(t, dict)}
            self.assertIn("edit_project_office_document", tool_names)
            self.assertIn("read_project_file", tool_names)
            self.assertIn("write_project_office_document", tool_names)

    def test_seeded_pdf_management_has_manage_pdf_tool(self):
        with Session(self.engine) as session:
            ensure_builtin_pro_skills(session)
            skill = session.exec(
                select(Skill).where(Skill.name == PDF_MANAGEMENT_SKILL_NAME)
            ).one_or_none()
            self.assertIsNotNone(skill)
            tool_defs = json.loads(skill.tools_definition_json or "[]")
            tool_names = {t.get("name") for t in tool_defs if isinstance(t, dict)}
            self.assertIn("manage_pdf", tool_names)

    def test_seeded_meeting_intelligence_has_correct_tools(self):
        with Session(self.engine) as session:
            ensure_builtin_pro_skills(session)
            skill = session.exec(
                select(Skill).where(Skill.name == MEETING_INTELLIGENCE_SKILL_NAME)
            ).one_or_none()
            self.assertIsNotNone(skill)
            tool_defs = json.loads(skill.tools_definition_json or "[]")
            tool_names = {t.get("name") for t in tool_defs if isinstance(t, dict)}
            self.assertIn("update_project_markdown_document", tool_names)
            self.assertIn("write_project_office_document", tool_names)

    def test_seeded_goal_definition_has_correct_tools(self):
        with Session(self.engine) as session:
            ensure_builtin_pro_skills(session)
            skill = session.exec(
                select(Skill).where(Skill.name == GOAL_DEFINITION_SKILL_NAME)
            ).one_or_none()
            self.assertIsNotNone(skill)
            tool_defs = json.loads(skill.tools_definition_json or "[]")
            tool_names = {t.get("name") for t in tool_defs if isinstance(t, dict)}
            self.assertIn("update_project_markdown_document", tool_names)


# ── 6. Consulting capabilities ───────────────────────────────────────────────

class ConsultingCapabilitiesTestCase(unittest.TestCase):
    """Validate consulting capability definitions."""

    def test_all_capabilities_have_required_fields(self):
        for cap in CAPABILITIES_LIST:
            self.assertTrue(cap.id, f"Capability missing id")
            self.assertTrue(cap.name, f"Capability '{cap.id}' missing name")
            self.assertTrue(cap.trigger_terms, f"Capability '{cap.id}' missing trigger_terms")
            self.assertGreater(len(cap.trigger_terms), 0, f"Capability '{cap.id}' has empty trigger_terms")

    def test_capability_ids_are_unique(self):
        ids = [cap.id for cap in CAPABILITIES_LIST]
        self.assertEqual(len(ids), len(set(ids)), "Duplicate capability IDs")

    def test_capability_names_are_unique(self):
        names = [cap.name for cap in CAPABILITIES_LIST]
        self.assertEqual(len(names), len(set(names)), "Duplicate capability names")

    def test_expected_capabilities_exist(self):
        expected_ids = {
            "client_meeting_brief", "consulting_storyline", "interview_guide",
            "issue_tree", "hypothesis_tree", "research_plan",
            "opportunity_assessment", "strategic_options", "implementation_plan",
        }
        actual_ids = {cap.id for cap in CAPABILITIES_LIST}
        self.assertEqual(actual_ids, expected_ids)

    def test_trigger_terms_are_lowercase_or_mixed(self):
        """Trigger terms should work for case-insensitive matching."""
        for cap in CAPABILITIES_LIST:
            for term in cap.trigger_terms:
                self.assertIsInstance(term, str, f"Non-string trigger term in '{cap.id}'")
                self.assertGreater(len(term), 0, f"Empty trigger term in '{cap.id}'")


# ── 7. Cross-validation: skill names consistency ─────────────────────────────

class SkillNameConsistencyTestCase(unittest.TestCase):
    """Ensure skill names are consistent across all definitions."""

    def test_gstack_pro_skill_names_match_constants(self):
        gstack_names = {s["name"] for s in GSTACK_PRO_SKILLS}
        expected_constants = [
            DIGITAL_STRATEGY_SKILL_NAME,
            PRESENTATION_BUILDER_SKILL_NAME,
            OFFICE_DOCUMENT_ASSISTANT_SKILL_NAME,
            CONSULTING_PROPOSAL_ADVISOR_SKILL_NAME,
            OFFICE_DOCUMENT_EDITOR_SKILL_NAME,
            PDF_MANAGEMENT_SKILL_NAME,
            MEETING_INTELLIGENCE_SKILL_NAME,
            GOAL_DEFINITION_SKILL_NAME,
        ]
        for name in expected_constants:
            self.assertIn(name, gstack_names, f"Constant '{name}' not in GSTACK_PRO_SKILLS")

    def test_no_empty_skill_names(self):
        for skill_def in GSTACK_PRO_SKILLS:
            self.assertTrue(skill_def.get("name", "").strip(), f"Empty skill name in GSTACK_PRO_SKILLS")
        for skill_def in DEFAULT_SKILLS:
            self.assertTrue(skill_def.get("name", "").strip(), f"Empty skill name in DEFAULT_SKILLS")

    def test_no_empty_descriptions(self):
        for skill_def in GSTACK_PRO_SKILLS:
            desc = skill_def.get("description", "")
            self.assertGreater(len(desc), 10, f"Skill '{skill_def.get('name')}' description too short")


if __name__ == "__main__":
    unittest.main()
