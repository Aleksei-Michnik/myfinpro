#!/usr/bin/env bash
# scripts/deploy.sh — Blue-green deployment for MyFinPro
#
# Deploys application services into alternating blue/green slots,
# switches shared Nginx traffic with zero downtime, and cleans up old images.
#
# Usage:
#   ./scripts/deploy.sh <staging|production> <image_tag>
#
# Prerequisites:
#   - All application env vars must be exported (from CI or shell)
#   - Docker networks myfinpro-{staging,production}-net must exist
#   - Shared nginx must be running (myfinpro-nginx container)
#   - Infrastructure stack must be running (mysql, redis)

set -euo pipefail

# ─── Arguments ───────────────────────────────────────────────────────────────

ENVIRONMENT="${1:?Usage: deploy.sh <staging|production> <image_tag>}"
IMAGE_TAG="${2:?Usage: deploy.sh <staging|production> <image_tag>}"

if [[ "$ENVIRONMENT" != "staging" && "$ENVIRONMENT" != "production" ]]; then
  echo "❌ Invalid environment: $ENVIRONMENT. Must be 'staging' or 'production'."
  exit 1
fi

# ─── Configuration ───────────────────────────────────────────────────────────

DEPLOY_DIR="/opt/myfinpro/${ENVIRONMENT}"
SHARED_DIR="/opt/myfinpro/shared"
INFRA_COMPOSE="docker-compose.${ENVIRONMENT}.infra.yml"
APP_COMPOSE="docker-compose.${ENVIRONMENT}.app.yml"
NETWORK_NAME="myfinpro-${ENVIRONMENT}-net"
ACTIVE_SLOT_FILE="${DEPLOY_DIR}/.active-slot"
METADATA_FILE="${DEPLOY_DIR}/.deploy-metadata"
LOCK_FILE="${DEPLOY_DIR}/.deploy.lock"
LOG_FILE="${DEPLOY_DIR}/deploy-$(date +%Y%m%d-%H%M%S).log"

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

# ─── Logging ─────────────────────────────────────────────────────────────────

log()   { echo -e "${BLUE}[$(date +%H:%M:%S)]${NC} $*" | tee -a "$LOG_FILE"; }
info()  { echo -e "${GREEN}[$(date +%H:%M:%S)] ✅${NC} $*" | tee -a "$LOG_FILE"; }
warn()  { echo -e "${YELLOW}[$(date +%H:%M:%S)] ⚠️${NC}  $*" | tee -a "$LOG_FILE"; }
error() { echo -e "${RED}[$(date +%H:%M:%S)] ❌${NC} $*" | tee -a "$LOG_FILE"; }

# ─── Lock ────────────────────────────────────────────────────────────────────

cd "$DEPLOY_DIR" || { echo "❌ Deploy directory $DEPLOY_DIR not found."; exit 1; }
mkdir -p "$DEPLOY_DIR"

exec 200>"$LOCK_FILE"
flock -n 200 || { error "Another deployment is in progress (lock: $LOCK_FILE)"; exit 1; }

# ─── Step 1: Determine slots ────────────────────────────────────────────────

log "═══════════════════════════════════════════════════════════════"
log "  MyFinPro Blue-Green Deployment — ${ENVIRONMENT^^}"
log "  Image tag: ${IMAGE_TAG}"
log "  Started at: $(date)"
log "═══════════════════════════════════════════════════════════════"

CURRENT_SLOT=$(cat "$ACTIVE_SLOT_FILE" 2>/dev/null || echo "none")

if [ "$CURRENT_SLOT" = "blue" ]; then
  NEXT_SLOT="green"
elif [ "$CURRENT_SLOT" = "green" ]; then
  NEXT_SLOT="blue"
else
  NEXT_SLOT="blue"
  CURRENT_SLOT="none"
fi

log "Current active slot: ${CURRENT_SLOT}"
log "Deploying to slot:   ${NEXT_SLOT}"

# Save intended deployment tag before sourcing metadata (which may overwrite IMAGE_TAG)
_DEPLOY_IMAGE_TAG="$IMAGE_TAG"
_DEPLOY_GIT_SHA="${GIT_SHA:-}"

PREV_IMAGE_TAG=""
PREV_GIT_SHA=""
if [ -f "$METADATA_FILE" ]; then
  # shellcheck source=/dev/null
  source "$METADATA_FILE" 2>/dev/null || true
  PREV_IMAGE_TAG="${IMAGE_TAG:-}"
  PREV_GIT_SHA="${GIT_SHA:-}"
fi

# Restore the intended deployment values (overwritten by source)
IMAGE_TAG="$_DEPLOY_IMAGE_TAG"
GIT_SHA="$_DEPLOY_GIT_SHA"

# Export variables needed by compose files
export DEPLOY_SLOT="$NEXT_SLOT"
export IMAGE_TAG
export ACTIVE_SLOT="$NEXT_SLOT"

# ─── Step 2: Pull new images ────────────────────────────────────────────────

log "Pulling new images (tag: ${IMAGE_TAG})..."
docker compose -p "myfinpro-${ENVIRONMENT}-${NEXT_SLOT}" \
  -f "$APP_COMPOSE" pull || {
  error "Failed to pull images."
  exit 1
}
info "Images pulled successfully."

# ─── Step 3: Ensure infrastructure is running ────────────────────────────────

log "Ensuring infrastructure services are running..."
docker compose -p "myfinpro-${ENVIRONMENT}-infra" \
  -f "$INFRA_COMPOSE" up -d

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
        docker logs --tail 20 "$container" 2>&1 | tee -a "$LOG_FILE" || true
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

wait_for_container_health "${CONTAINER_PREFIX}-mysql" 60
wait_for_container_health "${CONTAINER_PREFIX}-redis" 30
info "Infrastructure services are healthy."

# ─── Step 4: Start new slot ─────────────────────────────────────────────────

log "Starting new slot: ${NEXT_SLOT}..."
docker compose -p "myfinpro-${ENVIRONMENT}-${NEXT_SLOT}" \
  -f "$APP_COMPOSE" up -d

# ─── Step 4.5: Run database migrations ──────────────────────────────────────

log "Running database migrations (prisma migrate deploy)..."
# Wait a few seconds for the API container to start
sleep 5
docker exec "${CONTAINER_PREFIX}-api-${NEXT_SLOT}" npx prisma migrate deploy 2>&1 | tee -a "$LOG_FILE" || {
  warn "Prisma migrate deploy failed — check migration status."
}
info "Database migrations complete."

# ─── Step 5: Wait for health checks ─────────────────────────────────────────

log "Waiting for new slot health checks..."
wait_for_container_health "${CONTAINER_PREFIX}-api-${NEXT_SLOT}" 90
wait_for_container_health "${CONTAINER_PREFIX}-web-${NEXT_SLOT}" 90
info "New slot ${NEXT_SLOT} is healthy!"

# ─── Step 6: Switch shared Nginx to new slot ─────────────────────────────────

log "Switching shared Nginx traffic to slot: ${NEXT_SLOT} for ${ENVIRONMENT}..."

# Generate per-environment nginx config pointing to the new slot
export ACTIVE_SLOT="$NEXT_SLOT"
export ENVIRONMENT
envsubst '$SERVER_NAME $ACTIVE_SLOT $ENVIRONMENT' \
  < infrastructure/nginx/conf.d/ssl.conf.template \
  > "${SHARED_DIR}/nginx/conf.d/${ENVIRONMENT}.conf"

log "Generated ${ENVIRONMENT}.conf in shared nginx config directory."

# Test nginx config before reloading
docker exec "${NGINX_CONTAINER}" nginx -t 2>&1 | tee -a "$LOG_FILE" || {
  error "Nginx config test failed! Aborting traffic switch."
  # Remove the bad config
  rm -f "${SHARED_DIR}/nginx/conf.d/${ENVIRONMENT}.conf"
  # Stop the new slot since we can't switch to it
  docker compose -p "myfinpro-${ENVIRONMENT}-${NEXT_SLOT}" \
    -f "$APP_COMPOSE" down 2>/dev/null || true
  exit 1
}

# Graceful reload — no dropped connections
docker exec "${NGINX_CONTAINER}" nginx -s reload
info "Nginx reloaded — traffic now flows to ${NEXT_SLOT} for ${ENVIRONMENT}."

# ─── Step 7: Drain & verify ─────────────────────────────────────────────────

log "Allowing in-flight requests to drain (5s)..."
sleep 5

log "Verifying deployment through Nginx..."
VERIFY_RETRIES=10
VERIFY_OK=false
for i in $(seq 1 "$VERIFY_RETRIES"); do
  if curl -sf -H "Host: ${SERVER_NAME}" "http://localhost/api/v1/health" > /dev/null 2>&1; then
    VERIFY_OK=true
    break
  fi
  log "  Health check attempt $i/${VERIFY_RETRIES}..."
  sleep 3
done

if [ "$VERIFY_OK" = false ]; then
  error "CRITICAL: Health check through Nginx failed after switch!"
  warn "Emergency: switching Nginx back to previous slot..."

  if [ "$CURRENT_SLOT" != "none" ]; then
    export ACTIVE_SLOT="$CURRENT_SLOT"
    envsubst '$SERVER_NAME $ACTIVE_SLOT $ENVIRONMENT' \
      < infrastructure/nginx/conf.d/ssl.conf.template \
      > "${SHARED_DIR}/nginx/conf.d/${ENVIRONMENT}.conf"
    docker exec "${NGINX_CONTAINER}" nginx -s reload
    warn "Nginx reverted to slot: ${CURRENT_SLOT} for ${ENVIRONMENT}"
  else
    # First deploy, nothing to revert to — remove the env config
    rm -f "${SHARED_DIR}/nginx/conf.d/${ENVIRONMENT}.conf"
    docker exec "${NGINX_CONTAINER}" nginx -s reload 2>/dev/null || true
  fi

  # Stop the failed new slot
  docker compose -p "myfinpro-${ENVIRONMENT}-${NEXT_SLOT}" \
    -f "$APP_COMPOSE" down 2>/dev/null || true

  exit 1
fi

info "Post-switch health check passed!"

# ─── Step 8: Write state files ───────────────────────────────────────────────

log "Saving deployment state..."
echo "$NEXT_SLOT" > "$ACTIVE_SLOT_FILE"

cat > "$METADATA_FILE" << EOF
DEPLOY_TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)
ACTIVE_SLOT=${NEXT_SLOT}
PREVIOUS_SLOT=${CURRENT_SLOT}
IMAGE_TAG=${IMAGE_TAG}
PREVIOUS_IMAGE_TAG=${PREV_IMAGE_TAG}
GIT_SHA=${IMAGE_TAG}
PREVIOUS_GIT_SHA=${PREV_GIT_SHA}
DEPLOY_STATUS=success
EOF

info "State saved: active=${NEXT_SLOT}, previous=${CURRENT_SLOT}"

# ─── Step 9: Stop old slot ──────────────────────────────────────────────────

if [ "$CURRENT_SLOT" != "none" ]; then
  log "Stopping old slot: ${CURRENT_SLOT}..."
  # Need to set DEPLOY_SLOT for the old slot's compose context
  DEPLOY_SLOT="$CURRENT_SLOT" docker compose -p "myfinpro-${ENVIRONMENT}-${CURRENT_SLOT}" \
    -f "$APP_COMPOSE" down 2>/dev/null || {
    warn "Failed to stop old slot ${CURRENT_SLOT} — may need manual cleanup."
  }
  info "Old slot ${CURRENT_SLOT} stopped."
else
  log "No previous slot to stop (first deployment)."
fi

# ─── Step 10: Smart cleanup ─────────────────────────────────────────────────

if [ -f scripts/cleanup-images.sh ]; then
  log "Running smart image cleanup..."
  bash scripts/cleanup-images.sh "$ENVIRONMENT" || {
    warn "Cleanup encountered errors (non-fatal)."
  }
else
  log "Cleanup script not found — running basic prune..."
  docker image prune -f 2>/dev/null || true
fi

# ─── Done ────────────────────────────────────────────────────────────────────

log "═══════════════════════════════════════════════════════════════"
info "🚀 Blue-green deployment to ${ENVIRONMENT} completed successfully!"
info "   Active slot: ${NEXT_SLOT}"
info "   Image tag:   ${IMAGE_TAG}"
log "═══════════════════════════════════════════════════════════════"
