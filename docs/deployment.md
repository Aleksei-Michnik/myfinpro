# Deployment Guide

## Overview

MyFinPro deploys to a dedicated Ubuntu server using Docker Compose with **ephemeral secret injection**. The CD pipeline builds Docker images, pushes them to GitHub Container Registry (GHCR), then deploys via SSH with secrets injected at deploy time and shredded immediately after.

**Security Pattern:**

```
GitHub Secrets (source of truth)
    → SSH into server
    → Write temp .env file
    → docker compose up (reads .env)
    → shred .env (secrets never persist on disk)
```

**Environments:**

| Environment | Branch    | Trigger         | Compose File                    | Deploy Dir                  |
| ----------- | --------- | --------------- | ------------------------------- | --------------------------- |
| Staging     | `develop` | Push / Manual   | `docker-compose.staging.yml`    | `/opt/myfinpro/staging/`    |
| Production  | `main`    | Push + Approval | `docker-compose.production.yml` | `/opt/myfinpro/production/` |

---

## Security Architecture

### Ephemeral Secret Injection

Secrets are **never stored persistently** on the server. The deployment follows this pattern:

1. **GitHub Secrets** is the single source of truth for all application secrets
2. The deploy workflow passes secrets via SSH environment variables using `appleboy/ssh-action@v1` `envs` parameter
3. On the server, a temporary `.env` file is written with `chmod 600`
4. `docker compose up -d` reads the `.env` via the `env_file:` directive
5. The `.env` file is immediately **shredded** (`shred -vfz -n 3`) after compose starts
6. Docker Compose uses `env_file:` (not `environment:`) to avoid exposure via `docker inspect`

### Why This Pattern?

| Concern                   | Solution                                    |
| ------------------------- | ------------------------------------------- |
| Secrets in git history    | Never committed — injected at deploy time   |
| Secrets on server disk    | Shredded after compose up                   |
| `docker inspect` exposure | Using `env_file:` instead of `environment:` |
| Secret rotation           | Update GitHub Secret → redeploy             |
| Audit trail               | GitHub Secrets audit log                    |

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

### SSH & Infrastructure Secrets (per environment)

| Secret               | Description                                                        |
| -------------------- | ------------------------------------------------------------------ |
| `STAGING_HOST`       | Staging server IP or hostname                                      |
| `STAGING_USER`       | SSH username on staging server                                     |
| `STAGING_SSH_KEY`    | Private SSH key for staging server                                 |
| `PRODUCTION_HOST`    | Production server IP or hostname                                   |
| `PRODUCTION_USER`    | SSH username on production server                                  |
| `PRODUCTION_SSH_KEY` | Private SSH key for production server                              |
| `GHCR_REPO`          | GitHub Container Registry repo (lowercase, e.g., `owner/myfinpro`) |

### Application Secrets (per environment)

These must be configured in each GitHub Environment (`staging` / `production`):

| Secret                | Description                                     | Example                            |
| --------------------- | ----------------------------------------------- | ---------------------------------- |
| `MYSQL_ROOT_PASSWORD` | MySQL root password                             | `openssl rand -base64 48`          |
| `MYSQL_DATABASE`      | Database name                                   | `myfinpro_staging`                 |
| `MYSQL_USER`          | Database user                                   | `myfinpro_staging`                 |
| `MYSQL_PASSWORD`      | Database user password                          | `openssl rand -base64 48`          |
| `DATABASE_URL`        | Full MySQL connection string                    | `mysql://user:pass@mysql:3306/db`  |
| `JWT_SECRET`          | JWT access token signing secret (min 32 chars)  | `openssl rand -base64 48`          |
| `JWT_REFRESH_SECRET`  | JWT refresh token signing secret (min 32 chars) | `openssl rand -base64 48`          |
| `REDIS_URL`           | Redis connection string                         | `redis://redis:6379`               |
| `CORS_ORIGIN`         | Allowed CORS origins (production only)          | `https://myfinpro.example.com`     |
| `NEXT_PUBLIC_API_URL` | Public API URL (production only)                | `https://myfinpro.example.com/api` |

### Non-Secret Config (hardcoded in workflow)

These values are set directly in the workflow files:

| Variable              | Staging Value     | Production Value  |
| --------------------- | ----------------- | ----------------- |
| `NODE_ENV`            | `staging`         | `production`      |
| `API_PORT`            | `3001`            | `3001`            |
| `CORS_ORIGIN`         | `*`               | From secret       |
| `LOG_LEVEL`           | `debug`           | `warn`            |
| `SWAGGER_ENABLED`     | `true`            | `false`           |
| `RATE_LIMIT_TTL`      | `60000`           | `60000`           |
| `RATE_LIMIT_MAX`      | `60`              | `30`              |
| `NEXT_PUBLIC_API_URL` | `/api`            | From secret       |
| `API_INTERNAL_URL`    | `http://api:3001` | `http://api:3001` |
| `IMAGE_TAG`           | `staging`         | `latest`          |

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

**Important:** Since secrets are ephemeral, rotating a secret is as simple as updating it in GitHub and redeploying. No need to SSH into servers to update `.env` files.

---

## How to Deploy

### Deploy to Staging

**Automatic:** Push to the `develop` branch. The pipeline will:

1. Wait for CI to pass
2. Build & push Docker images tagged `staging`
3. SSH into the staging server
4. Write ephemeral `.env` with secrets from GitHub
5. Pull images, run `docker compose up -d`
6. Shred the `.env` file
7. Verify health checks

**Manual:** Go to **Actions → Deploy Staging → Run workflow**.

### Deploy to Production

**Automatic:** Push to the `main` branch (typically via PR merge from `develop`). The pipeline will:

1. Require manual approval in the `production` environment
2. Build & push Docker images tagged `latest` and version tag
3. SSH into the production server
4. Write ephemeral `.env` with production secrets
5. Pull images, run `docker compose up -d`
6. Shred the `.env` file
7. Verify health checks

**Manual:** Go to **Actions → Deploy Production → Run workflow**:

- Type `deploy-production` in the confirmation field
- Optionally provide a version tag (e.g., `v1.2.3`)

### Manual Deployment (via CLI)

For manual deployment without GitHub Actions, export required env vars and run:

```bash
# Export all required env vars (see .env.staging.template for the list)
export MYSQL_ROOT_PASSWORD="..."
export MYSQL_DATABASE="..."
# ... (all vars from the template)

cd /opt/myfinpro/staging
./scripts/deploy.sh staging
```

The deploy script will write the `.env`, run compose, and shred on exit.

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
./scripts/deploy.sh staging
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
    Actions -->|SSH + inject secrets| Server
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
    SSH->>Srv: Write .env (chmod 600)
    SSH->>Srv: docker compose up -d
    Srv->>Srv: Containers read env_file: .env
    SSH->>Srv: shred -vfz -n 3 .env
    Note over Srv: .env no longer exists on disk
```
