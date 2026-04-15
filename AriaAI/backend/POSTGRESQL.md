# PostgreSQL Setup

AriaAI backend now defaults to PostgreSQL.

## Default connection

```env
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/ariaai
```

## Recommended setup

1. Create the database:

```sql
CREATE DATABASE ariaai;
```

2. Put the real connection string into `backend/.env`.

3. Activate the backend environment and run migrations:

```bash
cd AriaAI/backend
source .venv/bin/activate
alembic upgrade head
```

4. Start the backend from `start.ps1` or `start.sh`.

## Current migration chain

The current migration chain includes at least:

- `001_v1_1_project_context`
- `002_v1_2_project_notes_todos`
- `003_v1_3_project_members`
- `004_v1_4_knowledge_doc_project_id`
- `005_v1_5_todo_due_date`

## Operational notes

- PostgreSQL is the recommended default for all deployed environments.
- SQLite is only kept as an explicit fallback and should not be treated as the primary production path.
- After every deployment that changes backend models or routers, run `alembic upgrade head`.
- If code has already created tables or columns manually and Alembic version is behind, fix the version state first with `alembic stamp ...`, then continue with `alembic upgrade head`.
- Typical checks:

```bash
alembic current
alembic upgrade head
```

## Common failure mode

If you see errors like:

- `relation "...\" already exists`
- `column "...\" already exists`
- `column "...\" does not exist`

then the most likely cause is schema drift between the real database and the `alembic_version` table.

In that case:

1. Inspect the actual table or column state in PostgreSQL.
2. Stamp Alembic to the version that matches reality.
3. Run `alembic upgrade head` again.
