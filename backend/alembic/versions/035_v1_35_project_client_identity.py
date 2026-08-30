"""V1.35 - Stable Project to ClientRecord identity.

The stable-entity identity boundary adapts the world-state identity principle
from OpenAI Codex ``codex-rs/core/src/context/world_state/mod.rs`` at upstream
commit ``83d1fe0e67b1323f71febc2925817732b449f1d9`` (Apache License 2.0).
The schema and compatibility migration are Aria-native; no Codex runtime,
protocol, SDK, or communication is used.

Revision ID: 035_v1_35
Revises: 034_v1_34
Create Date: 2026-08-30
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "035_v1_35"
down_revision = "034_v1_34"
branch_labels = None
depends_on = None

CLIENT_IDENTITY_TRIM_CHARS = (
    " \t\n\r\v\f"
    "\x1c\x1d\x1e\x1f\x85\xa0\u1680"
    "\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a"
    "\u2028\u2029\u202f\u205f\u3000"
)
FK_NAME = "fk_project_client_id_clientrecord"
INDEX_NAME = "ix_project_client_id"
CLIENT_CREATOR_FK_NAME = "fk_clientrecord_created_by_user_id_user"
CLIENT_CREATOR_INDEX_NAME = "ix_clientrecord_created_by_user_id"


def _tables() -> set[str]:
    return set(inspect(op.get_bind()).get_table_names())


def _columns(table_name: str) -> set[str]:
    if table_name not in _tables():
        return set()
    return {
        str(column["name"])
        for column in inspect(op.get_bind()).get_columns(table_name)
    }


def _indexes(table_name: str) -> set[str]:
    if table_name not in _tables():
        return set()
    return {
        str(index["name"])
        for index in inspect(op.get_bind()).get_indexes(table_name)
    }


def _foreign_keys(table_name: str) -> list[dict]:
    if table_name not in _tables():
        return []
    return list(inspect(op.get_bind()).get_foreign_keys(table_name))


def _is_set_null_foreign_key(
    foreign_key: dict,
    *,
    column_name: str,
    referred_table: str,
) -> bool:
    columns = [str(value) for value in foreign_key.get("constrained_columns") or []]
    referred_columns = [
        str(value) for value in foreign_key.get("referred_columns") or []
    ]
    ondelete = str((foreign_key.get("options") or {}).get("ondelete") or "")
    return (
        columns == [column_name]
        and str(foreign_key.get("referred_table") or "") == referred_table
        and (not referred_columns or referred_columns == ["id"])
        and ondelete.upper().replace("_", " ") == "SET NULL"
    )


def _repair_set_null_foreign_key(
    *,
    table_name: str,
    column_name: str,
    referred_table: str,
    constraint_name: str,
) -> None:
    """Replace partial/legacy FK variants without stacking constraints."""

    matching = [
        foreign_key
        for foreign_key in _foreign_keys(table_name)
        if [
            str(value)
            for value in foreign_key.get("constrained_columns") or []
        ]
        == [column_name]
    ]
    compatible = any(
        _is_set_null_foreign_key(
            foreign_key,
            column_name=column_name,
            referred_table=referred_table,
        )
        for foreign_key in matching
    )
    for foreign_key in matching:
        if _is_set_null_foreign_key(
            foreign_key,
            column_name=column_name,
            referred_table=referred_table,
        ):
            continue
        existing_name = str(foreign_key.get("name") or "")
        if not existing_name:
            raise RuntimeError(
                f"Cannot repair unnamed foreign key on {table_name}.{column_name}"
            )
        op.drop_constraint(existing_name, table_name, type_="foreignkey")
    if not compatible:
        op.create_foreign_key(
            constraint_name,
            table_name,
            referred_table,
            [column_name],
            ["id"],
            ondelete="SET NULL",
        )


def _backfill_unique_client_links() -> None:
    if not {"project", "clientrecord"}.issubset(_tables()):
        return
    if "client_id" not in _columns("project"):
        return

    bind = op.get_bind()
    client = sa.table(
        "clientrecord",
        sa.column("id", sa.Integer()),
        sa.column("name", sa.String()),
    )
    project = sa.table(
        "project",
        sa.column("id", sa.Integer()),
        sa.column("client", sa.String()),
        sa.column("client_id", sa.Integer()),
    )
    identity_expression = lambda column: sa.func.lower(
        sa.func.trim(column, CLIENT_IDENTITY_TRIM_CHARS)
    )

    client_rows = bind.execute(
        sa.select(
            client.c.id,
            identity_expression(client.c.name).label("identity"),
        ).order_by(client.c.id)
    ).mappings().all()
    client_ids_by_identity: dict[str, list[int]] = {}
    for row in client_rows:
        identity = str(row.get("identity") or "")
        if identity:
            client_ids_by_identity.setdefault(identity, []).append(int(row["id"]))
    unique_client_ids = {
        identity: ids[0]
        for identity, ids in client_ids_by_identity.items()
        if len(ids) == 1
    }
    if not unique_client_ids:
        return

    project_rows = bind.execute(
        sa.select(
            project.c.id,
            identity_expression(project.c.client).label("identity"),
        ).where(project.c.client_id.is_(None))
    ).mappings().all()
    for row in project_rows:
        client_id = unique_client_ids.get(str(row.get("identity") or ""))
        if client_id is None:
            continue
        bind.execute(
            project.update()
            .where(project.c.id == int(row["id"]))
            .where(project.c.client_id.is_(None))
            .values(client_id=client_id)
        )


def upgrade() -> None:
    tables = _tables()
    if "clientrecord" in tables:
        if "created_by_user_id" not in _columns("clientrecord"):
            op.add_column(
                "clientrecord",
                sa.Column("created_by_user_id", sa.Integer(), nullable=True),
            )
        if CLIENT_CREATOR_INDEX_NAME not in _indexes("clientrecord"):
            op.create_index(
                CLIENT_CREATOR_INDEX_NAME,
                "clientrecord",
                ["created_by_user_id"],
                unique=False,
            )
        if "user" in tables and op.get_bind().dialect.name != "sqlite":
            _repair_set_null_foreign_key(
                table_name="clientrecord",
                column_name="created_by_user_id",
                referred_table="user",
                constraint_name=CLIENT_CREATOR_FK_NAME,
            )
    if "project" not in tables:
        return
    added_client_id_column = "client_id" not in _columns("project")
    if added_client_id_column:
        op.add_column("project", sa.Column("client_id", sa.Integer(), nullable=True))

    if added_client_id_column:
        _backfill_unique_client_links()

    if INDEX_NAME not in _indexes("project"):
        op.create_index(INDEX_NAME, "project", ["client_id"], unique=False)

    # SQLite cannot add a foreign key constraint to an existing table without
    # rebuilding it. Test databases created from SQLModel metadata still carry
    # the constraint; deployed PostgreSQL receives the named SET NULL FK here.
    if "clientrecord" in tables and op.get_bind().dialect.name != "sqlite":
        _repair_set_null_foreign_key(
            table_name="project",
            column_name="client_id",
            referred_table="clientrecord",
            constraint_name=FK_NAME,
        )


def downgrade() -> None:
    if "project" in _tables() and "client_id" in _columns("project"):
        foreign_key_names = {
            str(foreign_key.get("name") or "")
            for foreign_key in _foreign_keys("project")
        }
        if op.get_bind().dialect.name != "sqlite" and FK_NAME in foreign_key_names:
            op.drop_constraint(FK_NAME, "project", type_="foreignkey")
        if INDEX_NAME in _indexes("project"):
            op.drop_index(INDEX_NAME, table_name="project")
        if op.get_bind().dialect.name == "sqlite":
            with op.batch_alter_table("project") as batch_op:
                batch_op.drop_column("client_id")
        else:
            op.drop_column("project", "client_id")

    if "clientrecord" not in _tables() or "created_by_user_id" not in _columns("clientrecord"):
        return
    client_foreign_key_names = {
        str(foreign_key.get("name") or "")
        for foreign_key in _foreign_keys("clientrecord")
    }
    if (
        op.get_bind().dialect.name != "sqlite"
        and CLIENT_CREATOR_FK_NAME in client_foreign_key_names
    ):
        op.drop_constraint(
            CLIENT_CREATOR_FK_NAME,
            "clientrecord",
            type_="foreignkey",
        )
    if CLIENT_CREATOR_INDEX_NAME in _indexes("clientrecord"):
        op.drop_index(CLIENT_CREATOR_INDEX_NAME, table_name="clientrecord")
    if op.get_bind().dialect.name == "sqlite":
        with op.batch_alter_table("clientrecord") as batch_op:
            batch_op.drop_column("created_by_user_id")
    else:
        op.drop_column("clientrecord", "created_by_user_id")
