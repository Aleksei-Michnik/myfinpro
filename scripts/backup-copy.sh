#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# MyFinPro off-box backup copy
# Takes the newest scheduled backup of an environment (fetched from the server
# over SSH, or a local file), encrypts it to an age recipient, and publishes it
# into a private git repository — the "store" — whose history is one snapshot
# commit that is force-pushed on every run, so the store holds exactly the files
# it keeps and never grows with history. The age identity that decrypts the
# copies never reaches this script or the server: only the owner holds it.
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/backup-common.sh
source "${SCRIPT_DIR}/backup-common.sh"

ENVIRONMENT="${1:-production}"
AGE_RECIPIENT="${AGE_RECIPIENT:-}"
STORE_URL="${STORE_URL:-}"
STORE_SSH_KEY_FILE="${STORE_SSH_KEY_FILE:-}"
STORE_BRANCH="${STORE_BRANCH:-main}"
STORE_KEEP="${STORE_KEEP:-14}"
SOURCE_FILE="${SOURCE_FILE:-}"
SERVER_HOST="${SERVER_HOST:-}"
SERVER_USER="${SERVER_USER:-}"
SERVER_SSH_KEY_FILE="${SERVER_SSH_KEY_FILE:-}"
LOG_PREFIX="[backup-copy]"

usage() {
  cat <<USAGE
Usage: $(basename "$0") [production|staging]

Copies the newest scheduled backup of an environment off the server: encrypts
it to an age recipient and commits it into the store repository as
<environment>/<file>.age, keeping the newest STORE_KEEP files there.

Environment variables:
  AGE_RECIPIENT         age public key (age1…) the copy is encrypted to   (required)
  STORE_URL             git URL of the private store repository           (required)
  STORE_SSH_KEY_FILE    SSH private key that may push to the store        (ssh URLs)
  STORE_BRANCH          branch that holds the snapshot (default: $STORE_BRANCH)
  STORE_KEEP            files kept per environment (default: $STORE_KEEP)
  SERVER_HOST, SERVER_USER, SERVER_SSH_KEY_FILE
                        SSH access to the server that holds the backups
  BACKUP_ROOT           server-side backup root (default: $BACKUP_ROOT)
  SOURCE_FILE           a local .sql.gz to copy instead of fetching over SSH

Exit codes:
  0  Copy published
  1  Copy failed
  2  Invalid arguments or missing tools
USAGE
  exit 0
}

log() {
  echo "$LOG_PREFIX $(date '+%Y-%m-%d %H:%M:%S') $*"
}

die() {
  echo "$LOG_PREFIX $(date '+%Y-%m-%d %H:%M:%S') ERROR: $1" >&2
  exit "${2:-1}"
}

[[ "${1:-}" == "--help" ]] && usage
case "$ENVIRONMENT" in production | staging) ;; *) die "Unknown environment: $ENVIRONMENT" 2 ;; esac
[[ -n "$AGE_RECIPIENT" ]] || die "AGE_RECIPIENT is required" 2
[[ -n "$STORE_URL" ]] || die "STORE_URL is required" 2
command -v age > /dev/null || die "age is not installed" 2
command -v git > /dev/null || die "git is not installed" 2
if [[ -z "$SOURCE_FILE" ]]; then
  [[ -n "$SERVER_HOST" && -n "$SERVER_USER" && -n "$SERVER_SSH_KEY_FILE" ]] \
    || die "SERVER_HOST, SERVER_USER and SERVER_SSH_KEY_FILE are required without SOURCE_FILE" 2
  command -v ssh > /dev/null || die "ssh is not installed" 2
fi

WORK_DIR="$(mktemp -d)"
cleanup() { rm -rf "$WORK_DIR"; }
trap cleanup EXIT

# ---------------------------------------------------------------------------
# 1. The newest scheduled backup
# ---------------------------------------------------------------------------
if [[ -n "$SOURCE_FILE" ]]; then
  [[ -f "$SOURCE_FILE" ]] || die "Source file not found: $SOURCE_FILE"
  BACKUP_NAME="$(basename "$SOURCE_FILE")"
  cp "$SOURCE_FILE" "$WORK_DIR/$BACKUP_NAME"
  log "Source: $SOURCE_FILE"
else
  SSH_OPTS=(-i "$SERVER_SSH_KEY_FILE" -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=accept-new)
  REMOTE_DIR="$(backup_env_dir "$ENVIRONMENT")"
  LATEST="$(ssh "${SSH_OPTS[@]}" "$SERVER_USER@$SERVER_HOST" \
    "ls -t '$REMOTE_DIR'/${BACKUP_FILE_PREFIX}*.sql.gz 2>/dev/null | head -1")"
  [[ -n "$LATEST" ]] || die "No scheduled backup found on the server in $REMOTE_DIR"
  BACKUP_NAME="$(basename "$LATEST")"
  log "Fetching $BACKUP_NAME from the server..."
  ssh "${SSH_OPTS[@]}" "$SERVER_USER@$SERVER_HOST" "cat '$LATEST'" > "$WORK_DIR/$BACKUP_NAME"
fi
[[ -s "$WORK_DIR/$BACKUP_NAME" ]] || die "Backup file is empty"
gunzip -t "$WORK_DIR/$BACKUP_NAME" 2> /dev/null || die "Backup file failed gzip integrity check"

# ---------------------------------------------------------------------------
# 2. Encrypt; the plaintext leaves this process right after
# ---------------------------------------------------------------------------
ENCRYPTED="$WORK_DIR/$BACKUP_NAME.age"
age -r "$AGE_RECIPIENT" -o "$ENCRYPTED" "$WORK_DIR/$BACKUP_NAME"
rm -f "$WORK_DIR/$BACKUP_NAME"
log "Encrypted: $BACKUP_NAME.age ($(du -h "$ENCRYPTED" | cut -f1))"

# ---------------------------------------------------------------------------
# 3. Publish into the store as a single snapshot commit
# ---------------------------------------------------------------------------
if [[ -n "$STORE_SSH_KEY_FILE" ]]; then
  export GIT_SSH_COMMAND="ssh -i $STORE_SSH_KEY_FILE -o IdentitiesOnly=yes -o BatchMode=yes"
fi
STORE_DIR="$WORK_DIR/store"
log "Cloning the store..."
if ! git clone -q --depth 1 --branch "$STORE_BRANCH" "$STORE_URL" "$STORE_DIR" 2> /dev/null; then
  # An empty store has no branch yet.
  git clone -q "$STORE_URL" "$STORE_DIR" 2> /dev/null || die "Cannot clone the store"
fi

mkdir -p "$STORE_DIR/$ENVIRONMENT"
cp "$ENCRYPTED" "$STORE_DIR/$ENVIRONMENT/"
# Keep the newest STORE_KEEP files; names sort chronologically.
find "$STORE_DIR/$ENVIRONMENT" -maxdepth 1 -name "${BACKUP_FILE_PREFIX}*.sql.gz.age" -type f \
  | sort -r | tail -n +"$((STORE_KEEP + 1))" | while IFS= read -r old; do
  log "Pruning from the store: $(basename "$old")"
  rm -f "$old"
done

cat > "$STORE_DIR/README.md" <<README
# Encrypted database backups

Written by the backup workflow of the application repository; every run replaces this
snapshot. Each \`<environment>/<name>.sql.gz.age\` is a gzipped \`mysqldump\` encrypted to the
owner's age recipient. To restore, decrypt with the owner's identity and use the application's
restore script:

\`\`\`bash
age -d -i backup-age-identity.txt -o <name>.sql.gz <environment>/<name>.sql.gz.age
scripts/restore.sh <name>.sql.gz <environment>
\`\`\`
README

(
  cd "$STORE_DIR"
  git checkout -q --orphan snapshot
  git add -A
  git -c user.name="myfinpro backup" -c user.email="myfinpro-backup@users.noreply.github.com" \
    commit -q -m "Snapshot $(date -u '+%Y-%m-%dT%H:%M:%SZ'): $ENVIRONMENT $BACKUP_NAME"
  git push -q --force origin "snapshot:$STORE_BRANCH"
)
log "Published to the store ($STORE_BRANCH). Files kept for $ENVIRONMENT:"
find "$STORE_DIR/$ENVIRONMENT" -maxdepth 1 -name '*.age' -type f -printf '%f\n' | sort
exit 0
