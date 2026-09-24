# Data model (checked 2026-09-24)

Read when: you touch `apps/api/prisma/schema.prisma`, write a migration, or need to know where a
fact is stored and who may see it.

Source of truth is `apps/api/prisma/schema.prisma` (715 lines, 29 models, **zero Prisma enums**).
Naming and file-layout rules are in [conventions.md](conventions.md); this page is the map.

## Identity and auth

| Model                                          | Purpose                    | Key fields / relations                                                                                                                     | Notable indexes                                        | Soft delete           |
| ---------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ | --------------------- |
| `User` → `users`                               | account + preferences      | `email` unique, `passwordHash?`, `defaultCurrency`, `locale`, `timezone`, `dueReminderDays`, `llmProvider/llmModel`, `scheduledDeletionAt` | `email`, `createdAt`, `scheduledDeletionAt`            | **yes** (`deletedAt`) |
| `UserLlmCredential` → `user_llm_credentials`   | BYOK provider keys         | `encryptedValue` (`v1:<iv>:<tag>:<ct>`, AES-256-GCM under `LLM_SECRETS_ENCRYPTION_KEY`), `keyHint` = last 4 chars                          | `@@unique([userId, provider])`                         | no                    |
| `RefreshToken` → `refresh_tokens`              | rotation + reuse detection | `tokenHash` unique, `revokedAt`, `replacedBy`, `userAgent`, `ipAddress`                                                                    | `userId`, `expiresAt`                                  | no                    |
| `OAuthProvider` → `oauth_providers`            | Google/Telegram linkage    | `metadata Json?`                                                                                                                           | `@@unique([provider, providerId])`, `(provider,email)` | no                    |
| `EmailVerificationToken`, `PasswordResetToken` | one-shot tokens            | `tokenHash` unique, `expiresAt`, `usedAt`                                                                                                  | `userId`, `expiresAt`                                  | no                    |
| `AuditLog` → `audit_logs`                      | who did what               | `userId?`, `action`, `entity`, `entityId?`, `details Json?`, `ipAddress`, `userAgent`                                                      | `userId`, `action`, `createdAt`                        | no                    |
| `HealthCheck` → `health_checks`                | Phase 0 connection probe   | autoincrement `Int` id — the only non-uuid id in the schema                                                                                | —                                                      | no                    |

Tokens are never stored in the clear: `tokenHash` everywhere. Deleting a user cascades to every
table above.

## Groups

| Model              | Purpose                        | Key fields                                                  | Indexes / uniques                                  |
| ------------------ | ------------------------------ | ----------------------------------------------------------- | -------------------------------------------------- |
| `Group`            | family/shared wallet container | `type` (default `family`), `defaultCurrency`, `createdById` | `createdById`                                      |
| `GroupMembership`  | user ↔ group with a role       | `role` (default `member`)                                   | `@@unique([groupId, userId])`, `userId`, `groupId` |
| `GroupInviteToken` | join links                     | `tokenHash` unique, `expiresAt`, `usedAt`, `usedByUserId`   | `groupId`, `expiresAt`                             |

## Transactions

| Model                    | Purpose                                 | Key fields / relations                                                                                                                                                                                         | Indexes / uniques                                                                                             |
| ------------------------ | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `Transaction`            | one money movement, IN or OUT           | `direction` `IN`\|`OUT`, `type`, `amountCents`, `currency`, `occurredAt`, `status` (default `POSTED`), `categoryId` (the **primary** category), self-relation `parent`/`occurrences`, `idempotencyKey?` unique | `(direction, occurredAt)`, `categoryId`, `(createdById, occurredAt)`, `parentTransactionId`, `(type, status)` |
| `TransactionAttribution` | who/what the transaction counts against | `scopeType` `personal`\|`group`, exactly one of `userId`/`groupId`                                                                                                                                             | `@@unique([transactionId, scopeType, userId, groupId])`, `(userId,scopeType)`, `(groupId,scopeType)`          |
| `Category`               | system/user/group category              | `slug`, `name`, `icon`, `color`, `direction`, `ownerType` `system`\|`user`\|`group`, `ownerId?`, `isSystem`                                                                                                    | `@@unique([ownerType, ownerId, slug, direction])`, `(ownerType,ownerId)`, `direction`                         |
| `TransactionCategory`    | **additional** categories, ordered      | `position` 1-based; the primary category is never duplicated here                                                                                                                                              | `@@unique([transactionId, categoryId])`, `@@unique([transactionId, position])`                                |
| `TransactionSchedule`    | recurrence (BullMQ mirror)              | exactly one of `cron`/`everyMs` (service-level invariant — MySQL CHECK is not generated), `nextRunAt`, `pausedAt`, `cancelledAt`                                                                               | `nextRunAt`                                                                                                   |
| `TransactionPlan`        | installment / loan / mortgage           | `kind`, `principalCents`, `interestRate Decimal(8,6)`, `transactionsCount`, `frequency`, `amortizationMethod` (default `french`), `cancelledAt`                                                                | 1:1 on `transactionId`                                                                                        |
| `TransactionDocument`    | attached file                           | `kind`, `fileRef`, `mimeType`, `sizeBytes`, `uploadedById`                                                                                                                                                     | `transactionId`                                                                                               |
| `TransactionComment`     | discussion                              | `content Text`                                                                                                                                                                                                 | `(transactionId, createdAt)`, `userId` — **soft delete** (`deletedAt`)                                        |
| `TransactionStar`        | per-user star                           | —                                                                                                                                                                                                              | `@@unique([transactionId, userId])`, `(userId, createdAt)`                                                    |

Cancellation is soft on purpose: cancelling a plan or schedule flips remaining `PENDING` children to
`CANCELLED` and stamps `cancelledAt`; rows are never deleted, for audit.
`idempotencyKey` is `${scheduleId}:${firedAtMs}` — a re-fired BullMQ job hits the unique index and
becomes a no-op.

## Receipts

| Model              | Purpose                             | Key fields                                                                                                                                                                                                                                                                                 | Indexes / uniques                                                           |
| ------------------ | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| `Merchant`         | global merchant registry            | `normalizedName` unique (lowercased, whitespace-collapsed, diacritics stripped)                                                                                                                                                                                                            | —                                                                           |
| `Receipt`          | intake + extraction envelope        | `status` `UPLOADED→EXTRACTING→REVIEW→CONFIRMED` or `FAILED`; `source` `upload`\|`url`\|`manual`; `totalCents?`, `discountCents?`, `rawExtraction Json?`, `extractionReasoning MediumText?`, `failureReason?`; `transactionId?` unique, SetNull                                             | `(uploadedById, status)`, `merchantId`                                      |
| `ReceiptFile`      | one stored page (multi-photo slips) | `position` 1-based, `fileRef`, `mimeType`, `sizeBytes`                                                                                                                                                                                                                                     | `@@unique([receiptId, position])`                                           |
| `ReceiptItem`      | one printed line                    | `position`, `rawName`, `barcode?` (validated GTIN), `quantity Decimal(10,3)`, `unitPriceCents?`, `discountCents`, `totalCents` (**after** the line discount), `matchStatus` `PENDING`\|`AUTO`\|`CONFIRMED`\|`SKIPPED`, `matchCandidates Json?`, `purchasedAt` denormalized from the header | `@@unique([receiptId, position])`, `(productId, purchasedAt)`, `categoryId` |
| `ReceiptUrlIntake` | anonymized log of URL fetches       | `host`, `pathTemplate` (id/token segments masked), `provider?`, `outcome`; deliberately **not** linked to a user                                                                                                                                                                           | `(host, createdAt)`                                                         |

Deleting a transaction SetNulls `Receipt.transactionId`; the receipt survives as a CONFIRMED audit
artifact. `ReceiptItem.productId` and `.categoryId` are SetNull so registry or category maintenance
can never orphan-fail a receipt.

## Products

| Model          | Purpose                                  | Key fields                                                                                                                                                                                         | Indexes / uniques                                         |
| -------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `Product`      | **global** registry shared by all users  | `barcode?` unique (GTIN-8/12/13/14, checksum-validated at the API boundary), `name`, `normalizedName`, `brand?`, `defaultCategoryId?`, `offCheckedAt?` (null = never swept)                        | `normalizedName`, `offCheckedAt`                          |
| `ProductImage` | up to `PRODUCT_IMAGE_MAX_COUNT` pictures | `position` 1 = primary, `baseRef` server-minted stem `yyyy/mm/uuid`; renditions are `<base>.{webp,avif,thumb.webp,thumb.avif}` under `PRODUCT_IMAGE_STORAGE_DIR`; rows immutable except `position` | `@@unique([productId, position])`                         |
| `ProductAlias` | multi-language spellings                 | `name`, `normalizedName`, `locale?`, `source` (`confirmation`\|`manual`\|`extraction`\|`off`), `confirmationCount`                                                                                 | `@@unique([productId, normalizedName])`, `normalizedName` |

The registry never records who bought what — private purchase data stays on `receipt_items`.

## Budgets and ops

| Model              | Purpose               | Key fields                                                                                                                                                                                                                                                                                | Indexes / uniques                                                                |
| ------------------ | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `Budget`           | spending target       | `amountCents`, `currency`, `scopeType` `personal`\|`group` with exactly one of `ownerId`/`groupId`, `categoryId?` (SetNull), `period` `WEEKLY`\|`MONTHLY`\|`QUARTERLY`\|`YEARLY`\|`CUSTOM`, `startsAt`/`endsAt` (CUSTOM only), `alertThresholdPct?` 1–100, `alertOverspend`, `archivedAt` | `(ownerId,scopeType,archivedAt)`, `(groupId,scopeType,archivedAt)`, `categoryId` |
| `BudgetAlertEvent` | alert dedup + history | `kind` `BUDGET_THRESHOLD`\|`BUDGET_OVERSPENT`\|`TRANSACTION_DUE`, `periodKey` (`yyyy-mm-dd`), `details Json?`                                                                                                                                                                             | `@@unique([kind, budgetId, transactionId, periodKey])`, `(budgetId, createdAt)`  |

**Drift, must fix before alerts ship**: `docs/phase-10-budgets-design.md` §schema replaces that
composite unique with a single `dedupKey String @unique` and explains why — MariaDB/MySQL treat NULLs
as distinct in a unique index, and every alert row has one of `budgetId`/`transactionId` NULL, so the
composite **never fires**. The schema still has the composite; the `dedupKey` column does not exist.

## Scoping and visibility

Nothing is owned by a group directly; ownership is expressed by side tables.

- A `Transaction` is visible through its `TransactionAttribution` rows: `scopeType='personal'` with a
  `userId`, or `scopeType='group'` with a `groupId`. A transaction can carry several, so one movement
  can count for a person and a group at once.
- Group access is `GroupMembership` (`role`); the group guards are
  `apps/api/src/group/guards/group-{member,admin}.guard.ts`.
- `Category` visibility follows `(ownerType, ownerId)`: `system` (ownerId NULL, visible to everyone),
  `user`, or `group`. Uniqueness is per owner **and** direction, so IN and OUT may reuse a slug.
- `Budget` mirrors attributions with `scopeType` + exactly one of `ownerId`/`groupId`.
- `Receipt` is owned by `uploadedById`; other members reach it through the linked transaction.
- `Product`, `ProductAlias`, `ProductImage` and `Merchant` are global and unscoped by design.
- `ReceiptUrlIntake` is intentionally user-less so the log cannot profile anyone.

## JSON columns

`AuditLog.details` (event snapshot) · `OAuthProvider.metadata` (raw provider profile) ·
`Receipt.rawExtraction` (the model's structured output) · `ReceiptItem.matchCandidates`
(`[{productId,name,brand,stage,confidence}]` from the staged matcher) · `BudgetAlertEvent.details`
(`spentCents`, `pct`, `dueAt`, …). None is queried relationally — treat each as an opaque snapshot.

## Migrations

22 directories under `apps/api/prisma/migrations/`, named `<YYYYMMDDHHMMSS>_<topic>`, from
`20260314123440_phase1_auth_schema` to `20260725110000_receipt_extraction_reasoning`. Timestamps are
hand-set rather than left to `migrate dev`, which is how ordering stays deliberate when several
phases are in flight: Prisma applies directories in lexical order, so a branch that lands late must
carry a timestamp after everything already merged. Never edit an applied migration.

- **Expand then contract, always two directories** (plan §8.3, blue/green means both API versions run
  against one schema). The worked example is `product_images`:
  `20260717120000_phase8_25_product_images_expand` creates the table and backfills one row per
  product from `products.image_ref`; the code cutover ships; then
  `20260717121000_phase8_25_product_images_contract` does `ALTER TABLE products DROP COLUMN image_ref`.
- Purely additive changes are a single migration (`20260725110000_receipt_extraction_reasoning`
  adds one MEDIUMTEXT column).
- `apps/api/prisma/migrations/**/migration_lock.toml` is gitignored, so the provider lock is not
  tracked — do not rely on it in review.

## Client, seeding, regeneration

`PrismaService` (`apps/api/src/prisma/prisma.service.ts`) builds the client with the driver adapter:
`new PrismaMariaDb(DATABASE_URL)` passed as `{ adapter }` — Prisma 7 requires it, and
`schema.prisma`'s `datasource` block therefore carries no `url`. `prisma.config.ts` supplies the
connection, derives `SHADOW_DATABASE_URL` (`…/prisma_shadow`) for `migrate diff`, and sets
`seed: 'node prisma/seed.ts'` — Node 26 strips types, so the seed graph must stay erasable TS.

Regenerate/apply from the repo root: `pnpm db:generate`, `pnpm db:migrate` (dev),
`pnpm db:migrate:prod` (`migrate deploy`), `pnpm db:seed`, `pnpm db:reset`.

`prisma/seed.ts` seeds only a dev user (`dev@myfinpro.test`, no password hash) and the system
categories. Deploys run `migrate deploy` but **not** `db:seed`, so `SystemCategoriesBootstrap`
(`apps/api/src/transaction/system-categories.bootstrap.ts`) re-runs `seedSystemCategories()` on every
API boot; it is skipped when `NODE_ENV=test` and swallows its own errors so a seed failure can never
break boot. The seeder uses `findFirst` + `create`/`update` rather than `upsert` because `ownerId` is
NULL for system rows and MySQL upserts on a composite unique with a NULL member are unreliable.
Its docblock says "the 22 defaults"; `DEFAULT_CATEGORIES` in `packages/shared` now holds **25**
(18 OUT + 7 IN), as `transaction/__tests__/seed-system-categories.spec.ts` asserts — stale comment.
