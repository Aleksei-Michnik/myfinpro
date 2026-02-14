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
# Build shared package, generate Prisma client, then build API
RUN rm -f /app/packages/shared/tsconfig.tsbuildinfo /app/apps/api/tsconfig.build.tsbuildinfo /app/apps/api/tsconfig.tsbuildinfo && \
    pnpm --filter shared run build && \
    pnpm --filter api exec prisma generate && \
    pnpm --filter api run build

# ───── Production Stage ─────
FROM base AS production
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
