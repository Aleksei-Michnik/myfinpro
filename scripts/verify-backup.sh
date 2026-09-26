#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# MyFinPro Backup Verification Script
# Verifies backup existence, recency, integrity, and optionally restores the
# newest backup into a throwaway <database>_verify schema (the restore drill).
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/backup-common.sh
source "${SCRIPT_DIR}/backup-common.sh"

BACKUP_DIR="${BACKUP_DIR:-}"
BACKUP_MAX_AGE_HOURS="${BACKUP_MAX_AGE_HOURS:-26}"
MYSQL_HOST="${MYSQL_HOST:-}"
MYSQL_PORT="${MYSQL_PORT:-3306}"
MYSQL_USER="${MYSQL_USER:-root}"
MYSQL_DATABASE="${MYSQL_DATABASE:-}"

ENVIRONMENT=""
CONTAINER=""
TEST_RESTORE=false
LOG_PREFIX="[verify-backup]"

# =============================================================================
# Functions
# =============================================================================

usage() {
  cat <<USAGE
Usage: $(basename "$0") [production|staging] [OPTIONS]

Verifies that a recent, valid backup exists. With --test-restore the newest
backup is restored into <database>_verify, tables and rows are counted, and
the schema is dropped again.

Options:
  --max-age-hours N     Maximum backup age in hours (default: $BACKUP_MAX_AGE_HOURS)
  --backup-dir DIR      Backup directory (default: ${BACKUP_ROOT}/<env>)
  --test-restore        Perform the restore drill
  --container NAME      MySQL container for the drill (default: the environment's)
  --host HOST           Direct connection for the drill instead of a container
  --port PORT           MySQL port (default: $MYSQL_PORT)
  --user USER           MySQL user (default: $MYSQL_USER)
  --database DB         Database name (direct connection only; drill uses <DB>_verify)
  --help                Show this help message

Output:
  JSON status on stdout for monitoring integration; log lines on stderr.

Exit codes:
  0  Backup is valid and recent
  1  Backup verification failed
USAGE
  exit 0
}

log() {
  echo "$LOG_PREFIX $(date '+%Y-%m-%d %H:%M:%S') $*" >&2
}

log_error() {
  echo "$LOG_PREFIX $(date '+%Y-%m-%d %H:%M:%S') ERROR: $*" >&2
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      production | staging)
        ENVIRONMENT="$1"
        shift
        ;;
      --max-age-hours)
        BACKUP_MAX_AGE_HOURS="$2"
        shift 2
        ;;
      --backup-dir)
        BACKUP_DIR="$2"
        shift 2
        ;;
      --test-restore)
        TEST_RESTORE=true
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
      *)
        log_error "Unknown option: $1. Use --help for usage information."
        exit 1
        ;;
    esac
  done

  if [[ -n "$ENVIRONMENT" ]]; then
    CONTAINER="${CONTAINER:-$(backup_env_container "$ENVIRONMENT")}"
    BACKUP_DIR="${BACKUP_DIR:-$(backup_env_dir "$ENVIRONMENT")}"
  fi

  if [[ -z "$BACKUP_DIR" ]]; then
    log_error "Give an environment name or --backup-dir DIR. Use --help."
    exit 1
  fi
  if [[ "$TEST_RESTORE" == "true" && -z "$CONTAINER" && -z "$MYSQL_HOST" ]]; then
    log_error "--test-restore needs an environment name, --container NAME or --host HOST."
    exit 1
  fi
  if [[ "$TEST_RESTORE" == "true" && -z "$CONTAINER" && -z "$MYSQL_DATABASE" ]]; then
    log_error "--test-restore over a direct connection needs --database DB."
    exit 1
  fi
}

# mysql client bound to whichever connection the drill uses.
drill_mysql() {
  if [[ -n "$CONTAINER" ]]; then
    container_mysql "$CONTAINER" mysql "$@"
  else
    direct_mysql mysql "$@"
  fi
}

# Restore into <database>_verify, count tables and rows, drop it.
# Prints "<table_count> <row_count>" on success.
do_test_restore() {
  local backup_file="$1"
  local database verify_db

  if [[ -n "$CONTAINER" ]]; then
    container_running "$CONTAINER" || {
      log_error "Container '$CONTAINER' is not running"
      return 1
    }
    database="$(container_database "$CONTAINER")"
  else
    database="$MYSQL_DATABASE"
  fi
  verify_db="${database}_verify"

  log "Restore drill: $(basename "$backup_file") → $verify_db"

  drill_mysql -e "DROP DATABASE IF EXISTS \`$verify_db\`; CREATE DATABASE \`$verify_db\`;" || {
    log_error "Failed to create $verify_db"
    return 1
  }

  local restore_ok=true
  gunzip -c "$backup_file" | drill_mysql "$verify_db" || restore_ok=false

  local table_count=0 row_count=0 tables table
  if [[ "$restore_ok" == "true" ]]; then
    tables=$(drill_mysql -N -e \
      "SELECT table_name FROM information_schema.tables WHERE table_schema='$verify_db' AND table_type='BASE TABLE';")
    for table in $tables; do
      table_count=$((table_count + 1))
      row_count=$((row_count + $(drill_mysql -N -e "SELECT COUNT(*) FROM \`$verify_db\`.\`$table\`;")))
    done
  fi

  drill_mysql -e "DROP DATABASE IF EXISTS \`$verify_db\`;" || log_error "Failed to drop $verify_db"

  if [[ "$restore_ok" != "true" ]]; then
    log_error "Restore drill failed"
    return 1
  fi
  if [[ $table_count -eq 0 ]]; then
    log_error "Restore drill produced no tables"
    return 1
  fi

  log "Restore drill passed: $table_count tables, $row_count rows"
  echo "$table_count $row_count"
}

output_json() {
  local status="$1"
  local message="$2"
  local backup_file="${3:-}"
  local backup_age="${4:-}"
  local backup_size="${5:-}"
  local test_restore_result="${6:-}"
  local table_count="${7:-}"
  local row_count="${8:-}"

  cat <<JSON
{
  "status": "$status",
  "message": "$message",
  "timestamp": "$(date -u '+%Y-%m-%dT%H:%M:%SZ')",
  "backup_file": "$backup_file",
  "backup_age_hours": ${backup_age:-null},
  "backup_size_bytes": ${backup_size:-null},
  "max_age_hours": $BACKUP_MAX_AGE_HOURS,
  "test_restore": ${test_restore_result:-null},
  "table_count": ${table_count:-null},
  "row_count": ${row_count:-null},
  "backup_dir": "$BACKUP_DIR"
}
JSON
}

# =============================================================================
# Main
# =============================================================================

main() {
  parse_args "$@"

  if [[ ! -d "$BACKUP_DIR" ]]; then
    output_json "fail" "Backup directory does not exist: $BACKUP_DIR"
    exit 1
  fi

  local latest_backup
  latest_backup=$(find_latest_backup "$BACKUP_DIR")

  if [[ -z "$latest_backup" ]]; then
    output_json "fail" "No backup files found in $BACKUP_DIR"
    exit 1
  fi

  local filename
  filename=$(basename "$latest_backup")
  log "Latest backup: $filename"

  if [[ ! -s "$latest_backup" ]]; then
    output_json "fail" "Latest backup file is empty" "$filename"
    exit 1
  fi

  local file_size
  file_size=$(stat -c %s "$latest_backup" 2>/dev/null || stat -f %z "$latest_backup" 2>/dev/null)

  if ! gunzip -t "$latest_backup" 2>/dev/null; then
    output_json "fail" "Backup file failed gzip integrity check" "$filename" "" "$file_size"
    exit 1
  fi
  log "Gzip integrity verified"

  local age_hours
  age_hours=$(file_age_hours "$latest_backup")
  log "Backup age: ${age_hours}h (max: ${BACKUP_MAX_AGE_HOURS}h)"

  if file_older_than_hours "$latest_backup" "$BACKUP_MAX_AGE_HOURS"; then
    output_json "fail" "Backup is too old: ${age_hours}h > ${BACKUP_MAX_AGE_HOURS}h" \
      "$filename" "$age_hours" "$file_size"
    exit 1
  fi

  local test_result="null" table_count="null" row_count="null" counts
  if [[ "$TEST_RESTORE" == "true" ]]; then
    if counts=$(do_test_restore "$latest_backup"); then
      test_result="true"
      table_count="${counts% *}"
      row_count="${counts#* }"
    else
      output_json "fail" "Restore drill failed" "$filename" "$age_hours" "$file_size" "false"
      exit 1
    fi
  fi

  output_json "ok" "Backup is valid and recent" \
    "$filename" "$age_hours" "$file_size" "$test_result" "$table_count" "$row_count"

  log "Verification passed"
  exit 0
}

main "$@"
