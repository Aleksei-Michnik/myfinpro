#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# MyFinPro Backup Verification Script
# Verifies backup existence, recency, integrity, and optionally test-restores
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
BACKUP_MAX_AGE_HOURS="${BACKUP_MAX_AGE_HOURS:-26}"
MYSQL_HOST="${MYSQL_HOST:-localhost}"
MYSQL_PORT="${MYSQL_PORT:-3306}"
MYSQL_USER="${MYSQL_USER:-myfinpro}"
MYSQL_PASSWORD="${MYSQL_PASSWORD:-}"
MYSQL_DATABASE="${MYSQL_DATABASE:-myfinpro}"
DOCKER_CONTAINER_NAME="${DOCKER_CONTAINER_NAME:-myfinpro-mysql-1}"

USE_DOCKER=false
TEST_RESTORE=false
LOG_PREFIX="[verify-backup]"

# =============================================================================
# Functions
# =============================================================================

usage() {
  cat <<EOF
Usage: $(basename "$0") [OPTIONS]

Verifies that a recent, valid backup exists.

Options:
  --max-age-hours N     Maximum backup age in hours (default: $BACKUP_MAX_AGE_HOURS)
  --backup-dir DIR      Backup directory (default: $BACKUP_DIR)
  --test-restore        Perform a test restore to a temporary database
  --docker              Use Docker container for test restore
  --container NAME      Docker container name (default: $DOCKER_CONTAINER_NAME)
  --host HOST           MySQL host (default: $MYSQL_HOST)
  --port PORT           MySQL port (default: $MYSQL_PORT)
  --user USER           MySQL user (default: $MYSQL_USER)
  --help                Show this help message

Output:
  Outputs JSON status to stdout for monitoring integration.

Exit codes:
  0  Backup is valid and recent
  1  Backup verification failed
EOF
  exit 0
}

log() {
  echo "$LOG_PREFIX $(date '+%Y-%m-%d %H:%M:%S') $*" >&2
}

log_error() {
  echo "$LOG_PREFIX $(date '+%Y-%m-%d %H:%M:%S') ERROR: $*" >&2
}

# Parse command-line arguments
parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
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
      --docker)
        USE_DOCKER=true
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
      --help)
        usage
        ;;
      *)
        log_error "Unknown option: $1. Use --help for usage information."
        exit 1
        ;;
    esac
  done
}

# Find the most recent backup file
find_latest_backup() {
  find "$BACKUP_DIR" -name 'myfinpro_*.sql.gz' -type f 2>/dev/null | sort -r | head -1
}

# Calculate age of a file in hours
file_age_hours() {
  local file="$1"
  local now
  now=$(date +%s)
  local file_time
  file_time=$(stat -c %Y "$file" 2>/dev/null || stat -f %m "$file" 2>/dev/null)
  local age_seconds=$(( now - file_time ))
  echo $(( age_seconds / 3600 ))
}

# Perform test restore to temporary database
do_test_restore() {
  local backup_file="$1"
  local test_db="myfinpro_restore_test_$$"

  log "Performing test restore to temporary database: $test_db"

  local mysql_cmd
  if [[ "$USE_DOCKER" == "true" ]]; then
    mysql_cmd="docker exec -i $DOCKER_CONTAINER_NAME mysql --user=$MYSQL_USER --password=$MYSQL_PASSWORD"
  else
    mysql_cmd="mysql --host=$MYSQL_HOST --port=$MYSQL_PORT --user=$MYSQL_USER --password=$MYSQL_PASSWORD"
  fi

  # Create temporary database
  echo "CREATE DATABASE IF NOT EXISTS \`$test_db\`;" | eval "$mysql_cmd" 2>/dev/null || {
    log_error "Failed to create test database"
    return 1
  }

  # Restore to temporary database
  if [[ "$USE_DOCKER" == "true" ]]; then
    gunzip -c "$backup_file" | docker exec -i "$DOCKER_CONTAINER_NAME" \
      mysql --user="$MYSQL_USER" --password="$MYSQL_PASSWORD" "$test_db" 2>/dev/null
  else
    gunzip -c "$backup_file" | mysql \
      --host="$MYSQL_HOST" --port="$MYSQL_PORT" \
      --user="$MYSQL_USER" --password="$MYSQL_PASSWORD" "$test_db" 2>/dev/null
  fi
  local restore_result=$?

  # Get table count from restored database
  local table_count
  table_count=$(echo "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$test_db';" | eval "$mysql_cmd" 2>/dev/null | tail -1)

  # Drop temporary database
  echo "DROP DATABASE IF EXISTS \`$test_db\`;" | eval "$mysql_cmd" 2>/dev/null || true

  if [[ $restore_result -ne 0 ]]; then
    log_error "Test restore failed"
    return 1
  fi

  if [[ -z "$table_count" || "$table_count" -eq 0 ]]; then
    log_error "Test restore produced no tables"
    return 1
  fi

  log "Test restore successful: $table_count tables restored"
  echo "$table_count"
  return 0
}

# Output JSON status
output_json() {
  local status="$1"
  local message="$2"
  local backup_file="${3:-}"
  local backup_age="${4:-}"
  local backup_size="${5:-}"
  local test_restore_result="${6:-}"
  local table_count="${7:-}"

  cat <<EOF
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
  "backup_dir": "$BACKUP_DIR"
}
EOF
}

# =============================================================================
# Main
# =============================================================================

main() {
  parse_args "$@"

  # Check backup directory exists
  if [[ ! -d "$BACKUP_DIR" ]]; then
    output_json "fail" "Backup directory does not exist: $BACKUP_DIR"
    exit 1
  fi

  # Find latest backup
  local latest_backup
  latest_backup=$(find_latest_backup)

  if [[ -z "$latest_backup" ]]; then
    output_json "fail" "No backup files found in $BACKUP_DIR"
    exit 1
  fi

  local filename
  filename=$(basename "$latest_backup")
  log "Latest backup: $filename"

  # Check file is not empty
  if [[ ! -s "$latest_backup" ]]; then
    output_json "fail" "Latest backup file is empty" "$filename"
    exit 1
  fi

  # Get file size in bytes
  local file_size
  file_size=$(stat -c %s "$latest_backup" 2>/dev/null || stat -f %z "$latest_backup" 2>/dev/null)

  # Verify gzip integrity
  if ! gzip -t "$latest_backup" 2>/dev/null; then
    output_json "fail" "Backup file failed gzip integrity check" "$filename" "" "$file_size"
    exit 1
  fi
  log "Gzip integrity verified"

  # Check backup age
  local age_hours
  age_hours=$(file_age_hours "$latest_backup")
  log "Backup age: ${age_hours}h (max: ${BACKUP_MAX_AGE_HOURS}h)"

  if [[ $age_hours -gt $BACKUP_MAX_AGE_HOURS ]]; then
    output_json "fail" "Backup is too old: ${age_hours}h > ${BACKUP_MAX_AGE_HOURS}h" \
      "$filename" "$age_hours" "$file_size"
    exit 1
  fi

  # Optional test restore
  local test_result="null"
  local table_count="null"
  if [[ "$TEST_RESTORE" == "true" ]]; then
    local tc
    tc=$(do_test_restore "$latest_backup") && {
      test_result="true"
      table_count="$tc"
    } || {
      test_result="false"
      output_json "fail" "Test restore failed" "$filename" "$age_hours" "$file_size" "false"
      exit 1
    }
  fi

  # All checks passed
  output_json "ok" "Backup is valid and recent" \
    "$filename" "$age_hours" "$file_size" "$test_result" "$table_count"

  log "Verification passed"
  exit 0
}

main "$@"
