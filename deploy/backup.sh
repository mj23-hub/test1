#!/usr/bin/env bash
# data/attendance.db の簡易バックアップスクリプト
# cronで定期実行する例:
#   0 3 * * * /opt/committee-attendance/deploy/backup.sh >> /var/log/committee-attendance-backup.log 2>&1

set -euo pipefail

APP_DIR="/opt/committee-attendance"
BACKUP_DIR="$APP_DIR/backups"
DB_FILE="$APP_DIR/data/attendance.db"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
KEEP_DAYS=30

mkdir -p "$BACKUP_DIR"

if [ ! -f "$DB_FILE" ]; then
  echo "DBファイルが見つかりません: $DB_FILE" >&2
  exit 1
fi

# better-sqlite3のWALファイルも含めて整合性を保つため、sqlite3のバックアップコマンドを使用
if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "$DB_FILE" ".backup '$BACKUP_DIR/attendance_${TIMESTAMP}.db'"
else
  cp "$DB_FILE" "$BACKUP_DIR/attendance_${TIMESTAMP}.db"
fi

find "$BACKUP_DIR" -name 'attendance_*.db' -mtime "+${KEEP_DAYS}" -delete

echo "バックアップ完了: $BACKUP_DIR/attendance_${TIMESTAMP}.db"
