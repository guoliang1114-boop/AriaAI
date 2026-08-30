"""Canonical client-name identity and PostgreSQL namespace serialization."""
from __future__ import annotations

from typing import Any, Iterable

from sqlalchemy import func
from sqlmodel import Session, select


# This is the exact set stripped by Python 3.9 ``str.strip()``. Supplying the
# characters explicitly keeps SQLite and PostgreSQL normalization identical.
CLIENT_IDENTITY_TRIM_CHARS = (
    " \t\n\r\v\f"
    "\x1c\x1d\x1e\x1f\x85\xa0\u1680"
    "\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a"
    "\u2028\u2029\u202f\u205f\u3000"
)
CLIENT_IDENTITY_LOCK_NAMESPACE = "aria.client-identity.v1"


def client_identity_expression(column: Any) -> Any:
    """Return the shared database expression for client-name identity."""

    return func.lower(func.trim(column, CLIENT_IDENTITY_TRIM_CHARS))


def resolve_client_identity(session: Session, value: str | None) -> str:
    """Normalize one value with the active database's exact SQL semantics."""

    identity = session.exec(select(client_identity_expression(str(value or "")))).one()
    return str(identity or "")


def lock_client_identity_namespaces(
    session: Session,
    identities: Iterable[str],
) -> None:
    """Serialize client/project relationship predicates for this transaction.

    PostgreSQL row locks cannot protect rows that do not exist or do not yet
    match a normalized-name predicate. Every Aria writer that can create or
    change that predicate therefore takes the same transaction-scoped advisory
    lock before any Project or ClientRecord row lock. SQLite remains a no-op;
    it is used only by isolated tests and local development.
    """

    bind = getattr(session, "bind", None)
    if bind is None and hasattr(session, "get_bind"):
        bind = session.get_bind()
    dialect = getattr(bind, "dialect", None)
    if getattr(dialect, "name", "") != "postgresql":
        return

    # Empty/whitespace-only names share one real namespace too. Skipping it
    # would leave blank-name client updates on a different lock order from
    # project/candidate writers and reopen a deadlock/TOCTOU window.
    normalized = sorted({str(identity) for identity in identities})
    for identity in normalized:
        lock_key = f"{CLIENT_IDENTITY_LOCK_NAMESPACE}:{identity}"
        session.exec(
            select(
                func.pg_advisory_xact_lock(
                    func.hashtextextended(lock_key, 0)
                )
            )
        ).one()


def lock_client_identity_values(
    session: Session,
    values: Iterable[str | None],
) -> list[str]:
    """Normalize values, lock their distinct namespaces, and preserve order."""

    identities = [resolve_client_identity(session, value) for value in values]
    lock_client_identity_namespaces(session, identities)
    return identities
