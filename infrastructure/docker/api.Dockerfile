# ───── Base Stage ─────
FROM node:26-alpine AS base
RUN npm install -g corepack && corepack enable
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
# The generated Prisma client lives in the root node_modules, which is an anonymous volume at
# run time (the bind mounts replace apps/api and packages, not node_modules): generate it here
# or the watcher starts with hundreds of "@prisma/client has no exported member" errors.
RUN pnpm --filter api exec prisma generate
WORKDIR /app/apps/api
EXPOSE 3001
# Two host artefacts arrive through the bind mounts and break a fresh container: a stale
# tsconfig.build.tsbuildinfo makes Nest emit only declarations after it empties dist (then
# "Cannot find module dist/main"), and a missing packages/shared/dist breaks @myfinpro/shared.
CMD ["sh", "-c", "rm -f tsconfig.build.tsbuildinfo tsconfig.tsbuildinfo /app/packages/shared/tsconfig.tsbuildinfo && { [ -f /app/packages/shared/dist/index.js ] || pnpm --filter shared run build; } && exec pnpm run start:dev"]

# ───── Build Stage ─────
FROM dependencies AS build
COPY . .
# Build shared package, generate Prisma client, then build API
RUN rm -f /app/packages/shared/tsconfig.tsbuildinfo /app/apps/api/tsconfig.build.tsbuildinfo /app/apps/api/tsconfig.tsbuildinfo && \
    pnpm --filter shared run build && \
    pnpm --filter api exec prisma generate && \
    pnpm --filter api run build

# ───── Production Stage ─────
FROM base AS production
LABEL org.opencontainers.image.source="https://github.com/Aleksei-Michnik/myfinpro"
LABEL org.opencontainers.image.description="MyFinPro API Server"
LABEL org.opencontainers.image.licenses="UNLICENSED"
# Install wget for Docker health checks (BusyBox wget lacks --no-verbose/--tries flags)
RUN apk add --no-cache wget
WORKDIR /app
# Copy everything needed from the build stage
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/prisma ./apps/api/prisma
COPY --from=build /app/apps/api/prisma.config.ts ./apps/api/prisma.config.ts
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
WORKDIR /app/apps/api
EXPOSE 3001
CMD ["node", "dist/main.js"]
