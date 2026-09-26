---
name: local-stack
description: Bring up, check and use the local development stack — Docker infra at the pinned versions, migrations, API and web dev servers, ports and health probes, mock extraction provider — and what changes when Mdock (shared local Traefik, production hostnames) is adopted. Use when a task needs the app running locally, before Playwright or integration tests, or when a local service misbehaves.
---

# Local stack

Versions must match production (`stack-versions`): `mysql:9.7`, `redis:8-alpine`, Node 26,
pnpm 10. Compose: `docker-compose.yml` (+ `docker-compose.override.yml`) defines `mysql`, `redis`,
`api`, `web`, `nginx` on `myfinpro-net`.

## Up

1. Env files from templates if missing (`.env.example` → `.env`, and per app); never commit them.
2. `scripts/dev.sh` does the whole sequence: infra up → wait for MySQL → `prisma migrate dev` →
   `docker compose up -d`. Or by hand: `docker compose up -d mysql redis`, then
   `pnpm --filter api dev` and `pnpm --filter web dev` on the host for hot reload.
3. Ports (env var names, defaults): nginx `NGINX_PORT` (80), API `API_PORT` (3001) at `/api/v1`,
   web dev 3000, MySQL `MYSQL_EXTERNAL_PORT` (3307), Redis `REDIS_EXTERNAL_PORT` (6380).
   Swagger at `/api/docs` behind the nginx port.
4. Host `next dev` against any running API (2026-09-26): `API_INTERNAL_URL=http://localhost:<api
port>/api/v1 NEXT_PUBLIC_API_URL=/api pnpm --filter web exec next dev --port <n>` — the config
   rewrites `/api/:path*` onto `API_INTERNAL_URL`, so the public base must be `/api`, not the code
   default `/api/v1`. `/api/health` is the web's own route; probe `/api/receipts` (401 = proxied).
   Stop it by the pid bound to the port (`ss -ltnp`), never `pkill -f '<command>'` (it matches and
   kills the calling shell, exit 144).
5. A fresh worktree needs `pnpm install --frozen-lockfile --prefer-offline`, then
   `pnpm --filter @myfinpro/shared build` and `pnpm --filter api exec prisma generate` before any
   typecheck or test — without them `tsc` reports a missing `@myfinpro/shared` or `PrismaService` members.

When the stack runs **in containers** (`docker compose up -d`, with or without the mdock overlay):
the API dev image has no generated Prisma client and a host `apps/api/tsconfig.build.tsbuildinfo`
makes Nest emit only declarations — see the four container rows in `wiki/gotchas.md` (2026-09-25)
before debugging a red `myfinpro-api`. Ports 3000/3001 may be held by a sibling project; set
`API_PORT`/`WEB_PORT`/`NGINX_PORT` in `.env`.

## Check

- `docker inspect --format '{{.Config.Image}}' <mysql container>` must say `mysql:9.7`; a stale
  container is the first suspect for handshake or "pool timeout" errors (`wiki/gotchas.md`).
- `curl -s -o /dev/null -w '%{http_code}\n' http://localhost:${API_PORT:-3001}/api/v1/health`.
- Receipt extraction locally: `RECEIPT_EXTRACTION_PROVIDER=mock` unless you are testing a real
  provider with your own key (never someone else's; never logged).
- Mail locally goes to the configured dev sink, not to the shared relay.

## Reset

`docker compose down` keeps volumes; `docker compose down -v` destroys the **local** DB — fine
for local, and exactly what must never be run against the infra compose files.

## Mdock (coming)

The sibling infra repo provides a shared local Traefik on 80/443 and a hostname registry so the
production URLs resolve to the local stack in an isolated browser profile. Adoption here is a
small compose change (join the external network, add routes, drop the published port) — see
`wiki/infra-context.md` for status; until then use the ports above.
