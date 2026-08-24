#!/usr/bin/env python3
"""Run Aria's synthetic grounded Q&A suite against the configured provider."""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from sqlmodel import Session

from app.database import engine
from app.services.agent_harness.grounded_provider_eval import (
    run_grounded_provider_eval,
)
from app.services.provider_selector import (
    _load_provider_module,
    get_provider_name,
    get_selected_model,
)


def _args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--enforce", action="store_true", help="Exit non-zero when quality thresholds fail.")
    parser.add_argument("--pretty", action="store_true")
    return parser.parse_args()


async def _run() -> dict:
    with Session(engine) as session:
        provider = get_provider_name(session)
        model = get_selected_model(session, provider)
    llm = _load_provider_module(provider)

    async def complete(system: str, prompt: str, max_tokens: int) -> str:
        return await llm.complete(
            [{"role": "user", "content": prompt}],
            system=system,
            model=model,
            max_tokens=max_tokens,
            temperature=0,
        )

    return await run_grounded_provider_eval(
        complete,
        provider=provider,
        model=model,
    )


def main() -> int:
    args = _args()
    report = asyncio.run(_run())
    print(json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2 if args.pretty else None))
    return 1 if args.enforce and not report["release_gate_passed"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
