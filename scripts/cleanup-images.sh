#!/usr/bin/env bash
# scripts/cleanup-images.sh — Smart Docker image cleanup for MyFinPro
#
# Keeps current + previous deployment images for rollback capability.
# Removes all other GHCR images, dangling images, and build cache.
# NEVER touches Docker volumes (database data).
#
# Usage:
#   ./scripts/cleanup-images.sh <staging|production>

set -euo pipefail

# ─── Arguments ───────────────────────────────────────────────────────────────

ENV="${1:-staging}"

if [[ "$ENV" != "staging" && "$ENV" != "production" ]]; then
  echo "❌ Invalid environment: $ENV. Must be 'staging' or 'production'."
  exit 1
fi

# ─── Configuration ───────────────────────────────────────────────────────────

DEPLOY_DIR="/opt/myfinpro/${ENV}"
METADATA_FILE="${DEPLOY_DIR}/.deploy-metadata"
GHCR_PREFIX="ghcr.io/aleksei-michnik/myfinpro"

# ─── Load deployment metadata ───────────────────────────────────────────────

CURRENT_TAG=""
PREVIOUS_TAG=""

if [ -f "$METADATA_FILE" ]; then
  # shellcheck source=/dev/null
  source "$METADATA_FILE" 2>/dev/null || true
  CURRENT_TAG="${IMAGE_TAG:-}"
  PREVIOUS_TAG="${PREVIOUS_IMAGE_TAG:-}"
fi

# Build list of tags to keep
KEEP_TAGS=()

if [ -n "$CURRENT_TAG" ]; then
  KEEP_TAGS+=("$CURRENT_TAG")
fi

if [ -n "$PREVIOUS_TAG" ]; then
  KEEP_TAGS+=("$PREVIOUS_TAG")
fi

# Always keep the environment's floating tags
KEEP_TAGS+=("latest" "staging")

echo "=== Smart Image Cleanup for ${ENV} ==="
echo "Keeping tags: ${KEEP_TAGS[*]}"
echo ""

# ─── Track space before cleanup ─────────────────────────────────────────────

SPACE_BEFORE=$(docker system df --format '{{.Size}}' 2>/dev/null | head -1 || echo "unknown")

# ─── Remove old GHCR images ─────────────────────────────────────────────────

REMOVED_COUNT=0
KEPT_COUNT=0

ALL_IMAGES=$(docker images --format '{{.Repository}}:{{.Tag}}' 2>/dev/null \
  | grep "^${GHCR_PREFIX}" | sort -u || true)

if [ -z "$ALL_IMAGES" ]; then
  echo "No GHCR images found for ${GHCR_PREFIX}"
else
  for image in $ALL_IMAGES; do
    tag="${image##*:}"
    should_keep=false

    for keep_tag in "${KEEP_TAGS[@]}"; do
      # Exact match
      if [ "$tag" = "$keep_tag" ]; then
        should_keep=true
        break
      fi
      # SHA-prefixed tag match (e.g., "staging-abc1234" matches tag "staging-abc1234")
      if [[ "$tag" == *"-${keep_tag}" ]] || [[ "$tag" == "${keep_tag}-"* ]]; then
        should_keep=true
        break
      fi
    done

    if [ "$should_keep" = true ]; then
      echo "  KEEP:   $image"
      KEPT_COUNT=$((KEPT_COUNT + 1))
    else
      echo "  REMOVE: $image"
      docker rmi "$image" 2>/dev/null || true
      REMOVED_COUNT=$((REMOVED_COUNT + 1))
    fi
  done
fi

echo ""
echo "Images: kept=${KEPT_COUNT}, removed=${REMOVED_COUNT}"

# ─── Prune dangling images ──────────────────────────────────────────────────

echo ""
echo "Pruning dangling images..."
docker image prune -f 2>/dev/null || true

# ─── Prune build cache (keep 1GB for minor local operations) ────────────────

echo ""
echo "Pruning build cache (keeping 1GB)..."
docker builder prune -f --keep-storage=1073741824 2>/dev/null || true

# ─── Prune stopped containers ───────────────────────────────────────────────

echo ""
echo "Pruning stopped containers..."
docker container prune -f 2>/dev/null || true

# ─── Clean old deploy/rollback logs ─────────────────────────────────────────

echo ""
echo "Cleaning old log files (>30 days)..."
find "$DEPLOY_DIR" -name 'deploy-*.log' -mtime +30 -delete 2>/dev/null || true
find "$DEPLOY_DIR" -name 'rollback-*.log' -mtime +30 -delete 2>/dev/null || true

# ─── Report ──────────────────────────────────────────────────────────────────

SPACE_AFTER=$(docker system df --format '{{.Size}}' 2>/dev/null | head -1 || echo "unknown")

echo ""
echo "=== Docker Disk Usage ==="
docker system df 2>/dev/null || true
echo ""
echo "Space before: ${SPACE_BEFORE}"
echo "Space after:  ${SPACE_AFTER}"
echo ""
echo "=== Cleanup Complete ==="
