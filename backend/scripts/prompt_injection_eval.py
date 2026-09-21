#!/usr/bin/env python3
"""Evaluate synthetic injected sources; never rebuild or write business memory."""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
from pathlib import Path
import sys

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from sqlmodel import Session
from app.database import engine
from app.services.agent_harness.prompt_injection_eval import run_prompt_injection_eval
from app.services.provider_selector import _load_provider_module, get_provider_name, get_selected_model


async def run() -> dict:
    with Session(engine) as session:
        provider = get_provider_name(session)
        model = get_selected_model(session, provider)
    llm = _load_provider_module(provider)

    async def complete(system: str, messages: list[dict], max_tokens: int) -> str:
        return await llm.complete(messages, system=system, model=model, max_tokens=max_tokens, temperature=0)

    report = await run_prompt_injection_eval(complete, provider=provider, model=model)
    paths = ('app/services/memory_generation.py', 'app/services/project_contexts.py',
             'app/services/client_contexts.py', 'app/services/agent_harness/prompt_injection_eval.py')
    report['runtime_sha256'] = {path: hashlib.sha256((BACKEND_ROOT / path).read_bytes()).hexdigest() for path in paths}
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--enforce', action='store_true')
    args = parser.parse_args()
    report = asyncio.run(run())
    print(json.dumps(report, ensure_ascii=False, sort_keys=True))
    return int(args.enforce and not report['release_gate_passed'])


if __name__ == '__main__':
    raise SystemExit(main())
