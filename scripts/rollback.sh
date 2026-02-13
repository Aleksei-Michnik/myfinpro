#!/usr/bin/env bash
# scripts/rollback.sh — Rollback MyFinPro to previous deployment
# Usage: ./scripts/rollback.sh [staging|production]

set -euo pipefail

# ─── Configuration ───────────────────────────────────────────────────────────

ENVIRONMENT="${1:-staging}"
DEPLOY_DIR="/opt/myfinpro"
COMPOSE_FILE="docker-compose.${ENVIRONMENT}.yml"
BACKUP_TAG_FILE="${DEPLOY_DIR}/.previous-image-tags"
HEALTH_CHECK_URL="http://localhost/api/v1/health"
HEALTH_CHECK_RETRIES=15
HEALTH_CHECK_INTERVAL=5
LOG_FILE="${DEPLOY_DIR}/rollback-$(date +%Y%m%d-%H%M%S).log"

# ─── Colors ──────────────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# ─── Logging ─────────────────────────────────────────────────────────────────

log()    { echo -e "${BLUE}[$(date +%H:%M:%S)]${NC} $*" | tee -a "$LOG_FILE"; }
info()   { echo -e "${GREEN}[$(date +%H:%M:%S)] ✅${NC} $*" | tee -a "$LOG_FILE"; }
warn()   { echo -e "${YELLOW}[$(date +%H:%M:%S)] ⚠️${NC}  $*" | tee -a "$LOG_FILE"; }
error()  { echo -e "${RED}[$(date +%H:%M:%S)] ❌${NC} $*" | tee -a "$LOG_FILE"; }

# ─── Validation ──────────────────────────────────────────────────────────────

validate_environment() {
  if [[ "$ENVIRONMENT" != "staging" && "$ENVIRONMENT" != "production" ]]; then
    error "Invalid environment: $ENVIRONMENT. Must be 'staging' or 'production'."
    exit 1
  fi

  cd "$DEPLOY_DIR" || { error "Deploy directory $DEPLOY_DIR not found."; exit 1; }

  if [ ! -f "$COMPOSE_FILE" ]; then
    error "Compose file $COMPOSE_FILE not found."
    exit 1
  fi
}

# ─── Rollback to previous images ────────────────────────────────────────────

rollback_images() {
  log "Rolling back to previous image versions..."

  if [ ! -f "$BACKUP_TAG_FILE" ]; then
    warn "No previous image tags found at $BACKUP_TAG_FILE."
    warn "Attempting to use previous Docker image layers..."

    # Stop current containers
    docker compose -f "$COMPOSE_FILE" stop api web

    # Try to find previous images
    local api_prev web_prev
    api_prev=$(docker images --format '{{.Repository}}:{{.Tag}}' | grep "/api:" | grep -v "staging\$\|latest\$" | head -1 || echo "")
    web_prev=$(docker images --format '{{.Repository}}:{{.Tag}}' | grep "/web:" | grep -v "staging\$\|latest\$" | head -1 || echo "")

    if [ -n "$api_prev" ] && [ -n "$web_prev" ]; then
      log "Found previous API image: $api_prev"
      log "Found previous Web image: $web_prev"
    else
      error "No previous images found for rollback. Manual intervention required."
      exit 1
    fi
  else
    log "Found previous image tags file."
    cat "$BACKUP_TAG_FILE" | tee -a "$LOG_FILE"
  fi
}

# ─── Restart services ───────────────────────────────────────────────────────

restart_services() {
  log "Restarting services with previous images..."

  # Stop current containers gracefully
  docker compose -f "$COMPOSE_FILE" stop api web nginx

  # Start them back up (Docker will use cached images if pull was reverted)
  docker compose -f "$COMPOSE_FILE" up -d mysql redis
  sleep 5

  docker compose -f "$COMPOSE_FILE" up -d api
  sleep 10

  docker compose -f "$COMPOSE_FILE" up -d web
  sleep 10

  docker compose -f "$COMPOSE_FILE" up -d nginx
  sleep 3

  info "Services restarted."
}

# ─── Verify health ──────────────────────────────────────────────────────────

verify_health() {
  log "Verifying rollback health..."

  for i in $(seq 1 "$HEALTH_CHECK_RETRIES"); do
    if curl -sf "$HEALTH_CHECK_URL" > /dev/null 2>&1; then
      info "Health check passed after rollback."
      return 0
    fi
    if [ "$i" -eq "$HEALTH_CHECK_RETRIES" ]; then
      error "Health check failed after rollback! Manual intervention required."
      error "Check logs: docker compose -f $COMPOSE_FILE logs"
      return 1
    fi
    log "  Health check attempt $i/$HEALTH_CHECK_RETRIES..."
    sleep "$HEALTH_CHECK_INTERVAL"
  done
}

# ─── Main ────────────────────────────────────────────────────────────────────

main() {
  log "═══════════════════════════════════════════════════════════════"
  log "  MyFinPro Rollback — ${ENVIRONMENT^^}"
  log "  Started at: $(date)"
  log "═══════════════════════════════════════════════════════════════"

  validate_environment
  rollback_images
  restart_services

  if verify_health; then
    log "═══════════════════════════════════════════════════════════════"
    info "🔄 Rollback to ${ENVIRONMENT} completed successfully!"
    log "═══════════════════════════════════════════════════════════════"
    exit 0
  else
    error "Rollback verification failed. Manual intervention required."
    error "  1. Check container status: docker compose -f $COMPOSE_FILE ps"
    error "  2. Check container logs:   docker compose -f $COMPOSE_FILE logs"
    error "  3. If needed, restart all: docker compose -f $COMPOSE_FILE down && docker compose -f $COMPOSE_FILE up -d"
    exit 1
  fi
}

main "$@"
