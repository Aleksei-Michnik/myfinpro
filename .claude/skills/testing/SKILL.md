---
name: testing
description: The test suites of this monorepo and how to run them — Jest unit and Testcontainers integration for the API, Vitest for web and shared, Playwright local and staging, what CI actually gates — plus the verdict standard for claiming something works. Use when writing or running tests, verifying an iteration, or deciding which suite a change needs.
---

# Testing

Full matrix, helpers and gotchas: `wiki/testing.md`. Strategy and expected levels per iteration:
`IMPLEMENTATION-PLAN.md` §3.5 and the iteration row's "Testing" column.

## Commands (repo root)

| Suite           | Command                                                                       | Needs                                                   |
| --------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------- |
| Gate            | `pnpm typecheck && pnpm lint && pnpm format:check`                            | —                                                       |
| API unit        | `pnpm --filter api test:unit` (Jest, `*.spec.ts`)                             | —                                                       |
| API integration | `pnpm test:integration` (Jest + Testcontainers, `apps/api/test/integration/`) | Docker; not run in CI                                   |
| Web unit        | `pnpm --filter web test:unit` (Vitest + Testing Library, `TZ=UTC`)            | —                                                       |
| Shared unit     | `pnpm --filter @myfinpro/shared test`                                         | —                                                       |
| Web e2e (local) | `pnpm test:e2e` (Playwright, `apps/web/e2e/*.spec.ts`, `PLAYWRIGHT_BASE_URL`) | running stack (`local-stack`), mock extraction provider |
| Staging suites  | `pnpm test:staging`, `pnpm test:e2e:staging`                                  | CI after a staging deploy                               |

One file: `pnpm --filter api exec jest src/<module>/<file>.spec.ts`;
`pnpm --filter web exec vitest run src/<path>`; `pnpm --filter web exec playwright test e2e/<file>.spec.ts --project=chromium`.

## Writing tests

- Next to the code (`*.spec.ts`, `*.spec.tsx`); integration tests follow the helpers in
  `apps/api/test/helpers/` (Testcontainers pinned to `mysql:9.7`); e2e specs build their own
  users via the register flow (no shared fixtures yet).
- Test behaviour through public surfaces (endpoints, rendered components), not internals.
- A flaky test is a finding: fix the race at its source; never `.skip`, broaden an assertion or
  raise a timeout to pass.

## Verdict standard

1. Gate first. 2. Suites for the changed packages while iterating. 3. Full relevant suite before
   the verdict. 4. Docker unavailable ⇒ report "integration not run: environment", never "skipped".
2. Verdict per acceptance criterion, **met / not met**, with the command and trimmed output.
   Local integration runs against a shared dev DB can accumulate state (duplicate-email 409s,
   throttling 429s) — reset the DB before judging a red run.
