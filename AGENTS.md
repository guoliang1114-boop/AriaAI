# AriaAI Agent Guide

This file is the Codex entry point for the repository. Read `agent.md` before
changing code; it is the complete project guide and remains the source of truth
for repository layout, architecture, deployment, and collaboration rules.

## Working contract

- Preserve user changes and unrelated work. Never discard a dirty worktree.
- Keep product/domain state and execution control in AriaAI. Projects, clients,
  memory, tasks, artifacts, approvals, permissions, and audit history always
  belong to Aria's native services.
- Treat `backend/app/services/chat/product_run_events.py` as the backend run
  event contract and `web/src/types/productRunEvent.ts` as its frontend mirror.
- Route consequential writes through AriaAI authorization and HITAS. A model,
  provider, or filesystem-sandbox decision is not business authorization.
- Do not add a Codex App Server, Codex SDK, Codex subprocess, or Codex protocol
  dependency to the Aria application runtime. Codex may be used as a developer
  tool, but Aria does not communicate with Codex in production.
- When adapting useful open-source implementations, port the smallest cohesive
  mechanism into Aria's language and architecture. Record its upstream commit,
  source path, license, attribution, and Aria modifications. Keep the current
  model-provider paths intact and verify behavior with focused tests.

## Development loop

- Backend commands run from `backend/` with `backend/.venv/bin/python` when the
  checked-in virtual environment exists.
- Frontend commands run from `web/`.
- Add focused tests with every behavioral change. Run focused tests first,
  then the broader affected suite.
- Database changes require an idempotent Alembic revision with exactly one
  migration head. Do not rely only on `SQLModel.metadata.create_all`.
- Update the relevant design or operations document when changing a public
  event, runtime boundary, approval flow, data model, or deployment contract.

## Useful checks

```bash
cd backend
.venv/bin/python -m pytest -q tests/test_agent_harness_native.py
.venv/bin/python -m pytest -q tests/test_product_run_events.py

cd ../web
npm test -- --run src/stores/runActivityReducer.test.ts
npm run build
```

## Repository skills

Curated developer-agent discovery links live in `.agents/skills/`. They are
development metadata only and are never loaded by the Aria production runtime.
Canonical Aria Skill packages remain under `skills/`.
