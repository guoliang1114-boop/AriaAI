#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="/www/wwwroot/AriaAI/backups"
LOG_FILE="/www/wwwroot/AriaAI/logs/backup.log"
RETENTION_DAYS=7
DB_NAME="ariaai"
DB_USER="postgres"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/${DB_NAME}_${TIMESTAMP}.sql.gz"

mkdir -p "$BACKUP_DIR"
mkdir -p "$(dirname "$LOG_FILE")"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG_FILE"
}

log "Starting backup of database '$DB_NAME'"

if pg_dump -U "$DB_USER" -d "$DB_NAME" | gzip > "$BACKUP_FILE"; then
    SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
    log "Backup completed: $BACKUP_FILE ($SIZE)"
else
    log "ERROR: Backup failed"
    rm -f "$BACKUP_FILE"
    exit 1
fi

DELETED=$(find "$BACKUP_DIR" -name "${DB_NAME}_*.sql.gz" -mtime +${RETENTION_DAYS} -delete -print | wc -l | tr -d ' ')
if [ "$DELETED" -gt 0 ]; then
    log "Cleaned up $DELETED backup(s) older than ${RETENTION_DAYS} days"
fi

log "Backup process finished"
