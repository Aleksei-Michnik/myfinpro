# Deployment Guide

## Overview

MyFinPro deploys to a dedicated Ubuntu server using Docker Compose with **blue-green zero-downtime deployment** and a **test-gated pipeline**. The full deployment lifecycle is:

1. **CI** — lint, typecheck, unit tests, build (on every PR/push)
2. **Staging Deploy** — blue-green deploy to staging (on push to `develop`)
3. **Staging Tests** — API integration + Playwright E2E tests against live staging
4. **Production Deploy** — blue-green deploy to production (on push to `main`), gated by staging test results

**Security Pattern:** GitHub Secrets is the single source of truth for all application secrets. They are injected via SSH environment variables at deploy time — no files are ever written to disk.

**Environments:**

| Environment | Branch    | Frontend URL                                    | API URL                                          |
| ----------- | --------- | ----------------------------------------------- | ------------------------------------------------ |
| Staging     | `develop` | `https://<CLOUDFLARE_STAGING_SUBDOMAIN>`        | `https://<CLOUDFLARE_STAGING_SUBDOMAIN>/api/v1`  |
| Production  | `main`    | `https://<CLOUDFLARE_PRODUCTION_SUBDOMAIN>`     | `https://<CLOUDFLARE_PRODUCTION_SUBDOMAIN>/api/v1` |

> Domain values are stored as GitHub Secrets (`CLOUDFLARE_STAGING_SUBDOMAIN`, `CLOUDFLARE_PRODUCTION_SUBDOMAIN`).

### Pipeline Flow

```mermaid
flowchart TB
    subgraph develop["Push to develop"]
        CI_S[CI<br/>lint, typecheck,<br/>unit tests, build]
        DS[Deploy Staging<br/>blue-green]
        TS[Test Staging<br/>API integration +<br/>Playwright E2E]
        CI_S --> DS --> TS
    end

    subgraph main["Push to main"]
        CI_P[CI<br/>lint, typecheck,<br/>unit tests, build]
        VST[Verify Staging Tests<br/>passed within 24h]
        DP[Deploy Production<br/>blue-green]
        CI_P --> VST --> DP
    end

    TS -.->|results gate| VST
```

---

## Deployment Pipeline

### CI Pipeline

**Workflow:** [`.github/workflows/ci.yml`](../.github/workflows/ci.yml)

- **Trigger:** PR or push to `develop` / `main`
- **Jobs:**
  1. **lint-and-typecheck** — ESLint, TypeScript compiler, Prettier format check
  2. **unit-tests** — All unit tests across API (Jest), Web (Vitest), Shared (Vitest)
  3. **build** — Build all packages and apps

```
lint-and-typecheck → unit-tests (parallel with build)
```

### Staging Deployment

**Workflow:** [`.github/workflows/deploy-staging.yml`](../.github/workflows/deploy-staging.yml)

- **Trigger:** Push to `develop` or manual dispatch
- **Steps:**
  1. Wait for CI to pass on the same commit
  2. Build Docker images (API + Web)
  3. Push images to GHCR with `staging` and `staging-<sha>` tags
  4. SSH into staging server
  5. Export secrets as shell environment variables
  6. Run blue-green deploy via [`scripts/deploy.sh`](../scripts/deploy.sh)
  7. Health checks verify the new slot is healthy
  8. On failure: automatic rollback to previous slot

### Staging Tests

**Workflow:** [`.github/workflows/test-staging.yml`](../.github/workflows/test-staging.yml)

- **Trigger:** Automatically after staging deploy succeeds, or manual dispatch
- **Jobs:**
  1. **API Staging Integration Tests** — Jest HTTP-based tests against the live staging API
  2. **Playwright Staging E2E Tests** — Browser-based tests against the staging frontend
  3. **Staging Tests Summary** — Aggregates results from both jobs

**API tests** (4 suites, 16 tests):

| Suite          | What it verifies                                        |
| -------------- | ------------------------------------------------------- |
| `health`       | Health endpoint returns OK with component statuses      |
| `api-root`     | API root responds with correct version and metadata     |
| `swagger`      | Swagger/OpenAPI docs are accessible and valid           |
| `rate-limiting` | Rate limiting headers present, 429 on excess requests  |

**Playwright tests** (4 suites, 14 tests):

| Suite        | What it verifies                                           |
| ------------ | ---------------------------------------------------------- |
| `homepage`   | Homepage loads, renders key elements, navigation works     |
| `api-proxy`  | Frontend API proxy correctly forwards to backend           |
| `i18n`       | English and Hebrew localization, URL-based locale switching |
| `responsive` | Layout adapts correctly to mobile, tablet, desktop         |

### Production Deployment

**Workflow:** [`.github/workflows/deploy-production.yml`](../.github/workflows/deploy-production.yml)

- **Trigger:** Push to `main` or manual dispatch (with confirmation text)
- **Gate:** Verifies staging tests passed within the last 24 hours (see [Production Deployment Gating](#production-deployment-gating))
- **Steps:**
  1. Validate manual trigger confirmation (if manual dispatch)
  2. Wait for CI to pass on the same commit
  3. **Verify staging tests passed** (must be successful and < 24h old)
  4. Build Docker images (API + Web)
  5. Push images to GHCR with `latest`, version tag, and `<sha>` tags
  6. SSH into production server
  7. Export secrets as shell environment variables
  8. Run blue-green deploy via [`scripts/deploy.sh`](../scripts/deploy.sh)
  9. On failure: automatic rollback to previous slot

---

## Real-Time Deployment Monitoring

### Watch Deployment Progress

```bash
# Watch a specific workflow run in real-time
gh run watch

# Watch the latest staging deployment
gh run list --workflow=deploy-staging.yml --limit=1
gh run watch $(gh run list --workflow=deploy-staging.yml --limit=1 --json databaseId --jq '.[0].databaseId')

# Watch the latest production deployment
gh run watch $(gh run list --workflow=deploy-production.yml --limit=1 --json databaseId --jq '.[0].databaseId')
```

### View Deployment Logs

```bash
# View logs for a specific run
gh run view <run-id> --log

# View failed step logs only
gh run view <run-id> --log-failed

# List recent deployments
gh run list --workflow=deploy-staging.yml --limit=5
gh run list --workflow=deploy-production.yml --limit=5
```

### On-Server Monitoring

```bash
# SSH into the server
ssh deploy@<SERVER_IP>

# Check running containers
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

# Check active deployment slot
cat /opt/myfinpro/staging/.active-slot 2>/dev/null || echo "no state file"
cat /opt/myfinpro/production/.active-slot 2>/dev/null || echo "no state file"

# API health check (use actual domain from CLOUDFLARE_*_SUBDOMAIN secrets)
curl -sf https://$STAGING_DOMAIN/api/v1/health | jq .
curl -sf https://$PRODUCTION_DOMAIN/api/v1/health | jq .

# Service logs (follow mode)
docker compose -p myfinpro-staging-app -f docker-compose.staging.app.yml logs -f api
docker compose -p myfinpro-staging-app -f docker-compose.staging.app.yml logs -f web

# Resource usage
docker stats --no-stream
```

---

## Test Execution and Status

### Unit Tests (Local)

```bash
# All unit tests
pnpm test

# API unit tests only (Jest — 13 suites, ~90 tests)
pnpm --filter api test

# Web unit tests only (Vitest — 3 suites, 35 tests)
pnpm --filter web test

# Shared package tests (Vitest — 3 suites, 46 tests)
pnpm --filter @myfinpro/shared test

# With coverage
pnpm test:coverage
```

### Staging Tests (Against Live Staging)

```bash
# API staging integration tests (Jest — 4 suites, 16 tests)
STAGING_API_URL=https://<CLOUDFLARE_STAGING_SUBDOMAIN>/api/v1 pnpm test:staging

# Playwright staging E2E tests (4 suites, 14 tests)
STAGING_URL=https://<CLOUDFLARE_STAGING_SUBDOMAIN> pnpm test:e2e:staging

# View Playwright HTML report after running
npx playwright show-report apps/web/playwright-report/staging
```

### View Staging Test Results in CI

```bash
# List recent staging test runs
gh run list --workflow=test-staging.yml --limit=5

# View specific test run details
gh run view <run-id>

# Download Playwright report artifact
gh run download <run-id> --name playwright-staging-report --dir ./playwright-report
```

---

## How to Deploy

### Deploy to Staging

**Automatic:** Push to the `develop` branch. The pipeline will:

1. Wait for CI to pass (lint, typecheck, unit tests, build)
2. Build & push Docker images tagged `staging` and `staging-<sha>`
3. SSH into the staging server
4. Export secrets as shell environment variables
5. Run blue-green deployment (start new slot, health check, switch nginx, stop old slot)
6. After deploy succeeds: staging tests run automatically (API integration + Playwright E2E)

**Manual:** Go to **Actions → Deploy Staging → Run workflow**.

### Deploy to Production

**Automatic:** Push to the `main` branch (typically via PR merge from `develop`). The pipeline will:

1. Wait for CI to pass
2. **Verify staging tests passed within the last 24 hours** — if not, deployment is blocked
3. Build & push Docker images tagged `latest`, version tag, and `<sha>`
4. SSH into the production server
5. Export secrets as shell environment variables
6. Run blue-green deployment

**Manual:** Go to **Actions → Deploy Production → Run workflow**:

- Type `deploy-production` in the confirmation field
- Optionally provide a version tag (e.g., `v1.2.3`)

> **Important:** Even manual production deploys are gated by the staging test check. If staging tests haven't passed within 24 hours, the deploy will fail. Use `workflow_dispatch` to trigger a fresh staging test run if needed.

### Manual Deployment (via CLI)

For manual deployment without GitHub Actions, SSH into the server and run the deploy script directly:

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
export CORS_ORIGINS="*"
export LOG_LEVEL="debug"
export SWAGGER_ENABLED="true"
export RATE_LIMIT_TTL="60000"
export RATE_LIMIT_MAX="60"
export NEXT_PUBLIC_API_URL="/api"
export API_INTERNAL_URL="http://api:3001"
export GHCR_REPO="aleksei-michnik/myfinpro"
export IMAGE_TAG="staging-<sha>"

# Export domain (from CLOUDFLARE_STAGING_SUBDOMAIN GitHub Secret)
export SERVER_NAME="<CLOUDFLARE_STAGING_SUBDOMAIN>"

# Run blue-green deploy
chmod +x scripts/deploy.sh
bash scripts/deploy.sh staging "$IMAGE_TAG"
```

---

## Production Deployment Gating

The `staging-tests-check` job in [`deploy-production.yml`](../.github/workflows/deploy-production.yml) enforces that staging tests have passed before production deployment proceeds:

1. **Queries the GitHub API** for the latest completed run of `test-staging.yml`
2. **Verifies conclusion is `success`** — if the latest run failed, production deploy is blocked
3. **Verifies the run is less than 24 hours old** — stale test results are rejected
4. **If any check fails**, the production deployment is blocked with a clear error message

This ensures:

- Every production deploy is validated against the staging environment
- Staging infrastructure issues are caught before reaching production
- Test results are fresh and relevant to the current codebase

**If production deploy is blocked:**

```bash
# Check the latest staging test status
gh run list --workflow=test-staging.yml --limit=3

# If tests are stale, trigger a fresh run
gh workflow run test-staging.yml

# Watch the test run complete
gh run watch $(gh run list --workflow=test-staging.yml --limit=1 --json databaseId --jq '.[0].databaseId')

# Then retry the production deployment
gh workflow run deploy-production.yml
```

---

## Rollback Procedures

### Automatic Rollback

If a deployment fails health checks, the deploy workflow's failure step triggers an automatic rollback via [`scripts/rollback.sh`](../scripts/rollback.sh). This reverts traffic to the previously active blue-green slot.

### Manual Rollback

SSH into the server and run:

```bash
cd /opt/myfinpro/staging    # or /opt/myfinpro/production

# Export all required environment variables first (same as deployment)
export MYSQL_ROOT_PASSWORD="..."
# ... (all env vars)

chmod +x scripts/rollback.sh
bash scripts/rollback.sh staging     # or production
```

The rollback script:

1. Reads the current active slot from state file
2. Starts the previously active slot containers (images are still cached locally)
3. Waits for health checks to pass
4. Switches Nginx upstream to the restored slot
5. Stops the failed slot containers

### Manual Image Rollback

To deploy a specific version:

```bash
# Set IMAGE_TAG to the desired version
export IMAGE_TAG=staging-abc1234
# ... export other required env vars ...

bash scripts/deploy.sh staging "$IMAGE_TAG"
```

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

| Variable              | Staging                    | Production                                     |
| --------------------- | -------------------------- | ---------------------------------------------- |
| `NODE_ENV`            | `staging`                  | `production`                                   |
| `API_PORT`            | `3001`                     | `3001`                                         |
| `CORS_ORIGINS`        | `*`                        | Derived from `CLOUDFLARE_PRODUCTION_SUBDOMAIN` |
| `LOG_LEVEL`           | `debug`                    | `warn`                                         |
| `SWAGGER_ENABLED`     | `true`                     | `false`                                        |
| `RATE_LIMIT_TTL`      | `60000`                    | `60000`                                        |
| `RATE_LIMIT_MAX`      | `60`                       | `30`                                           |
| `NEXT_PUBLIC_API_URL` | `/api`                     | `/api`                                         |
| `API_INTERNAL_URL`    | `http://api:3001`          | `http://api:3001`                              |
| `IMAGE_TAG`           | `staging-<sha>`            | `<sha>`                                        |
| `GHCR_REPO`           | `aleksei-michnik/myfinpro` | `aleksei-michnik/myfinpro`                     |

---

## Troubleshooting

### Container won't start

```bash
# Check logs for the specific service
docker compose -p myfinpro-staging-app -f docker-compose.staging.app.yml logs api --tail=50

# Check if the image was pulled correctly
docker images | grep myfinpro
```

### Database migration failed

```bash
# Check migration status
docker compose -p myfinpro-staging-app -f docker-compose.staging.app.yml exec api npx prisma migrate status

# Reset migrations (⚠️ destroys data — staging only)
docker compose -p myfinpro-staging-app -f docker-compose.staging.app.yml exec api npx prisma migrate reset --force
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
docker compose -p myfinpro-staging-app -f docker-compose.staging.app.yml exec api wget -qO- http://localhost:3001/api/v1/health

# Check Nginx upstream
docker exec myfinpro-nginx nginx -t
docker logs myfinpro-nginx --tail=20
```

### Out of disk space

```bash
# Clean up Docker resources
docker system prune -af --volumes
docker builder prune -af
```

### Staging tests failing after deploy

```bash
# Check the test run output
gh run list --workflow=test-staging.yml --limit=3
gh run view <run-id> --log-failed

# Verify staging is actually healthy (use actual staging domain)
curl -sf https://$STAGING_DOMAIN/api/v1/health | jq .
curl -sf https://$STAGING_DOMAIN/en

# Re-run staging tests manually
gh workflow run test-staging.yml
```

### Playwright tests timing out

```bash
# Download the Playwright report for details
gh run download <run-id> --name playwright-staging-report --dir ./playwright-report

# Check if staging frontend is responding
curl -sf -o /dev/null -w "%{http_code}" https://$STAGING_DOMAIN

# Run tests locally against staging for debugging
STAGING_URL=https://<CLOUDFLARE_STAGING_SUBDOMAIN> pnpm test:e2e:staging
```

### Production deploy blocked by staging tests

```bash
# Check why staging tests failed
gh run list --workflow=test-staging.yml --limit=5

# If tests are stale (>24h), trigger a fresh test run
gh workflow run test-staging.yml

# Wait for tests to pass, then retry production deploy
gh run watch $(gh run list --workflow=test-staging.yml --limit=1 --json databaseId --jq '.[0].databaseId')
gh workflow run deploy-production.yml
```

### How to force skip staging test gate (emergency)

For emergency production deployments when staging tests can't be run:

1. Go to **Actions → Deploy Production → Run workflow** with `workflow_dispatch`
2. The staging test check will still run — if it blocks, you'll need to temporarily modify the workflow
3. **Preferred approach:** Fix staging, run tests, then deploy to production

> ⚠️ **There is no bypass switch for the staging test gate by design.** This ensures production quality. If you need to deploy urgently, deploy to staging first, run tests, then proceed.

### Service dependency issues

```bash
# Restart in correct order
docker compose -p myfinpro-staging-infra -f docker-compose.staging.infra.yml down
docker compose -p myfinpro-staging-infra -f docker-compose.staging.infra.yml up -d
sleep 10
docker compose -p myfinpro-staging-app -f docker-compose.staging.app.yml up -d
```

---

## Architecture

### Deployment Flow

```mermaid
flowchart LR
    subgraph GitHub
        Repo[Repository]
        Secrets[GitHub Secrets<br/>source of truth]
        Actions[GitHub Actions<br/>CI → CD → Tests]
    end

    subgraph Server[Ubuntu Server]
        Nginx[Nginx :80/:443]
        API_B[API Blue/Green :3001]
        Web_B[Web Blue/Green :3000]
        MySQL[MySQL :3306]
        Redis[Redis :6379]
    end

    Repo -->|develop / main| Actions
    Actions -->|Build & push GHCR| Actions
    Actions -->|SSH + export env vars| Server
    Secrets -->|envs via SSH| Actions

    Nginx --> API_B
    Nginx --> Web_B
    API_B --> MySQL
    API_B --> Redis
```
