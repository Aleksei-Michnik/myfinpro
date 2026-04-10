#!/bin/sh
set -e

# Generate domain-specific Haraka config files from environment variables
# These are NOT committed to git — they're created at container startup

MAIL_DOMAIN="${HARAKA_MAIL_DOMAIN:?HARAKA_MAIL_DOMAIN is required}"
MAIL_HOSTNAME="${HARAKA_MAIL_HOSTNAME:-mail.${MAIL_DOMAIN}}"

# config/me — SMTP EHLO/HELO hostname (must match PTR record)
echo "${MAIL_HOSTNAME}" > /opt/haraka/config/me

# config/host_list — domains Haraka is authorized to send for
echo "${MAIL_DOMAIN}" > /opt/haraka/config/host_list

# config/dkim_sign.ini — DKIM signing configuration (built-in dkim_sign plugin)
cat > /opt/haraka/config/dkim_sign.ini <<EOF
; DKIM signing configuration (generated at startup from env vars)
disabled=false
selector=mail
domain=${MAIL_DOMAIN}

; Headers to include in DKIM signature
headers_to_sign=from:to:subject:date:message-id:content-type:mime-version:reply-to
EOF

# Set up DKIM key directory structure
# Haraka expects keys at: config/dkim/<domain>/private
DKIM_SRC="/opt/haraka/dkim-keys"
DKIM_DEST="/opt/haraka/config/dkim/${MAIL_DOMAIN}"

if [ -f "${DKIM_SRC}/private" ]; then
  mkdir -p "${DKIM_DEST}"
  cp "${DKIM_SRC}/private" "${DKIM_DEST}/private"
  cp "${DKIM_SRC}/selector" "${DKIM_DEST}/selector"
  if [ -f "${DKIM_SRC}/public" ]; then
    cp "${DKIM_SRC}/public" "${DKIM_DEST}/public"
  fi
  echo "[entrypoint] DKIM keys installed for ${MAIL_DOMAIN}"
else
  echo "[entrypoint] WARNING: No DKIM private key found at ${DKIM_SRC}/private"
  echo "[entrypoint] DKIM signing will NOT work without the private key"
fi

echo "[entrypoint] Haraka configured for domain: ${MAIL_DOMAIN}"
echo "[entrypoint] EHLO hostname: ${MAIL_HOSTNAME}"

# Start Haraka
exec haraka -c /opt/haraka
