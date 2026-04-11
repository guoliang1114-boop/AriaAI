#!/usr/bin/env python3
"""测试数据库连接"""
import os
import sys
from pathlib import Path

# 加载 .env 文件
env_path = Path(__file__).parent / ".env"
if env_path.exists():
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                key, value = line.split('=', 1)
                os.environ[key] = value

from app.config import DATABASE_URL

print(f"当前数据库配置: {DATABASE_URL}")
print(f"数据库类型: {'SQLite' if DATABASE_URL.startswith('sqlite') else 'PostgreSQL'}")
print()

if DATABASE_URL.startswith("postgresql"):
    try:
        import psycopg2
        conn = psycopg2.connect(DATABASE_URL, connect_timeout=10)
        cur = conn.cursor()
        
        # 测试连接
        cur.execute("SELECT version();")
        version = cur.fetchone()[0]
        print(f"✅ 连接成功!")
        print(f"   PostgreSQL: {version}")
        
        # 测试数据库权限
        cur.execute("SELECT current_database(), current_user;")
        db, user = cur.fetchone()
        print(f"   数据库: {db}")
        print(f"   用户: {user}")
        
        # 检查现有表
        cur.execute("""
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public'
        """)
        tables = cur.fetchall()
        if tables:
            print(f"\n   现有表 ({len(tables)}个):")
            for (table,) in tables:
                print(f"     - {table}")
        else:
            print("\n   数据库为空，需要初始化表")
        
        cur.close()
        conn.close()
        
        print("\n✅ 数据库连接测试通过!")
        sys.exit(0)
        
    except ImportError:
        print("❌ 缺少 psycopg2，请安装: pip install psycopg2-binary")
        sys.exit(1)
    except Exception as e:
        print(f"❌ 连接失败: {e}")
        sys.exit(1)
else:
    print("ℹ️ 使用 SQLite 本地数据库")
    print(f"   路径: {DATABASE_URL}")
