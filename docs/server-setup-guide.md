# Server Setup Guide — Staging & Production

> **MyFinPro** — Complete server provisioning guide for Ubuntu 22.04–24.04.
> Follow this guide from a fresh Ubuntu server with SSH access to get a fully operational staging or production environment.

---

## Table of Contents

- [Variables & Conventions](#variables--conventions)
- [Part 1: Initial Server Setup](#part-1-initial-server-setup) (~30 min)
- [Part 2: Application Directory Setup](#part-2-application-directory-setup) (~10 min)
- [Part 3: SSL/TLS Setup (Production)](#part-3-ssltls-setup-production) (~15 min)
- [Part 4: GitHub Actions Integration](#part-4-github-actions-integration) (~20 min)
- [Part 5: First Deployment](#part-5-first-deployment) (~15 min)
- [Part 6: Backup Configuration](#part-6-backup-configuration) (~15 min)
- [Part 7: Monitoring & Maintenance](#part-7-monitoring--maintenance)
- [Part 8: Staging-Specific Configuration](#part-8-staging-specific-configuration)
- [Part 9: Production-Specific Configuration](#part-9-production-specific-configuration)
- [Part 10: Troubleshooting](#part-10-troubleshooting)

---

## Variables & Conventions

Define these variables **before** running any commands. Replace placeholder values with your actual data.

```bash
# ── Set these on your LOCAL machine and on the server ──
export SERVER_IP="203.0.113.10"           # Your server's public IP
export DOMAIN="myfinpro.example.com"      # Production domain
export STAGING_DOMAIN="staging.myfinpro.example.com"  # Staging domain
export DEPLOY_USER="deploy"               # Non-root deploy user
export GITHUB_USERNAME="your-github-username"  # GitHub username (lowercase)
export GITHUB_REPO="your-github-username/myfinpro"  # owner/repo (lowercase)
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

### 2.1 Create Application Directory

```bash
# (as deploy)
sudo mkdir -p /opt/myfinpro
sudo chown $USER:$USER /opt/myfinpro
```

### 2.2 Set Up Directory Structure

```bash
# (as deploy)
cd /opt/myfinpro

mkdir -p \
  scripts \
  infrastructure/nginx/conf.d \
  infrastructure/mysql/init \
  infrastructure/backup \
  logs
```

### 2.3 Configure Environment Files

#### For Staging

```bash
# (local) — Copy the template to the server
scp .env.staging.example $DEPLOY_USER@$SERVER_IP:/opt/myfinpro/.env.staging
```

Then on the server, edit it with real values:

```bash
# (as deploy) — on the server
cd /opt/myfinpro
nano .env.staging
```

Key values to change in `.env.staging`:

| Variable | What to set |
|---|---|
| `MYSQL_ROOT_PASSWORD` | Strong random password |
| `MYSQL_PASSWORD` | Strong random password |
| `DATABASE_URL` | Must match `MYSQL_USER` and `MYSQL_PASSWORD` |
| `GHCR_REPO` | `your-github-username/myfinpro` (lowercase) |
| `JWT_ACCESS_SECRET` | Generate: `openssl rand -base64 48` |
| `JWT_REFRESH_SECRET` | Generate: `openssl rand -base64 48` |
| `CORS_ORIGINS` | Your staging domain |
| `NEXT_PUBLIC_API_URL` | `https://staging.myfinpro.example.com/api/v1` |

#### For Production

```bash
# (local) — Copy the template to the server
scp .env.production.example $DEPLOY_USER@$SERVER_IP:/opt/myfinpro/.env.production
```

Then on the server, edit with strong, unique credentials:

```bash
# (as deploy) — on the server
cd /opt/myfinpro
nano .env.production
```

Key values to change in `.env.production`:

| Variable | What to set |
|---|---|
| `MYSQL_ROOT_PASSWORD` | `openssl rand -base64 48` |
| `MYSQL_PASSWORD` | `openssl rand -base64 48` |
| `DATABASE_URL` | Must match `MYSQL_USER` and `MYSQL_PASSWORD` |
| `GHCR_REPO` | `your-github-username/myfinpro` (lowercase) |
| `JWT_ACCESS_SECRET` | `openssl rand -base64 48` |
| `JWT_REFRESH_SECRET` | `openssl rand -base64 48` |
| `REDIS_PASSWORD` | `openssl rand -base64 32` |
| `CORS_ORIGINS` | `https://myfinpro.example.com` |
| `NEXT_PUBLIC_API_URL` | `https://myfinpro.example.com/api/v1` |
| `SWAGGER_ENABLED` | `false` |

### 2.4 Set File Permissions

```bash
# (as deploy)
chmod 600 /opt/myfinpro/.env.staging
chmod 600 /opt/myfinpro/.env.production
```

**Verification:**

```bash
ls -la /opt/myfinpro/.env.*
# -rw------- 1 deploy deploy ... .env.staging
# -rw------- 1 deploy deploy ... .env.production
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
docker compose -f /opt/myfinpro/docker-compose.production.yml down nginx 2>/dev/null || true

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
cat > /opt/myfinpro/infrastructure/nginx/conf.d/production-ssl.conf << 'NGINXEOF'
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
sed -i "s/DOMAIN_PLACEHOLDER/$DOMAIN/g" /opt/myfinpro/infrastructure/nginx/conf.d/production-ssl.conf
```

Then update `docker-compose.production.yml` to mount Let's Encrypt certs. Uncomment the SSL volume line:

```bash
# (as deploy)
cd /opt/myfinpro
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

## Part 4: GitHub Actions Integration

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

Add the following secrets:

| Secret | Value | Description |
|---|---|---|
| `STAGING_HOST` | `203.0.113.10` | Staging server IP or hostname |
| `STAGING_USER` | `deploy` | SSH user for staging server |
| `STAGING_SSH_KEY` | Contents of `~/.ssh/myfinpro-deploy` | Private SSH key for staging |
| `PRODUCTION_HOST` | `203.0.113.20` | Production server IP or hostname |
| `PRODUCTION_USER` | `deploy` | SSH user for production server |
| `PRODUCTION_SSH_KEY` | Contents of `~/.ssh/myfinpro-deploy` | Private SSH key for production |

To copy the private key:

```bash
# (local)
cat ~/.ssh/myfinpro-deploy
# Copy the entire output including -----BEGIN OPENSSH PRIVATE KEY----- and -----END OPENSSH PRIVATE KEY-----
```

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

echo "YOUR_GITHUB_PAT" | docker login ghcr.io -u $GITHUB_USERNAME --password-stdin
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

### 5.1 Copy Project Files to the Server

The CI/CD pipeline copies deployment files automatically, but for the first deployment, copy them manually:

```bash
# (local) — from the repository root
scp docker-compose.yml $DEPLOY_USER@$SERVER_IP:/opt/myfinpro/
scp docker-compose.staging.yml $DEPLOY_USER@$SERVER_IP:/opt/myfinpro/
scp docker-compose.production.yml $DEPLOY_USER@$SERVER_IP:/opt/myfinpro/
scp -r infrastructure/nginx/ $DEPLOY_USER@$SERVER_IP:/opt/myfinpro/infrastructure/
scp -r infrastructure/mysql/ $DEPLOY_USER@$SERVER_IP:/opt/myfinpro/infrastructure/
scp scripts/deploy.sh $DEPLOY_USER@$SERVER_IP:/opt/myfinpro/scripts/
scp scripts/rollback.sh $DEPLOY_USER@$SERVER_IP:/opt/myfinpro/scripts/
scp scripts/backup.sh $DEPLOY_USER@$SERVER_IP:/opt/myfinpro/scripts/
scp scripts/check-backup-age.sh $DEPLOY_USER@$SERVER_IP:/opt/myfinpro/scripts/
```

Make scripts executable:

```bash
# (as deploy) — on the server
chmod +x /opt/myfinpro/scripts/*.sh
```

### 5.2 Pull Docker Images from GHCR

Choose the correct compose file for your environment:

```bash
# (as deploy)
cd /opt/myfinpro

# For staging:
docker compose -f docker-compose.staging.yml pull

# For production:
docker compose -f docker-compose.production.yml pull
```

### 5.3 Start Database and Run Migrations

```bash
# (as deploy) — Example for staging
cd /opt/myfinpro
COMPOSE_FILE="docker-compose.staging.yml"

# Start MySQL and Redis first
docker compose -f $COMPOSE_FILE up -d mysql redis

# Wait for MySQL to be healthy
echo "Waiting for MySQL..."
until docker compose -f $COMPOSE_FILE exec -T mysql mysqladmin ping -h localhost --silent 2>/dev/null; do
  sleep 2
done
echo "MySQL is ready."

# Run Prisma migrations
docker compose -f $COMPOSE_FILE run --rm api npx prisma migrate deploy --schema=prisma/schema.prisma
```

### 5.4 Start All Services

```bash
# (as deploy)
cd /opt/myfinpro

# For staging:
docker compose -f docker-compose.staging.yml up -d

# For production:
docker compose -f docker-compose.production.yml up -d
```

### 5.5 Verify Deployment

```bash
# (as deploy)
cd /opt/myfinpro

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

### 5.6 Set Up DNS

Point your domain to the server IP. Add these DNS records with your DNS provider:

| Type | Name | Value | TTL |
|---|---|---|---|
| `A` | `myfinpro.example.com` | `203.0.113.20` (production IP) | 300 |
| `A` | `staging.myfinpro.example.com` | `203.0.113.10` (staging IP) | 300 |

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
scp scripts/backup.sh $DEPLOY_USER@$SERVER_IP:/opt/myfinpro/scripts/
scp scripts/check-backup-age.sh $DEPLOY_USER@$SERVER_IP:/opt/myfinpro/scripts/
scp infrastructure/backup/backup.env.example $DEPLOY_USER@$SERVER_IP:/opt/myfinpro/infrastructure/backup/

# (as deploy) — on the server
chmod +x /opt/myfinpro/scripts/backup.sh
chmod +x /opt/myfinpro/scripts/check-backup-age.sh
```

### 6.2 Configure Backup Environment

```bash
# (as deploy) — on the server
cd /opt/myfinpro
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
MYSQL_USER=myfinpro_prod      # Match your .env.production
MYSQL_PASSWORD=your_db_pass   # Match your .env.production
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

- **Daily backup** at 2:00 AM: `/opt/myfinpro/scripts/backup.sh --docker`
- **Backup age check** every 6 hours: `/opt/myfinpro/scripts/check-backup-age.sh --max-age 26`

**Verification:**

```bash
crontab -l
# Should show the two cron entries
```

### 6.4 Test Backup and Restore

```bash
# (as deploy) — Run a manual backup
/opt/myfinpro/scripts/backup.sh --docker

# Verify the backup was created
ls -lh /var/backups/myfinpro/
# Should show: myfinpro_YYYY-MM-DD_HH-MM-SS.sql.gz

# Test restore (⚠️ only on staging!)
# Decompress and pipe into MySQL
LATEST_BACKUP=$(ls -t /var/backups/myfinpro/myfinpro_*.sql.gz | head -1)
echo "Latest backup: $LATEST_BACKUP"

# Dry-run: just verify the backup is valid gzip
gzip -t "$LATEST_BACKUP" && echo "Backup is valid gzip"

# Actual restore command (use with caution):
# gunzip -c "$LATEST_BACKUP" | docker exec -i myfinpro-staging-mysql \
#   mysql -u root -p"$MYSQL_ROOT_PASSWORD" myfinpro_staging
```

### 6.5 Set Up Backup Monitoring

Test the backup age check:

```bash
# (as deploy)
/opt/myfinpro/scripts/check-backup-age.sh --max-age 26
# Expected: OK: Latest backup 'myfinpro_...' is 0h old (threshold: 26h)
```

If you set `ALERT_WEBHOOK_URL` in `backup.env`, alerts will be sent when:

- No backups are found
- The latest backup is older than the threshold (26 hours)

---

## Part 7: Monitoring & Maintenance

### 7.1 Docker Logs

```bash
# (as deploy)
cd /opt/myfinpro
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

# Remove unused volumes (⚠️ careful — this deletes data volumes too)
# docker volume prune -f

# Remove dangling images only
docker image prune -f

# Check Docker disk usage
docker system df
```

### 7.4 Update the Application

Deployments are triggered automatically via GitHub Actions:

- **Staging:** Push to `develop` branch → automatic deploy
- **Production:** Push to `main` branch → requires approval → deploy

For manual deployment:

```bash
# (as deploy) — on the server
cd /opt/myfinpro
./scripts/deploy.sh staging     # or production
```

Or trigger manually from GitHub: **Actions** → **Deploy Staging/Production** → **Run workflow**.

### 7.5 Rollback a Failed Deployment

```bash
# (as deploy) — on the server
cd /opt/myfinpro

# Automatic rollback (uses saved previous image tags)
./scripts/rollback.sh staging     # or production

# Manual rollback to a specific image version
# Edit the .env file and set IMAGE_TAG to the desired version:
#   IMAGE_TAG=staging-abc1234
# Then:
docker compose -f docker-compose.staging.yml pull api web
docker compose -f docker-compose.staging.yml up -d
```

### 7.6 Database Maintenance

```bash
# (as deploy)
COMPOSE_FILE="docker-compose.production.yml"

# Check migration status
docker compose -f $COMPOSE_FILE exec api npx prisma migrate status

# Connect to MySQL shell
docker compose -f $COMPOSE_FILE exec mysql mysql -u root -p

# Run OPTIMIZE TABLE (schedule during low traffic)
docker compose -f $COMPOSE_FILE exec mysql mysql -u root -p -e "OPTIMIZE TABLE myfinpro.your_table_name;"

# Check slow queries
docker compose -f $COMPOSE_FILE exec mysql mysql -u root -p -e "SHOW VARIABLES LIKE 'slow_query%';"

# Enable slow query log (add to MySQL command in compose)
# --slow-query-log=1
# --slow-query-log-file=/var/log/mysql/slow.log
# --long-query-time=2
```

---

## Part 8: Staging-Specific Configuration

### Differences from Production

| Setting | Staging | Production |
|---|---|---|
| Compose file | `docker-compose.staging.yml` | `docker-compose.production.yml` |
| Env file | `.env.staging` | `.env.production` |
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
htpasswd -cb /opt/myfinpro/infrastructure/nginx/.htpasswd staging secretpassword
```

Add to your staging Nginx config (`infrastructure/nginx/conf.d/default.conf`):

```nginx
# Add inside the server block, before location blocks:
auth_basic "Staging Environment";
auth_basic_user_file /etc/nginx/.htpasswd;

# Except for health checks:
location = /health {
    auth_basic off;
    access_log off;
    return 200 '{"status":"ok","service":"nginx"}';
    add_header Content-Type application/json;
}

location /api/v1/health {
    auth_basic off;
    proxy_pass http://api_upstream/api/v1/health;
}
```

And mount the htpasswd file in your staging compose under the nginx service:

```yaml
volumes:
  - ./infrastructure/nginx/.htpasswd:/etc/nginx/.htpasswd:ro
```

### Lower Resource Requirements

Staging typically runs on a smaller server (1–2 vCPU, 2 GB RAM). The default staging compose file has no resource limits, which is fine for smaller servers with swap enabled.

---

## Part 9: Production-Specific Configuration

### Resource Limits

The production compose file (`docker-compose.production.yml`) already includes resource limits:

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

For system-level log rotation, ensure the log directory is managed:

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

### Rate Limiting at Nginx Level

Add to your production Nginx config (inside the `http` block in `nginx.conf`):

```nginx
# Rate limiting
limit_req_zone $binary_remote_addr zone=api_limit:10m rate=30r/m;
limit_req_zone $binary_remote_addr zone=web_limit:10m rate=60r/m;
```

Apply in `conf.d/production-ssl.conf`:

```nginx
location /api/ {
    limit_req zone=api_limit burst=10 nodelay;
    # ... existing proxy settings ...
}

location / {
    limit_req zone=web_limit burst=20 nodelay;
    # ... existing proxy settings ...
}
```

### Higher Security Settings

Production-specific hardening already in the compose file:

- No ports exposed except 80/443 (Nginx only)
- Redis and MySQL are internal-only (no exposed ports)
- Swagger is disabled (`SWAGGER_ENABLED=false`)
- Lower rate limits (`THROTTLE_LIMIT=30` vs. 60 for staging)
- Log level set to `warn` instead of `debug`

---

## Part 10: Troubleshooting

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
echo "$GITHUB_PAT" | docker login ghcr.io -u $GITHUB_USERNAME --password-stdin

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

### How to Check Service Status

```bash
# All services
docker compose -f $COMPOSE_FILE ps

# Specific service
docker compose -f $COMPOSE_FILE ps api

# Detailed container inspection
docker inspect myfinpro-prod-api | jq '.[0].State'
```

### How to View Logs

```bash
# All services
docker compose -f $COMPOSE_FILE logs

# Follow specific service
docker compose -f $COMPOSE_FILE logs -f api

# Since a timestamp
docker compose -f $COMPOSE_FILE logs --since="1h" api

# Deployment logs on the server
ls -la /opt/myfinpro/deploy-*.log
ls -la /opt/myfinpro/rollback-*.log
tail -50 /opt/myfinpro/deploy-*.log
```

### How to Restart Services

```bash
# Restart a single service
docker compose -f $COMPOSE_FILE restart api

# Restart all services
docker compose -f $COMPOSE_FILE restart

# Full stop and start (recreate containers)
docker compose -f $COMPOSE_FILE down
docker compose -f $COMPOSE_FILE up -d
```

### How to Connect to the Database

```bash
# Interactive MySQL shell (as root user)
docker compose -f $COMPOSE_FILE exec mysql mysql -u root -p

# Interactive MySQL shell (as app user)
docker compose -f $COMPOSE_FILE exec mysql mysql -u myfinpro_prod -p myfinpro

# Run a single query
docker compose -f $COMPOSE_FILE exec mysql mysql -u root -p -e "SELECT COUNT(*) FROM myfinpro.users;"

# From the host (staging only — port exposed)
mysql -h 127.0.0.1 -P 3306 -u myfinpro_staging -p myfinpro_staging
```

---

## Quick Reference

### Key Paths

| Path | Description |
|---|---|
| `/opt/myfinpro/` | Application root directory |
| `/opt/myfinpro/.env.staging` | Staging environment config |
| `/opt/myfinpro/.env.production` | Production environment config |
| `/opt/myfinpro/scripts/` | Deploy, rollback, backup scripts |
| `/opt/myfinpro/infrastructure/` | Nginx configs, MySQL init, backup config |
| `/var/backups/myfinpro/` | Database backups |
| `/var/log/myfinpro/` | Application logs (backup, cron) |
| `/etc/letsencrypt/` | SSL certificates |

### Key Commands

```bash
# Deploy
cd /opt/myfinpro && ./scripts/deploy.sh staging

# Rollback
cd /opt/myfinpro && ./scripts/rollback.sh staging

# Backup
/opt/myfinpro/scripts/backup.sh --docker

# View status
docker compose -f docker-compose.staging.yml ps

# View logs
docker compose -f docker-compose.staging.yml logs -f api

# Health check
curl -sf http://localhost/api/v1/health | jq .
```

### Health Check Endpoints

| Service | URL |
|---|---|
| API | `http://localhost/api/v1/health` |
| Web | `http://localhost/` |
| Nginx | `http://localhost/health` |
