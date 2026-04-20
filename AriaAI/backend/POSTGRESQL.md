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
- After every deployment that changes backend models or routers, run the migration governance report before applying migrations.
- If code has already created tables or columns manually and Alembic version is behind, use the governance report to decide whether to run the additive safety script or a manual `alembic stamp`.
- Do not auto-stamp a production database unless the real schema has been inspected and confirmed to match the target revision.

## Migration governance workflow

Use the wrapper script for normal operations:

```bash
cd AriaAI/backend
python scripts/migration_governance.py report
python scripts/migration_governance.py check
python scripts/migration_governance.py ensure
python scripts/migration_governance.py upgrade
```

Recommended deployment order:

1. `python scripts/migration_governance.py report`
2. If the database is `lightweight`, run `python scripts/migration_governance.py ensure` first.
3. If the database is Alembic-managed and has pending revisions, run `python scripts/migration_governance.py upgrade`.
4. Verify with `python scripts/migration_governance.py check`.
5. Verify the public health endpoint: `GET /health/db/migrations`.

Script actions:

| Action | Purpose |
|---|---|
| `report` | Print database mode, current revision, latest revision, and pending revisions. |
| `json` | Print the full `/health/db`-style payload for logs or automation. |
| `check` | Exit non-zero if an Alembic-managed database has pending revisions or a legacy lightweight database needs governance. |
| `ensure` | Run additive idempotent schema guards and stamp an empty/missing `alembic_version` to the local latest revision. |
| `upgrade` | Run `alembic upgrade head` with before/after governance output. |
| `current` | Run `alembic current` with governance output. |

## Common failure mode

If you see errors like:

- `relation "...\" already exists`
- `column "...\" already exists`
- `column "...\" does not exist`
- `Can't locate revision identified by '005'`
- `current_revision: 005_v1_5` with `latest_revision: 005`

then the most likely cause is schema drift between the real database and the `alembic_version` table.

In that case:

1. Inspect the actual table or column state in PostgreSQL.
2. Run `python scripts/migration_governance.py report`.
3. If the schema is a known legacy lightweight schema, run `python scripts/migration_governance.py ensure`.
4. Only if the schema has been manually verified, stamp Alembic to the version that matches reality.
5. Run `python scripts/migration_governance.py upgrade` again.

## Revision alias repair SOP

Some historical deployments used short filename prefixes such as `005` instead of the real Alembic revision ID `005_v1_5`.
When that happens, Alembic may report pending revisions even though the schema is already at the expected version, or fail because the short revision is unknown.

Use this safe repair flow:

```bash
cd AriaAI/backend
python scripts/migration_governance.py report
python scripts/migration_governance.py ensure
python scripts/migration_governance.py upgrade
python scripts/migration_governance.py check
```

`ensure` normalizes a single short `alembic_version` alias to the matching full local revision ID, for example `005` -> `005_v1_5`.
It does not auto-stamp an existing non-empty revision to an unrelated head.

If `check` still reports pending revisions after `ensure`:

1. Run `alembic current` and `alembic heads`.
2. Confirm whether the database schema really includes the objects from each pending migration.
3. If schema and data have been manually verified, run an explicit `alembic stamp <revision>` using the full revision ID.
4. Re-run `python scripts/migration_governance.py check`.
