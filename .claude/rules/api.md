---
paths:
  - 'apps/api/**'
  - 'packages/shared/**'
---

# API and shared rules

- Read `wiki/conventions.md` and the domain page for the module you touch (`wiki/transactions.md`,
  `receipts-and-llm.md`, `products-catalog.md`, `analytics-and-budgets.md`, `auth-and-groups.md`)
  before editing; `wiki/data-model.md` before any schema change (`prisma-migrations` skill).
- Module layout: `<module>.module|controller|service.ts`, `dto/`, `constants/<module>-errors.ts`,
  `guards/`, specs next to sources, integration tests in `apps/api/test/integration/`.
- DTOs validate with class-validator (whitelist); errors are module constants thrown as Nest
  exceptions; types shared with the web live in `packages/shared` (build it after changing).
- Visibility is scope-based (user vs group, attributions). Never widen a query to make a test
  pass; unauthorized access to another user's data is a 404/403 per the domain page, never a leak.
- Queue jobs use names from `apps/api/src/queue/queue.constants.ts`; SSE events from
  `apps/api/src/realtime/events.types.ts`. Credentials (JWT secrets, LLM keys) never reach logs.
- Verify: `pnpm --filter api typecheck && pnpm --filter api lint && pnpm --filter api test:unit`;
  `pnpm test:integration` needs Docker.
