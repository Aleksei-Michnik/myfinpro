# Platform Upgrade 2026 — Node 26 · TypeScript 6 · MySQL 9.7 LTS

Plan and execution record for the coordinated platform upgrade (July 2026).
Each step ships as its own commit with a green CI + staging gate before the
next one starts. The database step additionally gates on a verified backup
and explicit approval before touching production.

## 1. Targets

| Component  | Current                             | Target                      | Notes                                                                                                                                                            |
| ---------- | ----------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node.js    | 24 (`.nvmrc`, CI, `node:24-alpine`) | **26.x** (`node:26-alpine`) | 26.5.0 is Current; LTS promotion lands October 2026 (see §6 watch list)                                                                                          |
| TypeScript | 5.9.3                               | **6.0.3**                   | Bridge release. TS 7 (native compiler) is GA but ships no JS API until 7.1 — the ecosystem (ts-jest, typescript-eslint, `nest build`, Next) cannot run on it yet |
| MySQL      | 8.4 LTS (`mysql:8.4`, server 8.4.8) | **9.7 LTS** (`mysql:9.7`)   | First LTS since 8.4 (9.7.0 Apr 2026, 9.7.1 Jun 2026); premier support to 2034                                                                                    |

## 2. Research findings that shaped the plan (verified 2026-07-19)

### Node 24 → 26

- `node:26-alpine` (Alpine 3.24) **no longer bundles corepack** — the
  Dockerfile pnpm bootstrap must install it (`npm i -g corepack`) or pnpm
  directly. We install corepack and let it resolve the pnpm version from the
  root `package.json` `packageManager` field — this also removes the previous
  duplicated pnpm pin (`10.28.2` in Dockerfiles vs `10.32.1` in
  `packageManager`).
- Native TS **type stripping is stable**: `node script.ts` runs erasable
  TypeScript with no flags. ts-node 10.9 is unmaintained and its loader hook
  (`module.register()`) is runtime-deprecated in 26.
- ABI bump (NODE_MODULE_VERSION 137→147) is irrelevant to us: sharp and
  argon2 are Node-API based.
- `Temporal` becomes a global (no collisions in this repo — verified).
- Compatible as-is: NestJS 11, Next 16 (≥20.9, no upper bound), jest 30
  (engines ≥24), vitest 4, Playwright (officially lists 26.x), pnpm 10,
  BullMQ, mariadb driver (pure JS).
- Caveats: 26 is **Current, not LTS until October 2026**; Prisma officially
  tests LTS lines only (26 works; official support flips at LTS promotion).

### TypeScript 5.9 → 6.0 (and the 7 horizon)

- Install **6.0.3** (no 6.1 will exist on the main package; the 6.x line
  continues as the `@typescript/typescript6` alias after 7 becomes `latest`).
- 6.0 deprecations that hit this repo (hard errors in 7.0, so we clear them
  now, without `ignoreDeprecations`):
  - `moduleResolution: "node"` (node10) — used in `packages/tsconfig/base.json`
    → Node packages move to `module`/`moduleResolution` **`nodenext`** (still
    emits CJS while package.json has no `"type": "module"`).
  - `baseUrl` — used in api/web tsconfigs → fold into `paths` or drop.
    The API's `@/*` alias is **unused** in code → delete rather than migrate.
- 6.0 default flips that matter even with explicit configs: `types` now
  defaults to `[]` (was: everything in `@types`) — packages relying on ambient
  `@types/node`/`jest` globals must declare `"types"` explicitly.
- Tooling matrix: ts-jest 29.4.11 (peer `<7`) ✓ · typescript-eslint 8.64
  (peer `<6.1`) ✓ · vitest 4 ✓ · Next 16.2 ✓ · Prisma 7 (peer `>=5.4`) ✓ ·
  **`@nestjs/cli` must be ≥ 11.0.24** (TS6 + `incremental: true` +
  `deleteOutDir` emitted zero files with stale `.tsbuildinfo`; fixed in
  11.0.20, nest-cli #3312).
- ts-node / ts-node-dev are replaced (Prisma seed → native type stripping or
  tsx; jest TS configs → plain `.js` configs; bot dev loop → `node --watch`).
- TS 7 readiness = zero 6.0 deprecations + ecosystem gate: flip when TS 7.1
  ships the JS API **and** ts-jest / typescript-eslint / Next declare support.
  Until then `typescript@7` can only smoke-test raw `tsc` builds.

### MySQL 8.4 → 9.7 LTS

- Direct **in-place upgrade 8.4 → 9.7 is supported** (LTS→next-LTS path):
  stop the 8.4 container, start `mysql:9.7` on the same datadir; mysqld
  auto-upgrades system tables on first start. **Downgrade is not supported**
  — a fresh backup before the swap is mandatory; rollback = restore dump into
  a clean 8.4 volume.
- `mysql_native_password` is **removed** in 9.x. Preflight audit (2026-07-19):
  every account on staging and production is already `caching_sha2_password`
  — no account migration needed, and the running app already authenticates
  with it through the mariadb driver (supported since Connector/Node 2.5.0).
  The only remnant was the local testcontainers helper passing
  `--default-authentication-plugin=mysql_native_password`, which would
  prevent a 9.x server from starting → removed in step 3.
- Our compose `command:` only sets charset/collation
  (`utf8mb4`/`utf8mb4_unicode_ci`) — no removed variables
  (`temptable_use_mmap`, `replica_parallel_type`) anywhere.
- Prisma's supported-databases list does not include MySQL 9.x yet (8.4 is
  the newest row). Wire-protocol-wise nothing Prisma does changes; we treat
  it as "works, verify with our own integration suite" and keep it on the
  watch list (§6).
- `mysqldump` portability: 8.4 dumps restore into 9.7 (that _is_ the
  supported logical-upgrade path). The backup-verify workflow's restore
  target moves from `mariadb:11.8` to `mysql:9.7` so restores are verified
  against the production engine.

## 3. Order and rationale

1. **Node 26 first** — pure runtime bump, zero code changes, immediately
   exercised by CI and staging. Reversible by reverting one commit.
2. **TypeScript 6 second** — compile-time only; no runtime or deploy-surface
   change. Isolating it from the Node bump keeps any type-error fallout
   attributable.
3. **MySQL 9.7 last** — the only stateful, not-cleanly-reversible step, so it
   goes last, per environment (local → CI → staging → production), each with
   its own gate.

An important deploy-pipeline property that dictates sequencing: the staging
deploy runs `docker compose -f docker-compose.staging.infra.yml up -d`, so
**merely pushing the image bump to `develop` performs the staging DB
in-place upgrade on the next deploy**. Same for production on merge to
`main`. Backups are therefore taken _before_ the push/merge, not during.

## 4. Steps

### Step 1 — Node 26 (commit: `chore(platform): node 26`)

Files:

- `.nvmrc` → `26`
- root `package.json` → `"engines": { "node": ">=26.0.0" }`
- `.github/workflows/ci.yml` (3×), `test-staging.yml` (2×) → `node-version: 26`
- `infrastructure/docker/{api,web,bot}.Dockerfile` → `FROM node:26-alpine`;
  corepack bootstrap becomes `npm install -g corepack && corepack enable`
  (pnpm version then comes from `packageManager` — single source of truth)
- `@types/node` → `^26.1.1` in api, web, bot, shared

Verification gate: `pnpm install` + full local `typecheck` / `lint` / `test`
/ `build` on Node 26; audit `node_modules` for removed `_stream_*` internals;
CI green; staging deploy healthy (API healthcheck, web up); smoke test.

Rollback: revert commit, redeploy (stateless).

### Step 2 — TypeScript 6.0.3 + TS7 prep (commit: `chore(platform): typescript 6`)

Files:

- `typescript` → `~6.0.3` in root, api, web, bot, shared
- `@nestjs/cli` → `^11.0.24` (TS6 zero-emit fix)
- `packages/eslint-config/package.json` peer `typescript` → `^5.0.0 || ^6.0.0`
- `packages/tsconfig/base.json`: drop `moduleResolution: "node"`;
  Node presets (`nestjs.json`, `node.json`) move to
  `module: "nodenext"` + `moduleResolution: "nodenext"`; explicit `types`
  where ambient globals are needed (TS6 defaults `types` to `[]`)
- api `tsconfig.json`: remove unused `baseUrl`/`paths` (`@/*` unused in api)
- jest configs (`jest.config.ts`, `jest.integration.config.ts`,
  `jest.staging.config.ts`) → `.js` (removes the ts-node dependency of
  jest-config TS loading)
- Prisma seed: `ts-node prisma/seed.ts` → run via Node native type stripping
  (`node prisma/seed.ts`), falling back to `tsx` only if extension resolution
  bites; bot dev loop `ts-node-dev` → `node --watch`
- Remove `ts-node`, `ts-node-dev` devDeps (unmaintained; loader hook
  deprecated on Node 26; dead on TS 7)

Verification gate: zero TS deprecation output with **no `ignoreDeprecations`**
set; full local suite + `nest build` output non-empty (the #3312 failure
mode); `prisma db seed` works; CI green; staging deploy healthy.

Rollback: revert commit (compile-time only).

### Step 3 — MySQL 9.7, code-side (commit: `chore(platform): mysql 9.7 lts`)

Files:

- `docker-compose.yml`, `docker-compose.staging.infra.yml`,
  `docker-compose.production.infra.yml` (+ legacy monolithic
  `docker-compose.staging.yml` / `docker-compose.production.yml` for
  consistency) → `image: mysql:9.7`
- `apps/api/test/helpers/testcontainers.ts` → `mysql:9.7`, drop the removed
  `--default-authentication-plugin=mysql_native_password` flag (tests then
  exercise `caching_sha2_password`, same as staging/production)
- `.github/workflows/backup-verify.yml` → restore-target service
  `mariadb:11.8` → `mysql:9.7` (verify restores against the production
  engine; health-cmd moves to `mysqladmin ping`)

Verification gate (before push): full API integration suite locally against
`mysql:9.7` testcontainers; `prisma migrate deploy` + seed against a fresh
9.7 container.

**Do not push until the staging backup in step 4 is taken** (push = staging
auto-upgrade).

### Step 4 — Staging DB upgrade (deploy of step-3 commit)

Runbook:

1. Fresh logical backup of staging (`scripts/backup.sh --docker` against the
   staging container) + verify the dump is non-empty/readable.
2. Cold datadir snapshot: stop staging mysql, `tar` the
   `myfinpro-staging-mysql` volume, restart (brief staging outage, ~seconds).
3. Push step-3 commit to `develop`; watch the deploy
   (`gh run watch <ID> --exit-status`).
4. Verify: mysql container logs show the 8.4→9.7 auto-upgrade completing;
   `SELECT VERSION()` = 9.7.x; API healthcheck green; test-staging workflow
   (integration + e2e against staging) green.
5. **Manual user verification of staging before anything touches production.**

Rollback: stop 9.7 container, restore volume snapshot (or dump into a fresh
volume) under a reverted `mysql:8.4` compose file.

### Step 5 — Production (merge to `main` after explicit approval)

Runbook:

1. Fresh logical backup of production + cold datadir snapshot of
   `myfinpro-production-mysql` (brief maintenance pause on the DB container).
2. Merge `develop` → `main` (release commit), watch Deploy Production.
   The infra compose `up -d` recreates the mysql container on `mysql:9.7`;
   the datadir auto-upgrades on first start (one-time startup delay while
   system tables upgrade).
3. Verify: upgrade completion in mysqld log; `SELECT VERSION()`; blue-green
   app deploy healthy; manual smoke of auth + transactions + receipts +
   products (image-serving hits DB for `product_images`).
4. Keep the 8.4 snapshot + dump until the environment has run clean for an
   agreed soak period.

Rollback: as staging — restore snapshot/dump under `mysql:8.4` (revert
commit on `main`).

## 5. Execution log

- 2026-07-19 — Preflight completed: version survey, three research briefs,
  staging/production account-plugin audit (all `caching_sha2_password`),
  `mysql:9.7.1` and `node:26-alpine` images validated locally. Plan written.
  (Entries below are appended as each step ships.)
- 2026-07-19 — Step 1 (Node 26) shipped: `.nvmrc`/engines/CI → 26,
  Dockerfiles → `node:26-alpine` with corepack installed via npm (pnpm
  version now sourced solely from `packageManager`; verified 10.32.1 inside
  the built image), `@types/node` → ^26. **Root-caused the "pre-existing"
  local BudgetFormDialog/TransactionFormDialog spec failures**: Node 26
  defines a bare `localStorage` global (undefined without
  `--localstorage-file`) that pre-empts jsdom's implementation in the vitest
  realm — they were a genuine Node-26 incompatibility that would have broken
  CI on this bump, fixed with an in-memory Storage in
  `apps/web/src/test-setup.ts` (vitest patch-bumped to 4.1.10 along the way).
  Full suite green on 26.5.0: api 1213, web 1329, shared; `_stream_*`
  internals audit clean; api image dependencies stage builds on
  `node:26-alpine`.
- 2026-07-19 — Step 2 (TypeScript 6.0.3) shipped. Presets → `nodenext`
  (base), `baseUrl` removed everywhere, api's unused `@/*` alias dropped
  (tsconfig + dead jest moduleNameMapper), explicit `types` per preset.
  Fallout fixed: (a) 99× TS1272 — TS 6 requires `import type` for
  interfaces referenced in decorated signatures under nodenext; converted
  `JwtPayload`/express `Request`/`Response`/`ThrottlerModuleOptions` imports
  across 14 controllers/guards; (b) one spec used dynamic
  `import('node:fs/promises')`, which nodenext preserves as a real dynamic
  import that jest's CJS VM rejects — made static; (c) jest configs → `.js`
  and ts-node/ts-node-dev removed; Prisma seed runs via Node native type
  stripping (needed an explicit `.ts` extension on its relative import) and
  bot dev via `node --watch`; (d) surfaced a latent Prisma 7 bug: the seed
  constructed `new PrismaClient()` without a driver adapter — broken since
  the Prisma 7 migration, now uses `PrismaMariaDb` like PrismaService;
  (e) removed the legacy package.json `prisma` block (Prisma 7 reads
  `prisma.config.ts`). Deprecation-clean without `ignoreDeprecations` →
  TS7-ready. Verified: typecheck/lint green, `nest build` emits 212 files
  (non-empty — the nest-cli #3312 check), full unit suite green
  (api 1213 / web 1329 / shared), seed + bot smoke-run on bare Node.
  **Also root-caused the long-standing local integration-suite failures**:
  the testcontainers helper passes `--default-authentication-plugin`,
  which `mysql:8.4` already rejects (removed in 8.4) — the test MySQL
  container has never started locally on this image; fix lands in step 3
  with the 9.7 bump.
- 2026-07-19 — Step 3 (MySQL 9.7 code-side) prepared: all compose files →
  `mysql:9.7`; testcontainers helper → 9.7 with the removed auth flag
  dropped; backup-verify workflow restores into `mysql:9.7` (was
  `mariadb:11.8`) so backups are verified against the production engine.
  Validated locally: full integration suite against 9.7 testcontainers —
  22/30 suites pass including every DB-sensitive one (transactions,
  receipts, products/trigram, budgets, queue, system-categories); the 8
  failing suites are the auth/email family that bypasses testcontainers and
  hits a stale local dev DB on 3306 (409 fixed-email conflicts, 429
  throttling, local redis) — pre-existing local-env class,
  engine-independent. Fresh-9.7 validation: `prisma migrate deploy` applies
  all migrations, `prisma db seed` completes (also exercising
  caching_sha2_password via the mariadb driver over plain TCP). Not pushed
  until the staging backup (step 4) is taken — push auto-upgrades the
  staging datadir.

## 6. Watch list (follow-ups, not part of this change)

- **October 2026** — Node 26 LTS promotion: retag CI/Dockerfiles if pinning
  tighter than `26`; Prisma's official Node-26 support flips then too.
- **TS 7.1** — ships the JS API; flip `typescript` to 7.x once ts-jest,
  typescript-eslint and Next declare support (all currently capped at `<7`
  or dependent on the API). The codebase is already deprecation-clean.
- **Prisma** — watch supported-databases for the MySQL 9.x row; until then
  our integration suite is the compatibility gate.
- Legacy monolithic `docker-compose.staging.yml` / `docker-compose.production.yml`
  are still referenced by `infra-maintenance.yml` and docs; consolidating
  onto the split infra/app files is a separate cleanup.
