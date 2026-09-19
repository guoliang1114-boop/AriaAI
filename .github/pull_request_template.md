## Summary

What changed, and why?

## Area

- [ ] Frontend
- [ ] Backend
- [ ] AI / chat runtime
- [ ] Memory
- [ ] Knowledge base
- [ ] Skill workflow
- [ ] Documentation
- [ ] Other

## Validation

What did you run?

- [ ] `npm run build`
- [ ] `npm test`
- [ ] `npm run lint -- --max-warnings=0`
- [ ] Focused backend tests using `backend/.venv/bin/python` and an isolated `TEST_DATABASE_URL`
- [ ] Affected backend regression suite
- [ ] Quality gates / PostgreSQL checks, when relevant
- [ ] Manual verification
- [ ] Not applicable

## AI Behavior Impact

If this changes prompts, model routing, tools, memory, knowledge retrieval, approvals, or generated artifacts, describe the expected user impact.

State whether evidence is local or deployed. For schema changes, identify the idempotent migration and single Alembic head. For consequential writes, describe the native authorization and HITAS boundary.

## Screenshots / Notes

Add screenshots, traces, release notes, or migration notes if useful.
