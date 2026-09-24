#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# MyFinPro Database Backup Script
# Creates a compressed MySQL dump, verifies it, applies the retention policy.
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/backup-common.sh
source "${SCRIPT_DIR}/backup-common.sh"

BACKUP_DIR="${BACKUP_DIR:-}"
BACKUP_RETENTION_DAILY="${BACKUP_RETENTION_DAILY:-7}"
BACKUP_RETENTION_WEEKLY="${BACKUP_RETENTION_WEEKLY:-4}"
MYSQL_HOST="${MYSQL_HOST:-}"
MYSQL_PORT="${MYSQL_PORT:-3306}"
MYSQL_USER="${MYSQL_USER:-root}"
MYSQL_DATABASE="${MYSQL_DATABASE:-}"

ENVIRONMENT=""
CONTAINER=""
LOG_PREFIX="[backup]"

# =============================================================================
# Functions
# =============================================================================

usage() {
  cat <<USAGE
Usage: $(basename "$0") <production|staging> [OPTIONS]
       $(basename "$0") --container NAME --output-dir DIR [OPTIONS]
       $(basename "$0") --host HOST --database DB --output-dir DIR [OPTIONS]

Creates a compressed MySQL database backup with retention policy.

With an environment name the dump runs inside that environment's MySQL
container using the container's own credentials, into
${BACKUP_ROOT}/<env>/. Nothing is read from a credentials file.

Options:
  --container NAME      Any MySQL container whose environment carries
                        MYSQL_ROOT_PASSWORD and MYSQL_DATABASE
  --output-dir DIR      Backup output directory (default: ${BACKUP_ROOT}/<env>)
  --host HOST           Direct connection instead of a container
  --port PORT           MySQL port (default: $MYSQL_PORT)
  --user USER           MySQL user (default: $MYSQL_USER)
  --database DB         MySQL database (direct connection only)
  --retention-daily N   Keep last N daily backups (default: $BACKUP_RETENTION_DAILY)
  --retention-weekly N  Keep last N weekly backups (default: $BACKUP_RETENTION_WEEKLY)
  --help                Show this help message

Environment variables:
  BACKUP_ROOT, BACKUP_DIR, BACKUP_RETENTION_DAILY, BACKUP_RETENTION_WEEKLY,
  MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD (direct only), MYSQL_DATABASE

Exit codes:
  0  Backup completed successfully
  1  Backup failed
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
  log_error "$@"
  exit "${2:-1}"
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      production | staging)
        ENVIRONMENT="$1"
        shift
        ;;
      --container)
        CONTAINER="$2"
        shift 2
        ;;
      --output-dir)
        BACKUP_DIR="$2"
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
        die "Unknown option: $1. Use --help for usage information." 2
        ;;
    esac
  done

  if [[ -n "$ENVIRONMENT" ]]; then
    CONTAINER="${CONTAINER:-$(backup_env_container "$ENVIRONMENT")}"
    BACKUP_DIR="${BACKUP_DIR:-$(backup_env_dir "$ENVIRONMENT")}"
  fi

  if [[ -z "$CONTAINER" && -z "$MYSQL_HOST" ]]; then
    die "Give an environment name, --container NAME or --host HOST. Use --help." 2
  fi
  if [[ -z "$BACKUP_DIR" ]]; then
    die "--output-dir is required without an environment name." 2
  fi
  if [[ -z "$CONTAINER" && -z "$MYSQL_DATABASE" ]]; then
    die "--database is required for a direct connection." 2
  fi
}

ensure_backup_dir() {
  if [[ ! -d "$BACKUP_DIR" ]]; then
    log "Creating backup directory: $BACKUP_DIR"
    mkdir -p "$BACKUP_DIR" || die "Failed to create backup directory: $BACKUP_DIR"
  fi
}

perform_dump() {
  local backup_file="$1"
  local tmp_file="${backup_file}.tmp"
  local dump_flags=(--single-transaction --no-tablespaces --routines --triggers)

  if [[ -n "$CONTAINER" ]]; then
    container_running "$CONTAINER" || die "Container '$CONTAINER' is not running"
    MYSQL_DATABASE="$(container_database "$CONTAINER")"
    [[ -n "$MYSQL_DATABASE" ]] || die "Container '$CONTAINER' has no MYSQL_DATABASE in its environment"
    log "Dumping database '$MYSQL_DATABASE' inside container $CONTAINER..."
    container_mysql "$CONTAINER" mysqldump "${dump_flags[@]}" "$MYSQL_DATABASE" | gzip > "$tmp_file"
  else
    log "Dumping database '$MYSQL_DATABASE' from $MYSQL_HOST:$MYSQL_PORT..."
    direct_mysql mysqldump "${dump_flags[@]}" "$MYSQL_DATABASE" | gzip > "$tmp_file"
  fi

  if [[ ! -s "$tmp_file" ]]; then
    rm -f "$tmp_file"
    die "Backup file is empty — mysqldump may have failed"
  fi

  if ! gunzip -t "$tmp_file" 2>/dev/null; then
    rm -f "$tmp_file"
    die "Backup file failed gzip integrity check"
  fi

  mv "$tmp_file" "$backup_file"
  log "Backup created: $backup_file ($(du -h "$backup_file" | cut -f1))"
}

# Keep the newest N daily backups and the first backup of each of the last
# M ISO weeks; delete the rest. Only files named <prefix>YYYY-MM-DD_*.sql.gz
# are considered, so pre-deploy dumps are left alone.
cleanup_old_backups() {
  log "Applying retention policy: keep $BACKUP_RETENTION_DAILY daily, $BACKUP_RETENTION_WEEKLY weekly"

  local all_backups
  all_backups=$(find "$BACKUP_DIR" -name "${BACKUP_FILE_PREFIX}*.sql.gz" -type f | sort -r)

  if [[ -z "$all_backups" ]]; then
    log "No backups found to clean up"
    return
  fi

  local daily_kept=0
  local weekly_kept=0
  local last_weekly_marker=""

  while IFS= read -r backup_path; do
    local filename date_part week_marker keep
    filename=$(basename "$backup_path")
    date_part=$(echo "$filename" | sed -n "s/${BACKUP_FILE_PREFIX}\([0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\}\)_.*/\1/p")
    [[ -n "$date_part" ]] || continue

    week_marker=$(date -d "$date_part" '+%G-W%V' 2>/dev/null || echo "unknown")
    keep=false

    if [[ $daily_kept -lt $BACKUP_RETENTION_DAILY ]]; then
      keep=true
      daily_kept=$((daily_kept + 1))
    fi

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

  local timestamp backup_file
  timestamp=$(date '+%Y-%m-%d_%H-%M-%S')
  backup_file="${BACKUP_DIR}/${BACKUP_FILE_PREFIX}${timestamp}.sql.gz"

  perform_dump "$backup_file"
  cleanup_old_backups

  log "Backup completed successfully"
  exit 0
}

main "$@"
