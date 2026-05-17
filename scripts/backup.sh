#!/bin/bash
# AriaAI Database Backup Script
# Usage: crontab -e → 0 2 * * * /www/wwwroot/AriaAI/scripts/backup.sh

set -euo pipefail

BACKUP_DIR="/www/wwwroot/AriaAI/backups"
DB_NAME="ariaai"
DB_USER="postgres"
DB_HOST="localhost"
KEEP_DAYS=7
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/${DB_NAME}_${DATE}.sql.gz"

mkdir -p "$BACKUP_DIR"

# Dump and compress
pg_dump -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" | gzip > "$BACKUP_FILE"

# Verify
if [ ! -s "$BACKUP_FILE" ]; then
    echo "[${DATE}] ERROR: Backup file is empty" >> "${BACKUP_DIR}/backup.log"
    exit 1
fi

SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
echo "[${DATE}] OK: ${BACKUP_FILE} (${SIZE})" >> "${BACKUP_DIR}/backup.log"

# Rotate: delete backups older than KEEP_DAYS
find "$BACKUP_DIR" -name "${DB_NAME}_*.sql.gz" -mtime +${KEEP_DAYS} -delete

echo "[${DATE}] Rotation complete (kept ${KEEP_DAYS} days)" >> "${BACKUP_DIR}/backup.log"
