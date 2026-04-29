"""
SQLite → PostgreSQL 数据迁移脚本
在服务器上运行：python3 migrate_to_pg.py
要求：
  - data/ariaai.db  存在（SQLite 原始数据）
  - DATABASE_URL 环境变量指向 PG，或使用默认值
"""
import sqlite3
import sys
from pathlib import Path
from datetime import datetime

BASE_DIR = Path(__file__).parent

# ── 连接 ──────────────────────────────────────────────────────
SQLITE_PATH = BASE_DIR / "data" / "ariaai.db"
if not SQLITE_PATH.exists():
    print("✓ SQLite 文件不存在，跳过数据迁移（全新部署）")
    sys.exit(0)

import os
PG_URL = os.getenv("DATABASE_URL")
if not PG_URL:
    print("DATABASE_URL is required. Set it in the environment; do not commit real credentials.")
    sys.exit(1)

try:
    import psycopg2
    from psycopg2.extras import execute_values
except ImportError:
    print("✗ 请先安装 psycopg2-binary")
    sys.exit(1)

print(f"  SQLite: {SQLITE_PATH}")
print(f"  PostgreSQL: {PG_URL.split('@')[-1]}")
print()

sq = sqlite3.connect(str(SQLITE_PATH))
sq.row_factory = sqlite3.Row

pg = psycopg2.connect(PG_URL)
pg.autocommit = False
cur = pg.cursor()


# SQLite 中用 0/1 存储的布尔列
BOOL_COLUMNS = {"is_done", "is_enabled", "is_admin", "is_active"}


def migrate_table(table: str, columns: list[str], pk: str = "id"):
    sq_rows = sq.execute(f"SELECT * FROM {table}").fetchall()
    if not sq_rows:
        print(f"  {table}: 空表，跳过")
        return

    col_str = ", ".join(columns)

    rows = []
    for r in sq_rows:
        row = []
        for c in columns:
            val = r[c] if c in r.keys() else None
            # 将 0/1 转为 Python bool，PostgreSQL 接受 True/False
            if c in BOOL_COLUMNS and val is not None:
                val = bool(val)
            row.append(val)
        rows.append(tuple(row))

    # PG 保留关键字需加双引号
    qt = f'"{table}"'

    # 清空目标表（幂等）
    cur.execute(f"DELETE FROM {qt}")

    execute_values(
        cur,
        f"INSERT INTO {qt} ({col_str}) VALUES %s",
        rows,
    )

    # 重置 PG 自增序列
    if pk:
        cur.execute(f"""
            SELECT setval(
                pg_get_serial_sequence('{table}', '{pk}'),
                COALESCE((SELECT MAX({pk}) FROM {qt}), 1)
            )
        """)

    print(f"  ✓ {table}: {len(rows)} 行")


# ── 按外键依赖顺序迁移 ────────────────────────────────────────
print("开始迁移...")

migrate_table("clientrecord", ["id","name","industry","contact","notes","created_at"])
migrate_table("project",      ["id","name","client","description","status","context_freshness","contract_amount","created_at","updated_at"])
migrate_table("projectfolder",["id","project_id","name","sort_order"])
migrate_table("milestone",    ["id","project_id","title","is_done","priority","due_date"])
migrate_table("projectpayment",["id","project_id","amount","payment_date","note","payment_type","created_at"])
migrate_table("projectfile",  ["id","project_id","folder_id","name","file_type","path","size_bytes","uploaded_at"])
migrate_table("skill",        ["id","name","category","description","system_prompt","user_template","estimated_time","tools_json"])
migrate_table("conversation", ["id","title","project_id","skill_id","created_at","updated_at"])
migrate_table("message",      ["id","conversation_id","role","content","created_at"])
migrate_table("knowledgedocument", ["id","name","file_type","path","category","vector_status","vector_progress","chunk_count","uploaded_at","client_id"])
migrate_table("documentchunk",["id","document_id","chunk_index","content","embedding_json"])
migrate_table("scheduledtask",["id","name","project_id","skill_id","prompt","frequency","cron_expr","is_enabled","status","last_run","next_run","created_at"])
migrate_table("template",     ["id","name","category","file_type","path","tags_json","status","uploaded_at"])
migrate_table("setting",      ["key","value"], pk="")
migrate_table("user",         ["id","email","display_name","password_hash","is_admin","is_active","auth_token","created_at"])

pg.commit()
sq.close()
pg.close()

print()
print("✓ 数据迁移完成")
