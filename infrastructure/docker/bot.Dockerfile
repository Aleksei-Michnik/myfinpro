# ───── Base Stage ─────
FROM node:26-alpine AS base
RUN npm install -g corepack && corepack enable
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
