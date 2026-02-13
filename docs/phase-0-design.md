# Phase 0.1 & 0.2 — Architectural Design Document

> **Purpose**: This document specifies every file, configuration, and structure to be created during Phase 0.1 (Local Dev Readiness) and Phase 0.2 (Project Scaffolding). It is the single source of truth for the implementation task.

---

## Table of Contents

1. [Complete Directory Tree](#1-complete-directory-tree)
2. [Phase 0.1 — Local Dev Readiness](#2-phase-01--local-dev-readiness)
   - 2.1 [Docker Compose Configuration](#21-docker-compose-configuration)
   - 2.2 [Dockerfiles](#22-dockerfiles)
   - 2.3 [Nginx Configuration](#23-nginx-configuration)
   - 2.4 [Environment Templates](#24-environment-templates)
   - 2.5 [Seed Data Structure](#25-seed-data-structure)
3. [Phase 0.2 — Project Scaffolding](#3-phase-02--project-scaffolding)
   - 3.1 [pnpm Workspace Configuration](#31-pnpm-workspace-configuration)
   - 3.2 [Root package.json](#32-root-packagejson)
   - 3.3 [TypeScript Configuration Hierarchy](#33-typescript-configuration-hierarchy)
   - 3.4 [ESLint Configuration](#34-eslint-configuration)
   - 3.5 [Prettier Configuration](#35-prettier-configuration)
   - 3.6 [packages/shared](#36-packagesshared)
   - 3.7 [apps/api — NestJS Backend](#37-appsapi--nestjs-backend)
   - 3.8 [apps/web — Next.js Frontend](#38-appsweb--nextjs-frontend)
   - 3.9 [apps/bot — Telegram Bot Placeholder](#39-appsbot--telegram-bot-placeholder)
   - 3.10 [Prisma Schema and Setup](#310-prisma-schema-and-setup)
   - 3.11 [API Versioning Strategy](#311-api-versioning-strategy)
   - 3.12 [@nestjs/swagger Setup](#312-nestjsswagger-setup)
   - 3.13 [Playwright E2E Configuration](#313-playwright-e2e-configuration)
   - 3.14 [Testcontainers Setup](#314-testcontainers-setup)
   - 3.15 [Jest / Vitest Configuration](#315-jest--vitest-configuration)
   - 3.16 [Git Configuration](#316-git-configuration)
4. [Dependency Version Matrix](#4-dependency-version-matrix)
5. [Architecture Diagrams](#5-architecture-diagrams)

---

## 1. Complete Directory Tree

Every file to be created in Phase 0.1 and 0.2. Files marked with `(0.1)` belong to Phase 0.1; `(0.2)` to Phase 0.2. Files with both markers are created in 0.1 and extended in 0.2.

```
myfinpro/
├── .env.example                          (0.1)
├── .gitignore                            (0.2)
├── .prettierrc                           (0.2)
├── .prettierignore                       (0.2)
├── .npmrc                                (0.2)
├── docker-compose.yml                    (0.1)
├── docker-compose.override.yml           (0.1)
├── pnpm-workspace.yaml                   (0.2)
├── package.json                          (0.2)
├── turbo.json                            (0.2)
├── IMPLEMENTATION-PLAN.md                (existing)
├── SPECIFICATION-USER-STORIES.md         (existing)
│
├── docs/
│   └── phase-0-design.md                 (this file)
│
├── infrastructure/
│   ├── nginx/
│   │   ├── nginx.conf                    (0.1)
│   │   └── conf.d/
│   │       └── default.conf              (0.1)
│   ├── mysql/
│   │   └── init/
│   │       └── 01-create-databases.sql   (0.1)
│   └── docker/
│       ├── api.Dockerfile                (0.1)
│       ├── web.Dockerfile                (0.1)
│       └── bot.Dockerfile                (0.2)
│
├── packages/
│   ├── tsconfig/
│   │   ├── package.json                  (0.2)
│   │   ├── base.json                     (0.2)
│   │   ├── nestjs.json                   (0.2)
│   │   ├── nextjs.json                   (0.2)
│   │   └── node.json                     (0.2)
│   │
│   ├── eslint-config/
│   │   ├── package.json                  (0.2)
│   │   ├── base.js                       (0.2)
│   │   ├── nestjs.js                     (0.2)
│   │   └── nextjs.js                     (0.2)
│   │
│   └── shared/
│       ├── package.json                  (0.2)
│       ├── tsconfig.json                 (0.2)
│       └── src/
│           ├── index.ts                  (0.2)
│           ├── constants/
│           │   └── index.ts              (0.2)
│           ├── types/
│           │   └── index.ts              (0.2)
│           └── dto/
│               └── index.ts              (0.2)
│
├── apps/
│   ├── api/
│   │   ├── .env.example                  (0.1)
│   │   ├── package.json                  (0.2)
│   │   ├── tsconfig.json                 (0.2)
│   │   ├── tsconfig.build.json           (0.2)
│   │   ├── nest-cli.json                 (0.2)
│   │   ├── jest.config.ts                (0.2)
│   │   ├── jest.integration.config.ts    (0.2)
│   │   ├── src/
│   │   │   ├── main.ts                   (0.2)
│   │   │   ├── app.module.ts             (0.2)
│   │   │   ├── app.controller.ts         (0.2)
│   │   │   ├── app.controller.spec.ts    (0.2)
│   │   │   ├── app.service.ts            (0.2)
│   │   │   ├── common/
│   │   │   │   ├── filters/
│   │   │   │   │   └── http-exception.filter.ts      (0.2)
│   │   │   │   ├── interceptors/
│   │   │   │   │   └── transform.interceptor.ts      (0.2)
│   │   │   │   ├── decorators/
│   │   │   │   │   └── api-version.decorator.ts      (0.2)
│   │   │   │   └── pipes/
│   │   │   │       └── validation.pipe.ts            (0.2)
│   │   │   ├── config/
│   │   │   │   ├── app.config.ts         (0.2)
│   │   │   │   ├── database.config.ts    (0.2)
│   │   │   │   └── swagger.config.ts     (0.2)
│   │   │   └── health/
│   │   │       ├── health.module.ts      (0.2)
│   │   │       └── health.controller.ts  (0.2)
│   │   ├── prisma/
│   │   │   ├── schema.prisma             (0.2)
│   │   │   └── seed.ts                   (0.1/0.2)
│   │   └── test/
│   │       ├── setup.ts                  (0.2)
│   │       ├── integration/
│   │       │   ├── setup.ts              (0.2)
│   │       │   └── app.integration.spec.ts (0.2)
│   │       └── helpers/
│   │           └── testcontainers.ts     (0.2)
│   │
│   ├── web/
│   │   ├── .env.example                  (0.1)
│   │   ├── package.json                  (0.2)
│   │   ├── tsconfig.json                 (0.2)
│   │   ├── next.config.ts                (0.2)
│   │   ├── next-env.d.ts                 (0.2 - auto-generated)
│   │   ├── postcss.config.js             (0.2)
│   │   ├── vitest.config.ts              (0.2)
│   │   ├── playwright.config.ts          (0.2)
│   │   ├── src/
│   │   │   ├── app/
│   │   │   │   ├── layout.tsx            (0.2)
│   │   │   │   ├── page.tsx              (0.2)
│   │   │   │   └── api/
│   │   │   │       └── health/
│   │   │   │           └── route.ts      (0.2)
│   │   │   ├── components/
│   │   │   │   └── ui/
│   │   │   │       └── .gitkeep          (0.2)
│   │   │   ├── lib/
│   │   │   │   └── api-client.ts         (0.2)
│   │   │   ├── hooks/
│   │   │   │   └── .gitkeep              (0.2)
│   │   │   └── styles/
│   │   │       └── globals.css           (0.2)
│   │   ├── public/
│   │   │   └── .gitkeep                  (0.2)
│   │   ├── messages/
│   │   │   ├── en.json                   (0.2)
│   │   │   └── he.json                   (0.2)
│   │   └── e2e/
│   │       ├── smoke.spec.ts             (0.2)
│   │       └── fixtures/
│   │           └── .gitkeep              (0.2)
│   │
│   └── bot/
│       ├── .env.example                  (0.2)
│       ├── package.json                  (0.2)
│       ├── tsconfig.json                 (0.2)
│       └── src/
│           ├── main.ts                   (0.2)
│           └── bot.module.ts             (0.2)
│
└── scripts/
    ├── dev.sh                            (0.1)
    └── seed.sh                           (0.1)
```

---

## 2. Phase 0.1 — Local Dev Readiness

### 2.1 Docker Compose Configuration

#### `docker-compose.yml` — Production-like base

```yaml
# docker-compose.yml

services:
  # ───── MySQL Database ─────
  mysql:
    image: mysql:8.4
    container_name: myfinpro-mysql
    restart: unless-stopped
    environment:
      MYSQL_ROOT_PASSWORD: ${MYSQL_ROOT_PASSWORD}
      MYSQL_DATABASE: ${MYSQL_DATABASE}
      MYSQL_USER: ${MYSQL_USER}
      MYSQL_PASSWORD: ${MYSQL_PASSWORD}
    ports:
      - "${MYSQL_PORT:-3306}:3306"
    volumes:
      - mysql_data:/var/lib/mysql
      - ./infrastructure/mysql/init:/docker-entrypoint-initdb.d:ro
    networks:
      - myfinpro-net
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost", "-u", "root", "-p${MYSQL_ROOT_PASSWORD}"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 30s
    command: >
      --default-authentication-plugin=mysql_native_password
      --character-set-server=utf8mb4
      --collation-server=utf8mb4_unicode_ci

  # ───── Redis ─────
  redis:
    image: redis:8-alpine
    container_name: myfinpro-redis
    restart: unless-stopped
    ports:
      - "${REDIS_PORT:-6379}:6379"
    volumes:
      - redis_data:/data
    networks:
      - myfinpro-net
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
    command: redis-server --appendonly yes --maxmemory 256mb --maxmemory-policy allkeys-lru

  # ───── NestJS API ─────
  api:
    build:
      context: .
      dockerfile: infrastructure/docker/api.Dockerfile
      target: development
    container_name: myfinpro-api
    restart: unless-stopped
    env_file:
      - ./apps/api/.env
    environment:
      NODE_ENV: development
      DATABASE_URL: mysql://${MYSQL_USER}:${MYSQL_PASSWORD}@mysql:3306/${MYSQL_DATABASE}
      REDIS_HOST: redis
      REDIS_PORT: 6379
    ports:
      - "${API_PORT:-3001}:3001"
    volumes:
      - ./apps/api:/app/apps/api
      - ./packages:/app/packages
      - /app/node_modules
      - /app/apps/api/node_modules
    networks:
      - myfinpro-net
    depends_on:
      mysql:
        condition: service_healthy
      redis:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:3001/api/v1/health"]
      interval: 15s
      timeout: 5s
      retries: 3
      start_period: 30s

  # ───── Next.js Web ─────
  web:
    build:
      context: .
      dockerfile: infrastructure/docker/web.Dockerfile
      target: development
    container_name: myfinpro-web
    restart: unless-stopped
    env_file:
      - ./apps/web/.env
    environment:
      NODE_ENV: development
      NEXT_PUBLIC_API_URL: http://localhost/api
    ports:
      - "${WEB_PORT:-3000}:3000"
    volumes:
      - ./apps/web:/app/apps/web
      - ./packages:/app/packages
      - /app/node_modules
      - /app/apps/web/node_modules
      - /app/apps/web/.next
    networks:
      - myfinpro-net
    depends_on:
      api:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:3000"]
      interval: 15s
      timeout: 5s
      retries: 3
      start_period: 30s

  # ───── Nginx Reverse Proxy ─────
  nginx:
    image: nginx:1.28-alpine
    container_name: myfinpro-nginx
    restart: unless-stopped
    ports:
      - "${NGINX_PORT:-80}:80"
    volumes:
      - ./infrastructure/nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./infrastructure/nginx/conf.d:/etc/nginx/conf.d:ro
    networks:
      - myfinpro-net
    depends_on:
      api:
        condition: service_healthy
      web:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost/health"]
      interval: 15s
      timeout: 5s
      retries: 3

volumes:
  mysql_data:
    driver: local
  redis_data:
    driver: local

networks:
  myfinpro-net:
    driver: bridge
```

#### `docker-compose.override.yml` — Development overrides

This file is auto-loaded by Docker Compose in development and can add debug ports or additional tools.

```yaml
# docker-compose.override.yml
# Development-only overrides (auto-loaded by Docker Compose)

services:
  mysql:
    ports:
      - "${MYSQL_EXTERNAL_PORT:-3307}:3306"

  redis:
    ports:
      - "${REDIS_EXTERNAL_PORT:-6380}:6379"
```

### 2.2 Dockerfiles

#### `infrastructure/docker/api.Dockerfile`

```dockerfile
# ───── Base Stage ─────
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.28.2 --activate
WORKDIR /app

# ───── Dependencies Stage ─────
FROM base AS dependencies
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/shared/package.json ./packages/shared/
COPY packages/tsconfig/package.json ./packages/tsconfig/
COPY packages/eslint-config/package.json ./packages/eslint-config/
RUN pnpm install --frozen-lockfile

# ───── Development Stage ─────
FROM dependencies AS development
COPY . .
WORKDIR /app/apps/api
EXPOSE 3001
CMD ["pnpm", "run", "start:dev"]

# ───── Build Stage ─────
FROM dependencies AS build
COPY . .
RUN pnpm --filter api run build

# ───── Production Stage ─────
FROM node:22-alpine AS production
RUN corepack enable && corepack prepare pnpm@10.28.2 --activate
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/shared/package.json ./packages/shared/
COPY packages/tsconfig/package.json ./packages/tsconfig/
RUN pnpm install --frozen-lockfile --prod
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/prisma ./apps/api/prisma
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
WORKDIR /app/apps/api
EXPOSE 3001
CMD ["node", "dist/main.js"]
```

#### `infrastructure/docker/web.Dockerfile`

```dockerfile
# ───── Base Stage ─────
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.28.2 --activate
WORKDIR /app

# ───── Dependencies Stage ─────
FROM base AS dependencies
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/
COPY packages/tsconfig/package.json ./packages/tsconfig/
COPY packages/eslint-config/package.json ./packages/eslint-config/
RUN pnpm install --frozen-lockfile

# ───── Development Stage ─────
FROM dependencies AS development
COPY . .
WORKDIR /app/apps/web
EXPOSE 3000
CMD ["pnpm", "run", "dev"]

# ───── Build Stage ─────
FROM dependencies AS build
COPY . .
RUN pnpm --filter web run build

# ───── Production Stage ─────
FROM node:22-alpine AS production
RUN corepack enable && corepack prepare pnpm@10.28.2 --activate
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/
COPY packages/tsconfig/package.json ./packages/tsconfig/
RUN pnpm install --frozen-lockfile --prod
COPY --from=build /app/apps/web/.next ./apps/web/.next
COPY --from=build /app/apps/web/public ./apps/web/public
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
WORKDIR /app/apps/web
EXPOSE 3000
CMD ["pnpm", "run", "start"]
```

#### `infrastructure/docker/bot.Dockerfile`

```dockerfile
# ───── Base Stage ─────
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.28.2 --activate
WORKDIR /app

# ───── Dependencies Stage ─────
FROM base AS dependencies
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/bot/package.json ./apps/bot/
COPY packages/shared/package.json ./packages/shared/
COPY packages/tsconfig/package.json ./packages/tsconfig/
COPY packages/eslint-config/package.json ./packages/eslint-config/
RUN pnpm install --frozen-lockfile

# ───── Development Stage ─────
FROM dependencies AS development
COPY . .
WORKDIR /app/apps/bot
CMD ["pnpm", "run", "start:dev"]

# ───── Placeholder: Build and production stages to be added in Telegram phase ─────
```

### 2.3 Nginx Configuration

#### `infrastructure/nginx/nginx.conf`

```nginx
worker_processes auto;
error_log /var/log/nginx/error.log warn;
pid /var/run/nginx.pid;

events {
    worker_connections 1024;
}

http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;

    log_format main '$remote_addr - $remote_user [$time_local] "$request" '
                    '$status $body_bytes_sent "$http_referer" '
                    '"$http_user_agent" "$http_x_forwarded_for"';

    access_log /var/log/nginx/access.log main;
    sendfile on;
    tcp_nopush on;
    keepalive_timeout 65;
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # Request size limit (for file uploads)
    client_max_body_size 15M;

    include /etc/nginx/conf.d/*.conf;
}
```

#### `infrastructure/nginx/conf.d/default.conf`

```nginx
upstream api_upstream {
    server api:3001;
}

upstream web_upstream {
    server web:3000;
}

server {
    listen 80;
    server_name localhost;

    # ─── Health check endpoint for Nginx itself ───
    location = /health {
        access_log off;
        return 200 '{"status":"ok","service":"nginx"}';
        add_header Content-Type application/json;
    }

    # ─── API: Proxy /api/* to NestJS ───
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

    # ─── Swagger docs: accessible at /api/docs ───
    location /api/docs {
        proxy_pass http://api_upstream/api/docs;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # ─── Web: Proxy everything else to Next.js ───
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
```

### 2.4 Environment Templates

#### `.env.example` (root level)

```env
# ─────────────────────────────────────────────
# MyFinPro — Root Environment Configuration
# Copy to .env and fill in values
# ─────────────────────────────────────────────

# ── Node ──
NODE_ENV=development

# ── MySQL ──
MYSQL_ROOT_PASSWORD=rootpassword_change_me
MYSQL_DATABASE=myfinpro
MYSQL_USER=myfinpro_user
MYSQL_PASSWORD=myfinpro_password_change_me
MYSQL_PORT=3306
MYSQL_EXTERNAL_PORT=3307

# ── Redis ──
REDIS_PORT=6379
REDIS_EXTERNAL_PORT=6380

# ── Service Ports ──
API_PORT=3001
WEB_PORT=3000
NGINX_PORT=80
```

#### `apps/api/.env.example`

```env
# ─────────────────────────────────────────────
# MyFinPro API — Environment Configuration
# Copy to .env and fill in values
# ─────────────────────────────────────────────

# ── Application ──
NODE_ENV=development
API_PORT=3001
API_PREFIX=api
API_VERSION=v1
API_GLOBAL_PREFIX=api/v1

# ── Database (Prisma) ──
DATABASE_URL=mysql://myfinpro_user:myfinpro_password_change_me@localhost:3307/myfinpro

# ── Redis ──
REDIS_HOST=localhost
REDIS_PORT=6380
REDIS_PASSWORD=

# ── JWT ──
JWT_ACCESS_SECRET=your_access_secret_change_me_min_32_chars
JWT_ACCESS_EXPIRATION=15m
JWT_REFRESH_SECRET=your_refresh_secret_change_me_min_32_chars
JWT_REFRESH_EXPIRATION=7d

# ── CORS ──
CORS_ORIGINS=http://localhost:3000,http://localhost:80

# ── Rate Limiting ──
THROTTLE_TTL=60
THROTTLE_LIMIT=60

# ── Swagger ──
SWAGGER_ENABLED=true
SWAGGER_TITLE=MyFinPro API
SWAGGER_DESCRIPTION=Personal/Family Finance Management API
SWAGGER_VERSION=1.0

# ── Logging ──
LOG_LEVEL=debug
```

#### `apps/web/.env.example`

```env
# ─────────────────────────────────────────────
# MyFinPro Web — Environment Configuration
# Copy to .env and fill in values
# ─────────────────────────────────────────────

# ── Application ──
NODE_ENV=development
PORT=3000

# ── API Connection ──
# Public URL: Used in browser (goes through Nginx)
NEXT_PUBLIC_API_URL=http://localhost/api/v1
# Internal URL: Used for SSR (direct container-to-container)
API_INTERNAL_URL=http://api:3001/api/v1

# ── i18n ──
NEXT_PUBLIC_DEFAULT_LOCALE=en
NEXT_PUBLIC_SUPPORTED_LOCALES=en,he
```

#### `apps/bot/.env.example`

```env
# ─────────────────────────────────────────────
# MyFinPro Bot — Environment Configuration
# Copy to .env and fill in values
# ─────────────────────────────────────────────

# ── Application ──
NODE_ENV=development

# ── Telegram Bot ──
BOT_TOKEN=your_telegram_bot_token
BOT_WEBHOOK_URL=

# ── API Connection ──
API_BASE_URL=http://api:3001/api/v1

# ── Redis ──
REDIS_HOST=localhost
REDIS_PORT=6380
```

### 2.5 Seed Data Structure

#### Approach

The seed mechanism uses Prisma's built-in `prisma db seed` command, configured in `apps/api/package.json`. Seed data is written in TypeScript using the Prisma Client and follows a factory pattern for reusability in tests.

#### `infrastructure/mysql/init/01-create-databases.sql`

This SQL runs on first MySQL container start (via `docker-entrypoint-initdb.d`):

```sql
-- Create test database for integration tests
CREATE DATABASE IF NOT EXISTS myfinpro_test;
GRANT ALL PRIVILEGES ON myfinpro_test.* TO 'myfinpro_user'@'%';
FLUSH PRIVILEGES;
```

#### `apps/api/prisma/seed.ts`

```typescript
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seed...');

  // Phase 0: Verify database connection
  await prisma.$connect();
  console.log('✅ Database connection verified');

  // Seed data will be added as models are created in later phases.
  // Phase 1 will add: default user accounts for development
  // Phase 4 will add: sample groups and memberships
  // Phase 5 will add: sample income categories
  // Phase 6 will add: sample expense categories

  console.log('🌱 Seed completed successfully');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
```

#### `scripts/dev.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail

echo "🚀 Starting MyFinPro development environment..."

# Check prerequisites
command -v docker >/dev/null 2>&1 || { echo "❌ Docker is required but not installed."; exit 1; }
command -v pnpm >/dev/null 2>&1 || { echo "❌ pnpm is required but not installed."; exit 1; }

# Copy env files if they don't exist
for env_file in .env apps/api/.env apps/web/.env; do
  if [ ! -f "$env_file" ] && [ -f "${env_file}.example" ]; then
    cp "${env_file}.example" "$env_file"
    echo "📋 Created $env_file from template"
  fi
done

# Start infrastructure services first
echo "🐳 Starting infrastructure services..."
docker compose up -d mysql redis

# Wait for MySQL to be healthy
echo "⏳ Waiting for MySQL to be ready..."
until docker compose exec mysql mysqladmin ping -h localhost -u root --password=rootpassword_change_me --silent 2>/dev/null; do
  sleep 2
done
echo "✅ MySQL is ready"

# Run migrations
echo "📦 Running database migrations..."
pnpm --filter api exec prisma migrate dev

# Start all services
echo "🐳 Starting all services..."
docker compose up -d

echo ""
echo "✅ MyFinPro is running!"
echo "   Web:     http://localhost:${NGINX_PORT:-80}"
echo "   API:     http://localhost:${API_PORT:-3001}/api/v1"
echo "   Swagger: http://localhost:${NGINX_PORT:-80}/api/docs"
echo "   MySQL:   localhost:${MYSQL_EXTERNAL_PORT:-3307}"
echo "   Redis:   localhost:${REDIS_EXTERNAL_PORT:-6380}"
```

#### `scripts/seed.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail

echo "🌱 Running database seed..."

# Run Prisma seed via the api package
pnpm --filter api exec prisma db seed

echo "✅ Seed completed"
```

---

## 3. Phase 0.2 — Project Scaffolding

### 3.1 pnpm Workspace Configuration

#### `pnpm-workspace.yaml`

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

#### `.npmrc`

```ini
# Hoist only specific packages to root to avoid phantom dependency issues
shamefully-hoist=false
# Strict peer dependency resolution
strict-peer-dependencies=false
# Enable pnpm lockfile
lockfile=true
# Auto-install peers
auto-install-peers=true
```

### 3.2 Root package.json

```jsonc
{
  "name": "myfinpro",
  "version": "0.1.0",
  "private": true,
  "description": "Personal/Family Finance Management Application",
  "packageManager": "pnpm@10.28.2",
  "engines": {
    "node": ">=22.0.0",
    "pnpm": ">=10.0.0"
  },
  "scripts": {
    // ── Development ──
    "dev": "turbo run dev",
    "dev:api": "pnpm --filter api dev",
    "dev:web": "pnpm --filter web dev",
    "dev:bot": "pnpm --filter bot dev",

    // ── Build ──
    "build": "turbo run build",
    "build:api": "pnpm --filter api build",
    "build:web": "pnpm --filter web build",

    // ── Lint & Format ──
    "lint": "turbo run lint",
    "lint:fix": "turbo run lint:fix",
    "format": "prettier --write \"**/*.{ts,tsx,js,jsx,json,md,yaml,yml}\"",
    "format:check": "prettier --check \"**/*.{ts,tsx,js,jsx,json,md,yaml,yml}\"",
    "typecheck": "turbo run typecheck",

    // ── Testing ──
    "test": "turbo run test",
    "test:unit": "turbo run test:unit",
    "test:integration": "pnpm --filter api test:integration",
    "test:e2e": "pnpm --filter web test:e2e",
    "test:coverage": "turbo run test:coverage",

    // ── Database ──
    "db:migrate": "pnpm --filter api exec prisma migrate dev",
    "db:migrate:prod": "pnpm --filter api exec prisma migrate deploy",
    "db:generate": "pnpm --filter api exec prisma generate",
    "db:seed": "pnpm --filter api exec prisma db seed",
    "db:reset": "pnpm --filter api exec prisma migrate reset",
    "db:studio": "pnpm --filter api exec prisma studio",

    // ── Docker ──
    "docker:up": "docker compose up -d",
    "docker:down": "docker compose down",
    "docker:restart": "docker compose restart",
    "docker:logs": "docker compose logs -f",
    "docker:build": "docker compose build",

    // ── Utilities ──
    "clean": "turbo run clean && rm -rf node_modules",
    "prepare": "echo 'Monorepo ready'"
  },
  "devDependencies": {
    "turbo": "^2.8.3",
    "prettier": "^3.8.1",
    "typescript": "^5.9.3"
  }
}
```

> **Note**: The `scripts` block above uses `//` comments for documentation clarity. In the actual `package.json`, comments must be removed since JSON does not support comments.

#### `turbo.json`

```jsonc
{
  "$schema": "https://turbo.build/schema.json",
  "globalDependencies": [".env"],
  "tasks": {
    "dev": {
      "cache": false,
      "persistent": true
    },
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", ".next/**"]
    },
    "lint": {
      "dependsOn": ["^build"]
    },
    "lint:fix": {
      "dependsOn": ["^build"],
      "cache": false
    },
    "typecheck": {
      "dependsOn": ["^build"]
    },
    "test": {
      "dependsOn": ["^build"]
    },
    "test:unit": {
      "dependsOn": ["^build"]
    },
    "test:coverage": {
      "dependsOn": ["^build"],
      "outputs": ["coverage/**"]
    },
    "clean": {
      "cache": false
    }
  }
}
```

### 3.3 TypeScript Configuration Hierarchy

The TypeScript configuration uses a layered inheritance approach:

```mermaid
flowchart TD
    base[packages/tsconfig/base.json] --> nestjs[packages/tsconfig/nestjs.json]
    base --> nextjs[packages/tsconfig/nextjs.json]
    base --> node[packages/tsconfig/node.json]
    nestjs --> api_tsconfig[apps/api/tsconfig.json]
    nextjs --> web_tsconfig[apps/web/tsconfig.json]
    node --> bot_tsconfig[apps/bot/tsconfig.json]
    node --> shared_tsconfig[packages/shared/tsconfig.json]
```

#### `packages/tsconfig/package.json`

```json
{
  "name": "@myfinpro/tsconfig",
  "version": "0.0.0",
  "private": true,
  "license": "MIT",
  "publishConfig": {
    "access": "public"
  },
  "files": [
    "base.json",
    "nestjs.json",
    "nextjs.json",
    "node.json"
  ]
}
```

#### `packages/tsconfig/base.json`

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "display": "Base",
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "moduleResolution": "node",
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "forceConsistentCasingInFileNames": true,
    "strict": true,
    "strictNullChecks": true,
    "strictPropertyInitialization": false,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "incremental": true
  },
  "exclude": ["node_modules", "dist", "coverage", ".next"]
}
```

#### `packages/tsconfig/nestjs.json`

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "display": "NestJS",
  "extends": "./base.json",
  "compilerOptions": {
    "module": "commonjs",
    "target": "ES2022",
    "outDir": "./dist",
    "rootDir": "./src",
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "declaration": true,
    "removeComments": true,
    "allowJs": false,
    "baseUrl": "./",
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```

#### `packages/tsconfig/nextjs.json`

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "display": "Next.js",
  "extends": "./base.json",
  "compilerOptions": {
    "target": "ES2017",
    "module": "esnext",
    "moduleResolution": "bundler",
    "allowJs": true,
    "jsx": "preserve",
    "noEmit": true,
    "incremental": true,
    "plugins": [
      { "name": "next" }
    ],
    "baseUrl": "./",
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```

#### `packages/tsconfig/node.json`

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "display": "Node Library",
  "extends": "./base.json",
  "compilerOptions": {
    "module": "commonjs",
    "target": "ES2022",
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

### 3.4 ESLint Configuration

Uses flat config format (ESLint v10 — flat config is now the only format).

#### `packages/eslint-config/package.json`

```json
{
  "name": "@myfinpro/eslint-config",
  "version": "0.0.0",
  "private": true,
  "license": "MIT",
  "main": "base.js",
  "files": [
    "base.js",
    "nestjs.js",
    "nextjs.js"
  ],
  "dependencies": {
    "@typescript-eslint/eslint-plugin": "^8.54.0",
    "@typescript-eslint/parser": "^8.54.0",
    "eslint-config-prettier": "^10.1.8",
    "eslint-plugin-import": "^2.32.0"
  },
  "peerDependencies": {
    "eslint": "^10.0.0",
    "typescript": "^5.0.0"
  }
}
```

#### `packages/eslint-config/base.js`

```javascript
const { resolve } = require('node:path');

/** @type {import('eslint').Linter.Config[]} */
module.exports = [
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: require('@typescript-eslint/parser'),
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': require('@typescript-eslint/eslint-plugin'),
      'import': require('eslint-plugin-import'),
    },
    rules: {
      // TypeScript
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-empty-interface': 'off',

      // Import ordering
      'import/order': [
        'warn',
        {
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
      'import/no-duplicates': 'error',

      // General
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/.next/**', '**/coverage/**'],
  },
];
```

#### `packages/eslint-config/nestjs.js`

```javascript
const baseConfig = require('./base');

/** @type {import('eslint').Linter.Config[]} */
module.exports = [
  ...baseConfig,
  {
    files: ['**/*.ts'],
    rules: {
      // NestJS-specific rules
      '@typescript-eslint/interface-name-prefix': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',

      // Allow console in NestJS (uses Logger instead — enforced by code review)
      'no-console': 'off',
    },
  },
];
```

#### `packages/eslint-config/nextjs.js`

```javascript
const baseConfig = require('./base');

/** @type {import('eslint').Linter.Config[]} */
module.exports = [
  ...baseConfig,
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      // Next.js-specific relaxations
      '@typescript-eslint/no-explicit-any': 'warn',

      // React
      'react/react-in-jsx-scope': 'off',
    },
  },
];
```

### 3.5 Prettier Configuration

#### `.prettierrc`

```json
{
  "semi": true,
  "trailingComma": "all",
  "singleQuote": true,
  "printWidth": 100,
  "tabWidth": 2,
  "useTabs": false,
  "bracketSpacing": true,
  "arrowParens": "always",
  "endOfLine": "lf"
}
```

#### `.prettierignore`

```
node_modules
dist
.next
coverage
pnpm-lock.yaml
*.min.js
*.min.css
```

### 3.6 packages/shared

#### `packages/shared/package.json`

```json
{
  "name": "@myfinpro/shared",
  "version": "0.1.0",
  "private": true,
  "license": "MIT",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "clean": "rm -rf dist",
    "lint": "eslint src/",
    "lint:fix": "eslint src/ --fix",
    "typecheck": "tsc --noEmit",
    "test": "echo \"No tests yet\" && exit 0",
    "test:unit": "echo \"No tests yet\" && exit 0"
  },
  "dependencies": {},
  "devDependencies": {
    "@myfinpro/tsconfig": "workspace:*",
    "@myfinpro/eslint-config": "workspace:*",
    "typescript": "^5.9.3",
    "eslint": "^10.0.0"
  }
}
```

#### `packages/shared/tsconfig.json`

```json
{
  "extends": "@myfinpro/tsconfig/node.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

#### `packages/shared/src/index.ts`

```typescript
export * from './constants';
export * from './types';
export * from './dto';
```

#### `packages/shared/src/constants/index.ts`

```typescript
/**
 * Application-wide constants shared between all apps.
 */

/** API version prefix */
export const API_VERSION = 'v1' as const;

/** Default pagination settings */
export const PAGINATION = {
  DEFAULT_PAGE_SIZE: 20,
  MAX_PAGE_SIZE: 100,
} as const;

/** Supported currencies (ISO 4217) — starter set */
export const CURRENCIES = ['USD', 'EUR', 'ILS', 'GBP'] as const;
export type CurrencyCode = (typeof CURRENCIES)[number];

/** Supported locales */
export const LOCALES = ['en', 'he'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';
```

#### `packages/shared/src/types/index.ts`

```typescript
/**
 * Shared type definitions.
 * These will be expanded in Phase 0.3 with pagination DTOs,
 * error response types, and currency types.
 */

/** Standard API response envelope */
export interface ApiResponse<T> {
  data: T;
  meta?: Record<string, unknown>;
}

/** Paginated API response */
export interface PaginatedResponse<T> {
  data: T[];
  cursor: string | null;
  hasMore: boolean;
}

/** Standard error response */
export interface ApiErrorResponse {
  statusCode: number;
  message: string;
  error: string;
  timestamp: string;
  path: string;
}
```

#### `packages/shared/src/dto/index.ts`

```typescript
/**
 * Shared DTO definitions.
 * Placeholder — will be populated in Phase 0.3
 * with PaginationQueryDto, SortQueryDto, etc.
 */

export {};
```

### 3.7 apps/api — NestJS Backend

#### `apps/api/package.json`

```json
{
  "name": "api",
  "version": "0.1.0",
  "private": true,
  "license": "MIT",
  "scripts": {
    "build": "nest build",
    "start": "nest start",
    "start:dev": "nest start --watch",
    "start:debug": "nest start --debug --watch",
    "start:prod": "node dist/main",
    "dev": "nest start --watch",
    "lint": "eslint \"{src,test}/**/*.ts\"",
    "lint:fix": "eslint \"{src,test}/**/*.ts\" --fix",
    "typecheck": "tsc --noEmit",
    "test": "jest",
    "test:unit": "jest --testPathPattern=\\.spec\\.ts$",
    "test:watch": "jest --watch",
    "test:coverage": "jest --coverage",
    "test:integration": "jest --config jest.integration.config.ts --runInBand",
    "clean": "rm -rf dist coverage"
  },
  "dependencies": {
    "@nestjs/common": "^11.1.13",
    "@nestjs/config": "^4.0.3",
    "@nestjs/core": "^11.1.13",
    "@nestjs/platform-express": "^11.1.13",
    "@nestjs/swagger": "^11.2.6",
    "@nestjs/terminus": "^11.0.0",
    "@prisma/client": "^7.3.0",
    "@myfinpro/shared": "workspace:*",
    "class-transformer": "^0.5.1",
    "class-validator": "^0.14.3",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.2"
  },
  "devDependencies": {
    "@myfinpro/tsconfig": "workspace:*",
    "@myfinpro/eslint-config": "workspace:*",
    "@nestjs/cli": "^11.0.16",
    "@nestjs/schematics": "^11.0.9",
    "@nestjs/testing": "^11.1.13",
    "@testcontainers/mysql": "^11.11.0",
    "@types/express": "^5.0.6",
    "@types/jest": "^30.0.0",
    "@types/node": "^22.15.0",
    "@types/supertest": "^6.0.3",
    "eslint": "^10.0.0",
    "jest": "^30.2.0",
    "prisma": "^7.3.0",
    "source-map-support": "^0.5.21",
    "supertest": "^7.2.2",
    "testcontainers": "^11.11.0",
    "ts-jest": "^29.4.6",
    "ts-loader": "^9.5.4",
    "ts-node": "^10.9.2",
    "typescript": "^5.9.3"
  },
  "prisma": {
    "schema": "prisma/schema.prisma",
    "seed": "ts-node prisma/seed.ts"
  },
  "jest": {
    "moduleFileExtensions": ["js", "json", "ts"],
    "rootDir": ".",
    "testRegex": ".*\\.spec\\.ts$",
    "transform": {
      "^.+\\.(t|j)s$": "ts-jest"
    },
    "collectCoverageFrom": ["src/**/*.(t|j)s", "!src/main.ts"],
    "coverageDirectory": "./coverage",
    "testEnvironment": "node",
    "moduleNameMapper": {
      "^@/(.*)$": "<rootDir>/src/$1"
    }
  }
}
```

#### `apps/api/tsconfig.json`

```json
{
  "extends": "@myfinpro/tsconfig/nestjs.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "baseUrl": "./",
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "test", "coverage"]
}
```

#### `apps/api/tsconfig.build.json`

```json
{
  "extends": "./tsconfig.json",
  "exclude": ["node_modules", "dist", "test", "**/*spec.ts", "coverage"]
}
```

#### `apps/api/nest-cli.json`

```json
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "src",
  "compilerOptions": {
    "deleteOutDir": true,
    "plugins": ["@nestjs/swagger"],
    "assets": [],
    "watchAssets": false
  }
}
```

#### `apps/api/src/main.ts`

```typescript
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AppModule } from './app.module';
import { setupSwagger } from './config/swagger.config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  // ── Global prefix ──
  const apiPrefix = configService.get<string>('API_GLOBAL_PREFIX', 'api/v1');
  app.setGlobalPrefix(apiPrefix);

  // ── Validation pipe ──
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // ── CORS ──
  const corsOrigins = configService.get<string>('CORS_ORIGINS', 'http://localhost:3000');
  app.enableCors({
    origin: corsOrigins.split(','),
    credentials: true,
  });

  // ── Swagger ──
  const swaggerEnabled = configService.get<string>('SWAGGER_ENABLED', 'true') === 'true';
  if (swaggerEnabled) {
    setupSwagger(app, apiPrefix);
  }

  // ── Start ──
  const port = configService.get<number>('API_PORT', 3001);
  await app.listen(port);

  logger.log(`🚀 API running on http://localhost:${port}/${apiPrefix}`);
  if (swaggerEnabled) {
    logger.log(`📚 Swagger docs at http://localhost:${port}/${apiPrefix.replace('/v1', '')}/docs`);
  }
}

bootstrap();
```

#### `apps/api/src/app.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    HealthModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
```

#### `apps/api/src/app.controller.ts`

```typescript
import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';

import { AppService } from './app.service';

@ApiTags('Root')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @ApiOperation({ summary: 'API root endpoint' })
  getRoot() {
    return this.appService.getRoot();
  }
}
```

#### `apps/api/src/app.service.ts`

```typescript
import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getRoot() {
    return {
      name: 'MyFinPro API',
      version: '0.1.0',
      status: 'ok',
    };
  }
}
```

#### `apps/api/src/app.controller.spec.ts`

```typescript
import { Test, TestingModule } from '@nestjs/testing';

import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    appController = module.get<AppController>(AppController);
  });

  describe('getRoot', () => {
    it('should return API info', () => {
      const result = appController.getRoot();
      expect(result).toHaveProperty('name', 'MyFinPro API');
      expect(result).toHaveProperty('status', 'ok');
    });
  });
});
```

#### `apps/api/src/config/app.config.ts`

```typescript
import { registerAs } from '@nestjs/config';

export default registerAs('app', () => ({
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.API_PORT || '3001', 10),
  apiPrefix: process.env.API_GLOBAL_PREFIX || 'api/v1',
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:3000').split(','),
}));
```

#### `apps/api/src/config/database.config.ts`

```typescript
import { registerAs } from '@nestjs/config';

export default registerAs('database', () => ({
  url: process.env.DATABASE_URL,
}));
```

#### `apps/api/src/config/swagger.config.ts`

```typescript
import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export function setupSwagger(app: INestApplication, globalPrefix: string): void {
  const config = new DocumentBuilder()
    .setTitle('MyFinPro API')
    .setDescription(
      'Personal/Family Finance Management API. ' +
      'All monetary amounts are stored as integer cents. ' +
      'Currency codes follow ISO 4217.',
    )
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'Authorization',
        description: 'Enter JWT token',
        in: 'header',
      },
      'access-token',
    )
    .addServer(`http://localhost:3001/${globalPrefix}`, 'Local Development')
    .build();

  const document = SwaggerModule.createDocument(app, config);

  // Swagger served at /api/docs (strip /v1 from prefix for docs path)
  const docsPath = globalPrefix.replace('/v1', '') + '/docs';
  SwaggerModule.setup(docsPath, app, document, {
    swaggerOptions: {
      persistAuthorization: true,
      tagsSorter: 'alpha',
      operationsSorter: 'alpha',
    },
  });
}
```

#### `apps/api/src/health/health.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';

import { HealthController } from './health.controller';

@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
})
export class HealthModule {}
```

#### `apps/api/src/health/health.controller.ts`

```typescript
import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { HealthCheck, HealthCheckService, HealthCheckResult } from '@nestjs/terminus';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private health: HealthCheckService) {}

  @Get()
  @HealthCheck()
  @ApiOperation({ summary: 'Health check endpoint' })
  check(): Promise<HealthCheckResult> {
    return this.health.check([
      // Add database health check when Prisma is integrated
      // () => this.prismaHealth.isHealthy('database'),
    ]);
  }
}
```

#### `apps/api/src/common/filters/http-exception.filter.ts`

```typescript
import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const message =
      exception instanceof HttpException
        ? exception.getResponse()
        : 'Internal server error';

    const errorResponse = {
      statusCode: status,
      message: typeof message === 'string' ? message : (message as any).message || message,
      error: exception instanceof HttpException ? exception.name : 'InternalServerError',
      timestamp: new Date().toISOString(),
      path: request.url,
    };

    this.logger.error(
      `${request.method} ${request.url} ${status}`,
      exception instanceof Error ? exception.stack : String(exception),
    );

    response.status(status).json(errorResponse);
  }
}
```

#### `apps/api/src/common/interceptors/transform.interceptor.ts`

```typescript
import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface ResponseEnvelope<T> {
  data: T;
  meta?: Record<string, unknown>;
}

@Injectable()
export class TransformInterceptor<T>
  implements NestInterceptor<T, ResponseEnvelope<T>>
{
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<ResponseEnvelope<T>> {
    return next.handle().pipe(
      map((data) => {
        // If data already has 'data' key (paginated responses), pass through
        if (data && typeof data === 'object' && 'data' in data) {
          return data;
        }
        return { data };
      }),
    );
  }
}
```

#### `apps/api/src/common/decorators/api-version.decorator.ts`

```typescript
import { SetMetadata } from '@nestjs/common';

export const API_VERSION_KEY = 'apiVersion';
export const ApiVersion = (version: string) => SetMetadata(API_VERSION_KEY, version);
```

#### `apps/api/src/common/pipes/validation.pipe.ts`

```typescript
import { ValidationPipe as NestValidationPipe, ValidationPipeOptions } from '@nestjs/common';

/**
 * Pre-configured validation pipe with project defaults.
 * Used as a reference; the global pipe is set in main.ts.
 */
export const createValidationPipe = (options?: ValidationPipeOptions) =>
  new NestValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: {
      enableImplicitConversion: true,
    },
    ...options,
  });
```

### 3.8 apps/web — Next.js Frontend

#### `apps/web/package.json`

```json
{
  "name": "web",
  "version": "0.1.0",
  "private": true,
  "license": "MIT",
  "scripts": {
    "dev": "next dev --port 3000",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "lint:fix": "next lint --fix",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:unit": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "test:e2e": "playwright test",
    "test:e2e:ui": "playwright test --ui",
    "clean": "rm -rf .next coverage"
  },
  "dependencies": {
    "@myfinpro/shared": "workspace:*",
    "next": "^16.1.6",
    "next-intl": "^4.8.2",
    "react": "^19.2.4",
    "react-dom": "^19.2.4"
  },
  "devDependencies": {
    "@myfinpro/tsconfig": "workspace:*",
    "@myfinpro/eslint-config": "workspace:*",
    "@playwright/test": "^1.58.2",
    "@tailwindcss/postcss": "^4.1.18",
    "@testing-library/react": "^16.3.2",
    "@testing-library/jest-dom": "^6.9.1",
    "@types/node": "^22.15.0",
    "@types/react": "^19.2.13",
    "@types/react-dom": "^19.2.3",
    "@vitejs/plugin-react": "^5.1.3",
    "eslint": "^10.0.0",
    "eslint-config-next": "^16.1.6",
    "jsdom": "^28.0.0",
    "postcss": "^8.5.6",
    "tailwindcss": "^4.1.18",
    "typescript": "^5.9.3",
    "vitest": "^4.0.18"
  }
}
```

#### `apps/web/tsconfig.json`

```json
{
  "extends": "@myfinpro/tsconfig/nextjs.json",
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    },
    "plugins": [
      { "name": "next" }
    ]
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules", ".next", "coverage", "e2e"]
}
```

#### `apps/web/next.config.ts`

```typescript
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // Standalone output for Docker deployments
  output: 'standalone',

  // Proxy API requests in development
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${process.env.API_INTERNAL_URL || 'http://localhost:3001/api/v1'}/:path*`,
      },
    ];
  },
};

export default withNextIntl(nextConfig);
```

> **Note**: The `next-intl` plugin configuration file `src/i18n/request.ts` will need to be created. This is a minimal bootstrap; the full i18n setup will be expanded in later phases.

#### `apps/web/postcss.config.js`

> **Note**: Tailwind CSS v4 uses CSS-first configuration. The `@tailwindcss/postcss` plugin replaces the old `tailwindcss` PostCSS plugin, and `autoprefixer` is no longer needed (Tailwind v4 includes it automatically). The `tailwind.config.ts` file is **removed** — all theme customization is done via `@theme` in CSS.

```javascript
module.exports = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};
```

#### `apps/web/vitest.config.ts`

```typescript
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['e2e/**', 'node_modules/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', '.next/', 'e2e/', '**/*.d.ts', '**/*.config.*'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
```

#### `apps/web/src/test-setup.ts`

```typescript
import '@testing-library/jest-dom';
```

#### `apps/web/src/app/layout.tsx`

```tsx
import type { Metadata } from 'next';

import '@/styles/globals.css';

export const metadata: Metadata = {
  title: 'MyFinPro - Finance Management',
  description: 'Personal and Family Finance Management Application',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

#### `apps/web/src/app/page.tsx`

```tsx
export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24">
      <h1 className="text-4xl font-bold">MyFinPro</h1>
      <p className="mt-4 text-lg text-gray-600">
        Personal &amp; Family Finance Management
      </p>
      <p className="mt-2 text-sm text-gray-400">
        Phase 0 — Foundation
      </p>
    </main>
  );
}
```

#### `apps/web/src/app/api/health/route.ts`

```typescript
import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    service: 'web',
    timestamp: new Date().toISOString(),
  });
}
```

#### `apps/web/src/lib/api-client.ts`

```typescript
/**
 * Typed API client for communicating with the NestJS backend.
 * Uses NEXT_PUBLIC_API_URL for client-side requests
 * and API_INTERNAL_URL for SSR requests.
 */

const getBaseUrl = (): string => {
  // Server-side: use internal URL
  if (typeof window === 'undefined') {
    return process.env.API_INTERNAL_URL || 'http://localhost:3001/api/v1';
  }
  // Client-side: use public URL
  return process.env.NEXT_PUBLIC_API_URL || '/api/v1';
};

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
}

class ApiClient {
  private baseUrl: string;

  constructor() {
    this.baseUrl = getBaseUrl();
  }

  private async request<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
    const { body, headers, ...rest } = options;

    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
      ...rest,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Request failed' }));
      throw new Error(error.message || `HTTP ${response.status}`);
    }

    return response.json();
  }

  async get<T>(endpoint: string, options?: RequestOptions): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: 'GET' });
  }

  async post<T>(endpoint: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: 'POST', body });
  }

  async put<T>(endpoint: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: 'PUT', body });
  }

  async patch<T>(endpoint: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: 'PATCH', body });
  }

  async delete<T>(endpoint: string, options?: RequestOptions): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: 'DELETE' });
  }
}

export const apiClient = new ApiClient();
```

#### `apps/web/src/styles/globals.css`

```css
@import "tailwindcss";

@theme {
  --color-primary-50: #f0f9ff;
  --color-primary-100: #e0f2fe;
  --color-primary-200: #bae6fd;
  --color-primary-300: #7dd3fc;
  --color-primary-400: #38bdf8;
  --color-primary-500: #0ea5e9;
  --color-primary-600: #0284c7;
  --color-primary-700: #0369a1;
  --color-primary-800: #075985;
  --color-primary-900: #0c4a6e;
  --color-primary-950: #082f49;
}

:root {
  --foreground-rgb: 0, 0, 0;
  --background-start-rgb: 255, 255, 255;
  --background-end-rgb: 245, 245, 245;
}

body {
  color: rgb(var(--foreground-rgb));
  background: linear-gradient(
    to bottom,
    rgb(var(--background-start-rgb)),
    rgb(var(--background-end-rgb))
  );
}
```

#### `apps/web/messages/en.json`

```json
{
  "common": {
    "appName": "MyFinPro",
    "loading": "Loading...",
    "error": "An error occurred",
    "save": "Save",
    "cancel": "Cancel",
    "delete": "Delete",
    "edit": "Edit",
    "back": "Back"
  },
  "home": {
    "title": "Personal & Family Finance Management",
    "subtitle": "Track your income, expenses, and budgets"
  }
}
```

#### `apps/web/messages/he.json`

```json
{
  "common": {
    "appName": "MyFinPro",
    "loading": "טוען...",
    "error": "אירעה שגיאה",
    "save": "שמור",
    "cancel": "ביטול",
    "delete": "מחק",
    "edit": "ערוך",
    "back": "חזרה"
  },
  "home": {
    "title": "ניהול כספים אישי ומשפחתי",
    "subtitle": "עקוב אחרי הכנסות, הוצאות ותקציבים"
  }
}
```

#### `apps/web/src/i18n/request.ts`

```typescript
import { getRequestConfig } from 'next-intl/server';

export default getRequestConfig(async ({ requestLocale }) => {
  const locale = (await requestLocale) || 'en';

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
```

### 3.9 apps/bot — Telegram Bot Placeholder

#### `apps/bot/package.json`

```json
{
  "name": "bot",
  "version": "0.1.0",
  "private": true,
  "license": "MIT",
  "scripts": {
    "build": "tsc",
    "start": "node dist/main.js",
    "start:dev": "ts-node-dev --respawn src/main.ts",
    "dev": "ts-node-dev --respawn src/main.ts",
    "lint": "eslint src/",
    "lint:fix": "eslint src/ --fix",
    "typecheck": "tsc --noEmit",
    "test": "echo \"Bot tests — placeholder\" && exit 0",
    "test:unit": "echo \"Bot tests — placeholder\" && exit 0",
    "clean": "rm -rf dist"
  },
  "dependencies": {
    "@myfinpro/shared": "workspace:*"
  },
  "devDependencies": {
    "@myfinpro/tsconfig": "workspace:*",
    "@myfinpro/eslint-config": "workspace:*",
    "@types/node": "^22.15.0",
    "ts-node": "^10.9.2",
    "ts-node-dev": "^2.0.0",
    "typescript": "^5.9.3",
    "eslint": "^10.0.0"
  }
}
```

#### `apps/bot/tsconfig.json`

```json
{
  "extends": "@myfinpro/tsconfig/node.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

#### `apps/bot/src/main.ts`

```typescript
/**
 * Telegram Bot — Placeholder
 *
 * This will be implemented in Phase 10.
 * For now, it serves as a workspace entry point.
 */

console.log('🤖 MyFinPro Bot — placeholder (will be implemented in Phase 10)');
console.log('   To implement: grammy.js bot with webhook support');
process.exit(0);
```

#### `apps/bot/src/bot.module.ts`

```typescript
/**
 * Bot module — placeholder
 * Will contain grammy.js Bot instance setup in Phase 10.
 */

export {};
```

### 3.10 Prisma Schema and Setup

#### `apps/api/prisma/schema.prisma`

```prisma
// ─────────────────────────────────────────────────────────────
// MyFinPro — Prisma Schema
// Location: apps/api/prisma/schema.prisma
// ─────────────────────────────────────────────────────────────

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "mysql"
  url      = env("DATABASE_URL")
}

// ── Phase 0: Baseline model for connection testing ──
// Full user model will be defined in Phase 1.1

model HealthCheck {
  id        Int      @id @default(autoincrement())
  status    String   @db.VarChar(50)
  checkedAt DateTime @default(now()) @map("checked_at")

  @@map("health_checks")
}
```

**Prisma integration notes**:
- Schema lives at `apps/api/prisma/schema.prisma`
- The `prisma` field in `apps/api/package.json` points to this location
- Migrations stored in `apps/api/prisma/migrations/`
- The Prisma Client is generated into `node_modules/.prisma/client`
- Seed file at `apps/api/prisma/seed.ts` runs via `prisma db seed`

### 3.11 API Versioning Strategy

The API uses a **URI-prefix versioning** approach:

- **Pattern**: `/{globalPrefix}/{version}/{resource}`
- **Example**: `/api/v1/health`, `/api/v1/transactions`
- **Implementation**: NestJS `setGlobalPrefix('api/v1')` in `main.ts`
- **Future versions**: When v2 is needed, a separate controller set with a `v2` prefix will be created alongside v1 (not replacing it)

```mermaid
flowchart LR
    client[Client] --> nginx[Nginx :80]
    nginx -->|/api/*| api[NestJS :3001]
    api -->|/api/v1/*| v1[v1 Controllers]
    api -.->|/api/v2/* future| v2[v2 Controllers]
    nginx -->|everything else| web[Next.js :3000]
```

**Design decisions**:
1. The `globalPrefix` is set to `api/v1` — all controllers are automatically under this prefix
2. The health endpoint is accessible at `/api/v1/health` for Docker health checks
3. Swagger docs are served at `/api/docs` (outside the versioned prefix for convenience)
4. When a v2 is introduced, a `V2` module will be added with its own prefix; v1 controllers remain untouched

### 3.12 @nestjs/swagger Setup

Swagger is configured in `apps/api/src/config/swagger.config.ts` (see [section 3.7](#appsapisrcconfigswaggerconfigts)) and activated in `main.ts`.

**Key features**:
- Auto-generated from decorators (`@ApiTags`, `@ApiOperation`, `@ApiProperty`)
- Bearer auth scheme registered for JWT tokens
- Served at `/api/docs`
- The `@nestjs/swagger` CLI plugin is enabled in `nest-cli.json` to auto-infer DTOs
- `persistAuthorization: true` keeps JWT across page refreshes during development

**Access URLs**:
| Environment | URL |
|---|---|
| Direct API | `http://localhost:3001/api/docs` |
| Via Nginx | `http://localhost/api/docs` |

### 3.13 Playwright E2E Configuration

#### `apps/web/playwright.config.ts`

```typescript
import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E test configuration.
 *
 * Run: pnpm --filter web test:e2e
 * UI:  pnpm --filter web test:e2e:ui
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'github' : 'html',

  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
    // Mobile viewports for responsive testing
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'] },
    },
    {
      name: 'mobile-safari',
      use: { ...devices['iPhone 12'] },
    },
  ],

  // Run local dev server before tests if not in CI
  webServer: process.env.CI
    ? undefined
    : {
        command: 'pnpm run dev',
        url: 'http://localhost:3000',
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
```

#### `apps/web/e2e/smoke.spec.ts`

```typescript
import { test, expect } from '@playwright/test';

test.describe('Smoke Tests', () => {
  test('homepage loads successfully', async ({ page }) => {
    await page.goto('/');

    // Verify the page title
    await expect(page).toHaveTitle(/MyFinPro/);

    // Verify main heading is visible
    await expect(page.getByRole('heading', { name: 'MyFinPro' })).toBeVisible();
  });

  test('health endpoint returns ok', async ({ request }) => {
    const response = await request.get('/api/health');
    expect(response.ok()).toBeTruthy();

    const body = await response.json();
    expect(body.status).toBe('ok');
  });
});
```

### 3.14 Testcontainers Setup

#### `apps/api/jest.integration.config.ts`

```typescript
import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.integration.spec.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  testEnvironment: 'node',
  testTimeout: 60_000, // Testcontainers need time to start
  maxWorkers: 1, // Run integration tests serially
  setupFilesAfterSetup: ['./test/integration/setup.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
};

export default config;
```

#### `apps/api/test/helpers/testcontainers.ts`

```typescript
import { MySqlContainer, StartedMySqlContainer } from '@testcontainers/mysql';
import { PrismaClient } from '@prisma/client';
import { execSync } from 'child_process';

/**
 * Testcontainers helper for integration tests.
 * Spins up an isolated MySQL container per test suite.
 *
 * Usage:
 *   const { prisma, container } = await setupTestDatabase();
 *   // ... run tests ...
 *   await teardownTestDatabase(prisma, container);
 */

let container: StartedMySqlContainer;
let prisma: PrismaClient;

export async function setupTestDatabase(): Promise<{
  prisma: PrismaClient;
  container: StartedMySqlContainer;
  databaseUrl: string;
}> {
  // Start MySQL container
  container = await new MySqlContainer('mysql:8.4')
    .withDatabase('myfinpro_test')
    .withUsername('test_user')
    .withUserPassword('test_password')
    .withCommand([
      '--default-authentication-plugin=mysql_native_password',
      '--character-set-server=utf8mb4',
      '--collation-server=utf8mb4_unicode_ci',
    ])
    .start();

  const databaseUrl = container.getConnectionUri();

  // Run Prisma migrations against the test container
  execSync('npx prisma migrate deploy', {
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
    },
    cwd: __dirname + '/../../',
  });

  // Create Prisma client for tests
  prisma = new PrismaClient({
    datasources: {
      db: { url: databaseUrl },
    },
  });

  await prisma.$connect();

  return { prisma, container, databaseUrl };
}

export async function teardownTestDatabase(
  prismaClient: PrismaClient,
  mysqlContainer: StartedMySqlContainer,
): Promise<void> {
  await prismaClient.$disconnect();
  await mysqlContainer.stop();
}
```

#### `apps/api/test/integration/setup.ts`

```typescript
/**
 * Integration test global setup.
 * Sets longer timeouts for container operations.
 */

// Increase Jest timeout for integration tests
jest.setTimeout(60_000);
```

#### `apps/api/test/integration/app.integration.spec.ts`

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';

import { AppModule } from '../../src/app.module';

describe('App Integration Tests', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /api/v1', () => {
    it('should return API info', () => {
      return request(app.getHttpServer())
        .get('/api/v1')
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveProperty('name', 'MyFinPro API');
          expect(res.body).toHaveProperty('status', 'ok');
        });
    });
  });

  describe('GET /api/v1/health', () => {
    it('should return health status', () => {
      return request(app.getHttpServer())
        .get('/api/v1/health')
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveProperty('status', 'ok');
        });
    });
  });
});
```

#### `apps/api/test/setup.ts`

```typescript
/**
 * Unit test global setup.
 */

// Clear all mocks after each test
afterEach(() => {
  jest.clearAllMocks();
});
```

### 3.15 Jest / Vitest Configuration

**API (NestJS)** uses **Jest** — configured inline in `apps/api/package.json` (see [section 3.7](#appsapipackagejson)). Key config:

| Setting | Value |
|---|---|
| Test runner | Jest 30 + ts-jest |
| Test pattern | `*.spec.ts` (unit), `*.integration.spec.ts` (integration) |
| Coverage threshold | 60% global, 80% for services (enforced in CI, added in later phase) |
| Module aliases | `@/*` → `src/*` |

**Web (Next.js)** uses **Vitest** — configured in `apps/web/vitest.config.ts` (see [section 3.8](#appswebvitestconfigts)). Key config:

| Setting | Value |
|---|---|
| Test runner | Vitest 4 + React plugin |
| Environment | jsdom |
| Test pattern | `*.test.ts` / `*.spec.ts` / `*.test.tsx` / `*.spec.tsx` |
| Coverage | v8 provider |

### 3.16 Git Configuration

#### `.gitignore`

```gitignore
# ── Dependencies ──
node_modules/
.pnpm-store/

# ── Build outputs ──
dist/
.next/
out/

# ── Environment files ──
.env
.env.local
.env.*.local
!.env.example
!apps/*/.env.example

# ── IDE ──
.idea/
.vscode/
*.swp
*.swo

# ── OS ──
.DS_Store
Thumbs.db

# ── Testing ──
coverage/
test-results/
playwright-report/
blob-report/

# ── Prisma ──
apps/api/prisma/migrations/**/migration_lock.toml

# ── Turbo ──
.turbo/

# ── Debug ──
*.log
npm-debug.log*
yarn-debug.log*
pnpm-debug.log*
lerna-debug.log*

# ── Docker ──
docker-compose.override.yml
```

---

## 4. Dependency Version Matrix

Critical version pins to ensure reproducibility. Non-critical versions use `^` for minor/patch updates.

| Package | Version | Reason for Pin |
|---|---|---|
| `node` | `>=22.0.0` | LTS, required by all packages |
| `pnpm` | `10.28.2` | Workspace support, corepack |
| `typescript` | `^5.9.3` | Decorator metadata, latest features |
| `@nestjs/core` | `^11.1.13` | Latest stable NestJS 11 |
| `@nestjs/swagger` | `^11.2.6` | OpenAPI 3.1 support |
| `@prisma/client` | `^7.3.0` | Latest Prisma with MySQL support |
| `next` | `^16.1.6` | App Router, React 19 support |
| `react` | `^19.2.4` | Latest React |
| `tailwindcss` | `^4.1.18` | Utility-first CSS (v4, CSS-first config) |
| `playwright` | `^1.58.2` | E2E testing |
| `testcontainers` | `^11.11.0` | Integration test containers |
| `vitest` | `^4.0.18` | Frontend unit testing |
| `jest` | `^30.2.0` | Backend unit testing |
| `turbo` | `^2.8.3` | Monorepo task runner |
| `eslint` | `^10.0.0` | Linting (flat config only) |
| `prettier` | `^3.8.1` | Code formatting |
| `mysql` (Docker) | `8.4` | Database server (LTS) |
| `redis` (Docker) | `8-alpine` | Cache/queue backend |
| `nginx` (Docker) | `1.28-alpine` | Reverse proxy |

---

## 5. Architecture Diagrams

### 5.1 Docker Compose Service Topology

```mermaid
flowchart TB
    subgraph docker[Docker Compose Network: myfinpro-net]
        nginx[Nginx :80] --> web[Next.js :3000]
        nginx --> api[NestJS :3001]
        api --> mysql[MySQL :3306]
        api --> redis[Redis :6379]
        web -.->|SSR requests| api
    end

    user[Browser] --> nginx
    dev[Developer] -->|:3307| mysql
    dev -->|:6380| redis
    dev -->|:3001| api
    dev -->|:3000| web
```

### 5.2 Monorepo Dependency Graph

```mermaid
flowchart TB
    subgraph packages[packages/]
        tsconfig[@myfinpro/tsconfig]
        eslint[@myfinpro/eslint-config]
        shared[@myfinpro/shared]
    end

    subgraph apps[apps/]
        api[apps/api]
        web[apps/web]
        bot[apps/bot]
    end

    api --> shared
    api --> tsconfig
    api --> eslint
    web --> shared
    web --> tsconfig
    web --> eslint
    bot --> shared
    bot --> tsconfig
    bot --> eslint
    shared --> tsconfig
    shared --> eslint
```

### 5.3 Request Flow

```mermaid
sequenceDiagram
    participant B as Browser
    participant N as Nginx :80
    participant W as Next.js :3000
    participant A as NestJS :3001
    participant D as MySQL :3306

    B->>N: GET /
    N->>W: proxy_pass
    W-->>N: HTML response
    N-->>B: HTML page

    B->>N: GET /api/v1/health
    N->>A: proxy_pass /api/
    A-->>N: JSON response
    N-->>B: Health status

    B->>N: POST /api/v1/auth/login
    N->>A: proxy_pass /api/
    A->>D: Query user
    D-->>A: User record
    A-->>N: JWT tokens
    N-->>B: Access + refresh tokens
```

### 5.4 Testing Strategy Overview

```mermaid
flowchart LR
    subgraph unit[Unit Tests]
        jest_api[Jest - API services/utils]
        vitest_web[Vitest - React components]
    end

    subgraph integration[Integration Tests]
        tc[Testcontainers + Jest - API endpoints]
    end

    subgraph e2e[E2E Tests]
        pw[Playwright - User flows]
    end

    unit --> integration --> e2e

    jest_api -.-> |mocks| api_code[API source]
    vitest_web -.-> |jsdom| web_code[Web source]
    tc -.-> |real MySQL| docker_mysql[MySQL container]
    pw -.-> |real browser| running_app[Running app stack]
```

---

## Appendix A: File-by-File Implementation Checklist

This checklist maps every file to its creation phase and provides implementation priority order.

### Phase 0.1 Files (create first)

| # | File | Purpose |
|---|---|---|
| 1 | `.env.example` | Root environment template |
| 2 | `apps/api/.env.example` | API environment template |
| 3 | `apps/web/.env.example` | Web environment template |
| 4 | `infrastructure/mysql/init/01-create-databases.sql` | Init SQL for test DB |
| 5 | `infrastructure/nginx/nginx.conf` | Nginx main config |
| 6 | `infrastructure/nginx/conf.d/default.conf` | Nginx site config |
| 7 | `infrastructure/docker/api.Dockerfile` | API container |
| 8 | `infrastructure/docker/web.Dockerfile` | Web container |
| 9 | `docker-compose.yml` | Full service orchestration |
| 10 | `docker-compose.override.yml` | Dev overrides |
| 11 | `scripts/dev.sh` | Dev startup script |
| 12 | `scripts/seed.sh` | Seed runner script |

### Phase 0.2 Files (create second)

| # | File | Purpose |
|---|---|---|
| 13 | `pnpm-workspace.yaml` | Workspace definition |
| 14 | `.npmrc` | pnpm settings |
| 15 | `package.json` | Root package.json |
| 16 | `turbo.json` | Turborepo config |
| 17 | `.gitignore` | Git ignore rules |
| 18 | `.prettierrc` | Prettier config |
| 19 | `.prettierignore` | Prettier ignore |
| 20 | `packages/tsconfig/package.json` | TSConfig package |
| 21 | `packages/tsconfig/base.json` | Base TS config |
| 22 | `packages/tsconfig/nestjs.json` | NestJS TS config |
| 23 | `packages/tsconfig/nextjs.json` | Next.js TS config |
| 24 | `packages/tsconfig/node.json` | Node TS config |
| 25 | `packages/eslint-config/package.json` | ESLint package |
| 26 | `packages/eslint-config/base.js` | Base ESLint config |
| 27 | `packages/eslint-config/nestjs.js` | NestJS ESLint config |
| 28 | `packages/eslint-config/nextjs.js` | Next.js ESLint config |
| 29 | `packages/shared/package.json` | Shared package |
| 30 | `packages/shared/tsconfig.json` | Shared TS config |
| 31 | `packages/shared/src/index.ts` | Shared barrel export |
| 32 | `packages/shared/src/constants/index.ts` | App constants |
| 33 | `packages/shared/src/types/index.ts` | Shared types |
| 34 | `packages/shared/src/dto/index.ts` | Shared DTOs (placeholder) |
| 35 | `apps/api/package.json` | API package.json |
| 36 | `apps/api/tsconfig.json` | API TS config |
| 37 | `apps/api/tsconfig.build.json` | API build TS config |
| 38 | `apps/api/nest-cli.json` | NestJS CLI config |
| 39 | `apps/api/prisma/schema.prisma` | Prisma schema |
| 40 | `apps/api/prisma/seed.ts` | Seed script |
| 41 | `apps/api/src/main.ts` | API entry point |
| 42 | `apps/api/src/app.module.ts` | Root module |
| 43 | `apps/api/src/app.controller.ts` | Root controller |
| 44 | `apps/api/src/app.controller.spec.ts` | Root controller test |
| 45 | `apps/api/src/app.service.ts` | Root service |
| 46 | `apps/api/src/config/app.config.ts` | App config |
| 47 | `apps/api/src/config/database.config.ts` | DB config |
| 48 | `apps/api/src/config/swagger.config.ts` | Swagger config |
| 49 | `apps/api/src/health/health.module.ts` | Health module |
| 50 | `apps/api/src/health/health.controller.ts` | Health controller |
| 51 | `apps/api/src/common/filters/http-exception.filter.ts` | Exception filter |
| 52 | `apps/api/src/common/interceptors/transform.interceptor.ts` | Response interceptor |
| 53 | `apps/api/src/common/decorators/api-version.decorator.ts` | Version decorator |
| 54 | `apps/api/src/common/pipes/validation.pipe.ts` | Validation pipe |
| 55 | `apps/api/jest.integration.config.ts` | Integration test config |
| 56 | `apps/api/test/setup.ts` | Unit test setup |
| 57 | `apps/api/test/integration/setup.ts` | Integration test setup |
| 58 | `apps/api/test/integration/app.integration.spec.ts` | Integration smoke test |
| 59 | `apps/api/test/helpers/testcontainers.ts` | Testcontainers helper |
| 60 | `apps/web/package.json` | Web package.json |
| 61 | `apps/web/tsconfig.json` | Web TS config |
| 62 | `apps/web/next.config.ts` | Next.js config |
| 63 | `apps/web/postcss.config.js` | PostCSS config |
| 64 | `apps/web/vitest.config.ts` | Vitest config |
| 65 | `apps/web/playwright.config.ts` | Playwright config |
| 66 | `apps/web/src/app/layout.tsx` | Root layout |
| 67 | `apps/web/src/app/page.tsx` | Home page |
| 68 | `apps/web/src/app/api/health/route.ts` | Web health endpoint |
| 69 | `apps/web/src/lib/api-client.ts` | API client |
| 70 | `apps/web/src/styles/globals.css` | Global styles |
| 71 | `apps/web/src/i18n/request.ts` | i18n request config |
| 72 | `apps/web/src/test-setup.ts` | Vitest setup |
| 73 | `apps/web/messages/en.json` | English translations |
| 74 | `apps/web/messages/he.json` | Hebrew translations |
| 75 | `apps/web/e2e/smoke.spec.ts` | E2E smoke test |
| 76 | `apps/web/src/components/ui/.gitkeep` | UI components dir |
| 77 | `apps/web/src/hooks/.gitkeep` | Hooks dir |
| 78 | `apps/web/public/.gitkeep` | Public assets dir |
| 79 | `apps/web/e2e/fixtures/.gitkeep` | E2E fixtures dir |
| 80 | `apps/bot/.env.example` | Bot env template |
| 81 | `apps/bot/package.json` | Bot package.json |
| 82 | `apps/bot/tsconfig.json` | Bot TS config |
| 83 | `apps/bot/src/main.ts` | Bot entry point (placeholder) |
| 84 | `apps/bot/src/bot.module.ts` | Bot module (placeholder) |
| 85 | `infrastructure/docker/bot.Dockerfile` | Bot container |

**Total files**: 85

---

## Appendix B: Acceptance Criteria

### Phase 0.1 Acceptance

- [ ] `docker compose up` starts all 5 services (MySQL, Redis, Nginx, API, Web)
- [ ] MySQL is accessible on port 3307 with credentials from `.env`
- [ ] Redis is accessible on port 6380
- [ ] API responds at `http://localhost:3001/api/v1` with JSON
- [ ] Web responds at `http://localhost:3000` with HTML
- [ ] Nginx proxies `http://localhost/api/*` to NestJS and `http://localhost/*` to Next.js
- [ ] All services pass their health checks
- [ ] `.env.example` files exist for root, API, and Web
- [ ] `scripts/dev.sh` bootstraps the full environment

### Phase 0.2 Acceptance

- [ ] `pnpm install` succeeds at root level and installs all workspace dependencies
- [ ] `pnpm build` builds all packages and apps without errors
- [ ] `pnpm lint` runs ESLint across all workspaces
- [ ] `pnpm typecheck` passes TypeScript strict checks in all packages
- [ ] `pnpm test` runs unit tests (Jest for API, Vitest for Web)
- [ ] `pnpm test:integration` runs integration test with NestJS Testing Module
- [ ] `pnpm test:e2e` runs Playwright smoke test against running web app
- [ ] Swagger UI accessible at `http://localhost:3001/api/docs`
- [ ] Prisma schema validates and generates client
- [ ] `@myfinpro/shared` types are importable from both API and Web
- [ ] Bot placeholder builds without errors
- [ ] Turbo caches parallel builds correctly
