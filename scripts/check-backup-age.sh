#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# MyFinPro Backup Age Check / Alert Script
# Exits 1 when the newest backup is older than the threshold (or missing).
# The scheduled backup workflow runs it last, so its failure is the alert.
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/backup-common.sh
source "${SCRIPT_DIR}/backup-common.sh"

BACKUP_DIR="${BACKUP_DIR:-}"
BACKUP_MAX_AGE_HOURS="${BACKUP_MAX_AGE_HOURS:-26}"
ALERT_WEBHOOK_URL="${ALERT_WEBHOOK_URL:-}"
LOG_PREFIX="[check-backup-age]"

# =============================================================================
# Functions
# =============================================================================

usage() {
  cat <<USAGE
Usage: $(basename "$0") [production|staging] [OPTIONS]

Checks the age of the most recent backup and alerts if it is too old.

Options:
  --max-age N           Maximum backup age in hours (default: $BACKUP_MAX_AGE_HOURS)
  --backup-dir DIR      Backup directory (default: ${BACKUP_ROOT}/<env>)
  --alert-webhook URL   Webhook URL for sending alerts (optional)
  --help                Show this help message

Environment variables:
  BACKUP_ROOT, BACKUP_DIR, BACKUP_MAX_AGE_HOURS, ALERT_WEBHOOK_URL

Exit codes:
  0  Backup is recent (within threshold)
  1  Backup is too old or missing
USAGE
  exit 0
}

log() {
  echo "$LOG_PREFIX $(date '+%Y-%m-%d %H:%M:%S') $*"
}

log_error() {
  echo "$LOG_PREFIX $(date '+%Y-%m-%d %H:%M:%S') ERROR: $*" >&2
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      production | staging)
        BACKUP_DIR="${BACKUP_DIR:-$(backup_env_dir "$1")}"
        shift
        ;;
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

  if [[ -z "$BACKUP_DIR" ]]; then
    log_error "Give an environment name or --backup-dir DIR. Use --help."
    exit 1
  fi
}

send_webhook_alert() {
  local message="$1"
  local status="$2"

  [[ -n "$ALERT_WEBHOOK_URL" ]] || return 0

  log "Sending alert to webhook..."

  local payload
  payload=$(
    cat <<JSON
{
  "text": "$message",
  "status": "$status",
  "service": "myfinpro-backup",
  "timestamp": "$(date -u '+%Y-%m-%dT%H:%M:%SZ')",
  "hostname": "$(hostname)"
}
JSON
  )

  curl -s -X POST \
    -H "Content-Type: application/json" \
    -d "$payload" \
    "$ALERT_WEBHOOK_URL" > /dev/null 2>&1 || {
    log_error "Failed to send webhook alert"
  }
}

# =============================================================================
# Main
# =============================================================================

main() {
  parse_args "$@"

  if [[ ! -d "$BACKUP_DIR" ]]; then
    local msg="ALERT: Backup directory does not exist: $BACKUP_DIR"
    log_error "$msg"
    send_webhook_alert "$msg" "critical"
    exit 1
  fi

  local latest_backup
  latest_backup=$(find_latest_backup "$BACKUP_DIR")

  if [[ -z "$latest_backup" ]]; then
    local msg="ALERT: No backup files found in $BACKUP_DIR"
    log_error "$msg"
    send_webhook_alert "$msg" "critical"
    exit 1
  fi

  local filename age_hours
  filename=$(basename "$latest_backup")
  age_hours=$(file_age_hours "$latest_backup")

  if file_older_than_hours "$latest_backup" "$BACKUP_MAX_AGE_HOURS"; then
    local msg="ALERT: Backup '$filename' is ${age_hours}h old (threshold: ${BACKUP_MAX_AGE_HOURS}h)"
    log "$msg"
    send_webhook_alert "$msg" "warning"
    exit 1
  fi

  log "OK: Latest backup '$filename' is ${age_hours}h old (threshold: ${BACKUP_MAX_AGE_HOURS}h)"
  exit 0
}

main "$@"
