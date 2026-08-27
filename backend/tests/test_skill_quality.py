from pathlib import Path

from app.services.agent_harness.skill_quality import (
    PRIORITY_SKILLS,
    apply_skill_metadata_defaults,
    build_skill_quality_report,
    evaluate_skill_package,
)


def _write_skill(root: Path, name: str, *, complete: bool = True) -> Path:
    skill_dir = root / name
    skill_dir.mkdir(parents=True)
    metadata = (
        f"---\nname: {name}\ndescription: A sufficiently detailed trigger and output description for testing.\n"
        "version: \"1.2.3\"\ndomain: consulting\nlast_updated: \"2026-08-26\"\nstatus: stable\n---\n"
        if complete
        else f"---\nname: {name}\ndescription: test\n---\n"
    )
    body = "\n".join(
        [
            "# Test Skill",
            "## When To Use",
            "Use it.",
            "## Tools and Dependencies",
            "None.",
            "## Workflow",
            "Do the work.",
            "## Diagnostic Questions",
            "Ask for context.",
            "## Output Format",
            "Return a report.",
            "## Quality Checklist",
            "Verify the report.",
            *[f"Supporting line {index}" for index in range(190)],
        ]
    )
    (skill_dir / "SKILL.md").write_text(metadata + body + "\n", encoding="utf-8")
    return skill_dir


def test_skill_quality_reports_invalid_metadata(tmp_path: Path):
    skill_dir = _write_skill(tmp_path, "example-skill", complete=False)

    score = evaluate_skill_package(skill_dir)

    assert score.grade == "D"
    assert {finding.code for finding in score.findings} >= {"missing_metadata"}
    assert any(finding.severity == "error" for finding in score.findings)


def test_metadata_fixer_preserves_existing_frontmatter(tmp_path: Path):
    skill_dir = _write_skill(tmp_path, "example-skill", complete=False)

    changed = apply_skill_metadata_defaults(tmp_path, updated_on="2026-08-26")
    contents = (skill_dir / "SKILL.md").read_text(encoding="utf-8")

    assert changed == ("example-skill",)
    assert "description: test" in contents
    assert 'version: "1.0.0"' in contents
    assert 'domain: "consulting"' in contents
    assert 'last_updated: "2026-08-26"' in contents
    assert 'status: "stable"' in contents


def test_repository_skill_quality_gate():
    skills_root = Path(__file__).resolve().parents[2] / "skills"

    report = build_skill_quality_report(skills_root)

    assert report.package_count == 48
    assert {item.name for item in report.packages if item.priority} == PRIORITY_SKILLS
    assert report.gate_passed, report.to_json()
