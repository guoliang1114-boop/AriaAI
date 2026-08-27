"""Deterministic quality governance for Aria file-backed Skill packages.

The quality gate deliberately inspects package structure and metadata only. It
never loads customer data, calls a model, or publishes a database Skill. The
database remains Aria's runtime source of truth; this module makes the source
packages reviewable and release-gated before they are seeded.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import date
import json
from pathlib import Path
import re
from typing import Any, Iterable

from app.services.agent_harness.skill_package import (
    SkillPackageError,
    parse_skill_document,
)


ALLOWED_DOMAINS = frozenset({"audit", "consulting", "tax", "tech"})
ALLOWED_STATUSES = frozenset({"beta", "deprecated", "stable"})
REQUIRED_METADATA = ("name", "description", "version", "domain", "last_updated", "status")
SEMVER_RE = re.compile(r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

# These packages cover the most common consulting, audit, transaction, meeting,
# analytics, tax, and deliverable paths. They must carry both executable quality
# references and at least one worked example.
PRIORITY_SKILLS = frozenset(
    {
        "audit-risk-assessment",
        "commercial-due-diligence",
        "consulting-proposal-advisor",
        "data-analytics-anomaly-detection",
        "digital-strategy",
        "fraud-risk-assessment",
        "ma-tax-due-diligence",
        "meeting-intelligence",
        "presentation-builder",
        "tax-risk-management-framework",
    }
)

AUDIT_SKILLS = frozenset(
    {
        "audit-report-draft",
        "audit-risk-assessment",
        "audit-substantive-procedures",
        "compliance-investigation-design",
        "data-analytics-anomaly-detection",
        "esg-assurance-preparation",
        "fraud-risk-assessment",
        "group-audit-strategy",
        "internal-audit-annual-plan",
        "internal-audit-execution",
        "itgc-testing",
        "sox-compliance-checklist",
        "walkthrough-and-control-testing",
    }
)
TAX_SKILLS = frozenset(
    {
        "apa-arrangement",
        "beps-pillar-two-assessment",
        "cross-border-investment-tax",
        "customs-and-trade-compliance",
        "deal-structure-tax-optimization",
        "equity-incentive-tax",
        "excise-and-other-indirect-taxes",
        "executive-compensation-tax",
        "expatriate-tax-planning",
        "ma-tax-due-diligence",
        "post-merger-tax-integration",
        "tax-compliance-calendar",
        "tax-digital-transformation",
        "tax-dispute-response",
        "tax-incentive-application",
        "tax-risk-management-framework",
        "tp-documentation-preparation",
        "vat-compliance-optimization",
    }
)
TECH_SKILLS = frozenset(
    {
        "ai-strategy-report",
        "archimate",
        "architecture",
        "bpmn",
        "infocard",
        "mindmap",
        "office-document-editor",
        "pdf-management",
        "presentation-builder",
    }
)


@dataclass(frozen=True)
class SkillQualityFinding:
    code: str
    message: str
    severity: str = "warning"


@dataclass(frozen=True)
class SkillQualityScore:
    name: str
    domain: str
    version: str
    status: str
    score: int
    grade: str
    priority: bool
    reference_count: int
    example_count: int
    line_count: int
    findings: tuple[SkillQualityFinding, ...]

    def to_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["findings"] = [asdict(item) for item in self.findings]
        return payload


@dataclass(frozen=True)
class SkillQualityReport:
    schema_version: int
    package_count: int
    average_score: float
    grade_counts: dict[str, int]
    error_count: int
    warning_count: int
    gate_passed: bool
    packages: tuple[SkillQualityScore, ...]

    def to_dict(self) -> dict[str, Any]:
        return {
            "schema_version": self.schema_version,
            "package_count": self.package_count,
            "average_score": self.average_score,
            "grade_counts": dict(self.grade_counts),
            "error_count": self.error_count,
            "warning_count": self.warning_count,
            "gate_passed": self.gate_passed,
            "packages": [item.to_dict() for item in self.packages],
        }

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), ensure_ascii=False, sort_keys=True)


def infer_skill_domain(name: str) -> str:
    normalized = str(name or "").strip().casefold()
    if normalized in AUDIT_SKILLS:
        return "audit"
    if normalized in TAX_SKILLS:
        return "tax"
    if normalized in TECH_SKILLS:
        return "tech"
    return "consulting"


def _supporting_files(skill_dir: Path, folder: str) -> tuple[Path, ...]:
    root = skill_dir / folder
    if not root.is_dir():
        return ()
    return tuple(
        path
        for path in sorted(root.rglob("*"))
        if path.is_file() and not path.name.startswith(".")
    )


def _reference_files(skill_dir: Path) -> tuple[Path, ...]:
    """Count governed support material without misclassifying worked examples."""

    supported_roots = ("assets", "layouts", "references", "scripts", "styles")
    return tuple(
        path
        for root_name in supported_roots
        for path in _supporting_files(skill_dir, root_name)
    )


def _contains_heading(headings: Iterable[str], *needles: str) -> bool:
    return any(any(needle in heading for needle in needles) for heading in headings)


def _grade(score: int) -> str:
    if score >= 90:
        return "A"
    if score >= 75:
        return "B"
    if score >= 60:
        return "C"
    return "D"


def evaluate_skill_package(skill_dir: Path) -> SkillQualityScore:
    package_name = skill_dir.name
    skill_path = skill_dir / "SKILL.md"
    findings: list[SkillQualityFinding] = []
    priority = package_name in PRIORITY_SKILLS
    reference_files = _reference_files(skill_dir)
    example_files = _supporting_files(skill_dir, "examples")

    try:
        contents = skill_path.read_text(encoding="utf-8")
        document = parse_skill_document(contents, default_name=package_name)
    except (OSError, UnicodeDecodeError, SkillPackageError) as exc:
        return SkillQualityScore(
            name=package_name,
            domain="",
            version="",
            status="",
            score=0,
            grade="D",
            priority=priority,
            reference_count=len(reference_files),
            example_count=len(example_files),
            line_count=0,
            findings=(SkillQualityFinding("invalid_package", str(exc), "error"),),
        )

    metadata = document.metadata
    score = 0
    for field in REQUIRED_METADATA:
        if str(metadata.get(field) or "").strip():
            score += 5
        else:
            findings.append(
                SkillQualityFinding(
                    "missing_metadata",
                    f"missing required frontmatter field: {field}",
                    "error",
                )
            )

    normalized_name = str(metadata.get("name") or "").strip()
    if normalized_name != package_name:
        findings.append(
            SkillQualityFinding(
                "name_mismatch",
                f"frontmatter name {normalized_name!r} must match directory {package_name!r}",
                "error",
            )
        )

    version = str(metadata.get("version") or "").strip()
    if version and not SEMVER_RE.fullmatch(version):
        findings.append(SkillQualityFinding("invalid_version", "version must be SemVer x.y.z", "error"))

    domain = str(metadata.get("domain") or "").strip().casefold()
    if domain and domain not in ALLOWED_DOMAINS:
        findings.append(
            SkillQualityFinding(
                "invalid_domain",
                f"domain must be one of {sorted(ALLOWED_DOMAINS)}",
                "error",
            )
        )

    status = str(metadata.get("status") or "").strip().casefold()
    if status and status not in ALLOWED_STATUSES:
        findings.append(
            SkillQualityFinding(
                "invalid_status",
                f"status must be one of {sorted(ALLOWED_STATUSES)}",
                "error",
            )
        )

    last_updated = str(metadata.get("last_updated") or "").strip()
    if last_updated:
        try:
            if not DATE_RE.fullmatch(last_updated):
                raise ValueError
            date.fromisoformat(last_updated)
        except ValueError:
            findings.append(
                SkillQualityFinding("invalid_last_updated", "last_updated must be YYYY-MM-DD", "error")
            )

    description_length = len(document.description)
    if 30 <= description_length <= 1_000:
        score += 5
    else:
        findings.append(
            SkillQualityFinding(
                "description_depth",
                "description should be 30-1000 characters and explain triggers plus output",
            )
        )

    headings = tuple(
        match.group(1).strip().casefold()
        for match in re.finditer(r"^#{2,3}\s+(.+?)\s*$", document.instructions, re.MULTILINE)
    )
    section_contract = {
        "when_to_use": ("when to use", "适用", "intake", "operating mode", "diagnosis"),
        "workflow": ("workflow", "工作流", "流程"),
        "output": ("output", "输出", "deliverable"),
        "quality": ("quality", "质量", "verification", "consulting standards"),
    }
    for code, needles in section_contract.items():
        if _contains_heading(headings, *needles):
            score += 7
        else:
            findings.append(
                SkillQualityFinding(
                    f"missing_{code}_section",
                    f"missing {code.replace('_', ' ')} section",
                )
            )

    if _contains_heading(headings, "diagnostic", "诊断", "intake", "diagnosis"):
        score += 6
    else:
        findings.append(
            SkillQualityFinding("missing_diagnostics", "missing diagnostic questions or intake section")
        )

    if _contains_heading(headings, "dependencies", "tools", "集成", "capability integration"):
        score += 6
    else:
        findings.append(
            SkillQualityFinding("missing_dependencies", "missing tools/dependencies section")
        )

    if reference_files:
        score += 10
    else:
        severity = "error" if priority else "warning"
        findings.append(
            SkillQualityFinding("missing_references", "package has no references/ support file", severity)
        )

    if example_files:
        score += 10
    else:
        severity = "error" if priority else "warning"
        findings.append(
            SkillQualityFinding("missing_examples", "package has no examples/ worked example", severity)
        )

    line_count = len(contents.splitlines())
    if line_count >= 180:
        score += 5
    else:
        findings.append(
            SkillQualityFinding("shallow_package", "SKILL.md should contain at least 180 lines")
        )

    score = max(0, min(100, score))
    return SkillQualityScore(
        name=package_name,
        domain=domain,
        version=version,
        status=status,
        score=score,
        grade=_grade(score),
        priority=priority,
        reference_count=len(reference_files),
        example_count=len(example_files),
        line_count=line_count,
        findings=tuple(findings),
    )


def build_skill_quality_report(skills_root: Path) -> SkillQualityReport:
    packages = tuple(
        evaluate_skill_package(skill_dir)
        for skill_dir in sorted(skills_root.iterdir())
        if skill_dir.is_dir() and (skill_dir / "SKILL.md").is_file()
    )
    package_count = len(packages)
    average_score = round(
        sum(item.score for item in packages) / package_count if package_count else 0.0,
        2,
    )
    grade_counts = {grade: sum(item.grade == grade for item in packages) for grade in ("A", "B", "C", "D")}
    error_count = sum(
        finding.severity == "error" for item in packages for finding in item.findings
    )
    warning_count = sum(
        finding.severity == "warning" for item in packages for finding in item.findings
    )
    priority_scores = [item.score for item in packages if item.priority]
    gate_passed = bool(packages) and all(
        (
            error_count == 0,
            average_score >= 70.0,
            grade_counts["D"] == 0,
            len(priority_scores) == len(PRIORITY_SKILLS),
            all(score >= 85 for score in priority_scores),
        )
    )
    return SkillQualityReport(
        schema_version=1,
        package_count=package_count,
        average_score=average_score,
        grade_counts=grade_counts,
        error_count=error_count,
        warning_count=warning_count,
        gate_passed=gate_passed,
        packages=packages,
    )


def apply_skill_metadata_defaults(skills_root: Path, *, updated_on: str) -> tuple[str, ...]:
    """Add missing governed metadata without rewriting existing frontmatter."""

    if not DATE_RE.fullmatch(updated_on):
        raise ValueError("updated_on must be YYYY-MM-DD")
    date.fromisoformat(updated_on)
    changed: list[str] = []
    for skill_dir in sorted(skills_root.iterdir()):
        skill_path = skill_dir / "SKILL.md"
        if not skill_path.is_file():
            continue
        contents = skill_path.read_text(encoding="utf-8")
        lines = contents.splitlines()
        if not lines or lines[0].strip() != "---":
            continue
        closing_index = next(
            (index for index, line in enumerate(lines[1:], start=1) if line.strip() == "---"),
            None,
        )
        if closing_index is None:
            continue
        document = parse_skill_document(contents, default_name=skill_dir.name)
        metadata = document.metadata
        additions = []
        if not str(metadata.get("version") or "").strip():
            additions.append('version: "1.0.0"')
        if not str(metadata.get("domain") or "").strip():
            additions.append(f'domain: "{infer_skill_domain(skill_dir.name)}"')
        if not str(metadata.get("last_updated") or "").strip():
            additions.append(f'last_updated: "{updated_on}"')
        if not str(metadata.get("status") or "").strip():
            additions.append('status: "stable"')
        if not additions:
            continue
        rewritten = [*lines[:closing_index], *additions, *lines[closing_index:]]
        skill_path.write_text("\n".join(rewritten) + "\n", encoding="utf-8")
        changed.append(skill_dir.name)
    return tuple(changed)
