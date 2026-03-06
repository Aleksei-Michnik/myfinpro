# Deployment Guide

## Overview

MyFinPro deploys to a dedicated Ubuntu server using Docker Compose with **direct environment variable injection**. The CD pipeline builds Docker images, pushes them to GitHub Container Registry (GHCR), then deploys via SSH with secrets exported as shell environment variables — no files are ever written to disk.

**Security Pattern:**

```
GitHub Secrets (source of truth)
    → SSH into server
    → Export env vars in shell session
    → Process nginx SSL template (envsubst)
    → docker compose up (resolves ${VAR} from shell)
    → No files written to disk
```

**Environments:**

| Environment | Branch    | Trigger         | Compose File                    | Deploy Dir                  |
| ----------- | --------- | --------------- | ------------------------------- | --------------------------- |
| Staging     | `develop` | Push / Manual   | `docker-compose.staging.yml`    | `/opt/myfinpro/staging/`    |
| Production  | `main`    | Push + Approval | `docker-compose.production.yml` | `/opt/myfinpro/production/` |

---

## Security Architecture

### Direct Environment Variable Injection

Secrets are **never stored on the server** — not even temporarily. The deployment follows this pattern:

1. **GitHub Secrets** is the single source of truth for all application secrets
2. The deploy workflow passes secrets via SSH environment variables using `appleboy/ssh-action@v1` `envs` parameter
3. On the server, secrets are exported as shell environment variables
4. Nginx SSL config is generated from `ssl.conf.template` via `envsubst '$SERVER_NAME'`
5. `docker compose up -d` resolves `${VAR}` references in the compose file directly from the shell environment
6. No files are written to disk — secrets exist only in process memory

### Why This Pattern?

| Concern                | Solution                                                             |
| ---------------------- | -------------------------------------------------------------------- |
| Secrets in git history | Never committed — injected at deploy time from GitHub Secrets        |
| Secrets on server disk | No files written to disk — secrets exist only in process memory      |
| Secret rotation        | Update GitHub Secret → redeploy                                      |
| Audit trail            | GitHub Secrets audit log                                             |
| Nginx config           | Generated from template via `envsubst` — domain never stored in repo |

---

## Prerequisites

### Server Setup

See [`server-setup-guide.md`](server-setup-guide.md) for full server provisioning.

1. **Ubuntu 22.04+** with Docker Engine and Docker Compose V2
2. **Deploy directory:** `/opt/myfinpro/staging/` and `/opt/myfinpro/production/`
3. **GHCR authentication** on the server
4. **curl** installed for health checks

### SSH Key Setup

1. Generate a deploy key:

   ```bash
   ssh-keygen -t ed25519 -C "deploy@myfinpro" -f ~/.ssh/myfinpro-deploy
   ```

2. Add the **public key** to the server:

   ```bash
   ssh-copy-id -i ~/.ssh/myfinpro-deploy.pub <DEPLOY_USER>@<YOUR_SERVER_IP>
   ```

3. Add the **private key** as a GitHub secret (see below).

---

## GitHub Secrets

Configure these in **Settings → Secrets and variables → Actions**.

### SSH & Infrastructure Secrets

| Secret               | Description                           |
| -------------------- | ------------------------------------- |
| `STAGING_HOST`       | Staging server IP or hostname         |
| `STAGING_USER`       | SSH username on staging server        |
| `STAGING_SSH_KEY`    | Private SSH key for staging server    |
| `PRODUCTION_HOST`    | Production server IP or hostname      |
| `PRODUCTION_USER`    | SSH username on production server     |
| `PRODUCTION_SSH_KEY` | Private SSH key for production server |

### Application Secrets (per environment — staging uses `STAGING_` prefix, production uses `PRODUCTION_` prefix)

| Secret                  | Description                                     |
| ----------------------- | ----------------------------------------------- |
| `*_MYSQL_ROOT_PASSWORD` | MySQL root password                             |
| `*_MYSQL_DATABASE`      | Database name                                   |
| `*_MYSQL_USER`          | Database user                                   |
| `*_MYSQL_PASSWORD`      | Database user password                          |
| `*_DATABASE_URL`        | Full MySQL connection string                    |
| `*_JWT_SECRET`          | JWT access token signing secret (min 32 chars)  |
| `*_JWT_REFRESH_SECRET`  | JWT refresh token signing secret (min 32 chars) |
| `*_REDIS_URL`           | Redis connection string                         |

### Domain Secrets

| Secret                            | Description                           |
| --------------------------------- | ------------------------------------- |
| `CLOUDFLARE_STAGING_SUBDOMAIN`    | Domain for the staging environment    |
| `CLOUDFLARE_PRODUCTION_SUBDOMAIN` | Domain for the production environment |

### Non-Secret Config (hardcoded in workflow)

These values are set directly in the workflow files:

| Variable              | Staging                    | Production                                     |
| --------------------- | -------------------------- | ---------------------------------------------- |
| `NODE_ENV`            | `staging`                  | `production`                                   |
| `API_PORT`            | `3001`                     | `3001`                                         |
| `CORS_ORIGIN`         | `*`                        | Derived from `CLOUDFLARE_PRODUCTION_SUBDOMAIN` |
| `LOG_LEVEL`           | `debug`                    | `warn`                                         |
| `SWAGGER_ENABLED`     | `true`                     | `false`                                        |
| `RATE_LIMIT_TTL`      | `60000`                    | `60000`                                        |
| `RATE_LIMIT_MAX`      | `60`                       | `30`                                           |
| `NEXT_PUBLIC_API_URL` | `/api`                     | `/api`                                         |
| `API_INTERNAL_URL`    | `http://api:3001`          | `http://api:3001`                              |
| `IMAGE_TAG`           | `staging`                  | `latest`                                       |
| `GHCR_REPO`           | `aleksei-michnik/myfinpro` | `aleksei-michnik/myfinpro`                     |

### GitHub Environments

Create two [GitHub Environments](https://docs.github.com/en/actions/deployment/targeting-different-environments/using-environments-for-deployment):

1. **`staging`** — No approval required
2. **`production`** — Enable "Required reviewers" for approval gate

---

## How to Add/Rotate Secrets

1. Go to **GitHub → Settings → Secrets and variables → Actions**
2. Update the secret value
3. Trigger a new deployment (push to branch or manual dispatch)
4. The new secret value is automatically injected on the next deploy

Since no files are written to disk, rotating a secret is as simple as updating it in GitHub and redeploying. No need to SSH into servers.

---

## How to Deploy

### Deploy to Staging

**Automatic:** Push to the `develop` branch. The pipeline will:

1. Wait for CI to pass
2. Build & push Docker images tagged `staging`
3. SSH into the staging server
4. Export secrets as shell environment variables
5. Generate nginx config from SSL template via `envsubst`
6. Pull images, run `docker compose up -d` (resolves `${VAR}` from shell)
7. Verify health checks

**Manual:** Go to **Actions → Deploy Staging → Run workflow**.

### Deploy to Production

**Automatic:** Push to the `main` branch (typically via PR merge from `develop`). The pipeline will:

1. Require manual approval in the `production` environment
2. Build & push Docker images tagged `latest` and version tag
3. SSH into the production server
4. Export secrets as shell environment variables
5. Generate nginx config from SSL template via `envsubst`
6. Pull images, run `docker compose up -d` (resolves `${VAR}` from shell)
7. Verify health checks

**Manual:** Go to **Actions → Deploy Production → Run workflow**:

- Type `deploy-production` in the confirmation field
- Optionally provide a version tag (e.g., `v1.2.3`)

### Manual Deployment (via CLI)

For manual deployment without GitHub Actions, export required env vars and run docker compose directly:

```bash
# SSH into the server
ssh deploy@<YOUR_SERVER_IP>
cd /opt/myfinpro/staging

# Export all required secrets (see .env.staging.template for the full list)
export MYSQL_ROOT_PASSWORD="..."
export MYSQL_DATABASE="..."
export MYSQL_USER="..."
export MYSQL_PASSWORD="..."
export DATABASE_URL="mysql://${MYSQL_USER}:${MYSQL_PASSWORD}@mysql:3306/${MYSQL_DATABASE}"
export JWT_SECRET="..."
export JWT_REFRESH_SECRET="..."
export REDIS_URL="redis://redis:6379"

# Export application config
export NODE_ENV="staging"
export API_PORT="3001"
export CORS_ORIGIN="*"
export LOG_LEVEL="debug"
export SWAGGER_ENABLED="true"
export RATE_LIMIT_TTL="60000"
export RATE_LIMIT_MAX="60"
export NEXT_PUBLIC_API_URL="/api"
export API_INTERNAL_URL="http://api:3001"
export GHCR_REPO="aleksei-michnik/myfinpro"
export IMAGE_TAG="staging"

# Export domain (from CLOUDFLARE_STAGING_SUBDOMAIN GitHub Secret)
export SERVER_NAME="<domain from CLOUDFLARE_STAGING_SUBDOMAIN>"

# Generate nginx config from template
envsubst '$SERVER_NAME' < infrastructure/nginx/conf.d/ssl.conf.template \
  > infrastructure/nginx/conf.d/default.conf

# Pull images and start services
docker compose -f docker-compose.staging.yml pull
docker compose -f docker-compose.staging.yml up -d

# Verify health
curl -sf http://localhost/api/v1/health | jq .
```

---

## How to Rollback

### Automatic Rollback

If a deployment fails health checks, the pipeline automatically triggers rollback via [`scripts/rollback.sh`](../scripts/rollback.sh).

### Manual Rollback

SSH into the server and run:

```bash
cd /opt/myfinpro/staging    # or /opt/myfinpro/production
./scripts/rollback.sh staging     # or production
```

The rollback script:

1. Stops the current API and Web containers
2. Reverts to previously cached Docker images
3. Restarts all services
4. Verifies health

### Manual Image Rollback

To deploy a specific version, re-run the deploy workflow with the required secrets and a specific `IMAGE_TAG`:

```bash
# Set IMAGE_TAG to the desired version
export IMAGE_TAG=staging-abc1234
# ... export other required env vars ...
docker compose -f docker-compose.staging.yml pull
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

| Service | URL                              |
| ------- | -------------------------------- |
| API     | `http://localhost/api/v1/health` |
| Web     | `http://localhost/`              |
| Nginx   | `http://localhost/health`        |

### View Deployment Logs

Deployment logs are saved on the server:

```bash
ls -la /opt/myfinpro/staging/deploy-*.log
ls -la /opt/myfinpro/staging/rollback-*.log
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
docker pull ghcr.io/aleksei-michnik/myfinpro/api:staging
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

### Deployment Flow

```mermaid
flowchart LR
    subgraph GitHub
        Repo[Repository]
        Secrets[GitHub Secrets<br/>source of truth]
        Actions[GitHub Actions<br/>CI → CD]
    end

    subgraph Server[Ubuntu Server]
        Nginx[Nginx :80/:443]
        API[API :3001]
        Web[Web :3000]
        MySQL[MySQL :3306]
        Redis[Redis :6379]
    end

    Repo -->|develop / main| Actions
    Actions -->|Build & push GHCR| Actions
    Actions -->|SSH + export env vars| Server
    Secrets -->|envs via SSH| Actions

    Nginx --> API
    Nginx --> Web
    API --> MySQL
    API --> Redis
```

### Secret Injection Flow

```mermaid
sequenceDiagram
    participant GH as GitHub Secrets
    participant GA as GitHub Actions
    participant SSH as SSH Session
    participant Srv as Server

    GH->>GA: Secrets via envs parameter
    GA->>SSH: appleboy/ssh-action with envs
    SSH->>Srv: export VAR=value (in shell)
    SSH->>Srv: envsubst ssl.conf.template → ssl.conf
    SSH->>Srv: docker compose up -d
    Srv->>Srv: Compose resolves ${VAR} from shell env
    Note over Srv: No files written — secrets in process memory only
```
