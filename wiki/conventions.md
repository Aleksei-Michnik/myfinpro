# Code conventions (checked 2026-09-24)

Read when: you are about to write or review code, a migration, a doc entry or a commit in this repo.

Rules come from `.kilocode/rules/{dna,docs,deployment}.md` — `.claude/rules/` symlinks the first two —
plus the shape the code actually has. `.gitignore` lists `.kilocode/`, so those files are untracked
and present only in a working clone that has them; this page is the durable copy. When a rule and the
code disagree, match the code and fix the rule.

## Non-negotiables

- **Minimal, no copy-paste.** Reuse the existing helper, component, DTO or type before adding one.
- **DRY constants: derive, never duplicate.** Two constants that must always hold the same value are
  a bug. `dna.md` gives the canonical example: keep one `PRODUCTION_HOST` and compute
  ``const HARAKA_MAIL_HOSTNAME = `mail.${PRODUCTION_HOST}`;`` — do not add a second env var for the
  same fact. The same applies to translation keys and secret names.
- **No legacy code.** Replacing a path deletes the old one: no deprecated wrapper, no commented-out
  block, no "keep for compat".
- **Async UI goes through `useAsyncOperation()`** (`apps/web/src/lib/ui/use-async-operation.ts`),
  scope `page` | `container` | `control`. No ad-hoc `useState<boolean>(loading)`, no inline spinner,
  no local try/catch error state. `AbortError` must never reach the user; page-level orchestrators
  also call `useResetOnLocaleChange(reset)`. Never write the URL before the data commits — that bug
  is why the rule exists. Full contract: `docs/ui-async-conventions.md`.
- **Every user-facing string lands in `apps/web/messages/en.json` and `he.json` together**; `he` is
  RTL, so use logical CSS properties. A string added to one file only is an incomplete change.
- **Tests accompany the change**, in the same commit — see the layout rules below.
- **Prettier on every changed file before committing** (`.kilocode/rules/deployment.md` pre-check):
  `npx prettier --write` for `.ts .tsx .js .jsx .json .md .yaml .yml .html`. Settings live in
  `.prettierrc`: single quotes, semicolons, trailing commas `all`, print width **100**, 2 spaces, LF.

## API layout (`apps/api/src/<module>/`)

- `<module>.module.ts`, `<module>.controller.ts`, `<module>.service.ts` at the root; extra
  controllers/services take a compound name (`transaction-schedule.controller.ts`,
  `receipt-extraction.processor.ts`).
- Subfolders, all optional and singular-named: `dto/`, `constants/`, `guards/`, `decorators/`,
  `interfaces/`, `strategies/`, `services/` (only when a module has many, as `auth` does), `utils/`,
  `engine/` (analytics), `extraction/` + `url-intake/` (receipt).
- **DTO file names say the operation**: `create-budget.dto.ts`, `update-schedule.dto.ts`,
  `list-receipts-query.dto.ts`, `budget-response.dto.ts`. One class per file.
- **Unit tests sit next to the source** as `*.spec.ts` (`budget.service.spec.ts`). A `__tests__/`
  directory is used only for tests that belong to no single file — schema shape checks
  (`receipt/__tests__/prisma-models.spec.ts`) and bootstrap/seed suites
  (`transaction/__tests__/`). Integration and staging suites live in `apps/api/test/{integration,staging}`
  and run with their own jest configs (`pnpm --filter api test:integration|test:staging`).
- **Error constants**: one frozen map per module in `constants/<module>-errors.ts`, exported as
  `UPPER_SNAKE` (`BUDGET_ERRORS`, `GROUP_ERRORS`) with a derived union type
  (`export type BudgetErrorCode = (typeof BUDGET_ERRORS)[keyof typeof BUDGET_ERRORS];`). Values are
  domain-prefixed strings (`'GROUP_INVITE_TOKEN_EXPIRED'`) and ride in the `errorCode` field that
  `common/filters/http-exception.filter.ts` copies onto the error body. Key and value may differ
  (`NOT_A_MEMBER: 'GROUP_NOT_A_MEMBER'`); the value is the wire contract, so never change it silently.
  Document each code's meaning in the file header, as `budget-errors.ts` does.
- Queue names only ever come from `queue/queue.constants.ts`.

## Web layout (`apps/web/src/`)

- Routes: `app/[locale]/<area>/page.tsx`; heavy pages delegate to a `…-client.tsx` orchestrator.
- `components/<domain>/PascalCase.tsx` with `PascalCase.spec.tsx` beside it; cross-domain primitives
  in `components/ui/`.
- `lib/<domain>/` holds that domain's React context (`<domain>-context.tsx`), `types.ts` and pure
  helpers (`filters.ts`, `formatters.ts`, `remember.ts`). Pure-helper tests are `*.test.ts(x)`,
  component tests `*.spec.tsx` — both run under vitest (`pnpm --filter web test`).
- Playwright specs in `apps/web/e2e/`. `src/hooks/` exists but is empty; hooks currently live in
  `lib/<domain>/` or `lib/ui/`.

## `packages/shared`

Put something here only when **both** the API and the web (or the bot) need it: cross-app TypeScript
types (`types/*.types.ts`), transport DTOs and their helpers (`dto/pagination.dto.ts` owns
`encodeCursor`/`decodeCursor`), and constants that must not drift (`constants/default-categories.ts`,
`PAGINATION`, `LOCALES`). Everything re-exports through `src/index.ts`. Tests live in
`src/__tests__/*.test.ts`. Nest decorators, Prisma types and React must never leak in — the bot and
the web both import this package.

## Prisma (`apps/api/prisma/schema.prisma`)

- Models `PascalCase`; `@@map("snake_case_plural")` on every model; `@map("snake_case")` on every
  multi-word column.
- Ids: `String @id @default(uuid()) @db.VarChar(36)`. FK columns are `VarChar(36)` and indexed.
- Timestamps: `createdAt @default(now())`, `updatedAt @updatedAt`, both `@map`ped.
- **No Prisma enums** — status/kind/scope columns are `String @db.VarChar(n)` with the allowed set
  listed in a comment above and validated by class-validator at the API boundary. The Phase 6 design
  shows `enum TransactionDirection` and then says to use String; the code uses String everywhere.
- Soft delete is not global: `deletedAt` exists only on `users` and `transaction_comments`.
  Everything else uses a domain flag (`archivedAt`, `cancelledAt`, `pausedAt`) or hard delete.
- Every list query gets its composite `@@index`; every uniqueness rule gets a named `@@unique`.
- Non-obvious columns carry a comment saying **why** (see `Transaction.idempotencyKey`).

Migration directories are `apps/api/prisma/migrations/<YYYYMMDDHHMMSS>_<topic>`; the topic is
`phase<N>_<iteration>_<subject>` (`20260716130000_phase8_22_receipt_files`) or a plain subject for
cross-phase work (`20260724100000_multi_category_transactions`). Expand and contract are **two
directories** with adjacent timestamps — see `20260717120000_phase8_25_product_images_expand` and
`…121000_…_contract`. Details in [data-model.md](data-model.md).

## Commits

Observed over the last 120 commits: **Conventional Commits, lowercase subject, always scoped** —
`type(scope): subject`. Types in use: `feat`, `fix`, `docs`, `chore`, `test`, `style`, `ops`.
Scope was the iteration id (`feat(phase-8.25): …`) through Phase 8; since the Phase 9/10 work it is
the domain (`feat(receipts): persist full extraction reasoning on the receipt`,
`fix(ci): bump playwright to 1.61 — browser install hung on node 26`). Follow the recent form; add
the iteration id in the body when the commit closes one. An em dash introduces the clarifying clause.

Hygiene (`.kilocode/rules/deployment.md`):

- **Never** put a domain name, hostname, server name, IP, username, key or secret value in a file or
  a commit message. Check the diff, not just the message.
- One logical change per commit. `--amend` only for trivial fixups, never to fold in new value.
- Merging `develop` → `main` always gets its own merge commit with a message.
- **No AI attribution**: 470 commits contain zero `Co-Authored-By` trailers and zero "Generated with"
  lines. Do not add them here — this repo's rule differs from `green-fluffy`'s.

## `docs/` rules (`.kilocode/rules/docs.md`)

- `docs/progress.md` is an **index only**: the phase table, 2–4 sentences per phase, links. Never put
  iteration detail there.
- Detail goes in `docs/phase-<n>-progress.md`; design stays in `docs/phase-<n>[-<topic>]-design.md`.
- H1 once per progress file: `# Phase <n> — <Name>`. H2 per subphase:
  `## <n.m> — <Title> (<YYYY-MM-DD>)`. H3 for `### Scope` / `### API` / `### Web` / `### Tests` when
  a subphase grows. Never deeper than H4.
- Each subphase records commit hashes / CI run ids, what shipped, decisions, test counts, with
  relative markdown links into the code.
- Finishing an iteration = append the H2 section, update the phase row + summary + the
  `Last updated` / `Current work` lines in `docs/progress.md`, run prettier on the changed docs.
