# Phase 9 — Purchase Analytics (Configurable)

Kickoff 2026-07-17. Design doc: [`phase-9-analytics-design.md`](phase-9-analytics-design.md).
Design decisions taken with the product owner: hybrid purchase-row grain, Recharts,
per-currency aggregation (no FX), nightly habit job, member = transaction creator.

## 9.1 — Aggregation engine + POST /analytics/query (2026-07-20)

Commit `506550c`. The configurable aggregation core (design §2, §5, §6):

- **Hybrid purchase rows** ([`purchase-rows.sql.ts`](../apps/api/src/analytics/engine/purchase-rows.sql.ts)):
  one CTE with three `UNION ALL` arms — item rows from `CONFIRMED` receipts,
  header rows for transactions without items, and balancing rows
  (`header − Σ items`) so totals always reconcile. Countable = `POSTED` +
  `ONE_TIME`; recurring/plan parents are templates and never count.
- **Engine** ([`analytics-engine.service.ts`](../apps/api/src/analytics/engine/analytics-engine.service.ts)):
  first `$queryRaw` in the codebase, isolated in `analytics/engine/`. Closed
  dimension allowlist (0–2 of category / merchant / product / member / group /
  scope / period + implicit currency), SQL visibility predicate mirroring
  `TransactionService.buildVisibilityWhere`, count-once vs attribution-join
  modes, per-query timezone offset for period buckets, fingerprinted offset
  cursors, batch display-name resolution.
- **Shared types** ([`analytics.types.ts`](../packages/shared/src/types/analytics.types.ts));
  `tzOffsetMs` exported from [`budget-period.ts`](../packages/shared/src/budget-period.ts) for reuse.

### Decisions & gotchas

- `GROUP BY` / `ORDER BY` reference **select aliases**, never expressions: a
  parameterized expression (the period `CONVERT_TZ` offset) repeated in
  `GROUP BY` binds a second placeholder, which `ONLY_FULL_GROUP_BY` treats as
  a different, non-grouped expression (MySQL error 1055).
- A narrowing scope **filter** stays count-once (`EXISTS`); only the
  scope/group **dimensions** fan out per attribution (design §2.3 corrected).
- Local integration runs need the MySQL `caching_sha2_password` auth cache
  warm: after a `myfinpro-mysql` container restart the mariadb driver fails
  full auth (`ER_CANNOT_RETRIEVE_RSA_KEY`, surfacing as pool timeouts) until
  one full auth happens (e.g. `mysql` CLI login). Durable fix candidates:
  `allowPublicKeyRetrieval` in the `PrismaMariaDb` config, or creating the DB
  user with `mysql_native_password`.

### Tests

24 new unit tests (fingerprint/offset, dimension map, engine validation +
mapping; api suite 1213 green) and a 14-test integration spec
([`analytics-query.integration.spec.ts`](../apps/api/test/integration/analytics-query.integration.spec.ts)):
Σ invariant, every dimension incl. balancing-row math, dual-attribution
fan-out vs count-once filters, default-currency-first ordering, month
bucketing, direction IN, cursor pagination + fingerprint mismatch, 403 on
non-member scope, per-caller visibility, template/PENDING exclusion.
