# Deployment Guide

## Overview

MyFinPro deploys to a dedicated Ubuntu server using Docker Compose. The CD pipeline builds Docker images, pushes them to GitHub Container Registry (GHCR), then deploys via SSH.

**Environments:**

| Environment | Branch    | Trigger          | Compose File                  |
|-------------|-----------|------------------|-------------------------------|
| Staging     | `develop` | Push / Manual    | `docker-compose.staging.yml`  |
| Production  | `main`    | Push + Approval  | `docker-compose.production.yml` |

---

## Prerequisites

### Server Setup

1. **Ubuntu 22.04+** with Docker Engine and Docker Compose V2:

   ```bash
   # Install Docker
   curl -fsSL https://get.docker.com | sh
   sudo usermod -aG docker $USER

   # Verify
   docker compose version   # should be v2.x
   ```

2. **Create deployment directory:**

   ```bash
   sudo mkdir -p /opt/myfinpro
   sudo chown $USER:$USER /opt/myfinpro
   ```

3. **Authenticate with GHCR** on the server:

   ```bash
   echo "$GITHUB_PAT" | docker login ghcr.io -u USERNAME --password-stdin
   ```

4. **Install curl** (for health checks):

   ```bash
   sudo apt-get install -y curl
   ```

### SSH Key Setup

1. Generate a deploy key (on your local machine):

   ```bash
   ssh-keygen -t ed25519 -C "deploy@myfinpro" -f ~/.ssh/myfinpro-deploy
   ```

2. Add the **public key** to the server:

   ```bash
   ssh-copy-id -i ~/.ssh/myfinpro-deploy.pub user@server-ip
   ```

3. Add the **private key** as a GitHub secret (see below).

---

## GitHub Secrets

Configure these in **Settings → Secrets and variables → Actions**:

### Staging Environment

| Secret             | Description                              |
|--------------------|------------------------------------------|
| `STAGING_HOST`     | Staging server IP or hostname            |
| `STAGING_USER`     | SSH username on staging server           |
| `STAGING_SSH_KEY`  | Private SSH key for staging server       |

### Production Environment

| Secret               | Description                              |
|----------------------|------------------------------------------|
| `PRODUCTION_HOST`    | Production server IP or hostname         |
| `PRODUCTION_USER`    | SSH username on production server        |
| `PRODUCTION_SSH_KEY` | Private SSH key for production server    |

### GitHub Environments

Create two [GitHub Environments](https://docs.github.com/en/actions/deployment/targeting-different-environments/using-environments-for-deployment):

1. **`staging`** — No approval required
2. **`production`** — Enable "Required reviewers" for approval gate

---

## Environment Configuration

### Staging

1. Copy the template to the server:

   ```bash
   scp .env.staging.example user@staging-server:/opt/myfinpro/.env.staging
   ```

2. Edit `/opt/myfinpro/.env.staging` with actual values.

3. Ensure `GHCR_REPO` matches your GitHub repository (lowercase).

### Production

1. Copy the template to the server:

   ```bash
   scp .env.production.example user@prod-server:/opt/myfinpro/.env.production
   ```

2. Edit `/opt/myfinpro/.env.production` with strong, unique credentials.

3. Restrict file permissions:

   ```bash
   chmod 600 /opt/myfinpro/.env.production
   ```

---

## How to Deploy

### Deploy to Staging

**Automatic:** Push to the `develop` branch. The pipeline will:
1. Wait for CI to pass
2. Build & push Docker images tagged `staging`
3. SSH into the staging server
4. Pull images, run migrations, restart services
5. Verify health checks

**Manual:** Go to **Actions → Deploy Staging → Run workflow**.

### Deploy to Production

**Automatic:** Push to the `main` branch (typically via PR merge from `develop`). The pipeline will:
1. Require manual approval in the `production` environment
2. Build & push Docker images tagged `latest` and version tag
3. SSH into the production server
4. Pull images, run migrations, restart services with zero-downtime
5. Verify health checks

**Manual:** Go to **Actions → Deploy Production → Run workflow**:
- Type `deploy-production` in the confirmation field
- Optionally provide a version tag (e.g., `v1.2.3`)

---

## How to Rollback

### Automatic Rollback

If a deployment fails health checks, the pipeline automatically triggers rollback via [`scripts/rollback.sh`](../scripts/rollback.sh).

### Manual Rollback

SSH into the server and run:

```bash
cd /opt/myfinpro
./scripts/rollback.sh staging     # or production
```

The rollback script:
1. Stops the current API and Web containers
2. Reverts to previously cached Docker images
3. Restarts all services
4. Verifies health

### Manual Image Rollback

If you need to deploy a specific version:

```bash
cd /opt/myfinpro

# Edit .env.staging (or .env.production) to set a specific IMAGE_TAG
# e.g., IMAGE_TAG=staging-abc1234

docker compose -f docker-compose.staging.yml pull api web
docker compose -f docker-compose.staging.yml up -d
```

---

## Monitoring Deployed Services

### Check Service Status

```bash
# All services
docker compose -f docker-compose.staging.yml ps

# Service logs (follow)
docker compose -f docker-compose.staging.yml logs -f api
docker compose -f docker-compose.staging.yml logs -f web

# Resource usage
docker stats --no-stream
```

### Health Check Endpoints

| Service | URL                             |
|---------|----------------------------------|
| API     | `http://localhost/api/v1/health` |
| Web     | `http://localhost/`              |
| Nginx   | `http://localhost/health`        |

### View Deployment Logs

Deployment logs are saved on the server:

```bash
ls -la /opt/myfinpro/deploy-*.log
ls -la /opt/myfinpro/rollback-*.log
```

---

## Troubleshooting

### Container won't start

```bash
# Check logs for the specific service
docker compose -f docker-compose.staging.yml logs api --tail=50

# Check if the image was pulled correctly
docker images | grep myfinpro
```

### Database migration failed

```bash
# Check migration status
docker compose -f docker-compose.staging.yml exec api npx prisma migrate status

# Reset migrations (⚠️ destroys data — staging only)
docker compose -f docker-compose.staging.yml exec api npx prisma migrate reset --force
```

### Cannot pull images from GHCR

```bash
# Re-authenticate
echo "$GITHUB_PAT" | docker login ghcr.io -u USERNAME --password-stdin

# Verify image exists
docker pull ghcr.io/your-repo/api:staging
```

### Health check failing

```bash
# Check if port is reachable internally
docker compose -f docker-compose.staging.yml exec api wget -qO- http://localhost:3001/api/v1/health

# Check Nginx upstream
docker compose -f docker-compose.staging.yml exec nginx nginx -t
docker compose -f docker-compose.staging.yml logs nginx --tail=20
```

### Out of disk space

```bash
# Clean up Docker resources
docker system prune -af --volumes
docker builder prune -af
```

### Service dependency issues

```bash
# Restart in correct order
docker compose -f docker-compose.staging.yml down
docker compose -f docker-compose.staging.yml up -d mysql redis
sleep 10
docker compose -f docker-compose.staging.yml up -d api
sleep 10
docker compose -f docker-compose.staging.yml up -d web nginx
```

---

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌──────────────────────────┐
│  GitHub      │────►│  GitHub      │────►│  Ubuntu Server           │
│  Repository  │     │  Actions     │     │                          │
│              │     │  (CI → CD)   │     │  ┌────────┐             │
│  develop ────┼─────┤  Build img   │     │  │ Nginx  │ :80/:443   │
│  main ───────┤     │  Push GHCR   │     │  └───┬────┘             │
│              │     │  SSH deploy  │     │      │                   │
└─────────────┘     └──────────────┘     │  ┌───┴────┐ ┌────────┐ │
                                          │  │  API   │ │  Web   │ │
                                          │  │ :3001  │ │ :3000  │ │
                                          │  └───┬────┘ └────────┘ │
                                          │      │                   │
                                          │  ┌───┴────┐ ┌────────┐ │
                                          │  │ MySQL  │ │ Redis  │ │
                                          │  │ :3306  │ │ :6379  │ │
                                          │  └────────┘ └────────┘ │
                                          └──────────────────────────┘
```
