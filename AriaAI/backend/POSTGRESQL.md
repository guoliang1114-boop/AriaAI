# PostgreSQL Setup

AriaAI backend now defaults to PostgreSQL.

## Default connection

```env
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/ariaai
```

## Recommended steps

1. Create the database:

```sql
CREATE DATABASE ariaai;
```

2. Put your real connection string into `backend/.env`.

3. Start the backend from `backend/start.ps1` or `backend/start.sh`.

4. If this is a fresh database, the app will create tables on startup.

## Notes

- Alembic is already configured and reads `DATABASE_URL` from `app.config`.
- SQLite is still technically supported as an explicit fallback, but it is no longer the default.
