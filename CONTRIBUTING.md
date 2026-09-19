# Contributing to AriaAI

Thanks for taking an interest in AriaAI.

AriaAI is an open-source agentic workspace for professional knowledge work. The project is still evolving quickly, so contributions are most useful when they make the system easier to understand, safer to run, or more reliable for real work.

## Good First Areas

- Improve setup, architecture, or product documentation.
- Add or refine Skill examples.
- Add tests around chat, memory, knowledge, and Skill workflows.
- Improve frontend accessibility, empty states, loading states, and responsive behavior.
- Improve backend reliability, migration checks, task governance, and error handling.

## Local Development

Follow the [English setup guide](README.md#quick-start) for Python/Node versions, environment variables, administrator setup, and migrations. Read [AGENTS.md](AGENTS.md) and [agent.md](agent.md) before editing. Use the [documentation index](docs/README.md) to distinguish active contracts from historical plans.

Backend:

```bash
cd backend
./start.sh
```

Frontend:

```bash
cd web
npm install
npm run dev
```

Useful checks:

```bash
cd web
npm run lint -- --max-warnings=0
npm run build
npm test
```

```bash
cd backend
ARIA_TEST_DB=$(mktemp /tmp/aria-tests.XXXXXX)
TEST_DATABASE_URL="sqlite:///$ARIA_TEST_DB" .venv/bin/python -m pytest -q \
  tests/test_agent_harness_native.py tests/test_product_run_events.py \
  tests/test_knowledge_retrieval.py tests/test_knowledge_conversation_access.py
.venv/bin/python scripts/project_chat_quality_eval.py
.venv/bin/python scripts/knowledge_retrieval_eval.py --enforce
.venv/bin/python scripts/skill_quality_report.py --strict
```

Run focused tests first, then the affected suite. Use `backend/.venv/bin/python` from `backend/`; a bare system Python may lack the pinned dependencies. In-memory `sqlite://` uses separate connections across HTTP worker threads, so use a temporary SQLite file for API integration tests. Remove your temporary test database when finished.

For PostgreSQL validation, set `TEST_DATABASE_URL` to a separate test database. `tests/test_database.py` creates an `ariaai_test_*` schema per process and refuses destructive cleanup outside it. Do not point ad hoc tests at production. PostgreSQL-only migration, locking, and concurrency checks are not covered by SQLite. Database changes require an idempotent Alembic revision, the migration governance checks, and exactly one head.

Skill package checks verify structure and declared inputs, deliverables, and QA; a high score does not establish professional correctness. Use each package's `examples/` and `references/` to record actual output and per-item verification. Missing facts, unsupported professional conclusions, failed tools, and pending HITAS actions must remain visible.

## Pull Request Expectations

- Keep changes scoped.
- Include tests when behavior changes.
- Update docs when the product surface, API, or workflow changes.
- Do not include secrets, customer data, private documents, or generated local artifacts.
- For AI behavior changes, describe the user impact and the validation path.
- Keep product state, execution, authorization, and audit in Aria's native services. Do not add a Codex runtime dependency.
- Keep backend Product Run Events and the frontend mirror consistent; document public event or runtime boundary changes.
- Preserve unrelated uncommitted work. For upstream code ports, record the commit, source path, license, attribution, and local modifications.
- Distinguish local validation from deployed evidence. Publish via GitHub Actions and follow [DEPLOY.md](DEPLOY.md).

## Design Principles

- AriaAI is not a generic chatbot.
- Project, client, knowledge, Skill, artifact, and memory context should remain explicit.
- High-risk write/delete/update actions should be reviewable.
- AI output should be useful, traceable, and easy to turn into work.

## Security

Please do not open a public issue for security-sensitive reports. Email the maintainer or use a private channel first.
