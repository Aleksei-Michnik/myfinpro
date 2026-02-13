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
