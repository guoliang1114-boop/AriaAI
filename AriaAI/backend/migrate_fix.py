#!/usr/bin/env python3
"""
修复版迁移脚本 - 处理 PostgreSQL 大小写问题
"""
import os
import sys

# 设置环境变量
os.environ["DATABASE_URL"] = "postgresql://postgres:4LsPEyLFeaj3ZdAy@85.137.244.146:5432/ariaai"

import psycopg2
from psycopg2.extras import RealDictCursor

# Supabase 连接信息
SUPABASE_HOST = "aws-1-ap-southeast-1.pooler.supabase.com"
SUPABASE_PORT = "6543"
SUPABASE_DB = "postgres"
SUPABASE_USER = "postgres.lhvomzvdozwairpibdpp"
SUPABASE_PASS = "Qweruiop@123"

# 生产数据库连接信息
PROD_DATABASE_URL = os.environ.get("DATABASE_URL")

# 表列表（按依赖顺序）
TABLES = [
    "template",
    "setting", 
    "user",
    "usertoken",
    "skill",
    "conversation",
    "message",
    "projectfolder",
    "project",
    "milestone",
    "projectpayment",
    "projectfile",
    "generatedfile",
    "toolcall",
    "scheduledtask",
    "clientrecord",
    "knowledgedocument",
    "documentchunk",
]


def get_supabase_connection():
    """连接到 Supabase"""
    return psycopg2.connect(
        host=SUPABASE_HOST,
        port=SUPABASE_PORT,
        database=SUPABASE_DB,
        user=SUPABASE_USER,
        password=SUPABASE_PASS,
        sslmode="require"
    )


def get_prod_connection():
    """连接到生产数据库"""
    return psycopg2.connect(PROD_DATABASE_URL)


def get_table_columns(conn, table_name):
    """获取表的列信息"""
    with conn.cursor() as cur:
        cur.execute("""
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = %s AND table_schema = 'public'
            ORDER BY ordinal_position
        """, (table_name.lower(),))
        return {row[0]: row[1] for row in cur.fetchall()}


def migrate_table(table_name):
    """迁移单个表"""
    print(f"\n{'='*60}")
    print(f"迁移表: {table_name}")
    print(f"{'='*60}")
    
    src_conn = None
    dst_conn = None
    
    try:
        # 分别连接源和目标数据库
        src_conn = get_supabase_connection()
        dst_conn = get_prod_connection()
        
        # 获取源表数据 - 使用小写表名，不加引号
        src_cur = src_conn.cursor()
        src_cur.execute(f"SELECT * FROM {table_name}")
        rows = src_cur.fetchall()
        
        if not rows:
            print(f"  表 {table_name} 没有数据，跳过")
            return True
            
        print(f"  源表 {table_name}: {len(rows)} 行数据")
        
        # 获取列名
        colnames = [desc[0] for desc in src_cur.description]
        print(f"  列: {', '.join(colnames)}")
        
        # 清空目标表 - 使用小写表名
        dst_cur = dst_conn.cursor()
        dst_cur.execute(f"TRUNCATE TABLE {table_name} CASCADE")
        dst_conn.commit()
        print(f"  已清空目标表 {table_name}")
        
        # 构建插入语句 - 列名不加引号
        columns_str = ', '.join(colnames)
        placeholders = ', '.join(['%s'] * len(colnames))
        insert_sql = f"INSERT INTO {table_name} ({columns_str}) VALUES ({placeholders})"
        
        # 批量插入
        count = 0
        for row in rows:
            try:
                dst_cur.execute(insert_sql, row)
                count += 1
                if count % 100 == 0:
                    dst_conn.commit()
                    print(f"  已插入 {count}/{len(rows)} 行...")
            except Exception as e:
                print(f"  插入行失败: {e}")
                print(f"  数据: {row}")
                raise
        
        dst_conn.commit()
        print(f"  ✓ 成功迁移 {count} 行数据到 {table_name}")
        
        src_cur.close()
        dst_cur.close()
        
        return True
        
    except Exception as e:
        print(f"  ✗ 迁移表 {table_name} 失败: {e}")
        if dst_conn:
            dst_conn.rollback()
        return False
    finally:
        if src_conn:
            src_conn.close()
        if dst_conn:
            dst_conn.close()


def main():
    print("开始数据库迁移 (修复版)...")
    print(f"源: Supabase ({SUPABASE_HOST})")
    print(f"目标: 生产服务器")
    print(f"表数量: {len(TABLES)}")
    
    success_count = 0
    fail_count = 0
    failed_tables = []
    
    for table in TABLES:
        if migrate_table(table):
            success_count += 1
        else:
            fail_count += 1
            failed_tables.append(table)
    
    print(f"\n{'='*60}")
    print("迁移完成!")
    print(f"成功: {success_count} 个表")
    print(f"失败: {fail_count} 个表")
    if failed_tables:
        print(f"失败的表: {', '.join(failed_tables)}")
    print(f"{'='*60}")
    
    return fail_count == 0


if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)
