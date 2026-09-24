#!/usr/bin/env bash
# shellcheck shell=bash
# =============================================================================
# Shared helpers for the backup scripts (backup.sh, verify-backup.sh,
# restore.sh, check-backup-age.sh). Sourced, never executed.
#
# Two ways to reach MySQL:
#   * an environment name (production | staging): the dump runs inside that
#     environment's MySQL container with the container's own MYSQL_ROOT_PASSWORD
#     and MYSQL_DATABASE. No credential is read from disk or passed on the host
#     command line — the password expands inside the container only.
#   * a direct connection (--host/--port/--user/--database): the CI drill in
#     backup-verify.yml; the password comes from the MYSQL_PASSWORD variable and
#     is handed to the client through MYSQL_PWD, never as an argument.
# =============================================================================

BACKUP_ROOT="${BACKUP_ROOT:-/opt/myfinpro/backups}"
BACKUP_FILE_PREFIX="myfinpro_"

# Container that holds an environment's database (container_name in the
# docker-compose.<env>.infra.yml files).
backup_env_container() {
  case "$1" in
    production) echo "myfinpro-prod-mysql" ;;
    staging) echo "myfinpro-staging-mysql" ;;
    *) return 1 ;;
  esac
}

# Directory that holds an environment's backups.
backup_env_dir() {
  echo "${BACKUP_ROOT}/$1"
}

container_running() {
  docker ps --format '{{.Names}}' | grep -qx "$1"
}

# Database name as the container knows it.
container_database() {
  docker exec "$1" sh -c 'printf %s "$MYSQL_DATABASE"'
}

# Run a MySQL client inside the container as root with the container's own
# password. $1 container, $2 client (mysql | mysqldump), rest: client args.
# Stdin is forwarded (restores pipe SQL in); the client's "password on the
# command line" notice is dropped from stderr.
container_mysql() {
  local container="$1" client="$2"
  shift 2
  docker exec -i "$container" \
    sh -c "exec $client -u root -p\"\$MYSQL_ROOT_PASSWORD\" \"\$@\"" sh "$@" \
    2> >(grep -v 'Using a password on the command line' >&2 || true)
}

# Direct-connection equivalent: password via MYSQL_PWD from MYSQL_PASSWORD.
direct_mysql() {
  local client="$1"
  shift
  MYSQL_PWD="${MYSQL_PASSWORD:-}" "$client" \
    --host="$MYSQL_HOST" --port="$MYSQL_PORT" --user="$MYSQL_USER" "$@"
}

# Newest scheduled backup in a directory (pre-deploy dumps are not counted).
find_latest_backup() {
  find "$1" -name "${BACKUP_FILE_PREFIX}*.sql.gz" -type f 2>/dev/null | sort -r | head -1
}

file_age_seconds() {
  local now file_time
  now=$(date +%s)
  file_time=$(stat -c %Y "$1" 2>/dev/null || stat -f %m "$1" 2>/dev/null)
  echo $((now - file_time))
}

# True when the file is older than N hours (compared in seconds, so a
# threshold of 0 fails for any file that is not brand new).
file_older_than_hours() {
  [[ $(file_age_seconds "$1") -gt $(($2 * 3600)) ]]
}

file_age_hours() {
  echo $(($(file_age_seconds "$1") / 3600))
}
