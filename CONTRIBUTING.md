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
npm run build
npm test
```

```bash
cd backend
python3 -m pytest tests
```

## Pull Request Expectations

- Keep changes scoped.
- Include tests when behavior changes.
- Update docs when the product surface, API, or workflow changes.
- Do not include secrets, customer data, private documents, or generated local artifacts.
- For AI behavior changes, describe the user impact and the validation path.

## Design Principles

- AriaAI is not a generic chatbot.
- Project, client, knowledge, Skill, artifact, and memory context should remain explicit.
- High-risk write/delete/update actions should be reviewable.
- AI output should be useful, traceable, and easy to turn into work.

## Security

Please do not open a public issue for security-sensitive reports. Email the maintainer or use a private channel first.
