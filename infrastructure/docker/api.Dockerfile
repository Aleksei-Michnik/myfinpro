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
# Build shared package first (dependency of api)
RUN pnpm --filter shared run build
# Generate Prisma client
RUN pnpm --filter api exec prisma generate
# Build the API
RUN pnpm --filter api run build

# ───── Production Stage ─────
FROM dependencies AS production
# Copy Prisma schema and config for generate
COPY apps/api/prisma ./apps/api/prisma
COPY apps/api/prisma.config.ts ./apps/api/prisma.config.ts
# Generate Prisma client in production node_modules
RUN pnpm --filter api exec prisma generate
# Copy built artifacts from build stage
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
WORKDIR /app/apps/api
EXPOSE 3001
CMD ["node", "dist/main.js"]
