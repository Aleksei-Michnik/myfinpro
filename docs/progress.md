# MyFinPro — Project Progress

> **Last updated:** 2026-07-17
> **Current work:** Phase 8 — Product Catalog, Matching & Barcode (8.1–8.22 shipped, incl. the Payment → Transaction rename, chunked extraction and multi-photo receipts) · Phase 10 — Budgets & Spending Targets (10.1 shipped, budgets API in flight)

This document is an **index**: per-phase status and a short summary, with a link to each phase's detailed progress document (`phase-<number>-progress.md`). Formatting rules for progress documentation live in [`.kilocode/rules/docs.md`](../.kilocode/rules/docs.md).

---

## Project Overview

**MyFinPro** is a personal/family finance management application spanning a web app, Telegram bot, and Telegram mini app. It supports multi-provider authentication, group management, income/expense tracking (including loans, mortgages, and installment plans), budgets, receipt ingestion, analytics, and LLM-assisted insights.

### Tech Stack

| Layer          | Technology                               |
| -------------- | ---------------------------------------- |
| Frontend (Web) | Next.js 15 + TypeScript                  |
| Frontend i18n  | next-intl                                |
| Backend API    | NestJS + TypeScript                      |
| Database       | MySQL + Prisma                           |
| Cache / Queue  | Redis + BullMQ                           |
| Telegram Bot   | grammy.js                                |
| API Docs       | @nestjs/swagger                          |
| Testing        | Jest, Vitest, Playwright, Testcontainers |
| CI/CD          | GitHub Actions                           |
| Infrastructure | Docker Compose + Nginx                   |
| Rate Limiting  | @nestjs/throttler                        |

### Architecture

- **Monorepo** managed with pnpm workspaces
- **Apps:** `api` (NestJS), `web` (Next.js), `bot` (grammy.js)
- **Packages:** `shared` (DTOs, types, constants), `eslint-config`, `tsconfig`

> **Re-plan (2026-07-03)**: Phases after 6 restructured around receipt ingestion and the product catalog — see the re-plan note in [`IMPLEMENTATION-PLAN.md`](../IMPLEMENTATION-PLAN.md) §5. Old → new numbering: Budgets 8→10, Receipts 9→7, Analytics 10→9, Bot 11→12, Mini App 12→13, Bot Receipts 13→14, Bot Analytics 14→15, LLM Assistant 15→16.

---

## Phase Index

| Phase | Name                                            | Status         | Completed  | Details                                      |
| ----- | ----------------------------------------------- | -------------- | ---------- | -------------------------------------------- |
| 0     | Foundation                                      | ✅ Complete    | 2026-02-13 | [phase-0-progress.md](phase-0-progress.md)   |
| 1     | Basic Authentication                            | ✅ Complete    | 2026-03-14 | [phase-1-progress.md](phase-1-progress.md)   |
| 2     | Google Authentication                           | ✅ Complete    | 2026-03-25 | [phase-2-progress.md](phase-2-progress.md)   |
| 3     | Telegram Authentication                         | ✅ Complete    | 2026-04-03 | [phase-3-progress.md](phase-3-progress.md)   |
| 4     | Auth Completion & Legal Pages                   | ✅ Complete    | 2026-04-12 | [phase-4-progress.md](phase-4-progress.md)   |
| 5     | Family/Group Management                         | ✅ Complete    | 2026-04-24 | [phase-5-progress.md](phase-5-progress.md)   |
| 6     | Payment Management (unified incomes + expenses) | ✅ Complete    | 2026-07-04 | [phase-6-progress.md](phase-6-progress.md)   |
| 7     | Receipt Ingestion & LLM Extraction              | ✅ Complete    | 2026-07-09 | [phase-7-progress.md](phase-7-progress.md)   |
| 8     | Product Catalog, Matching & Barcode             | 🔄 In progress | —          | [phase-8-progress.md](phase-8-progress.md)   |
| 9     | Purchase Analytics (configurable)               | ⬜ Not started | —          | —                                            |
| 10    | Budgets & Spending Targets                      | 🔄 In progress | —          | [phase-10-progress.md](phase-10-progress.md) |
| 11    | MCP Server (LLM access to purchases)            | ⬜ Not started | —          | —                                            |
| 12    | Telegram Bot                                    | ⬜ Not started | —          | —                                            |
| 13    | Telegram Mini App                               | ⬜ Not started | —          | —                                            |
| 14    | Bot Receipt Processing                          | ⬜ Not started | —          | —                                            |
| 15    | Bot Analytics                                   | ⬜ Not started | —          | —                                            |
| 16    | LLM Assistant (in-app)                          | ⬜ Not started | —          | —                                            |
| 17    | WebMCP (in-GUI agent tools)                     | ⬜ Not started | —          | —                                            |
| 18    | Centralized Search                              | ⬜ Not started | —          | —                                            |
| 19    | LLM Usage & Cost Tracking                       | ⬜ Not started | —          | —                                            |

---

## Phase Summaries

### Phase 0 — Foundation

Monorepo scaffolding (pnpm workspaces: NestJS API, Next.js web, grammy bot), shared DTOs, baseline CI and CD pipelines, automated MySQL backup strategy, observability baseline (structured logging, health checks, metrics), and rate limiting. Post-phase upgrades added blue-green deployment (shared nginx, blue/green slots, Cloudflare DNS automation) and the staging-gated testing & deployment pipeline. Details: [phase-0-progress.md](phase-0-progress.md).

### Phase 1 — Basic Authentication

Email/password authentication end to end: registration and login APIs with Argon2id hashing, JWT access tokens plus rotating refresh tokens with reuse detection, login/registration UI with password strength indicator, frontend auth context, protected routes, structured error handling, and auth rate limiting — hardened by a series of deployment fixes during rollout. Details: [phase-1-progress.md](phase-1-progress.md).

### Phase 2 — Google Authentication

Google OAuth sign-in: backend Passport strategy, endpoints, and account linking; frontend Google button and OAuth callback page. Details: [phase-2-progress.md](phase-2-progress.md).

### Phase 3 — Telegram Authentication

Telegram Login integration with HMAC-SHA256 verification, backend JWT migration, and the Connected Accounts API + UI with integration tests. Details: [phase-3-progress.md](phase-3-progress.md).

### Phase 4 — Auth Completion & Legal Pages

Email verification, password reset, account deletion with a scheduler, consolidated account settings (connected accounts, currency, timezone), Terms of Use / Privacy Policy / How-to Guide pages, registration consent + global footer, and self-hosted Haraka SMTP with DKIM signing. Post-phase iterations (4.14–4.21) fixed NPM/backup issues and delivered the prefix-free URL redesign. Details: [phase-4-progress.md](phase-4-progress.md).

### Phase 5 — Family/Group Management

Group schema and CRUD API, invite tokens with accept/join flow, group dashboard, group settings with member management, leave-group flow with audit logging review, and password change. Details: [phase-5-progress.md](phase-5-progress.md).

### Phase 6 — Payment Management

Unified `Payment` entity with a `direction` field (`IN` / `OUT`) replacing the originally separate income and expense phases. Delivered categories (system/user/group), payment CRUD with multi-scope attributions, per-user stars, comments, aggregated dashboard, per-scope payment pages with URL-synced filters, global async-operation infrastructure, BullMQ recurring schedules with lifecycle and cascade rules, SSE realtime cross-tab sync, plans + amortisation (installments, loans, mortgages), and a closing E2E/audit/i18n/dark-mode pass. Merged to main and live in production 2026-07-04. Details: [phase-6-progress.md](phase-6-progress.md).

### Phase 7 — Receipt Ingestion & LLM Extraction

Receipt intake (photo/PDF/URL) with file storage, ingestion API and BullMQ extraction worker, pluggable vision-LLM provider layer, upload/review/edit UI, confirm-receipt-to-payment flow with line items, and an SSRF guard + closing E2E/audit pass; follow-ups 7.11–7.13 added recognition fixes and payment-first intake. Details: [phase-7-progress.md](phase-7-progress.md).

### Phase 8 — Product Catalog, Matching & Barcode (in progress)

Two-layer product DB: a global barcode-keyed registry with multi-language aliases plus private per-user purchase data. Shipped so far (8.1–8.20): staged matcher, walkthrough UI, registry auto-update, camera barcode scanning, Open Food Facts enrichment, product images, catalog UI, per-user LLM selection with BYOK, receipt-intake improvements (content-based URL routing, intake chooser, manual barcode receipts, attach-to-existing transactions with LLM reconciliation, online-receipt provider adapters), accessible receipt document viewer, the transaction Documents panel with cross-member receipt access, and the end-to-end Payment → Transaction rename (DB, API, web, docs). Details: [phase-8-progress.md](phase-8-progress.md).

### Phase 10 — Budgets & Spending Targets (in progress)

Kickoff 10.1 (runs in parallel with the receipts/catalog track): shared budget types, the timezone-aware `resolvePeriod` utility, and the expand-only budgets schema (`budgets`, `budget_alert_events`). Budgets CRUD API is in flight. Details: [phase-10-progress.md](phase-10-progress.md).

---

## Documentation Index

| Document                                                                        | Description                                              |
| ------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `docs/phase-<n>-progress.md`                                                    | Per-phase progress details (linked from the index above) |
| [`docs/phase-0-design.md`](phase-0-design.md)                                   | Phase 0 architecture design decisions                    |
| [`docs/phase-0-testing-deployment-plan.md`](phase-0-testing-deployment-plan.md) | Testing & deployment pipeline plan                       |
| [`docs/phase-1-design.md`](phase-1-design.md)                                   | Phase 1 authentication architecture and design           |
| [`docs/phase-2-design.md`](phase-2-design.md)                                   | Phase 2 Google OAuth architecture and design             |
| [`docs/phase-3-design.md`](phase-3-design.md)                                   | Phase 3 Telegram authentication architecture and design  |
| [`docs/phase-4-design.md`](phase-4-design.md)                                   | Phase 4 Auth Completion & Legal Pages design             |
| [`docs/phase-4-smtp-design.md`](phase-4-smtp-design.md)                         | Phase 4 Haraka SMTP infrastructure design                |
| [`docs/post-phase-4-design.md`](post-phase-4-design.md)                         | Post-Phase 4: URL redesign, NPM fix, backup fix          |
| [`docs/phase-5-design.md`](phase-5-design.md)                                   | Phase 5 group management design                          |
| [`docs/phase-6-transactions-design.md`](phase-6-transactions-design.md)         | Phase 6 unified transaction management design            |
| [`docs/phase-6.18.1.4-rca.md`](phase-6.18.1.4-rca.md)                           | RCA: realtime SSE auth + reconnect storm                 |
| [`docs/phase-6.18.1.4-realtime-rca.md`](phase-6.18.1.4-realtime-rca.md)         | RCA: realtime cross-tab sync                             |
| [`docs/phase-7-receipts-design.md`](phase-7-receipts-design.md)                 | Phase 7 receipt ingestion & LLM extraction design        |
| [`docs/phase-8-products-design.md`](phase-8-products-design.md)                 | Phase 8 product catalog, matching & barcode design       |
| [`docs/phase-8-receipt-intake-design.md`](phase-8-receipt-intake-design.md)     | Phase 8 receipt intake design                            |
| [`docs/phase-10-budgets-design.md`](phase-10-budgets-design.md)                 | Phase 10 budgets & spending targets design               |
| [`docs/runbook-llm-extraction.md`](runbook-llm-extraction.md)                   | Runbook: LLM receipt extraction operations               |
| [`docs/deployment.md`](deployment.md)                                           | Deployment guide — full pipeline, test gating, rollback  |
| [`docs/blue-green-deployment.md`](blue-green-deployment.md)                     | Blue-green deployment architecture and procedures        |
| [`docs/backup.md`](backup.md)                                                   | Backup strategy, schedules, and restore procedures       |
| [`docs/server-setup-guide.md`](server-setup-guide.md)                           | Server provisioning guide for Ubuntu + Docker            |
| [`docs/ui-async-conventions.md`](ui-async-conventions.md)                       | UI async-operation conventions (`useAsyncOperation`)     |
| [`docs/ui-realtime-conventions.md`](ui-realtime-conventions.md)                 | UI realtime (SSE) conventions                            |
| [`IMPLEMENTATION-PLAN.md`](../IMPLEMENTATION-PLAN.md)                           | Full implementation roadmap (phases 0–19)                |
| [`SPECIFICATION-USER-STORIES.md`](../SPECIFICATION-USER-STORIES.md)             | User stories and requirements                            |
