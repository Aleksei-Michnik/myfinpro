---
name: prisma-migrations
description: How schema changes are made here — Prisma 7 on MySQL 9.7 through the MariaDB driver adapter, migration naming, expand/contract for live tables, regeneration, seeding, and the rule that migrations are serialized across parallel work. Use before editing apps/api/prisma/schema.prisma, when a migration fails or drifts, or when two branches both need schema changes.
---

# Prisma migrations

Read `wiki/data-model.md` first for the models, naming (`@@map` snake_case tables, uuid ids,
soft deletes) and the domain's invariants.

## Procedure

1. Edit `apps/api/prisma/schema.prisma` following the neighbours (map names, indexes justified by
   a query, `deletedAt` where the domain soft-deletes).
2. Create the migration with a descriptive name — Prisma prefixes the timestamp:
   `pnpm --filter api exec prisma migrate dev --name phase<N>_<m>_<topic>` (existing examples:
   `phase8_25_product_images_expand`, `multi_category_transactions`). Requires the local MySQL
   (`local-stack`) at the pinned `mysql:9.7` image — a stale container produces false drift.
3. Read the generated SQL. Hand-edit only for things Prisma cannot express (data backfill,
   `ALTER … ALGORITHM=INPLACE`), and say so in the progress doc.
4. `pnpm --filter api exec prisma generate`; rebuild `packages/shared` if types moved; run the
   module's specs and the integration suite touching the table.
5. Seed data lives in `apps/api/prisma/seed.ts` and the system-categories bootstrap; keep seeds
   idempotent (upsert by stable key).

## Live tables: expand, then contract

Deploys run `prisma migrate deploy` before the new slot takes traffic while the old slot still
serves. A column or table still read by the running code is therefore **expanded** in one deploy
(add nullable column/table, dual-write) and **contracted** in a later one (drop the old path) —
see the `…_product_images_expand` / `…_contract` pair. Never rename or drop in one step.

## Rules

- Never edit a migration that has been applied anywhere; add a new one.
- Prisma applies migrations in lexical (timestamp) order and the repo's timestamps are hand-set:
  a migration created on a branch that lands after newer ones must be re-stamped to sort last.
- In parallel work only one branch holds the migration slot; the orchestrator grants it and names
  the base migration. Rebase onto it before creating yours.
- Migrations carry no environment-specific values.
- Failure in `migrate dev` with an auth or handshake error: check the container image first
  (`stack-versions`), not the credentials.
