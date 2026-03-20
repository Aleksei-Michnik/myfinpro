#!/usr/bin/env bash
# scripts/rollback.sh — Instant rollback for MyFinPro blue-green deployments
#
# Reads .deploy-metadata to find the previous slot and image tag,
# starts the previous slot, switches Nginx, and stops the failed slot.
#
# Usage:
#   ./scripts/rollback.sh <staging|production>
#
# Prerequisites:
#   - A previous successful deployment must exist (.deploy-metadata)
#   - All application env vars must be exported (from CI or shell)

set -euo pipefail

# ─── Arguments ───────────────────────────────────────────────────────────────

ENVIRONMENT="${1:?Usage: rollback.sh <staging|production>}"

if [[ "$ENVIRONMENT" != "staging" && "$ENVIRONMENT" != "production" ]]; then
  echo "❌ Invalid environment: $ENVIRONMENT. Must be 'staging' or 'production'."
  exit 1
fi

# ─── Configuration ───────────────────────────────────────────────────────────

DEPLOY_DIR="/opt/myfinpro/${ENVIRONMENT}"
SHARED_DIR="/opt/myfinpro/shared"
APP_COMPOSE="docker-compose.${ENVIRONMENT}.app.yml"
ACTIVE_SLOT_FILE="${DEPLOY_DIR}/.active-slot"
METADATA_FILE="${DEPLOY_DIR}/.deploy-metadata"
LOG_FILE="${DEPLOY_DIR}/rollback-$(date +%Y%m%d-%H%M%S).log"

# Container name prefix varies by environment
if [ "$ENVIRONMENT" = "production" ]; then
  CONTAINER_PREFIX="myfinpro-prod"
else
  CONTAINER_PREFIX="myfinpro-staging"
fi

# Shared nginx container name
NGINX_CONTAINER="myfinpro-nginx"

# ─── Colors ──────────────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# ─── Logging (best-effort: never fail on disk-full) ──────────────────────────

log()   { echo -e "${BLUE}[$(date +%H:%M:%S)]${NC} $*" | tee -a "$LOG_FILE" 2>/dev/null || echo -e "${BLUE}[$(date +%H:%M:%S)]${NC} $*"; }
info()  { echo -e "${GREEN}[$(date +%H:%M:%S)] ✅${NC} $*" | tee -a "$LOG_FILE" 2>/dev/null || echo -e "${GREEN}[$(date +%H:%M:%S)] ✅${NC} $*"; }
warn()  { echo -e "${YELLOW}[$(date +%H:%M:%S)] ⚠️${NC}  $*" | tee -a "$LOG_FILE" 2>/dev/null || echo -e "${YELLOW}[$(date +%H:%M:%S)] ⚠️${NC}  $*"; }
error() { echo -e "${RED}[$(date +%H:%M:%S)] ❌${NC} $*" | tee -a "$LOG_FILE" 2>/dev/null || echo -e "${RED}[$(date +%H:%M:%S)] ❌${NC} $*"; }

# ─── Health check helper ────────────────────────────────────────────────────

wait_for_container_health() {
  local container="$1"
  local timeout="${2:-90}"
  local elapsed=0

  log "Waiting for ${container} to become healthy (timeout: ${timeout}s)..."
  while [ $elapsed -lt "$timeout" ]; do
    local status
    status=$(docker inspect --format='{{.State.Health.Status}}' "$container" 2>/dev/null || echo "not_found")
    case "$status" in
      healthy)
        info "${container} is healthy."
        return 0
        ;;
      unhealthy)
        error "${container} is unhealthy!"
        docker logs --tail 20 "$container" 2>&1 | tee -a "$LOG_FILE" 2>/dev/null || true
        return 1
        ;;
    esac
    sleep 5
    elapsed=$((elapsed + 5))
    if [ $((elapsed % 15)) -eq 0 ]; then
      log "  ${container} status: ${status} (${elapsed}s/${timeout}s)"
    fi
  done

  error "${container} did not become healthy within ${timeout}s."
  return 1
}

# ─── Main ────────────────────────────────────────────────────────────────────

cd "$DEPLOY_DIR" || { echo "❌ Deploy directory $DEPLOY_DIR not found."; exit 1; }

# Emergency disk cleanup — rollback often runs when deploy failed due to full disk
echo "Emergency cleanup: freeing disk space for rollback..."
ls -t "${DEPLOY_DIR}"/deploy-*.log 2>/dev/null | tail -n +3 | xargs rm -f 2>/dev/null || true
ls -t "${DEPLOY_DIR}"/rollback-*.log 2>/dev/null | tail -n +2 | xargs rm -f 2>/dev/null || true
docker image prune -f 2>/dev/null || true
docker container prune -f 2>/dev/null || true

log "═══════════════════════════════════════════════════════════════"
log "  MyFinPro Rollback — ${ENVIRONMENT^^}"
log "  Started at: $(date)"
log "═══════════════════════════════════════════════════════════════"

# ─── Step 1: Read deployment metadata ────────────────────────────────────────

if [ ! -f "$METADATA_FILE" ]; then
  error "No deployment metadata found at $METADATA_FILE"
  error "Cannot determine previous slot and image tag."
  error "Manual intervention required."
  exit 1
fi

# shellcheck source=/dev/null
source "$METADATA_FILE"

CURRENT_SLOT="${ACTIVE_SLOT:-}"
ROLLBACK_SLOT="${PREVIOUS_SLOT:-}"
ROLLBACK_TAG="${PREVIOUS_IMAGE_TAG:-}"
# Save the failed deploy's tag before IMAGE_TAG is overwritten on export
FAILED_IMAGE_TAG="${IMAGE_TAG:-}"

if [ -z "$ROLLBACK_SLOT" ] || [ "$ROLLBACK_SLOT" = "none" ]; then
  error "No previous slot found in metadata. Cannot rollback."
  error "This may be the first deployment — no previous version exists."
  exit 1
fi

if [ -z "$ROLLBACK_TAG" ]; then
  error "No previous image tag found in metadata. Cannot rollback."
  exit 1
fi

log "Rolling back: ${CURRENT_SLOT} → ${ROLLBACK_SLOT}"
log "Rollback image tag: ${ROLLBACK_TAG}"

# ─── Step 2: Start previous slot containers ──────────────────────────────────

log "Starting rollback slot: ${ROLLBACK_SLOT} (tag: ${ROLLBACK_TAG})..."

export DEPLOY_SLOT="$ROLLBACK_SLOT"
export IMAGE_TAG="$ROLLBACK_TAG"

# Try to start — images should still be cached locally
docker compose -p "myfinpro-${ENVIRONMENT}-${ROLLBACK_SLOT}" \
  -f "$APP_COMPOSE" up -d || {
  warn "Failed to start with cached images — attempting pull..."
  docker compose -p "myfinpro-${ENVIRONMENT}-${ROLLBACK_SLOT}" \
    -f "$APP_COMPOSE" pull
  docker compose -p "myfinpro-${ENVIRONMENT}-${ROLLBACK_SLOT}" \
    -f "$APP_COMPOSE" up -d || {
    error "Failed to start rollback slot even after pulling. Manual intervention required."
    exit 1
  }
}

# ─── Step 3: Wait for health checks ─────────────────────────────────────────

log "Waiting for rollback slot health checks..."
wait_for_container_health "${CONTAINER_PREFIX}-api-${ROLLBACK_SLOT}" 90
wait_for_container_health "${CONTAINER_PREFIX}-web-${ROLLBACK_SLOT}" 90
info "Rollback slot ${ROLLBACK_SLOT} is healthy!"

# ─── Step 4: Switch Nginx to previous slot ───────────────────────────────────

log "Switching shared Nginx traffic to rollback slot: ${ROLLBACK_SLOT} for ${ENVIRONMENT}..."

export ACTIVE_SLOT="$ROLLBACK_SLOT"
export ENVIRONMENT
envsubst '$SERVER_NAME $ACTIVE_SLOT $ENVIRONMENT' \
  < infrastructure/nginx/conf.d/ssl.conf.template \
  > "${SHARED_DIR}/nginx/conf.d/${ENVIRONMENT}.conf"

docker exec "${NGINX_CONTAINER}" nginx -t 2>&1 | tee -a "$LOG_FILE" 2>/dev/null || {
  error "Nginx config test failed during rollback!"
  exit 1
}

docker exec "${NGINX_CONTAINER}" nginx -s reload
info "Nginx reloaded — traffic now flows to ${ROLLBACK_SLOT} for ${ENVIRONMENT}."

# Allow drain
sleep 5

# Verify
log "Verifying rollback through Nginx..."
VERIFY_OK=false
for i in $(seq 1 10); do
  if curl -sf -H "Host: ${SERVER_NAME}" "http://localhost/api/v1/health" > /dev/null 2>&1; then
    VERIFY_OK=true
    break
  fi
  log "  Health check attempt $i/10..."
  sleep 3
done

if [ "$VERIFY_OK" = false ]; then
  error "Health check failed after rollback! Manual intervention required."
  error "  1. Check container status: docker ps"
  error "  2. Check container logs: docker logs ${CONTAINER_PREFIX}-api-${ROLLBACK_SLOT}"
  exit 1
fi

info "Post-rollback health check passed!"

# ─── Step 5: Stop current (failed) slot ──────────────────────────────────────

if [ -n "$CURRENT_SLOT" ] && [ "$CURRENT_SLOT" != "none" ]; then
  log "Stopping failed slot: ${CURRENT_SLOT}..."
  DEPLOY_SLOT="$CURRENT_SLOT" docker compose -p "myfinpro-${ENVIRONMENT}-${CURRENT_SLOT}" \
    -f "$APP_COMPOSE" down 2>/dev/null || {
    warn "Failed to stop slot ${CURRENT_SLOT} — may need manual cleanup."
  }
  info "Failed slot ${CURRENT_SLOT} stopped."
fi

# ─── Step 6: Update state files ─────────────────────────────────────────────

echo "$ROLLBACK_SLOT" > "$ACTIVE_SLOT_FILE"

cat > "$METADATA_FILE" << EOF
DEPLOY_TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)
ACTIVE_SLOT=${ROLLBACK_SLOT}
PREVIOUS_SLOT=${CURRENT_SLOT}
IMAGE_TAG=${ROLLBACK_TAG}
PREVIOUS_IMAGE_TAG=${FAILED_IMAGE_TAG}
GIT_SHA=${PREVIOUS_GIT_SHA:-unknown}
PREVIOUS_GIT_SHA=${GIT_SHA:-unknown}
DEPLOY_STATUS=rollback
EOF

info "State updated: active=${ROLLBACK_SLOT}"

# ─── Done ────────────────────────────────────────────────────────────────────

log "═══════════════════════════════════════════════════════════════"
info "🔄 Rollback to ${ENVIRONMENT} completed successfully!"
info "   Active slot: ${ROLLBACK_SLOT}"
info "   Image tag:   ${ROLLBACK_TAG}"
log "═══════════════════════════════════════════════════════════════"
