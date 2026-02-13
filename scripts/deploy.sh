#!/usr/bin/env bash
# scripts/deploy.sh — Deploy MyFinPro services with ephemeral secret injection
#
# Security pattern:
#   1. Accept env vars (from CI) or read from GitHub Secrets via `gh` CLI
#   2. Write temp .env file
#   3. docker compose up
#   4. shred .env (secrets never persist on disk)
#
# Usage:
#   ./scripts/deploy.sh [staging|production]
#
# When called from GitHub Actions, env vars are pre-set via SSH envs.
# For manual deployment, ensure required env vars are exported or use `gh` CLI.

set -euo pipefail

# ─── Configuration ───────────────────────────────────────────────────────────

ENVIRONMENT="${1:-staging}"
DEPLOY_DIR="/opt/myfinpro/${ENVIRONMENT}"
COMPOSE_FILE="docker-compose.${ENVIRONMENT}.yml"
ENV_FILE=".env"
HEALTH_CHECK_URL="http://localhost/api/v1/health"
HEALTH_CHECK_RETRIES=20
HEALTH_CHECK_INTERVAL=5
BACKUP_TAG_FILE="${DEPLOY_DIR}/.previous-image-tags"
LOG_FILE="${DEPLOY_DIR}/deploy-$(date +%Y%m%d-%H%M%S).log"

# ─── Colors ──────────────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

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
    error "Compose file $COMPOSE_FILE not found in $DEPLOY_DIR."
    exit 1
  fi

  log "Deploying to ${ENVIRONMENT} environment..."
}

# ─── Write ephemeral .env file ───────────────────────────────────────────────

write_env_file() {
  log "Writing ephemeral .env file..."

  # Required variables — check they are set
  local required_vars=(
    MYSQL_ROOT_PASSWORD MYSQL_DATABASE MYSQL_USER MYSQL_PASSWORD
    DATABASE_URL JWT_SECRET JWT_REFRESH_SECRET REDIS_URL
    NODE_ENV API_PORT CORS_ORIGIN LOG_LEVEL SWAGGER_ENABLED
    RATE_LIMIT_TTL RATE_LIMIT_MAX NEXT_PUBLIC_API_URL API_INTERNAL_URL
    GHCR_REPO IMAGE_TAG
  )

  for var in "${required_vars[@]}"; do
    if [ -z "${!var:-}" ]; then
      error "Required env var $var is not set. Set it as an environment variable or configure GitHub Secrets."
      exit 1
    fi
  done

  cat > "$ENV_FILE" << EOF
MYSQL_ROOT_PASSWORD=${MYSQL_ROOT_PASSWORD}
MYSQL_DATABASE=${MYSQL_DATABASE}
MYSQL_USER=${MYSQL_USER}
MYSQL_PASSWORD=${MYSQL_PASSWORD}
DATABASE_URL=${DATABASE_URL}
JWT_SECRET=${JWT_SECRET}
JWT_REFRESH_SECRET=${JWT_REFRESH_SECRET}
REDIS_URL=${REDIS_URL}
NODE_ENV=${NODE_ENV}
API_PORT=${API_PORT}
CORS_ORIGIN=${CORS_ORIGIN}
LOG_LEVEL=${LOG_LEVEL}
SWAGGER_ENABLED=${SWAGGER_ENABLED}
RATE_LIMIT_TTL=${RATE_LIMIT_TTL}
RATE_LIMIT_MAX=${RATE_LIMIT_MAX}
NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
API_INTERNAL_URL=${API_INTERNAL_URL}
GHCR_REPO=${GHCR_REPO}
IMAGE_TAG=${IMAGE_TAG}
EOF

  chmod 600 "$ENV_FILE"
  info "Ephemeral .env file written."
}

# ─── Shred .env file ────────────────────────────────────────────────────────

shred_env_file() {
  log "Shredding ephemeral .env file..."
  if [ -f "$ENV_FILE" ]; then
    shred -vfz -n 3 "$ENV_FILE" 2>/dev/null || rm -f "$ENV_FILE"
    info ".env file securely removed."
  fi
}

# Ensure .env is shredded on exit (even on failure)
trap shred_env_file EXIT

# ─── Save current image tags for rollback ────────────────────────────────────

save_current_tags() {
  log "Saving current image tags for rollback..."
  if docker compose -f "$COMPOSE_FILE" ps --format json 2>/dev/null | head -1 | grep -q "Service"; then
    docker compose -f "$COMPOSE_FILE" config --images 2>/dev/null > "$BACKUP_TAG_FILE" || true
  fi
  docker inspect --format='{{.Config.Image}}' \
    $(docker compose -f "$COMPOSE_FILE" ps -q api 2>/dev/null) 2>/dev/null >> "$BACKUP_TAG_FILE" || true
  docker inspect --format='{{.Config.Image}}' \
    $(docker compose -f "$COMPOSE_FILE" ps -q web 2>/dev/null) 2>/dev/null >> "$BACKUP_TAG_FILE" || true
  info "Current image tags saved to $BACKUP_TAG_FILE"
}

# ─── Pull latest images ─────────────────────────────────────────────────────

pull_images() {
  log "Pulling latest Docker images..."
  docker compose -f "$COMPOSE_FILE" pull api web || {
    error "Failed to pull images."
    exit 1
  }
  info "Images pulled successfully."
}

# ─── Run database migrations ─────────────────────────────────────────────────

run_migrations() {
  log "Running database migrations..."

  # Ensure database is running first
  docker compose -f "$COMPOSE_FILE" up -d mysql
  log "Waiting for MySQL to be healthy..."
  local retries=30
  for i in $(seq 1 "$retries"); do
    if docker compose -f "$COMPOSE_FILE" exec -T mysql mysqladmin ping -h localhost --silent 2>/dev/null; then
      info "MySQL is healthy."
      break
    fi
    if [ "$i" -eq "$retries" ]; then
      error "MySQL did not become healthy within timeout."
      exit 1
    fi
    sleep 2
  done

  # Run Prisma migrations via the API container
  docker compose -f "$COMPOSE_FILE" run --rm --no-deps api \
    npx prisma migrate deploy --schema=prisma/schema.prisma 2>&1 | tee -a "$LOG_FILE" || {
    error "Database migration failed!"
    exit 1
  }
  info "Database migrations completed successfully."
}

# ─── Zero-downtime service restart ───────────────────────────────────────────

restart_services() {
  log "Starting zero-downtime service restart..."

  # 1. Ensure infrastructure services are up
  log "Ensuring infrastructure services are running..."
  docker compose -f "$COMPOSE_FILE" up -d mysql redis
  sleep 5

  # 2. Rolling restart — API first, then Web
  log "Restarting API service..."
  docker compose -f "$COMPOSE_FILE" up -d --no-deps --force-recreate api
  wait_for_health "api" "http://localhost:3001/api/v1/health" 30

  log "Restarting Web service..."
  docker compose -f "$COMPOSE_FILE" up -d --no-deps --force-recreate web
  wait_for_health "web" "http://localhost:3000" 30

  # 3. Restart Nginx to pick up any upstream changes
  log "Restarting Nginx..."
  docker compose -f "$COMPOSE_FILE" up -d --no-deps --force-recreate nginx
  sleep 3

  info "All services restarted successfully."
}

# ─── Wait for a service health check ─────────────────────────────────────────

wait_for_health() {
  local service_name="$1"
  local health_url="$2"
  local max_retries="${3:-20}"

  log "Waiting for $service_name to become healthy..."
  for i in $(seq 1 "$max_retries"); do
    local health_status
    health_status=$(docker compose -f "$COMPOSE_FILE" ps "$service_name" --format json 2>/dev/null | grep -o '"Health":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "unknown")
    if [ "$health_status" = "healthy" ]; then
      info "$service_name is healthy."
      return 0
    fi
    if [ "$i" -eq "$max_retries" ]; then
      error "$service_name did not become healthy within $max_retries attempts."
      return 1
    fi
    log "  $service_name status: $health_status (attempt $i/$max_retries)"
    sleep "$HEALTH_CHECK_INTERVAL"
  done
}

# ─── Final health verification ───────────────────────────────────────────────

verify_deployment() {
  log "Running final health verification..."

  for i in $(seq 1 "$HEALTH_CHECK_RETRIES"); do
    if curl -sf "$HEALTH_CHECK_URL" > /dev/null 2>&1; then
      info "Final health check passed — deployment successful!"
      return 0
    fi
    if [ "$i" -eq "$HEALTH_CHECK_RETRIES" ]; then
      error "Final health check failed after $HEALTH_CHECK_RETRIES attempts."
      return 1
    fi
    log "  Health check attempt $i/$HEALTH_CHECK_RETRIES..."
    sleep "$HEALTH_CHECK_INTERVAL"
  done
}

# ─── Cleanup old images ─────────────────────────────────────────────────────

cleanup() {
  log "Cleaning up dangling images..."
  docker image prune -f 2>/dev/null || true
  info "Cleanup complete."
}

# ─── Main ────────────────────────────────────────────────────────────────────

main() {
  log "═══════════════════════════════════════════════════════════════"
  log "  MyFinPro Deployment — ${ENVIRONMENT^^}"
  log "  Started at: $(date)"
  log "  Security: Ephemeral secret injection (write → compose up → shred)"
  log "═══════════════════════════════════════════════════════════════"

  validate_environment
  write_env_file
  save_current_tags
  pull_images
  run_migrations
  restart_services

  # .env is shredded by the EXIT trap after compose up reads it

  if verify_deployment; then
    cleanup
    log "═══════════════════════════════════════════════════════════════"
    info "🚀 Deployment to ${ENVIRONMENT} completed successfully!"
    log "═══════════════════════════════════════════════════════════════"
    exit 0
  else
    error "Deployment verification failed! Initiating rollback..."
    if [ -f scripts/rollback.sh ]; then
      bash scripts/rollback.sh "$ENVIRONMENT"
    fi
    exit 1
  fi
}

main "$@"
