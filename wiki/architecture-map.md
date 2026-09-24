# Architecture map (checked 2026-09-24)

Read when: you are new to this repo, or must decide which app, module and layer a change belongs in.

Condensed from `IMPLEMENTATION-PLAN.md` §1/§3/§4/§9, `docs/progress.md` and the code cited below.
Where plan and code disagree, the code wins and the drift is called out.

## Monorepo

pnpm workspaces (`pnpm-workspace.yaml`: `apps/*`, `packages/*`) driven by Turborepo (`turbo.json`:
`build` → `^build`, outputs `dist/**` + `.next/**`; `dev` is persistent and uncached).

| Path                                                    | What                                                                              | Size              |
| ------------------------------------------------------- | --------------------------------------------------------------------------------- | ----------------- |
| `apps/api`                                              | NestJS 11 + Prisma 7 (MySQL driver adapter) — all business logic                  | 3.3 MB, 304 files |
| `apps/web`                                              | Next.js 16 App Router, React 19, Tailwind 4, next-intl                            | 3.1 MB, 299 files |
| `apps/bot`                                              | grammy Telegram bot — **placeholder only**, `main.ts` prints and exits (Phase 12) | 44 KB, 4 files    |
| `packages/shared`                                       | `@myfinpro/shared` — cross-app types, DTOs, constants                             | 188 KB, 29 files  |
| `packages/eslint-config`                                | flat configs `base.js` / `nestjs.js` / `nextjs.js`                                | 20 KB             |
| `packages/tsconfig`                                     | shared TS bases                                                                   | 24 KB             |
| `infrastructure/`, `docs/`, root `docker-compose.*.yml` | images, nginx, DB init; design + progress docs; local/staging/production stacks   | —                 |

Root scripts (`package.json`): `pnpm dev|build|lint|typecheck|test|test:unit|format` fan out through
turbo; `test:integration` / `test:e2e` / `test:staging` target one app; `db:migrate`, `db:generate`,
`db:seed`, `db:reset`, `db:studio` proxy to `pnpm --filter api exec prisma …`.

## API modules (`apps/api/src/<module>`)

Registered in `app.module.ts` unless noted. Route prefixes are relative to the global prefix.

| Module        | Responsibility                                                                                                   | Key files                                                                                                                              | Phase |
| ------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| `auth`        | JWT + refresh rotation, Google/Telegram OAuth, email verification, password reset, account deletion/merge        | `auth.controller.ts` (21 routes), `services/*`, `strategies/*`, `guards/*`, `utils/auth-cookie.ts`                                     | 1–5   |
| `group`       | groups, memberships, invite tokens                                                                               | `group.service.ts`, `guards/group-{admin,member}.guard.ts`                                                                             | 5     |
| `category`    | system/user/group categories                                                                                     | `category.service.ts`, `constants/category-errors.ts`                                                                                  | 6     |
| `transaction` | unified IN/OUT transactions, attributions, comments, stars, schedules, plans/amortisation                        | `transaction.service.ts`, `transaction-{comment,schedule,plan}.*`, `transaction-occurrence.processor.ts`, `utils/amortization.util.ts` | 6     |
| `receipt`     | receipt intake (photo/PDF/URL/manual), vision-LLM extraction, review, confirm-to-transaction, storage compaction | `receipt.service.ts`, `extraction/*`, `url-intake/*`, `receipt-{extraction,optimization}.processor.ts`                                 | 7–8   |
| `product`     | global barcode registry, staged matching, aliases, images, Open Food Facts enrichment                            | `product-matching.service.ts`, `open-food-facts.service.ts`, `product-{image,enrichment}.processor.ts`, `utils/trigram.util.ts`        | 8     |
| `llm`         | per-user model selection + BYOK keys (AES-256-GCM)                                                               | `llm-credentials.service.ts`, `llm-crypto.util.ts`, `guards/fresh-auth.guard.ts`                                                       | 8.11  |
| `analytics`   | `POST /analytics/query` aggregation engine over purchase rows                                                    | `engine/analytics-engine.service.ts`, `engine/*.sql.ts`, `engine/query-fingerprint.ts`                                                 | 9     |
| `budget`      | budgets CRUD, scoping, archive, alert thresholds                                                                 | `budget.service.ts`, `constants/budget-errors.ts`                                                                                      | 10    |
| `realtime`    | SSE fan-out to per-user streams                                                                                  | `events.controller.ts`, `event-bus.service.ts`, `events.types.ts`                                                                      | 6.18  |
| `queue`       | `@Global()` BullMQ root + 5 registered queues                                                                    | `queue.module.ts`, `queue.constants.ts`                                                                                                | 6.17  |
| `mail`        | SMTP send + DKIM                                                                                                 | `mail.service.ts`                                                                                                                      | 4     |
| `prisma`      | `PrismaService` (driver adapter, connect/disconnect hooks)                                                       | `prisma.service.ts`                                                                                                                    | 0     |
| `health`      | liveness/readiness with DB, Redis, memory indicators                                                             | `health.controller.ts`, `indicators/*`                                                                                                 | 0     |
| `common`      | request context (ALS), pino logger, in-process metrics, throttler, exception filters                             | `common/{context,logger,metrics,throttler,filters}/**`                                                                                 | 0     |
| `config`      | `registerAs` namespaces: app, database, redis, throttler, swagger                                                | `config/*.config.ts`                                                                                                                   | 0     |

`llm` and `product` are **not** imported by `app.module.ts`; they reach the graph through
`receipt.module.ts`. Their controllers still mount (`/llm`, `/products`).

## Web areas (`apps/web/src`)

Routes live under `app/[locale]/<area>/page.tsx`; every area has a `components/<domain>/` folder and a
`lib/<domain>/` folder holding its React context, types and formatters.

| Routes                                                                                 | Components                                   | lib                                                    |
| -------------------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------ |
| `/auth/{login,register,forgot-password,reset-password,verify-email,callback}`          | `components/auth`                            | `lib/auth` (`auth-context.tsx`)                        |
| `/dashboard`                                                                           | `components/dashboard`                       | via transaction/group contexts                         |
| `/transactions`, `/transactions/[transactionId]`                                       | `components/transaction`                     | `lib/transaction` (filters, formatters, `remember.ts`) |
| `/receipts`, `/receipts/[receiptId]`                                                   | `components/receipt`                         | `lib/receipt`                                          |
| `/products`, `/products/[productId]`                                                   | `components/product`                         | `lib/product`                                          |
| `/budgets`                                                                             | `components/budget`                          | `lib/budget`                                           |
| `/groups`, `/groups/[groupId]`, `/groups/[groupId]/settings`, `/groups/invite/[token]` | `components/group`                           | `lib/group`                                            |
| `/settings/account`, `/settings/categories`                                            | `components/settings`, `components/category` | `lib/llm`, `lib/category`                              |
| `/legal/{terms,privacy}`, `/help`, `/`                                                 | `components/layout`                          | —                                                      |

Shared: `components/ui` (Button, dialogs, `DocumentViewer`, spinners, Toast), `lib/ui`
(`useAsyncOperation`), `lib/realtime`, `lib/api-client.ts`, `lib/money.ts`, `lib/upload.ts`.
`src/hooks/` exists but is empty. `app/[locale]/layout.tsx` nests the providers:
`UIStatus → Auth → AuthenticatedRealtime → Group → Transaction → Receipt → Product → Category → Budget → Toast`.

## Request flow

Browser → shared edge nginx → web (Next standalone) for pages, or → API for `/api/v1/*`.
`getBaseUrl()` in `lib/api-client.ts` picks the URL: server-side renders use `API_INTERNAL_URL`,
the browser uses `NEXT_PUBLIC_API_URL` (default `/api/v1`, i.e. same-origin through the proxy).
In dev, `next.config.ts` `rewrites()` forwards `/api/:path*` to `API_INTERNAL_URL` itself.
`main.ts` sets the global prefix from `API_GLOBAL_PREFIX` (default `api/v1`), trusts the CDN and
Docker proxy ranges, applies helmet + CSP, cookie-parser, a 5-minute in-memory OAuth session, a
whitelisting `ValidationPipe` and the two global exception filters. `proxy.ts` is only the next-intl
middleware; it never touches `/api`.

## Auth in five lines

1. `POST /auth/login|register` → access JWT (`JWT_EXPIRATION`, default 15m) in the JSON body **and**
   in an httpOnly `access_token` cookie (`utils/auth-cookie.ts`), refresh token in a `refresh_token` cookie.
2. Refresh tokens are hashed rows (`refresh_tokens`) with rotation, `replacedBy` chain and reuse detection;
   TTL `JWT_REFRESH_EXPIRATION`, default 7d.
3. Any 401 in the browser triggers exactly one single-flight `POST /auth/refresh` inside
   `lib/api-client.ts`; the new token is broadcast on `BroadcastChannel('auth')` for other tabs.
4. Bearer header is the normal path (`JwtAuthGuard`); `CookieOrBearerAuthGuard` exists because
   `EventSource` cannot send headers.
5. Google uses Passport + the short-lived express session; Telegram uses HMAC-SHA256 verification
   (`utils/telegram-auth.util.ts`). All clients authenticate against the API — API-first (plan §1).

## Queues and realtime

**Queues.** `QueueModule` is `@Global()`, builds one Redis connection from `buildRedisConnection()`
(`REDIS_HOST/PORT/PASSWORD/TLS`) and registers five queues named only in `queue.constants.ts`:
`transaction-occurrences`, `receipt-extractions`, `product-images`, `receipt-optimizations`,
`product-enrichments`. Each has exactly one `@Processor` in its feature module. Adding a queue = a
constant + a `registerQueue` entry; never a string literal in feature code. `@nestjs/bullmq` closes
clients on `app.close()`.

**Realtime.** `GET /events/stream` is an SSE endpoint guarded by `CookieOrBearerAuthGuard`. Services
publish a `RealtimeEvent` (a discriminated union in `realtime/events.types.ts`) carrying `userIds`;
`EventBus.subscribeForUser()` filters per authenticated user and `userIds` is stripped from the wire
payload. A `ping` every 30 s keeps proxies open; an incrementing `id:` supports `Last-Event-ID`.
The browser side is `lib/realtime/` (`AuthenticatedRealtimeProvider`, `use-realtime-resync.ts`).

## Cross-cutting invariants

| Invariant                                                                                         | Implemented in                                                                                           |
| ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Money is integer minor units + an ISO-4217 code — float arithmetic can never enter the DB         | `*_cents` columns; `packages/shared/src/types/currency.types.ts`; `apps/web/src/lib/money.ts`            |
| Cursor pagination `{ data, cursor, hasMore }`, opaque base64url, default 20 / max 100             | `packages/shared/src/dto/pagination.dto.ts` (`encodeCursor`/`decodeCursor`)                              |
| Every list pattern gets a composite index so pagination stays index-only (plan §3.3)              | `@@index` blocks in `apps/api/prisma/schema.prisma`                                                      |
| One error shape `{ statusCode, message, error, timestamp, path, requestId, errorCode? }`          | `common/filters/http-exception.filter.ts` + `all-exceptions.filter.ts`                                   |
| DTO whitelist strips unknown props and 400s on extras — no mass assignment                        | `ValidationPipe({ whitelist, forbidNonWhitelisted })` in `main.ts`                                       |
| Global throttling (`RATE_LIMIT_TTL`/`RATE_LIMIT_MAX`, default 60/min), tighter on auth            | `common/throttler/*`, `config/throttler.config.ts`, `@Throttle` decorator                                |
| Audit rows for auth, permission and financial mutations                                           | `prisma.auditLog.*` in 19 services (auth, group, transaction, budget, receipt, product, llm, category)   |
| Correlated logs: one request id in ALS, echoed in every log line and error body; secrets redacted | `common/context/request-context.ts`, `common/logger/logger.module.ts`                                    |
| Every user-facing string exists in `en` **and** `he`, RTL via `dir`                               | `apps/web/messages/{en,he}.json`, `i18n/routing.ts` (`localePrefix: 'never'`), `app/[locale]/layout.tsx` |

Drift vs the plan: §1 and §3.1 prescribe `dinero.js`; it is not a dependency anywhere — money is
plain integer cents plus `Intl.NumberFormat`. `common/interceptors/transform.interceptor.ts` exists
but is registered nowhere, so responses are **not** enveloped in `{ data }` by default; controllers
return their DTOs directly. `docs/progress.md` still says "Next.js 15"; `apps/web/package.json` pins
`next@^16.2.4`.

## Phase edges that still matter

Shipped: 0–7 complete; 8, 9, 10 in progress (`docs/progress.md`). Remaining edges from plan §9.1–9.2:

- 11 (MCP server) needs 9's habit summaries (9.7) and the Phase 7 receipt pipeline; its OAuth 2.1
  layer can start any time after 6.
- 12 (bot) needs only Phase 3 Telegram auth — `apps/bot` is still a placeholder.
- 13 (mini app) and 14 (bot receipts) both need 12 core; 14 additionally needs 7. 15 needs 9.
- 16 (LLM assistant) needs 9 + 7 and reuses the Phase 7 provider layer; 17 (WebMCP) needs 11's tool
  contracts.
- 18 (search) requires a hierarchical, many-to-many category model — it changes the Phase 6 category
  schema, so treat `Category`/`TransactionCategory` as pre-committed to that direction.
- 19 (LLM cost ledger) needs 8.11 BYOK and the extraction providers' token reporting.

## Read next

Cross-cutting: [conventions.md](conventions.md) (how code is written) ·
[data-model.md](data-model.md) (schema, migrations) · [testing.md](testing.md) ·
[ui-design-system.md](ui-design-system.md) · [roadmap.md](roadmap.md).

By domain: [auth-and-groups.md](auth-and-groups.md) · [transactions.md](transactions.md) ·
[receipts-and-llm.md](receipts-and-llm.md) · [products-catalog.md](products-catalog.md) ·
[analytics-and-budgets.md](analytics-and-budgets.md).

For depth go to the design doc, not the code: `docs/phase-6-transactions-design.md`,
`docs/phase-7-receipts-design.md`, `docs/phase-8-products-design.md`,
`docs/phase-9-analytics-design.md`, `docs/phase-10-budgets-design.md`,
`docs/ui-async-conventions.md`, `docs/ui-realtime-conventions.md`, `docs/deployment.md`.
