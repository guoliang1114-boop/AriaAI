#!/usr/bin/env python3
"""Print and optionally enforce Aria's deterministic Skill quality scorecard."""
from __future__ import annotations

import argparse
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.agent_harness.skill_quality import (
    apply_skill_metadata_defaults,
    build_skill_quality_report,
)


def _skills_root() -> Path:
    return Path(__file__).resolve().parents[2] / "skills"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--strict", action="store_true", help="fail when the release gate is not met")
    parser.add_argument(
        "--fix-metadata",
        metavar="YYYY-MM-DD",
        help="add missing version/domain/last_updated/status fields without rewriting existing values",
    )
    args = parser.parse_args()
    skills_root = _skills_root()
    if args.fix_metadata:
        changed = apply_skill_metadata_defaults(skills_root, updated_on=args.fix_metadata)
        print(f"Skill metadata normalized: changed={len(changed)}")
    report = build_skill_quality_report(skills_root)
    print(report.to_json())
    if args.strict and not report.gate_passed:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
