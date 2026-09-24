#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# MyFinPro Database Restore Script
# Restores a MySQL database from a compressed backup file
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/backup-common.sh
source "${SCRIPT_DIR}/backup-common.sh"

MYSQL_HOST="${MYSQL_HOST:-}"
MYSQL_PORT="${MYSQL_PORT:-3306}"
MYSQL_USER="${MYSQL_USER:-root}"
MYSQL_DATABASE="${MYSQL_DATABASE:-}"

ENVIRONMENT=""
CONTAINER=""
FORCE=false
BACKUP_FILE=""
LOG_PREFIX="[restore]"

# =============================================================================
# Functions
# =============================================================================

usage() {
  cat <<USAGE
Usage: $(basename "$0") <backup-file> <production|staging> [OPTIONS]
       $(basename "$0") <backup-file> --container NAME [OPTIONS]
       $(basename "$0") <backup-file> --host HOST --database DB [OPTIONS]

Restores a MySQL database from a .sql.gz backup file. With an environment
name the restore runs inside that environment's MySQL container with the
container's own credentials, into the database the container was created for.

Arguments:
  backup-file           Path to the .sql.gz backup file to restore

Options:
  --force               Skip confirmation prompt
  --container NAME      Any MySQL container whose environment carries
                        MYSQL_ROOT_PASSWORD and MYSQL_DATABASE
  --host HOST           Direct connection instead of a container
  --port PORT           MySQL port (default: $MYSQL_PORT)
  --user USER           MySQL user (default: $MYSQL_USER)
  --database DB         Target database (direct connection; overrides the
                        container's own database when given with a container)
  --help                Show this help message

Environment variables:
  MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD (direct only), MYSQL_DATABASE

Exit codes:
  0  Restore completed successfully
  1  Restore failed
  2  Invalid arguments
USAGE
  exit 0
}

log() {
  echo "$LOG_PREFIX $(date '+%Y-%m-%d %H:%M:%S') $*"
}

log_error() {
  echo "$LOG_PREFIX $(date '+%Y-%m-%d %H:%M:%S') ERROR: $*" >&2
}

die() {
  log_error "$1"
  exit "${2:-1}"
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      production | staging)
        ENVIRONMENT="$1"
        shift
        ;;
      --force)
        FORCE=true
        shift
        ;;
      --container)
        CONTAINER="$2"
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
        die "Unknown option: $1. Use --help for usage information." 2
        ;;
      *)
        if [[ -z "$BACKUP_FILE" ]]; then
          BACKUP_FILE="$1"
        else
          die "Unexpected argument: $1. Use --help for usage information." 2
        fi
        shift
        ;;
    esac
  done

  [[ -n "$BACKUP_FILE" ]] || die "Backup file argument is required. Use --help for usage information." 2

  if [[ -n "$ENVIRONMENT" ]]; then
    CONTAINER="${CONTAINER:-$(backup_env_container "$ENVIRONMENT")}"
  fi
  if [[ -z "$CONTAINER" && -z "$MYSQL_HOST" ]]; then
    die "Give an environment name, --container NAME or --host HOST. Use --help." 2
  fi
  if [[ -n "$CONTAINER" ]]; then
    container_running "$CONTAINER" || die "Container '$CONTAINER' is not running"
    MYSQL_DATABASE="${MYSQL_DATABASE:-$(container_database "$CONTAINER")}"
  fi
  [[ -n "$MYSQL_DATABASE" ]] || die "No target database: pass --database DB." 2
}

verify_backup_file() {
  log "Verifying backup file: $BACKUP_FILE"

  [[ -f "$BACKUP_FILE" ]] || die "Backup file not found: $BACKUP_FILE"
  [[ -r "$BACKUP_FILE" ]] || die "Backup file is not readable: $BACKUP_FILE"
  [[ -s "$BACKUP_FILE" ]] || die "Backup file is empty: $BACKUP_FILE"
  [[ "$BACKUP_FILE" == *.sql.gz ]] || die "Backup file must have .sql.gz extension: $BACKUP_FILE"

  if ! gunzip -t "$BACKUP_FILE" 2>/dev/null; then
    die "Backup file failed gzip integrity check: $BACKUP_FILE"
  fi

  log "Backup file verified: $(du -h "$BACKUP_FILE" | cut -f1)"
}

confirm_restore() {
  [[ "$FORCE" == "true" ]] && return 0

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

perform_restore() {
  log "Starting restore of database '$MYSQL_DATABASE' from $(basename "$BACKUP_FILE")..."

  if [[ -n "$CONTAINER" ]]; then
    log "Using container: $CONTAINER"
    gunzip -c "$BACKUP_FILE" | container_mysql "$CONTAINER" mysql "$MYSQL_DATABASE"
  else
    log "Using direct MySQL connection: $MYSQL_HOST:$MYSQL_PORT"
    gunzip -c "$BACKUP_FILE" | direct_mysql mysql "$MYSQL_DATABASE"
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
