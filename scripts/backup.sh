#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# MyFinPro Database Backup Script
# Creates compressed MySQL backups with retention policy management
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/../infrastructure/backup/backup.env"

# Load environment file if it exists
if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
fi

# Configuration with defaults
BACKUP_DIR="${BACKUP_DIR:-/var/backups/myfinpro}"
BACKUP_RETENTION_DAILY="${BACKUP_RETENTION_DAILY:-7}"
BACKUP_RETENTION_WEEKLY="${BACKUP_RETENTION_WEEKLY:-4}"
MYSQL_HOST="${MYSQL_HOST:-localhost}"
MYSQL_PORT="${MYSQL_PORT:-3306}"
MYSQL_USER="${MYSQL_USER:-myfinpro}"
MYSQL_PASSWORD="${MYSQL_PASSWORD:-}"
MYSQL_DATABASE="${MYSQL_DATABASE:-myfinpro}"
DOCKER_CONTAINER_NAME="${DOCKER_CONTAINER_NAME:-myfinpro-mysql-1}"

USE_DOCKER=false
LOG_PREFIX="[backup]"

# =============================================================================
# Functions
# =============================================================================

usage() {
  cat <<EOF
Usage: $(basename "$0") [OPTIONS]

Creates a compressed MySQL database backup with retention policy.

Options:
  --docker              Use Docker container for mysqldump
  --output-dir DIR      Backup output directory (default: $BACKUP_DIR)
  --container NAME      Docker container name (default: $DOCKER_CONTAINER_NAME)
  --host HOST           MySQL host (default: $MYSQL_HOST)
  --port PORT           MySQL port (default: $MYSQL_PORT)
  --user USER           MySQL user (default: $MYSQL_USER)
  --database DB         MySQL database (default: $MYSQL_DATABASE)
  --retention-daily N   Keep last N daily backups (default: $BACKUP_RETENTION_DAILY)
  --retention-weekly N  Keep last N weekly backups (default: $BACKUP_RETENTION_WEEKLY)
  --help                Show this help message

Environment variables:
  BACKUP_DIR, BACKUP_RETENTION_DAILY, BACKUP_RETENTION_WEEKLY,
  MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE,
  DOCKER_CONTAINER_NAME

Exit codes:
  0  Backup completed successfully
  1  Backup failed
  2  Invalid arguments
EOF
  exit 0
}

log() {
  echo "$LOG_PREFIX $(date '+%Y-%m-%d %H:%M:%S') $*"
}

log_error() {
  echo "$LOG_PREFIX $(date '+%Y-%m-%d %H:%M:%S') ERROR: $*" >&2
}

die() {
  log_error "$@"
  exit 1
}

# Parse command-line arguments
parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --docker)
        USE_DOCKER=true
        shift
        ;;
      --output-dir)
        BACKUP_DIR="$2"
        shift 2
        ;;
      --container)
        DOCKER_CONTAINER_NAME="$2"
        shift 2
        ;;
      --host)
        MYSQL_HOST="$2"
        shift 2
        ;;
      --port)
        MYSQL_PORT="$2"
        shift 2
        ;;
      --user)
        MYSQL_USER="$2"
        shift 2
        ;;
      --database)
        MYSQL_DATABASE="$2"
        shift 2
        ;;
      --retention-daily)
        BACKUP_RETENTION_DAILY="$2"
        shift 2
        ;;
      --retention-weekly)
        BACKUP_RETENTION_WEEKLY="$2"
        shift 2
        ;;
      --help)
        usage
        ;;
      *)
        die "Unknown option: $1. Use --help for usage information."
        ;;
    esac
  done
}

# Ensure backup directory exists
ensure_backup_dir() {
  if [[ ! -d "$BACKUP_DIR" ]]; then
    log "Creating backup directory: $BACKUP_DIR"
    mkdir -p "$BACKUP_DIR" || die "Failed to create backup directory: $BACKUP_DIR"
  fi
}

# Perform the database dump
perform_dump() {
  local backup_file="$1"
  local tmp_file="${backup_file}.tmp"

  log "Starting backup of database '$MYSQL_DATABASE'..."

  if [[ "$USE_DOCKER" == "true" ]]; then
    log "Using Docker container: $DOCKER_CONTAINER_NAME"
    docker exec "$DOCKER_CONTAINER_NAME" \
      mysqldump \
        --user="$MYSQL_USER" \
        --password="$MYSQL_PASSWORD" \
        --single-transaction \
        --routines \
        --triggers \
        --events \
        --set-gtid-purged=OFF \
        "$MYSQL_DATABASE" 2>/dev/null | gzip > "$tmp_file"
  else
    log "Using direct MySQL connection: $MYSQL_HOST:$MYSQL_PORT"
    mysqldump \
      --host="$MYSQL_HOST" \
      --port="$MYSQL_PORT" \
      --user="$MYSQL_USER" \
      --password="$MYSQL_PASSWORD" \
      --single-transaction \
      --routines \
      --triggers \
      --events \
      --set-gtid-purged=OFF \
      "$MYSQL_DATABASE" 2>/dev/null | gzip > "$tmp_file"
  fi

  # Verify the dump produced a non-empty file
  if [[ ! -s "$tmp_file" ]]; then
    rm -f "$tmp_file"
    die "Backup file is empty — mysqldump may have failed"
  fi

  # Verify gzip integrity
  if ! gzip -t "$tmp_file" 2>/dev/null; then
    rm -f "$tmp_file"
    die "Backup file failed gzip integrity check"
  fi

  mv "$tmp_file" "$backup_file"
  local size
  size=$(du -h "$backup_file" | cut -f1)
  log "Backup created: $backup_file ($size)"
}

# Clean up old backups according to retention policy
cleanup_old_backups() {
  log "Applying retention policy: keep $BACKUP_RETENTION_DAILY daily, $BACKUP_RETENTION_WEEKLY weekly"

  local all_backups
  all_backups=$(find "$BACKUP_DIR" -name 'myfinpro_*.sql.gz' -type f | sort -r)

  if [[ -z "$all_backups" ]]; then
    log "No backups found to clean up"
    return
  fi

  local daily_kept=0
  local weekly_kept=0
  local last_weekly_marker=""

  while IFS= read -r backup_path; do
    local filename
    filename=$(basename "$backup_path")

    # Extract date from filename: myfinpro_YYYY-MM-DD_HH-MM-SS.sql.gz
    local date_part
    date_part=$(echo "$filename" | sed -n 's/myfinpro_\([0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\}\)_.*/\1/p')

    if [[ -z "$date_part" ]]; then
      continue
    fi

    # Determine ISO week identifier (YYYY-WNN)
    local week_marker
    week_marker=$(date -d "$date_part" '+%G-W%V' 2>/dev/null || echo "unknown")

    local keep=false

    # Keep as daily backup
    if [[ $daily_kept -lt $BACKUP_RETENTION_DAILY ]]; then
      keep=true
      daily_kept=$((daily_kept + 1))
    fi

    # Keep as weekly backup (first backup of each week)
    if [[ "$week_marker" != "$last_weekly_marker" && $weekly_kept -lt $BACKUP_RETENTION_WEEKLY ]]; then
      keep=true
      weekly_kept=$((weekly_kept + 1))
      last_weekly_marker="$week_marker"
    fi

    if [[ "$keep" == "false" ]]; then
      log "Removing old backup: $filename"
      rm -f "$backup_path"
    fi
  done <<< "$all_backups"

  log "Retention cleanup complete (kept $daily_kept daily, $weekly_kept weekly)"
}

# =============================================================================
# Main
# =============================================================================

main() {
  parse_args "$@"
  ensure_backup_dir

  local timestamp
  timestamp=$(date '+%Y-%m-%d_%H-%M-%S')
  local backup_file="${BACKUP_DIR}/myfinpro_${timestamp}.sql.gz"

  perform_dump "$backup_file"
  cleanup_old_backups

  log "Backup completed successfully"
  exit 0
}

main "$@"
