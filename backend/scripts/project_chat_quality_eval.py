#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.agent_harness.project_chat_quality_eval import (
    run_project_chat_quality_eval,
)


def main() -> int:
    report = run_project_chat_quality_eval()
    print(json.dumps(report, ensure_ascii=False, sort_keys=True))
    return 0 if report["release_gate_passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
