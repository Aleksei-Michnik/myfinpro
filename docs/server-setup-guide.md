# Server Setup Guide — Staging & Production

> **MyFinPro** — Complete server provisioning guide for Ubuntu 22.04–24.04.
> Follow this guide from a fresh Ubuntu server with SSH access to get a fully operational staging or production environment.

---

## Table of Contents

- [Variables & Conventions](#variables--conventions)
- [Part 1: Initial Server Setup](#part-1-initial-server-setup) (~30 min)
- [Part 2: Application Directory Setup](#part-2-application-directory-setup) (~10 min)
- [Part 3: SSL/TLS Setup (Production)](#part-3-ssltls-setup-production) (~15 min)
- [Part 4: GitHub Actions & Secrets Configuration](#part-4-github-actions--secrets-configuration) (~20 min)
- [Part 5: First Deployment](#part-5-first-deployment) (~15 min)
- [Part 6: Backup Configuration](#part-6-backup-configuration) (~15 min)
- [Part 7: Monitoring & Maintenance](#part-7-monitoring--maintenance)
- [Part 8: Staging-Specific Configuration](#part-8-staging-specific-configuration)
- [Part 9: Production-Specific Configuration](#part-9-production-specific-configuration)
- [Part 10: Security Architecture](#part-10-security-architecture)
- [Part 11: Troubleshooting](#part-11-troubleshooting)

---

## Variables & Conventions

Define these variables **before** running any commands. Replace placeholder values with your actual data.

```bash
# ── Set these on your LOCAL machine and on the server ──
export SERVER_IP="<YOUR_SERVER_IP>"                    # Your server's public IP
export DOMAIN="<YOUR_PRODUCTION_DOMAIN>"               # Production domain
export STAGING_DOMAIN="<YOUR_STAGING_DOMAIN>"           # Staging domain
export DEPLOY_USER="deploy"                             # Non-root deploy user
export GITHUB_USERNAME="<YOUR_GITHUB_USERNAME>"         # GitHub username (lowercase)
export GITHUB_REPO="<YOUR_GITHUB_USERNAME>/myfinpro"    # owner/repo (lowercase)
```

**Conventions used in this guide:**

| Convention | Meaning |
|---|---|
| `# (as root)` | Run as root or with `sudo` |
| `# (as deploy)` | Run as the `deploy` user |
| `# (local)` | Run on your local machine |
| `staging` / `production` | Replace with the target environment |

---

## Part 1: Initial Server Setup

> ⏱ Estimated time: **30 minutes**

### 1.1 Connect to the Server

```bash
# (local) — Connect as root (initial setup)
ssh root@$SERVER_IP
```

### 1.2 Update the System

```bash
# (as root)
apt update && apt upgrade -y
apt install -y curl wget git unzip htop net-tools software-properties-common
```

### 1.3 Create Deploy User

```bash
# (as root)
adduser --disabled-password --gecos "Deploy User" $DEPLOY_USER
usermod -aG sudo $DEPLOY_USER

# Allow passwordless sudo for deploy user (optional, but needed for CI/CD)
echo "$DEPLOY_USER ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/$DEPLOY_USER
chmod 0440 /etc/sudoers.d/$DEPLOY_USER
```

### 1.4 Configure SSH

#### Add your SSH key to the deploy user

```bash
# (local) — Copy your public key to the deploy user
ssh-copy-id -i ~/.ssh/id_ed25519.pub $DEPLOY_USER@$SERVER_IP
```

Or manually on the server:

```bash
# (as root)
mkdir -p /home/$DEPLOY_USER/.ssh
chmod 700 /home/$DEPLOY_USER/.ssh

# Paste your public key here:
cat >> /home/$DEPLOY_USER/.ssh/authorized_keys << 'EOF'
ssh-ed25519 AAAA... your-email@example.com
EOF

chmod 600 /home/$DEPLOY_USER/.ssh/authorized_keys
chown -R $DEPLOY_USER:$DEPLOY_USER /home/$DEPLOY_USER/.ssh
```

#### Harden SSH configuration

```bash
# (as root)
cp /etc/ssh/sshd_config /etc/ssh/sshd_config.bak

cat > /etc/ssh/sshd_config.d/99-hardened.conf << 'EOF'
# Disable root login
PermitRootLogin no

# Disable password authentication
PasswordAuthentication no

# Only allow key-based authentication
PubkeyAuthentication yes

# Disable empty passwords
PermitEmptyPasswords no

# Limit authentication attempts
MaxAuthTries 3

# Disable X11 forwarding
X11Forwarding no

# Timeout idle sessions (5 minutes)
ClientAliveInterval 300
ClientAliveCountMax 2
EOF

# Test the config before restarting
sshd -t && systemctl restart sshd
```

> ⚠️ **Before disconnecting**, verify you can log in as the deploy user from another terminal:
> ```bash
> ssh $DEPLOY_USER@$SERVER_IP
> ```

### 1.5 Configure Firewall (UFW)

```bash
# (as root)
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp comment 'SSH'
ufw allow 80/tcp comment 'HTTP'
ufw allow 443/tcp comment 'HTTPS'
ufw --force enable
ufw status verbose
```

**Verification:**

```bash
ufw status
# Expected output:
# 22/tcp    ALLOW    Anywhere
# 80/tcp    ALLOW    Anywhere
# 443/tcp   ALLOW    Anywhere
```

### 1.6 Install Docker Engine

Install from the official Docker repository (not snap):

```bash
# (as root)
# Remove old/conflicting packages
for pkg in docker.io docker-doc docker-compose podman-docker containerd runc; do
  apt-get remove -y $pkg 2>/dev/null || true
done

# Add Docker's official GPG key
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc

# Add the repository
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  tee /etc/apt/sources.list.d/docker.list > /dev/null

# Install Docker Engine + Compose plugin
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

### 1.7 Install Docker Compose

Docker Compose v2 is included as a plugin with the Docker Engine installation above.

**Verification:**

```bash
docker --version
# Docker version 27.x.x
docker compose version
# Docker Compose version v2.x.x
```

### 1.8 Install Node.js 22

Node.js is needed for running database migrations directly on the host if required.

```bash
# (as root)
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs

# Verify
node --version   # v22.x.x
npm --version    # 10.x.x
```

### 1.9 Configure Docker Permissions

```bash
# (as root)
usermod -aG docker $DEPLOY_USER

# Apply group change (or the deploy user must log out and back in)
newgrp docker
```

**Verification** (as the deploy user):

```bash
# (as deploy)
su - $DEPLOY_USER
docker ps
# Should work without sudo
```

### 1.10 Set Up Swap

Recommended for servers with ≤4 GB RAM:

```bash
# (as root)
# Check if swap already exists
swapon --show

# Create 2 GB swap file
fallocate -l 2G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile

# Make it permanent
echo '/swapfile none swap sw 0 0' >> /etc/fstab

# Optimize swappiness for a server
echo 'vm.swappiness=10' >> /etc/sysctl.conf
echo 'vm.vfs_cache_pressure=50' >> /etc/sysctl.conf
sysctl -p
```

**Verification:**

```bash
free -h
# Should show ~2 GB swap
```

### 1.11 System Hardening

#### Install fail2ban

```bash
# (as root)
apt install -y fail2ban

cat > /etc/fail2ban/jail.local << 'EOF'
[DEFAULT]
bantime = 3600
findtime = 600
maxretry = 5

[sshd]
enabled = true
port = ssh
logpath = /var/log/auth.log
maxretry = 3
bantime = 7200
EOF

systemctl enable fail2ban
systemctl start fail2ban
```

#### Enable unattended security upgrades

```bash
# (as root)
apt install -y unattended-upgrades
dpkg-reconfigure -plow unattended-upgrades
# Select "Yes" when prompted

# Verify it's enabled
systemctl status unattended-upgrades
```

#### Set timezone

```bash
# (as root)
timedatectl set-timezone UTC
# or your preferred timezone, e.g.:
# timedatectl set-timezone Asia/Jerusalem
```

**✅ Part 1 Verification Checklist:**

```bash
# Run all of these as the deploy user
ssh $DEPLOY_USER@$SERVER_IP

docker ps                  # Works without sudo
docker compose version     # v2.x.x
node --version             # v22.x.x
ufw status                 # Shows 22, 80, 443 allowed
free -h                    # Shows swap
sudo fail2ban-client status sshd  # Shows fail2ban running
```

---

## Part 2: Application Directory Setup

> ⏱ Estimated time: **10 minutes**

All commands below should be run as the **deploy** user.

### 2.1 Create Application Directories

```bash
# (as deploy)
sudo mkdir -p /opt/myfinpro/staging
sudo mkdir -p /opt/myfinpro/production
sudo chown -R $USER:$USER /opt/myfinpro
```

### 2.2 Set Up Directory Structure

```bash
# (as deploy)
for env in staging production; do
  cd /opt/myfinpro/$env

  mkdir -p \
    scripts \
    infrastructure/nginx/conf.d \
    infrastructure/mysql/init \
    infrastructure/backup \
    logs
done
```

> **Note:** No `.env` files are created on the server. Secrets are injected ephemerally by the deploy workflow from GitHub Secrets. See [Part 10: Security Architecture](#part-10-security-architecture).

**Verification:**

```bash
ls -la /opt/myfinpro/staging/
ls -la /opt/myfinpro/production/
# Should show scripts/, infrastructure/, logs/ directories
```

---

## Part 3: SSL/TLS Setup (Production)

> ⏱ Estimated time: **15 minutes**
>
> Skip this section for staging if you're not using HTTPS. For staging, HTTP on port 80 is usually sufficient (or use a self-signed cert).

### 3.1 Install Certbot

```bash
# (as root)
snap install --classic certbot
ln -sf /snap/bin/certbot /usr/bin/certbot
```

### 3.2 Obtain SSL Certificate

Before obtaining the cert, ensure DNS is already pointing to your server and port 80 is accessible.

```bash
# (as root)
# Stop anything on port 80 first (if Nginx container is running)
docker compose -f /opt/myfinpro/production/docker-compose.production.yml down nginx 2>/dev/null || true

# Obtain the certificate
certbot certonly --standalone \
  -d $DOMAIN \
  --email admin@$DOMAIN \
  --agree-tos \
  --non-interactive
```

**Verification:**

```bash
ls -la /etc/letsencrypt/live/$DOMAIN/
# Should contain: fullchain.pem, privkey.pem, cert.pem, chain.pem
```

### 3.3 Configure Nginx for HTTPS

Create a production Nginx config with SSL:

```bash
# (as deploy)
cat > /opt/myfinpro/production/infrastructure/nginx/conf.d/production-ssl.conf << 'NGINXEOF'
upstream api_upstream {
    server api:3001;
}

upstream web_upstream {
    server web:3000;
}

# ─── Redirect HTTP → HTTPS ───
server {
    listen 80;
    server_name _;

    # Allow Let's Encrypt challenge
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    # Health check (keep accessible on HTTP for internal checks)
    location = /health {
        access_log off;
        return 200 '{"status":"ok","service":"nginx"}';
        add_header Content-Type application/json;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

# ─── HTTPS Server ───
server {
    listen 443 ssl http2;
    server_name _;

    # SSL certificates (Let's Encrypt)
    ssl_certificate /etc/letsencrypt/live/DOMAIN_PLACEHOLDER/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/DOMAIN_PLACEHOLDER/privkey.pem;

    # SSL settings
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    # HSTS (enable after confirming SSL works)
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;

    # Health check
    location = /health {
        access_log off;
        return 200 '{"status":"ok","service":"nginx"}';
        add_header Content-Type application/json;
    }

    # API: Proxy /api/* to NestJS
    location /api/ {
        proxy_pass http://api_upstream/api/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 60s;
        proxy_send_timeout 60s;
    }

    # Web: Proxy everything else to Next.js
    location / {
        proxy_pass http://web_upstream;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
NGINXEOF

# Replace the domain placeholder with your actual domain
sed -i "s/DOMAIN_PLACEHOLDER/$DOMAIN/g" /opt/myfinpro/production/infrastructure/nginx/conf.d/production-ssl.conf
```

Then update `docker-compose.production.yml` to mount Let's Encrypt certs. Uncomment the SSL volume line:

```bash
# (as deploy)
cd /opt/myfinpro/production
# Edit docker-compose.production.yml — uncomment the letsencrypt volume:
#   - /etc/letsencrypt:/etc/letsencrypt:ro
```

### 3.4 Auto-Renewal

Certbot's snap automatically installs a systemd timer for renewal. Verify:

```bash
# (as root)
systemctl list-timers | grep certbot
# Should show: snap.certbot.renew.timer

# Test renewal (dry run)
certbot renew --dry-run
```

To reload Nginx after renewal, add a deploy hook:

```bash
# (as root)
cat > /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh << 'EOF'
#!/bin/bash
docker exec myfinpro-prod-nginx nginx -s reload 2>/dev/null || true
EOF

chmod +x /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
```

---

## Part 4: GitHub Actions & Secrets Configuration

> ⏱ Estimated time: **20 minutes**

### 4.1 Generate SSH Key Pair for GitHub Actions

Run this on your **local machine** (not the server):

```bash
# (local) — Generate a dedicated deploy key
ssh-keygen -t ed25519 -C "github-actions-deploy" -f ~/.ssh/myfinpro-deploy -N ""
```

This creates two files:

- `~/.ssh/myfinpro-deploy` — **private key** (goes into GitHub Secrets)
- `~/.ssh/myfinpro-deploy.pub` — **public key** (goes on the server)

#### Add the public key to the server

```bash
# (local)
ssh-copy-id -i ~/.ssh/myfinpro-deploy.pub $DEPLOY_USER@$SERVER_IP
```

Or manually:

```bash
# (as deploy) — on the server
cat >> ~/.ssh/authorized_keys << 'EOF'
ssh-ed25519 AAAA... github-actions-deploy
EOF
```

> 💡 **For separate staging and production servers**, generate separate key pairs and repeat this for each server.

### 4.2 Configure GitHub Repository Secrets

Go to your GitHub repository → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**.

#### SSH & Infrastructure Secrets

| Secret | Value | Description |
|---|---|---|
| `STAGING_HOST` | `<YOUR_SERVER_IP>` | Staging server IP or hostname |
| `STAGING_USER` | `deploy` | SSH user for staging server |
| `STAGING_SSH_KEY` | Contents of `~/.ssh/myfinpro-deploy` | Private SSH key for staging |
| `PRODUCTION_HOST` | `<YOUR_SERVER_IP>` | Production server IP or hostname |
| `PRODUCTION_USER` | `deploy` | SSH user for production server |
| `PRODUCTION_SSH_KEY` | Contents of `~/.ssh/myfinpro-deploy` | Private SSH key for production |
| `GHCR_REPO` | `<YOUR_GITHUB_USERNAME>/myfinpro` | GHCR repository (lowercase) |

To copy the private key:

```bash
# (local)
cat ~/.ssh/myfinpro-deploy
# Copy the entire output including -----BEGIN OPENSSH PRIVATE KEY----- and -----END OPENSSH PRIVATE KEY-----
```

#### Application Secrets (per GitHub Environment)

Configure these in each GitHub Environment (`staging` / `production`):

| Secret | Description | How to generate |
|---|---|---|
| `MYSQL_ROOT_PASSWORD` | MySQL root password | `openssl rand -base64 48` |
| `MYSQL_DATABASE` | Database name | `myfinpro_staging` / `myfinpro` |
| `MYSQL_USER` | Database user | `myfinpro_staging` / `myfinpro_prod` |
| `MYSQL_PASSWORD` | Database user password | `openssl rand -base64 48` |
| `DATABASE_URL` | Full connection string | `mysql://USER:PASS@mysql:3306/DB_NAME` |
| `JWT_SECRET` | JWT access token secret | `openssl rand -base64 48` |
| `JWT_REFRESH_SECRET` | JWT refresh token secret | `openssl rand -base64 48` |
| `REDIS_URL` | Redis connection string | `redis://redis:6379` |
| `CORS_ORIGIN` | Allowed CORS origins (prod) | `https://<YOUR_PRODUCTION_DOMAIN>` |
| `NEXT_PUBLIC_API_URL` | Public API URL (prod) | `https://<YOUR_PRODUCTION_DOMAIN>/api` |

### 4.3 Create GitHub Environments

Go to your GitHub repository → **Settings** → **Environments**.

1. **Create `staging` environment:**
   - No protection rules needed
   - Optionally limit to the `develop` branch

2. **Create `production` environment:**
   - Enable **"Required reviewers"** — add yourself or team leads
   - Optionally limit to the `main` branch
   - This ensures deployments to production require manual approval

### 4.4 Authorize GHCR (GitHub Container Registry) on the Server

The server needs to pull Docker images from GitHub Container Registry.

```bash
# (as deploy) — on the server
# Create a GitHub Personal Access Token (PAT) with `read:packages` scope
# at: https://github.com/settings/tokens

echo "<YOUR_GITHUB_PAT>" | docker login ghcr.io -u $GITHUB_USERNAME --password-stdin
```

**Verification:**

```bash
# (as deploy)
docker pull ghcr.io/$GITHUB_REPO/api:staging 2>&1 | head -5
# Should attempt to pull (may fail if no image exists yet, but auth should succeed)
```

> 💡 The Docker login credentials are saved in `~/.docker/config.json`. Protect this file:
> ```bash
> chmod 600 ~/.docker/config.json
> ```

### 4.5 Test the Connection

Verify GitHub Actions can SSH to the server:

```bash
# (local) — Test with the deploy key
ssh -i ~/.ssh/myfinpro-deploy -o StrictHostKeyChecking=no $DEPLOY_USER@$SERVER_IP "echo 'SSH connection successful' && docker compose version"
```

---

## Part 5: First Deployment

> ⏱ Estimated time: **15 minutes**

### 5.1 Trigger the Deploy Workflow

The recommended way to do the first deployment is through GitHub Actions:

1. Ensure all GitHub Secrets are configured (see Part 4)
2. Push to the `develop` branch (for staging) or `main` branch (for production)
3. Or go to **Actions → Deploy Staging → Run workflow** for manual trigger

The workflow will automatically:
1. Build and push Docker images to GHCR
2. Copy deployment files to the server
3. Write ephemeral `.env` from GitHub Secrets
4. Pull images and start services with `docker compose up -d`
5. Shred the `.env` file
6. Verify health checks

### 5.2 Manual First Deployment (Alternative)

If you need to deploy manually without GitHub Actions for the first time:

```bash
# (local) — from the repository root
scp docker-compose.staging.yml $DEPLOY_USER@$SERVER_IP:/opt/myfinpro/staging/
scp -r infrastructure/nginx/ $DEPLOY_USER@$SERVER_IP:/opt/myfinpro/staging/infrastructure/
scp -r infrastructure/mysql/ $DEPLOY_USER@$SERVER_IP:/opt/myfinpro/staging/infrastructure/
scp scripts/deploy.sh $DEPLOY_USER@$SERVER_IP:/opt/myfinpro/staging/scripts/
scp scripts/rollback.sh $DEPLOY_USER@$SERVER_IP:/opt/myfinpro/staging/scripts/
```

Then SSH in and run with required env vars:

```bash
# (as deploy) — on the server
cd /opt/myfinpro/staging
chmod +x scripts/*.sh

# Export all required env vars
export MYSQL_ROOT_PASSWORD="$(openssl rand -base64 48)"
export MYSQL_DATABASE="myfinpro_staging"
export MYSQL_USER="myfinpro_staging"
export MYSQL_PASSWORD="$(openssl rand -base64 48)"
export DATABASE_URL="mysql://${MYSQL_USER}:${MYSQL_PASSWORD}@mysql:3306/${MYSQL_DATABASE}"
export JWT_SECRET="$(openssl rand -base64 48)"
export JWT_REFRESH_SECRET="$(openssl rand -base64 48)"
export REDIS_URL="redis://redis:6379"
export NODE_ENV="staging"
export API_PORT="3001"
export CORS_ORIGIN="*"
export LOG_LEVEL="debug"
export SWAGGER_ENABLED="true"
export RATE_LIMIT_TTL="60000"
export RATE_LIMIT_MAX="60"
export NEXT_PUBLIC_API_URL="/api"
export API_INTERNAL_URL="http://api:3001"
export GHCR_REPO="<YOUR_GITHUB_USERNAME>/myfinpro"
export IMAGE_TAG="staging"

# Run the deploy script (writes .env → compose up → shreds .env)
./scripts/deploy.sh staging
```

> ⚠️ **Important:** After manual deployment, add these same secret values to GitHub Secrets so future CI/CD deployments use the same credentials.

### 5.3 Verify Deployment

```bash
# (as deploy)
cd /opt/myfinpro/staging

# Check all containers are running
docker compose -f docker-compose.staging.yml ps
# All services should show "Up" and "healthy"

# Check health endpoints
curl -sf http://localhost/api/v1/health | jq .
# Expected: {"status":"ok", ...}

curl -sf http://localhost/health
# Expected: {"status":"ok","service":"nginx"}

curl -sf http://localhost/ | head -20
# Expected: HTML from Next.js

# Check logs for errors
docker compose -f docker-compose.staging.yml logs --tail=20 api
docker compose -f docker-compose.staging.yml logs --tail=20 web
```

### 5.4 Set Up DNS

Point your domain to the server IP. Add these DNS records with your DNS provider:

| Type | Name | Value | TTL |
|---|---|---|---|
| `A` | `<YOUR_PRODUCTION_DOMAIN>` | `<YOUR_PRODUCTION_SERVER_IP>` | 300 |
| `A` | `<YOUR_STAGING_DOMAIN>` | `<YOUR_STAGING_SERVER_IP>` | 300 |

**Verification:**

```bash
# (local)
dig +short $DOMAIN
# Should return your server IP

curl -sf https://$DOMAIN/api/v1/health
# Should return health status
```

---

## Part 6: Backup Configuration

> ⏱ Estimated time: **15 minutes**

### 6.1 Copy Backup Scripts to the Server

If not already done in Part 5:

```bash
# (local)
scp scripts/backup.sh $DEPLOY_USER@$SERVER_IP:/opt/myfinpro/production/scripts/
scp scripts/check-backup-age.sh $DEPLOY_USER@$SERVER_IP:/opt/myfinpro/production/scripts/
scp infrastructure/backup/backup.env.example $DEPLOY_USER@$SERVER_IP:/opt/myfinpro/production/infrastructure/backup/

# (as deploy) — on the server
chmod +x /opt/myfinpro/production/scripts/backup.sh
chmod +x /opt/myfinpro/production/scripts/check-backup-age.sh
```

### 6.2 Configure Backup Environment

```bash
# (as deploy) — on the server
cd /opt/myfinpro/production
cp infrastructure/backup/backup.env.example infrastructure/backup/backup.env
nano infrastructure/backup/backup.env
```

Fill in the values:

```bash
# infrastructure/backup/backup.env
BACKUP_DIR=/var/backups/myfinpro
BACKUP_RETENTION_DAILY=7
BACKUP_RETENTION_WEEKLY=4
BACKUP_MAX_AGE_HOURS=26

MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=myfinpro_prod      # Match your GitHub Secret
MYSQL_PASSWORD=your_db_pass   # Match your GitHub Secret
MYSQL_DATABASE=myfinpro

# For Docker-based backups (recommended)
DOCKER_CONTAINER_NAME=myfinpro-prod-mysql   # or myfinpro-staging-mysql

# Optional: alerting webhook (Slack, Discord, etc.)
ALERT_WEBHOOK_URL=https://hooks.slack.com/services/xxx
```

Create the backup directory and log directory:

```bash
# (as deploy)
sudo mkdir -p /var/backups/myfinpro
sudo chown $USER:$USER /var/backups/myfinpro

sudo mkdir -p /var/log/myfinpro
sudo chown $USER:$USER /var/log/myfinpro
```

### 6.3 Set Up Backup Cron

```bash
# (as deploy) — Install the crontab
crontab infrastructure/backup/crontab
```

This installs:

- **Daily backup** at 2:00 AM: `/opt/myfinpro/production/scripts/backup.sh --docker`
- **Backup age check** every 6 hours: `/opt/myfinpro/production/scripts/check-backup-age.sh --max-age 26`

**Verification:**

```bash
crontab -l
# Should show the two cron entries
```

### 6.4 Test Backup and Restore

```bash
# (as deploy) — Run a manual backup
/opt/myfinpro/production/scripts/backup.sh --docker

# Verify the backup was created
ls -lh /var/backups/myfinpro/
# Should show: myfinpro_YYYY-MM-DD_HH-MM-SS.sql.gz

# Test restore (⚠️ only on staging!)
# Decompress and pipe into MySQL
LATEST_BACKUP=$(ls -t /var/backups/myfinpro/myfinpro_*.sql.gz | head -1)
echo "Latest backup: $LATEST_BACKUP"

# Dry-run: just verify the backup is valid gzip
gzip -t "$LATEST_BACKUP" && echo "Backup is valid gzip"
```

### 6.5 Set Up Backup Monitoring

Test the backup age check:

```bash
# (as deploy)
/opt/myfinpro/production/scripts/check-backup-age.sh --max-age 26
# Expected: OK: Latest backup 'myfinpro_...' is 0h old (threshold: 26h)
```

---

## Part 7: Monitoring & Maintenance

### 7.1 Docker Logs

```bash
# (as deploy)
cd /opt/myfinpro/staging   # or /opt/myfinpro/production
COMPOSE_FILE="docker-compose.staging.yml"  # or docker-compose.production.yml

# View all service logs
docker compose -f $COMPOSE_FILE logs

# Follow logs in real time
docker compose -f $COMPOSE_FILE logs -f

# View logs for a specific service
docker compose -f $COMPOSE_FILE logs -f api
docker compose -f $COMPOSE_FILE logs -f web
docker compose -f $COMPOSE_FILE logs -f nginx
docker compose -f $COMPOSE_FILE logs -f mysql

# View last N lines
docker compose -f $COMPOSE_FILE logs --tail=100 api

# View logs since a specific time
docker compose -f $COMPOSE_FILE logs --since="2024-01-15T10:00:00" api
```

### 7.2 Health Checks

```bash
# API health (detailed)
curl -sf http://localhost/api/v1/health | jq .

# Web health
curl -sf http://localhost/ -o /dev/null -w "%{http_code}\n"

# Nginx health
curl -sf http://localhost/health | jq .

# Container health status
docker compose -f $COMPOSE_FILE ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}"

# Resource usage
docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}"
```

### 7.3 Disk Space Management

#### Check disk usage

```bash
df -h /
du -sh /var/lib/docker/
du -sh /var/backups/myfinpro/
```

#### Automated Docker cleanup cron

```bash
# (as deploy) — Add to crontab
crontab -e
```

Add this line:

```
# Weekly Docker cleanup — Sundays at 3:00 AM
0 3 * * 0 docker system prune -af --filter "until=168h" >> /var/log/myfinpro/docker-prune.log 2>&1
```

#### Manual cleanup

```bash
# Remove unused images, containers, and networks
docker system prune -af

# Remove dangling images only
docker image prune -f

# Check Docker disk usage
docker system df
```

### 7.4 Update the Application

Deployments are triggered automatically via GitHub Actions:

- **Staging:** Push to `develop` branch → automatic deploy
- **Production:** Push to `main` branch → requires approval → deploy

For manual deployment, trigger from GitHub: **Actions** → **Deploy Staging/Production** → **Run workflow**.

### 7.5 Rollback a Failed Deployment

```bash
# (as deploy) — on the server
cd /opt/myfinpro/staging   # or /opt/myfinpro/production

# Automatic rollback (uses saved previous image tags)
./scripts/rollback.sh staging     # or production
```

### 7.6 Database Maintenance

```bash
# (as deploy)
cd /opt/myfinpro/production
COMPOSE_FILE="docker-compose.production.yml"

# Check migration status
docker compose -f $COMPOSE_FILE exec api npx prisma migrate status

# Connect to MySQL shell
docker compose -f $COMPOSE_FILE exec mysql mysql -u root -p
```

---

## Part 8: Staging-Specific Configuration

### Differences from Production

| Setting | Staging | Production |
|---|---|---|
| Compose file | `docker-compose.staging.yml` | `docker-compose.production.yml` |
| Deploy directory | `/opt/myfinpro/staging/` | `/opt/myfinpro/production/` |
| Image tag | `staging` | `latest` / version tag |
| MySQL port exposed | Yes (3306) | No (internal only) |
| Redis port exposed | Yes (6379) | No (internal only) |
| API port exposed | Yes (3001) | No (internal only) |
| Web port exposed | Yes (3000) | No (internal only) |
| Resource limits | None | CPU & memory limits |
| Log rotation | Default | `json-file` with max-size |
| Swagger | Enabled | Disabled |
| Log level | `debug` | `warn` |
| SSL | Optional | Required |

### Optional: Basic Auth for Staging

To protect the staging environment with basic auth via Nginx:

```bash
# (as deploy) — on the staging server
sudo apt install -y apache2-utils

# Create password file
htpasswd -cb /opt/myfinpro/staging/infrastructure/nginx/.htpasswd staging secretpassword
```

### Lower Resource Requirements

Staging typically runs on a smaller server (1–2 vCPU, 2 GB RAM). The default staging compose file has no resource limits, which is fine for smaller servers with swap enabled.

---

## Part 9: Production-Specific Configuration

### Resource Limits

The production compose file (`docker-compose.production.yml`) includes resource limits:

| Service | CPU Limit | Memory Limit | Memory Reservation |
|---|---|---|---|
| MySQL | 1.0 | 1 GB | 512 MB |
| Redis | 0.5 | 768 MB | 256 MB |
| API | 1.0 | 512 MB | 256 MB |
| Web | 1.0 | 512 MB | 256 MB |
| Nginx | 0.5 | 256 MB | 128 MB |

**Recommended server:** 2+ vCPU, 4+ GB RAM for production.

### Log Rotation

Production compose already configures Docker JSON file log rotation:

```yaml
logging:
  driver: json-file
  options:
    max-size: "10m"
    max-file: "5"
```

For system-level log rotation:

```bash
# (as root) — on the production server
cat > /etc/logrotate.d/myfinpro << 'EOF'
/var/log/myfinpro/*.log {
    daily
    missingok
    rotate 14
    compress
    delaycompress
    notifempty
    create 0644 deploy deploy
}
EOF
```

---

## Part 10: Security Architecture

### Ephemeral Secret Injection Pattern

MyFinPro uses an **ephemeral secret injection** pattern for deployments:

```mermaid
sequenceDiagram
    participant GS as GitHub Secrets
    participant GA as GitHub Actions
    participant SSH as SSH Session
    participant Srv as Server
    participant DC as Docker Compose

    GS->>GA: Secrets via envs parameter
    GA->>SSH: appleboy/ssh-action
    SSH->>Srv: Write .env (chmod 600)
    SSH->>DC: docker compose up -d
    DC->>DC: Read env_file: .env
    SSH->>Srv: shred -vfz -n 3 .env
    Note over Srv: Secrets no longer on disk
```

### Why This Pattern?

| Threat | Mitigation |
|--------|------------|
| Secrets in git history | Never committed — injected at deploy time from GitHub Secrets |
| Secrets persisted on server disk | `.env` is shredded after `docker compose up` |
| `docker inspect` leaking secrets | Using `env_file:` directive instead of `environment:` |
| Secret rotation complexity | Update GitHub Secret → redeploy (no SSH needed) |
| Audit trail | GitHub Secrets provides built-in audit logging |

### What This Means for Server Setup

- **No `.env` files are created during server provisioning**
- **No secrets need to be manually placed on the server**
- All secrets are managed in **GitHub → Settings → Secrets and variables → Actions**
- The deploy workflow handles writing and shredding the `.env` file automatically
- For manual deployments, export env vars and use `scripts/deploy.sh` which handles the secure pattern

### How to Rotate Secrets

1. Go to **GitHub → Settings → Secrets and variables → Actions**
2. Update the secret value (e.g., `JWT_SECRET`)
3. Trigger a new deployment (push to branch or manual dispatch)
4. The new secret value is injected on the next deploy
5. No need to SSH into any server

---

## Part 11: Troubleshooting

### Common Issues and Solutions

#### ❌ Container won't start

```bash
# Check container status
docker compose -f $COMPOSE_FILE ps -a

# Check logs for errors
docker compose -f $COMPOSE_FILE logs api --tail=50
docker compose -f $COMPOSE_FILE logs web --tail=50

# Check if image was pulled correctly
docker images | grep myfinpro
```

#### ❌ Cannot pull images from GHCR

```bash
# Re-authenticate with GHCR
echo "<YOUR_GITHUB_PAT>" | docker login ghcr.io -u $GITHUB_USERNAME --password-stdin

# Verify the image exists
docker pull ghcr.io/$GITHUB_REPO/api:staging

# Check Docker login config
cat ~/.docker/config.json | jq .auths
```

#### ❌ Database migration failed

```bash
# Check migration status
docker compose -f $COMPOSE_FILE exec api npx prisma migrate status

# Check MySQL is running and healthy
docker compose -f $COMPOSE_FILE exec mysql mysqladmin ping -h localhost

# View migration error details
docker compose -f $COMPOSE_FILE run --rm api npx prisma migrate deploy --schema=prisma/schema.prisma

# Reset migrations (⚠️ DESTROYS DATA — staging only!)
docker compose -f $COMPOSE_FILE exec api npx prisma migrate reset --force
```

#### ❌ Health check failing

```bash
# Check if service is healthy internally
docker compose -f $COMPOSE_FILE exec api wget -qO- http://localhost:3001/api/v1/health

# Check Nginx config is valid
docker compose -f $COMPOSE_FILE exec nginx nginx -t

# Check Nginx logs
docker compose -f $COMPOSE_FILE logs nginx --tail=30

# Check if port is reachable from the host
curl -v http://localhost/api/v1/health
curl -v http://localhost/
```

#### ❌ Out of disk space

```bash
# Check disk usage
df -h /
du -sh /var/lib/docker/

# Clean up Docker resources
docker system prune -af --volumes
docker builder prune -af

# Check backup disk usage
du -sh /var/backups/myfinpro/
```

#### ❌ Service dependency issues (services starting in wrong order)

```bash
# Restart in correct order
docker compose -f $COMPOSE_FILE down
docker compose -f $COMPOSE_FILE up -d mysql redis
sleep 10
docker compose -f $COMPOSE_FILE up -d api
sleep 10
docker compose -f $COMPOSE_FILE up -d web nginx
```

#### ❌ SSL certificate expired

```bash
# (as root)
certbot renew

# If renewal fails, re-obtain:
certbot certonly --standalone -d $DOMAIN --force-renewal

# Reload Nginx
docker exec myfinpro-prod-nginx nginx -s reload
```

---

## Quick Reference

### Key Paths

| Path | Description |
|---|---|
| `/opt/myfinpro/staging/` | Staging application root |
| `/opt/myfinpro/production/` | Production application root |
| `/opt/myfinpro/*/scripts/` | Deploy, rollback, backup scripts |
| `/opt/myfinpro/*/infrastructure/` | Nginx configs, MySQL init |
| `/var/backups/myfinpro/` | Database backups |
| `/var/log/myfinpro/` | Application logs (backup, cron) |
| `/etc/letsencrypt/` | SSL certificates |

### Key Commands

```bash
# View status
cd /opt/myfinpro/staging
docker compose -f docker-compose.staging.yml ps

# View logs
docker compose -f docker-compose.staging.yml logs -f api

# Health check
curl -sf http://localhost/api/v1/health | jq .
```

### Secret Management

All secrets managed in GitHub → Settings → Secrets and variables → Actions.
See [Part 4](#part-4-github-actions--secrets-configuration) for full list.

### Health Check Endpoints

| Service | URL |
|---|---|
| API | `http://localhost/api/v1/health` |
| Web | `http://localhost/` |
| Nginx | `http://localhost/health` |
