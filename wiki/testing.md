# Testing & verification (checked 2026-09-24)

Read when: writing tests, running them, or deciding whether a change is ready to claim as done.

## Suite matrix

All commands run from the repo root. `pnpm test` / `pnpm typecheck` / `pnpm lint` fan out through
Turborepo (`turbo.json`), which makes them depend on `^build` — the workspace builds first.

| Suite                 | Runner                           | Location                                          | Command                        | Docker? | CI job          |
| --------------------- | -------------------------------- | ------------------------------------------------- | ------------------------------ | ------- | --------------- |
| API unit              | Jest + ts-jest (node)            | `apps/api/src/**/*.spec.ts`                       | `pnpm test` / `pnpm test:unit` | no      | CI → Unit Tests |
| API integration       | Jest + Testcontainers            | `apps/api/test/integration/*.integration.spec.ts` | `pnpm test:integration`        | **yes** | **none**        |
| API staging (HTTP)    | Jest                             | `apps/api/test/staging/*.staging.spec.ts`         | `pnpm test:staging`            | no      | Test Staging    |
| Web unit/interaction  | Vitest + Testing Library (jsdom) | `apps/web/src/**/*.{test,spec}.{ts,tsx}`          | `pnpm test`                    | no      | CI → Unit Tests |
| Shared unit           | Vitest (node)                    | `packages/shared/src/**`                          | `pnpm test`                    | no      | CI → Unit Tests |
| Web E2E (local stack) | Playwright                       | `apps/web/e2e/*.spec.ts`                          | `pnpm test:e2e`                | stack   | **none**        |
| Web E2E (staging)     | Playwright                       | `apps/web/e2e/staging/*.staging.spec.ts`          | `pnpm test:e2e:staging`        | no      | Test Staging    |

Rough size today: 87 API unit spec files (~1238 cases), 31 integration specs, 5 staging specs;
120 web spec files (~1382 cases), 11 shared spec files; 9 local E2E specs + 8 staging E2E specs.

The three Jest configs select by filename, so one file can never run in two suites:
`jest.config.js` (`*.spec.ts`, excludes `.integration.` / `.staging.`), `jest.integration.config.js`
(`.integration.spec.ts$`, 60 s timeout, `maxWorkers: 1`), `jest.staging.config.js`
(`.staging.spec.ts$`, 30 s timeout, `maxWorkers: 1`).

## Running one file

| Runner     | Command                                                                                                                             |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Jest unit  | `pnpm --filter api exec jest src/receipt/receipt.service.spec.ts`                                                                   |
| Jest integ | `pnpm --filter api exec jest --config jest.integration.config.js --runInBand test/integration/receipts-confirm.integration.spec.ts` |
| Vitest     | `pnpm --filter web exec vitest run src/components/ui/Button.spec.tsx`                                                               |
| Playwright | `pnpm --filter web exec playwright test e2e/receipts.spec.ts --project=chromium`                                                    |

Watch modes: `pnpm --filter api test:watch`, `pnpm --filter web test:watch`,
`pnpm --filter web test:e2e:ui`.

## API integration tests — Testcontainers

`apps/api/test/helpers/testcontainers.ts` starts **one `mysql:9.7` container per suite**
(`setupTestDatabase()` → runs `prisma migrate deploy` against it, returns a `PrismaClient` built on
the `PrismaMariaDb` driver adapter; `teardownTestDatabase()` stops it). The image tag must stay in
lockstep with the `stack-versions` skill and the compose files — **MySQL 9.7, never 8.4**; a
mismatch shows up as `caching_sha2_password` handshake / "pool timeout" errors.

Reuse rather than re-writing:

- `apps/api/test/integration/helpers.ts` — `bootstrapTestApp()` (full Nest app + supertest context),
  `registerUser()`, `loginUser()`, `hashToken()`.
- `apps/api/test/integration/setup.ts` — `jest.setTimeout(60_000)`.
- `apps/api/test/setup.ts` — unit-suite global: `jest.clearAllMocks()` after each test.

**Docker is required.** If the Docker daemon is unavailable, integration tests cannot run — report
it as a blocker and say which suites were therefore not exercised. Do not claim an integration
suite passed from a unit run.

## Web unit tests

`apps/web/vitest.config.ts`: `jsdom`, `globals: true`, `env: { TZ: 'UTC' }` (pinned so
`datetime-local` → UTC conversions are deterministic), setup `src/test-setup.ts`, alias `@` → `src`,
include `src/**/*.{test,spec}.{ts,tsx}`, exclude `e2e/**`, v8 coverage.

`src/test-setup.ts` imports `@testing-library/jest-dom` and installs an **in-memory `localStorage`
shim**: Node 26 defines a bare `localStorage` global that stays `undefined`, and because the key
already exists on `globalThis`, jsdom's implementation never reaches the test realm. Anything that
needs another Web Storage/API shim belongs in this file, not in individual specs.

Specs sit next to their subject (`Button.tsx` / `Button.spec.tsx`); realtime specs stub
`EventSource` (`src/lib/realtime/__tests__/realtime-context.test.tsx`).

## Playwright

- `apps/web/playwright.config.ts` — `testDir: ./e2e`, ignores `**/staging/**`, 5 projects
  (chromium, firefox, webkit, Pixel 5, iPhone 12), `fullyParallel`, CI: 2 retries / 1 worker /
  `github` reporter. Base URL from **`PLAYWRIGHT_BASE_URL`** (default `http://localhost:3000`).
  Outside CI it starts `pnpm run dev` itself and reuses an existing server.
- `apps/web/playwright.staging.config.ts` — `testDir: ./e2e/staging`, base URL from **`STAGING_URL`**
  (falls back to a hardcoded staging URL in the file), `ignoreHTTPSErrors: true`, chromium-only in
  CI and chromium/firefox/Pixel 5 locally.
- Conventions: plain `test`/`test.describe` — there are **no custom fixtures**; `e2e/fixtures/` holds
  only a `.gitkeep`. Specs register a fresh throwaway user per run and build their own helpers
  (`registerFreshUser` in `e2e/receipts.spec.ts`). Queries mix `getByRole`/`getByLabel` with
  `getByTestId` (76 uses); `data-testid` is the app-wide hook (829 in `apps/web/src`).
- `e2e/receipts.spec.ts` needs a live stack with `RECEIPT_EXTRACTION_PROVIDER=mock` for a
  deterministic extraction result.

## CI and gating

Node **26**, pnpm via `pnpm/action-setup@v5`, `pnpm install --frozen-lockfile`, then
`pnpm --filter api exec prisma generate` in every job. No service containers anywhere.

| Workflow                | Trigger                                                                    | Jobs                                                                                                                                                                                                                               |
| ----------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ci.yml`                | push/PR on `main`, `develop`                                               | `lint-and-typecheck` (lint → typecheck → `format:check`) → `unit-tests` (`pnpm run test`, uploads coverage artifact) and `build`, both `needs` it                                                                                  |
| `pr-check.yml`          | PR on `main`, `develop`                                                    | Conventional-Commits PR title; changed-package detection                                                                                                                                                                           |
| `deploy-staging.yml`    | push `develop` + dispatch                                                  | waits for CI, then blue-green deploy                                                                                                                                                                                               |
| `test-staging.yml`      | `workflow_run` after a successful Deploy Staging on `develop`, or dispatch | `api-staging-tests` (polls `/health` up to 5 min, then `pnpm test:staging`), `e2e-staging-tests` (`playwright install --with-deps chromium`, `pnpm test:e2e:staging`, uploads report), `staging-tests-summary` fails if either did |
| `deploy-production.yml` | push `main` + dispatch (typed confirmation)                                | validate → wait for CI → `staging-tests-check` → build/push → deploy                                                                                                                                                               |

`staging-tests-check` queries the GitHub API for the latest `test-staging.yml` run and fails unless
it is `success` **and under 24 hours old** — manual production dispatches are gated too. Flow:
PR → CI → merge to `develop` → deploy staging → test-staging → merge to `main` → deploy production.
Depth: [deployment.md](../docs/deployment.md) "Production Deployment Gating",
[phase-0-testing-deployment-plan.md](../docs/phase-0-testing-deployment-plan.md) §2 and §5.

Staging tests are deliberately HTTP-only (not Testcontainers): they validate the deployed stack —
nginx, env vars, TLS, DB, Redis. `apps/api/test/staging/helpers.ts` provides `getStagingApiUrl()`,
`stagingFetch`, `stagingFetchJson` and retrying variants; the API URL comes from **`STAGING_API_URL`**.

## Coverage

`pnpm test:coverage` (Jest `--coverage` for the API, Vitest v8 for web/shared). **No threshold is
enforced anywhere** — `apps/api/jest.config.js` has `collectCoverageFrom` but no
`coverageThreshold`, and no CI step checks a number. Design drift: `IMPLEMENTATION-PLAN.md` §3.5
specifies 80 % / 60 % / 70 % gates and Playwright visual-regression snapshots; neither exists in
code (no `coverageThreshold`, no snapshot directories) — checked 2026-09-24. `ci.yml` also does not
run the integration suite that §3.5's pipeline sketch shows.

## The verdict standard

Before claiming a change works, from the repo root, in this order:

1. `pnpm typecheck` · `pnpm lint` · `pnpm format:check` — exactly what CI's first job gates on, and
   `format:check` covers `**/*.{ts,tsx,js,jsx,json,md,yaml,yml}`, markdown included.
2. While iterating, scope to the file or package (`--filter`, single-file commands above).
3. Before the claim, run the full suite for every package you touched (`pnpm test`), plus the API
   integration suite when you changed API/Prisma behaviour.
4. State what you ran and what you did not. "Tests pass" without naming the suite is not a verdict;
   an unrunnable suite (no Docker, no live stack) is a reported blocker, not a pass.

Note: the `.kilocode/rules/*` DNA/deployment rule files the design docs cite are gitignored, so
they are not readable from the tracked tree — the above is what the configs and CI actually enforce.

## Known gotchas

- **jsdom + Node 26 storage** — see the `localStorage` shim above; never assume a Web Storage API
  exists in a spec.
- **Timezone** — web specs run at `TZ=UTC` by config; anything asserting a formatted date must not
  depend on the machine zone. API formatting tests should pass an explicit locale/zone.
- **Testcontainers startup** — 60 s Jest timeout and `maxWorkers: 1`/`--runInBand`; suites are slow
  and serial by design. A cold image pull can still exceed it on first run.
- **Local integration runs accumulate state** — running the full integration suite repeatedly
  against a shared local dev DB produced 59 failures from 409 duplicate-email and 429 throttling
  artifacts that were green in CI (`docs/phase-6-progress.md`, "Suites & CI").
- **Flaky-test policy**: de-flake, do not retry. The only flake in the git log was fixed at source
  (`4f5c264 test(phase-8.18): de-flake the reconcile-completes spec`). Retries exist only in the
  Playwright CI configs (2), never in Jest/Vitest.
- E2E specs create real users through the UI; they need a writable, non-production stack.
