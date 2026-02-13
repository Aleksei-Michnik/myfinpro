#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# MyFinPro Backup Age Check / Alert Script
# Checks backup recency and optionally sends webhook alerts
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
ALERT_WEBHOOK_URL="${ALERT_WEBHOOK_URL:-}"
LOG_PREFIX="[check-backup-age]"

# =============================================================================
# Functions
# =============================================================================

usage() {
  cat <<EOF
Usage: $(basename "$0") [OPTIONS]

Checks the age of the most recent backup and alerts if it is too old.

Options:
  --max-age N           Maximum backup age in hours (default: $BACKUP_MAX_AGE_HOURS)
  --backup-dir DIR      Backup directory (default: $BACKUP_DIR)
  --alert-webhook URL   Webhook URL for sending alerts (optional)
  --help                Show this help message

Environment variables:
  BACKUP_DIR, BACKUP_MAX_AGE_HOURS, ALERT_WEBHOOK_URL

Exit codes:
  0  Backup is recent (within threshold)
  1  Backup is too old or missing
EOF
  exit 0
}

log() {
  echo "$LOG_PREFIX $(date '+%Y-%m-%d %H:%M:%S') $*"
}

log_error() {
  echo "$LOG_PREFIX $(date '+%Y-%m-%d %H:%M:%S') ERROR: $*" >&2
}

# Parse command-line arguments
parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --max-age)
        BACKUP_MAX_AGE_HOURS="$2"
        shift 2
        ;;
      --backup-dir)
        BACKUP_DIR="$2"
        shift 2
        ;;
      --alert-webhook)
        ALERT_WEBHOOK_URL="$2"
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

# Send alert via webhook
send_webhook_alert() {
  local message="$1"
  local status="$2"

  if [[ -z "$ALERT_WEBHOOK_URL" ]]; then
    return
  fi

  log "Sending alert to webhook..."

  local payload
  payload=$(cat <<EOF
{
  "text": "$message",
  "status": "$status",
  "service": "myfinpro-backup",
  "timestamp": "$(date -u '+%Y-%m-%dT%H:%M:%SZ')",
  "hostname": "$(hostname)"
}
EOF
)

  curl -s -X POST \
    -H "Content-Type: application/json" \
    -d "$payload" \
    "$ALERT_WEBHOOK_URL" >/dev/null 2>&1 || {
    log_error "Failed to send webhook alert"
  }
}

# =============================================================================
# Main
# =============================================================================

main() {
  parse_args "$@"

  # Check backup directory
  if [[ ! -d "$BACKUP_DIR" ]]; then
    local msg="ALERT: Backup directory does not exist: $BACKUP_DIR"
    log_error "$msg"
    send_webhook_alert "$msg" "critical"
    exit 1
  fi

  # Find latest backup
  local latest_backup
  latest_backup=$(find_latest_backup)

  if [[ -z "$latest_backup" ]]; then
    local msg="ALERT: No backup files found in $BACKUP_DIR"
    log_error "$msg"
    send_webhook_alert "$msg" "critical"
    exit 1
  fi

  local filename
  filename=$(basename "$latest_backup")

  # Check backup age
  local age_hours
  age_hours=$(file_age_hours "$latest_backup")

  if [[ $age_hours -gt $BACKUP_MAX_AGE_HOURS ]]; then
    local msg="ALERT: Backup '$filename' is ${age_hours}h old (threshold: ${BACKUP_MAX_AGE_HOURS}h)"
    log "$msg"
    send_webhook_alert "$msg" "warning"
    exit 1
  fi

  log "OK: Latest backup '$filename' is ${age_hours}h old (threshold: ${BACKUP_MAX_AGE_HOURS}h)"
  exit 0
}

main "$@"
