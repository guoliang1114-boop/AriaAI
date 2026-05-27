"""Tests for new audit, tax, and consulting skills — registration and SKILL.md loading."""
import unittest

from app.routers.skills import (
    GSTACK_PRO_SKILLS,
    _load_skill_package_prompt,
    ensure_builtin_pro_skills,
    SKILLS_DIR,
)
from app.models.db import Skill
from sqlmodel import Session, SQLModel, select
from tests.test_database import create_test_engine, drop_all_tables


# Expected new skills by category
EXPECTED_AUDIT_SKILLS = {
    "审计计划与风险评估": "审计与鉴证",
    "实质性程序设计": "审计与鉴证",
    "审计报告草案生成": "审计与鉴证",
    "集团审计策略": "审计与鉴证",
    "年度审计计划制定": "审计与鉴证",
    "内审项目执行工作底稿": "审计与鉴证",
    "SOX 合规检查清单": "审计与鉴证",
    "穿行测试与控制测试设计": "审计与鉴证",
    "IT 一般控制测试": "审计与鉴证",
    "数据分析异常检测": "审计与鉴证",
    "ESG 报告鉴证准备": "审计与鉴证",
}

EXPECTED_TAX_SKILLS = {
    "增值税合规与优化": "税务与法律",
    "税收优惠申请方案": "税务与法律",
    "税务争议应对策略": "税务与法律",
    "税务合规日历与申报管理": "税务与法律",
    "并购税务尽职调查": "税务与法律",
    "交易结构税务优化": "税务与法律",
    "并购后税务整合": "税务与法律",
    "转让定价同期资料准备": "税务与法律",
    "预约定价安排方案": "税务与法律",
    "跨境投资架构税务优化": "税务与法律",
    "BEPS 2.0 支柱二影响评估": "税务与法律",
    "高管薪酬税务筹划": "税务与法律",
    "外派人员税务方案": "税务与法律",
    "股权激励税务方案": "税务与法律",
    "关税与贸易合规": "税务与法律",
    "消费税与其他间接税": "税务与法律",
    "税务数字化转型方案": "税务与法律",
    "税务风险管理框架": "税务与法律",
}

EXPECTED_CONSULTING_SKILLS = {
    "商业尽职调查": "交易",
    "并购整合计划（PMI）": "交易",
    "估值与交易定价": "交易",
    "债务重组方案": "交易",
    "舞弊风险评估": "风险监管",
    "合规调查程序设计": "风险监管",
}

# SKILL.md file slugs that should exist
EXPECTED_SKILL_MD_SLUGS = [
    "audit-risk-assessment",
    "audit-substantive-procedures",
    "audit-report-draft",
    "group-audit-strategy",
    "internal-audit-annual-plan",
    "internal-audit-execution",
    "sox-compliance-checklist",
    "walkthrough-and-control-testing",
    "itgc-testing",
    "data-analytics-anomaly-detection",
    "esg-assurance-preparation",
    "vat-compliance-optimization",
    "tax-incentive-application",
    "tax-dispute-response",
    "tax-compliance-calendar",
    "ma-tax-due-diligence",
    "deal-structure-tax-optimization",
    "post-merger-tax-integration",
    "tp-documentation-preparation",
    "apa-arrangement",
    "cross-border-investment-tax",
    "beps-pillar-two-assessment",
    "executive-compensation-tax",
    "expatriate-tax-planning",
    "equity-incentive-tax",
    "customs-and-trade-compliance",
    "excise-and-other-indirect-taxes",
    "tax-digital-transformation",
    "tax-risk-management-framework",
    "commercial-due-diligence",
    "post-merger-integration",
    "valuation-and-pricing",
    "debt-restructuring",
    "fraud-risk-assessment",
    "compliance-investigation-design",
]


class NewSkillsRegistrationTestCase(unittest.TestCase):
    """Test that all new skills are properly registered in GSTACK_PRO_SKILLS."""

    def _get_skill_names_by_category(self, category: str) -> set[str]:
        return {s["name"] for s in GSTACK_PRO_SKILLS if s["category"] == category}

    def test_audit_skills_registered(self):
        registered = self._get_skill_names_by_category("审计与鉴证")
        for name in EXPECTED_AUDIT_SKILLS:
            self.assertIn(name, registered, f"Missing audit skill: {name}")

    def test_tax_skills_registered(self):
        registered = self._get_skill_names_by_category("税务与法律")
        for name in EXPECTED_TAX_SKILLS:
            self.assertIn(name, registered, f"Missing tax skill: {name}")

    def test_consulting_skills_registered(self):
        all_registered = {s["name"] for s in GSTACK_PRO_SKILLS}
        for name in EXPECTED_CONSULTING_SKILLS:
            self.assertIn(name, all_registered, f"Missing consulting skill: {name}")

    def test_total_skill_count(self):
        self.assertGreaterEqual(len(GSTACK_PRO_SKILLS), 71)

    def test_all_skills_have_required_fields(self):
        required_fields = ["name", "category", "description", "system_prompt", "user_template", "estimated_time"]
        for skill in GSTACK_PRO_SKILLS:
            for field in required_fields:
                self.assertIn(field, skill, f"Skill '{skill.get('name')}' missing field: {field}")
                self.assertTrue(skill[field], f"Skill '{skill.get('name')}' has empty field: {field}")

    def test_audit_category_count(self):
        registered = self._get_skill_names_by_category("审计与鉴证")
        self.assertEqual(len(registered), 11)

    def test_tax_category_count(self):
        registered = self._get_skill_names_by_category("税务与法律")
        self.assertEqual(len(registered), 18)


class SkillMdLoadingTestCase(unittest.TestCase):
    """Test that all SKILL.md files exist and load correctly."""

    def test_all_skill_md_files_exist(self):
        for slug in EXPECTED_SKILL_MD_SLUGS:
            skill_path = SKILLS_DIR / slug / "SKILL.md"
            self.assertTrue(skill_path.is_file(), f"Missing SKILL.md for {slug}")

    def test_skill_md_files_have_content(self):
        for slug in EXPECTED_SKILL_MD_SLUGS:
            content = _load_skill_package_prompt(slug)
            self.assertGreater(len(content), 100, f"SKILL.md for {slug} is too short ({len(content)} chars)")

    def test_skill_md_files_have_frontmatter(self):
        for slug in EXPECTED_SKILL_MD_SLUGS:
            skill_path = SKILLS_DIR / slug / "SKILL.md"
            content = skill_path.read_text(encoding="utf-8")
            self.assertTrue(content.startswith("---"), f"SKILL.md for {slug} missing frontmatter")
            # Check it has closing ---
            parts = content.split("---", 2)
            self.assertGreaterEqual(len(parts), 3, f"SKILL.md for {slug} has malformed frontmatter")

    def test_skill_md_has_required_sections(self):
        required_sections = ["When To Use", "Workflow", "Output Format"]
        for slug in EXPECTED_SKILL_MD_SLUGS:
            content = _load_skill_package_prompt(slug)
            for section in required_sections:
                self.assertIn(section, content, f"SKILL.md for {slug} missing section: {section}")

    def test_skill_md_loading_returns_without_frontmatter(self):
        """_load_skill_package_prompt should strip the frontmatter."""
        for slug in EXPECTED_SKILL_MD_SLUGS[:5]:
            content = _load_skill_package_prompt(slug)
            self.assertFalse(content.startswith("---"), f"Frontmatter not stripped for {slug}")


class EnsureBuiltinProSkillsTestCase(unittest.TestCase):
    """Test that ensure_builtin_pro_skills correctly seeds new skills into the database."""

    def setUp(self):
        self.engine = create_test_engine()
        drop_all_tables(self.engine)
        SQLModel.metadata.create_all(self.engine)

    def tearDown(self):
        SQLModel.metadata.drop_all(self.engine)
        self.engine.dispose()

    def test_ensure_builtin_creates_new_skills(self):
        with Session(self.engine) as session:
            changed = ensure_builtin_pro_skills(session)
            self.assertGreater(changed, 0)

            # Verify audit skills were created
            skills = session.exec(
                select(Skill).where(Skill.category == "审计与鉴证")
            ).all()
            self.assertEqual(len(skills), 11)

    def test_ensure_builtin_creates_tax_skills(self):
        with Session(self.engine) as session:
            ensure_builtin_pro_skills(session)

            skills = session.exec(
                select(Skill).where(Skill.category == "税务与法律")
            ).all()
            self.assertEqual(len(skills), 18)

    def test_ensure_builtin_is_idempotent(self):
        with Session(self.engine) as session:
            changed1 = ensure_builtin_pro_skills(session)
            changed2 = ensure_builtin_pro_skills(session)
            # Second call should not create new skills
            self.assertEqual(changed2, 0, f"Second call changed {changed2} skills (expected 0)")

    def test_new_skills_have_system_prompt(self):
        with Session(self.engine) as session:
            ensure_builtin_pro_skills(session)

            # Check a sample of new skills have non-empty system_prompt
            sample_names = ["审计计划与风险评估", "增值税合规与优化", "商业尽职调查"]
            for name in sample_names:
                skill = session.exec(
                    select(Skill).where(Skill.name == name)
                ).first()
                self.assertIsNotNone(skill, f"Skill '{name}' not found in DB")
                self.assertTrue(skill.system_prompt, f"Skill '{name}' has empty system_prompt")
                self.assertGreater(len(skill.system_prompt), 100, f"Skill '{name}' system_prompt too short")


if __name__ == "__main__":
    unittest.main()
