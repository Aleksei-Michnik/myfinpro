#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# MyFinPro Database Restore Script
# Restores a MySQL database from a compressed backup file
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/../infrastructure/backup/backup.env"

# Load environment file if it exists
if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
fi

# Configuration with defaults
MYSQL_HOST="${MYSQL_HOST:-localhost}"
MYSQL_PORT="${MYSQL_PORT:-3306}"
MYSQL_USER="${MYSQL_USER:-myfinpro}"
MYSQL_PASSWORD="${MYSQL_PASSWORD:-}"
MYSQL_DATABASE="${MYSQL_DATABASE:-myfinpro}"
DOCKER_CONTAINER_NAME="${DOCKER_CONTAINER_NAME:-myfinpro-mysql-1}"

USE_DOCKER=false
FORCE=false
BACKUP_FILE=""
LOG_PREFIX="[restore]"

# =============================================================================
# Functions
# =============================================================================

usage() {
  cat <<EOF
Usage: $(basename "$0") <backup-file> [OPTIONS]

Restores a MySQL database from a .sql.gz backup file.

Arguments:
  backup-file           Path to the .sql.gz backup file to restore

Options:
  --docker              Use Docker container for mysql client
  --force               Skip confirmation prompt
  --container NAME      Docker container name (default: $DOCKER_CONTAINER_NAME)
  --host HOST           MySQL host (default: $MYSQL_HOST)
  --port PORT           MySQL port (default: $MYSQL_PORT)
  --user USER           MySQL user (default: $MYSQL_USER)
  --database DB         MySQL database (default: $MYSQL_DATABASE)
  --help                Show this help message

Environment variables:
  MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE,
  DOCKER_CONTAINER_NAME

Exit codes:
  0  Restore completed successfully
  1  Restore failed
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
      --force)
        FORCE=true
        shift
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
      --help)
        usage
        ;;
      -*)
        die "Unknown option: $1. Use --help for usage information."
        ;;
      *)
        if [[ -z "$BACKUP_FILE" ]]; then
          BACKUP_FILE="$1"
        else
          die "Unexpected argument: $1. Use --help for usage information."
        fi
        shift
        ;;
    esac
  done

  if [[ -z "$BACKUP_FILE" ]]; then
    die "Backup file argument is required. Use --help for usage information."
  fi
}

# Verify backup file before restoring
verify_backup_file() {
  log "Verifying backup file: $BACKUP_FILE"

  if [[ ! -f "$BACKUP_FILE" ]]; then
    die "Backup file not found: $BACKUP_FILE"
  fi

  if [[ ! -r "$BACKUP_FILE" ]]; then
    die "Backup file is not readable: $BACKUP_FILE"
  fi

  if [[ ! -s "$BACKUP_FILE" ]]; then
    die "Backup file is empty: $BACKUP_FILE"
  fi

  # Check file extension
  if [[ "$BACKUP_FILE" != *.sql.gz ]]; then
    die "Backup file must have .sql.gz extension: $BACKUP_FILE"
  fi

  # Verify gzip integrity
  if ! gzip -t "$BACKUP_FILE" 2>/dev/null; then
    die "Backup file failed gzip integrity check: $BACKUP_FILE"
  fi

  local size
  size=$(du -h "$BACKUP_FILE" | cut -f1)
  log "Backup file verified: $size"
}

# Prompt for confirmation
confirm_restore() {
  if [[ "$FORCE" == "true" ]]; then
    return 0
  fi

  local size
  size=$(du -h "$BACKUP_FILE" | cut -f1)

  echo ""
  echo "╔══════════════════════════════════════════════════════════╗"
  echo "║                    ⚠ WARNING ⚠                         ║"
  echo "║  This will OVERWRITE the database '$MYSQL_DATABASE'"
  echo "║  with data from: $(basename "$BACKUP_FILE")"
  echo "║  File size: $size"
  echo "║                                                          ║"
  echo "║  This action cannot be undone!                           ║"
  echo "╚══════════════════════════════════════════════════════════╝"
  echo ""

  read -rp "Are you sure you want to continue? (yes/no): " answer
  if [[ "$answer" != "yes" ]]; then
    log "Restore cancelled by user"
    exit 0
  fi
}

# Perform the restore
perform_restore() {
  log "Starting restore of database '$MYSQL_DATABASE' from $(basename "$BACKUP_FILE")..."

  if [[ "$USE_DOCKER" == "true" ]]; then
    log "Using Docker container: $DOCKER_CONTAINER_NAME"
    gunzip -c "$BACKUP_FILE" | docker exec -i "$DOCKER_CONTAINER_NAME" \
      mysql \
        --user="$MYSQL_USER" \
        --password="$MYSQL_PASSWORD" \
        "$MYSQL_DATABASE" 2>/dev/null
  else
    log "Using direct MySQL connection: $MYSQL_HOST:$MYSQL_PORT"
    gunzip -c "$BACKUP_FILE" | mysql \
      --host="$MYSQL_HOST" \
      --port="$MYSQL_PORT" \
      --user="$MYSQL_USER" \
      --password="$MYSQL_PASSWORD" \
      "$MYSQL_DATABASE" 2>/dev/null
  fi

  log "Restore completed successfully"
}

# =============================================================================
# Main
# =============================================================================

main() {
  parse_args "$@"
  verify_backup_file
  confirm_restore
  perform_restore
  exit 0
}

main "$@"
