# Phase 4 — Auth Completion & Legal Pages

| Iteration | Objective                                    | Status      |
| --------- | -------------------------------------------- | ----------- |
| 4.1       | Email service infrastructure                 | ✅ Complete |
| 4.2       | Email confirmation — backend                 | ✅ Complete |
| 4.3       | Email confirmation — frontend                | ✅ Complete |
| 4.4       | Password reset — backend                     | ✅ Complete |
| 4.5       | Password reset — frontend                    | ✅ Complete |
| 4.6       | Delete account — backend                     | ✅ Complete |
| 4.7       | Delete account — frontend                    | ✅ Complete |
| 4.7.1     | Consolidate connected accounts into settings | ✅ Complete |
| 4.7.2     | Currency & timezone settings                 | ✅ Complete |
| 4.8       | Account deletion scheduler                   | ✅ Complete |
| 4.9       | Terms of Use + Privacy Policy                | ✅ Complete |
| 4.10      | How-to Guide                                 | ✅ Complete |
| 4.11      | Consent + footer                             | ✅ Complete |
| 4.12      | Integration + E2E tests                      | ✅ Complete |
| 4.13      | Haraka SMTP infrastructure                   | ✅ Complete |

## Iteration 4.7: Delete Account — Frontend (2026-04-08)

**What was implemented:**

- Updated `User` type with `deletedAt` and `scheduledDeletionAt` nullable string fields
- Added `deleteAccount(email)` and `cancelDeletion()` methods to auth context
  - `deleteAccount` calls `POST /auth/delete-account` then logs out
  - `cancelDeletion` calls `POST /auth/cancel-deletion` then refreshes user
- Created Account Settings page at `/settings/account` (protected route)
  - Shows user info (email, name, sign-in method)
  - "Delete Account" button opens deletion confirmation dialog
  - Shows DeletionBanner when account has `scheduledDeletionAt` set
- Created `DeleteAccountDialog` component
  - Modal overlay with warning text about 30-day grace period
  - Email confirmation input — user must type their email to enable deletion
  - Loading state and error display during API call
- Created `DeletionBanner` component
  - Red warning banner shown when `scheduledDeletionAt` is set
  - Shows formatted deletion date with "Cancel Deletion" button
  - Loading state during cancellation API call
- Updated Dashboard page to show `DeletionBanner` at top when deletion is scheduled
- Added "Settings" navigation link to Header (visible when authenticated)
- Added i18n translations for `settings.account.*` namespace (13 keys in en + he)

**Key files created:**

- [`apps/web/src/components/auth/DeleteAccountDialog.tsx`](../apps/web/src/components/auth/DeleteAccountDialog.tsx) — Delete account confirmation dialog
- [`apps/web/src/components/auth/DeletionBanner.tsx`](../apps/web/src/components/auth/DeletionBanner.tsx) — Scheduled deletion warning banner
- [`apps/web/src/app/[locale]/settings/account/page.tsx`](../apps/web/src/app/[locale]/settings/account/page.tsx) — Account settings page

**Tests added:**

- [`apps/web/src/components/auth/DeleteAccountDialog.spec.tsx`](../apps/web/src/components/auth/DeleteAccountDialog.spec.tsx) — 9 tests (rendering, email validation, submit, error handling, loading state)
- [`apps/web/src/components/auth/DeletionBanner.spec.tsx`](../apps/web/src/components/auth/DeletionBanner.spec.tsx) — 7 tests (rendering, date display, cancel flow, loading)
- [`apps/web/src/app/[locale]/settings/account/account-settings.spec.tsx`](../apps/web/src/app/[locale]/settings/account/account-settings.spec.tsx) — 7 tests (page rendering, user info, delete button, banner display)
- Updated [`apps/web/src/lib/auth/auth-context.spec.tsx`](../apps/web/src/lib/auth/auth-context.spec.tsx) — 4 new tests for `deleteAccount` and `cancelDeletion`
- Updated [`apps/web/src/components/layout/Header.spec.tsx`](../apps/web/src/components/layout/Header.spec.tsx) — 1 new test for Settings link

**Test counts:**

| Category       | Count   | Framework                |
| -------------- | ------- | ------------------------ |
| API Unit Tests | 314     | Jest                     |
| Web Unit Tests | 235     | Vitest + Testing Library |
| Shared Package | 46      | Vitest                   |
| **Total**      | **595** |                          |

**Deployment:** ✅ CI passed, staging deployed successfully (2026-04-08)

> **Detailed design**: See [`docs/phase-4-design.md`](phase-4-design.md) for the full Phase 4 design document.

## Iteration 4.7.1: Consolidate Connected Accounts into Account Settings (2026-04-08)

**What was implemented:**

- Moved `ConnectedAccounts` component from its separate page (`/settings/connected-accounts`) into the Account Settings page (`/settings/account`)
- Connected Accounts now renders as a section between "Account Information" and "Delete Account" with consistent card styling
- Removed the separate `/settings/connected-accounts` page
- Removed "Connected Accounts" nav link from the Header — only "Settings" link remains
- Updated Header tests to verify the connected accounts link is no longer present
- Added test for ConnectedAccounts section rendering on the account settings page

**Key files changed:**

- [`apps/web/src/app/[locale]/settings/account/page.tsx`](../apps/web/src/app/[locale]/settings/account/page.tsx) — Added ConnectedAccounts section
- [`apps/web/src/components/layout/Header.tsx`](../apps/web/src/components/layout/Header.tsx) — Removed Connected Accounts nav link
- Deleted `apps/web/src/app/[locale]/settings/connected-accounts/page.tsx`

**Tests updated:**

- [`apps/web/src/components/layout/Header.spec.tsx`](../apps/web/src/components/layout/Header.spec.tsx) — Updated test: verifies no separate connected accounts link (19 tests)
- [`apps/web/src/app/[locale]/settings/account/account-settings.spec.tsx`](../apps/web/src/app/[locale]/settings/account/account-settings.spec.tsx) — Added test for connected accounts section (8 tests)

**Test counts:**

| Category       | Count   | Framework                |
| -------------- | ------- | ------------------------ |
| API Unit Tests | 314     | Jest                     |
| Web Unit Tests | 236     | Vitest + Testing Library |
| Shared Package | 46      | Vitest                   |
| **Total**      | **596** |                          |

**Deployment:** ✅ CI passed, staging deployed successfully (2026-04-08)

## Iteration 4.7.2: Currency & Timezone Settings (2026-04-08)

**What was implemented:**

**Backend:**

- Created [`UpdateProfileDto`](../apps/api/src/auth/dto/update-profile.dto.ts) with validation for currency (from `CURRENCY_CODES`) and timezone (string)
- Added `PATCH /auth/profile` endpoint to [`auth.controller.ts`](../apps/api/src/auth/auth.controller.ts:173) — updates user preferences (currency, timezone)
- Added [`updateProfile()`](../apps/api/src/auth/auth.service.ts:520) method to AuthService — conditionally updates fields, returns fresh user data via `getUser()`
- Added `timezone` field to login, register, and refresh token response objects across all three methods in AuthService

**Frontend:**

- Added `timezone` field to [`User`](../apps/web/src/lib/auth/types.ts:7) type
- Added [`updateProfile()`](../apps/web/src/lib/auth/auth-context.tsx:232) method to auth context — calls `PATCH /auth/profile` and updates user state
- Added Preferences section to [`AccountSettingsPage`](../apps/web/src/app/[locale]/settings/account/page.tsx:85) with:
  - Currency dropdown populated from `@myfinpro/shared` `CURRENCIES` registry (10 currencies)
  - Timezone dropdown populated from `Intl.supportedValuesOf('timeZone')` with UTC fallback
  - Save button with loading state
  - Success/error toast notifications
- Added i18n translations (6 keys each in [`en.json`](../apps/web/messages/en.json:144) and [`he.json`](../apps/web/messages/he.json:144))

**Tests added:**

- [`auth.service.spec.ts`](../apps/api/src/auth/auth.service.spec.ts) — 4 new tests for `updateProfile()` (currency, timezone, both, empty DTO) + updated login/refresh response assertions to include `timezone`
- [`auth.controller.spec.ts`](../apps/api/src/auth/auth.controller.spec.ts) — 3 new tests for `PATCH /auth/profile` endpoint (update, empty body, rate limiting metadata)
- [`auth-context.spec.tsx`](../apps/web/src/lib/auth/auth-context.spec.tsx) — 2 new tests for `updateProfile()` (success + API error)
- [`account-settings.spec.tsx`](../apps/web/src/app/[locale]/settings/account/account-settings.spec.tsx) — 3 new tests (preferences section rendering, save button, success/error toasts)

**Test counts:**

| Category       | Count   | Framework                |
| -------------- | ------- | ------------------------ |
| API Unit Tests | 321     | Jest                     |
| Web Unit Tests | 243     | Vitest + Testing Library |
| Shared Package | 46      | Vitest                   |
| **Total**      | **610** |                          |

**Deployment:** ✅ CI passed, staging deployed successfully (2026-04-08)

## Iteration 4.8: Account Deletion Scheduler (2026-04-08)

**What was implemented:**

- Installed [`@nestjs/schedule@6.1.1`](../apps/api/package.json) (latest) for cron job support
- Upgraded `@nestjs/common` and `@nestjs/core` to `11.1.18` (latest)
- Registered [`ScheduleModule.forRoot()`](../apps/api/src/app.module.ts:22) in AppModule
- Created [`AccountCleanupService`](../apps/api/src/auth/services/account-cleanup.service.ts) with:
  - Daily cron job at 3:00 AM (`@Cron(CronExpression.EVERY_DAY_AT_3AM)`)
  - Finds users where `deletedAt` is older than 30 days (grace period expired)
  - Transaction-based hard deletion of all related records: `OAuthProvider`, `RefreshToken`, `EmailVerificationToken`, `PasswordResetToken`, then `User`
  - Graceful error handling — catches and logs errors without crashing
  - Structured logging with account IDs for audit trail
- Registered `AccountCleanupService` in [`AuthModule`](../apps/api/src/auth/auth.module.ts:49) as a provider

**Key files created/modified:**

- [`apps/api/src/auth/services/account-cleanup.service.ts`](../apps/api/src/auth/services/account-cleanup.service.ts) — New scheduled cleanup service
- [`apps/api/src/auth/services/account-cleanup.service.spec.ts`](../apps/api/src/auth/services/account-cleanup.service.spec.ts) — 11 comprehensive tests
- [`apps/api/src/app.module.ts`](../apps/api/src/app.module.ts) — Added `ScheduleModule.forRoot()`
- [`apps/api/src/auth/auth.module.ts`](../apps/api/src/auth/auth.module.ts) — Registered `AccountCleanupService`
- [`apps/api/package.json`](../apps/api/package.json) — Added `@nestjs/schedule`, upgraded NestJS packages

**Tests added:**

- [`apps/api/src/auth/services/account-cleanup.service.spec.ts`](../apps/api/src/auth/services/account-cleanup.service.spec.ts) — 11 tests:
  - Skip cleanup when no expired accounts found
  - Find and delete accounts older than 30 days
  - Delete related records in correct order within transaction
  - Pass correct user IDs to delete operations
  - NOT delete recently soft-deleted accounts (within 30-day window)
  - Handle database errors gracefully without crashing
  - Handle transaction errors gracefully without crashing
  - Use correct cutoff date (30 days ago)
  - Handle single expired account correctly
  - Handle non-Error objects in catch block

**Test counts:**

| Category       | Count   | Framework                |
| -------------- | ------- | ------------------------ |
| API Unit Tests | 332     | Jest                     |
| Web Unit Tests | 243     | Vitest + Testing Library |
| Shared Package | 46      | Vitest                   |
| **Total**      | **621** |                          |

**CI Run:** `24150900153` ✅ | **Deploy Staging Run:** `24150900162` ✅

**Deployment:** ✅ CI passed, staging deployed successfully (2026-04-08)

## Iteration 4.9: Terms of Use + Privacy Policy Pages (2026-04-08)

**What was implemented:**

- Created `/legal/terms` route — server component page with structured Terms of Use content
- Created `/legal/privacy` route — server component page with structured Privacy Policy content
- Both pages use `getTranslations` from `next-intl/server` (async server components)
- Created [`LegalLayout`](../apps/web/src/app/[locale]/legal/layout.tsx) wrapper with consistent padding and max-width
- Content styled with manual Tailwind classes (no `@tailwindcss/typography` — Tailwind v4)
- Cross-links between Terms and Privacy pages using `next-intl` rich text with `Link` component
- "Back to Home" link on both pages
- Full bilingual content (English + Hebrew) covering all required legal sections
- RTL support inherited from locale layout

**Terms of Use sections:** Acceptance of Terms, Description of Service, Account Registration & Security, User Responsibilities, Data & Content Ownership, Limitation of Liability, Modifications to Terms, Contact Information

**Privacy Policy sections:** Information We Collect, How We Use Your Information, Data Storage & Security, Third-Party Services (Google OAuth, Telegram Login), Cookies & Local Storage (JWT handling), Data Retention & Deletion (30-day grace period), Your Rights, Children's Privacy, Changes to Privacy Policy, Contact Information

**Key files created:**

- [`apps/web/src/app/[locale]/legal/layout.tsx`](../apps/web/src/app/[locale]/legal/layout.tsx) — Legal pages layout wrapper
- [`apps/web/src/app/[locale]/legal/terms/page.tsx`](../apps/web/src/app/[locale]/legal/terms/page.tsx) — Terms of Use page (server component)
- [`apps/web/src/app/[locale]/legal/privacy/page.tsx`](../apps/web/src/app/[locale]/legal/privacy/page.tsx) — Privacy Policy page (server component)
- [`apps/web/src/app/[locale]/legal/terms/terms.spec.tsx`](../apps/web/src/app/[locale]/legal/terms/terms.spec.tsx) — Terms page tests
- [`apps/web/src/app/[locale]/legal/privacy/privacy.spec.tsx`](../apps/web/src/app/[locale]/legal/privacy/privacy.spec.tsx) — Privacy page tests

**Files modified:**

- [`apps/web/messages/en.json`](../apps/web/messages/en.json) — Added `legal` namespace with terms + privacy sections
- [`apps/web/messages/he.json`](../apps/web/messages/he.json) — Added Hebrew `legal` translations

**Tests added:**

- [`terms.spec.tsx`](../apps/web/src/app/[locale]/legal/terms/terms.spec.tsx) — 5 tests (title, last updated, all 8 section headings, privacy link, back to home link)
- [`privacy.spec.tsx`](../apps/web/src/app/[locale]/legal/privacy/privacy.spec.tsx) — 5 tests (title, last updated, all 10 section headings, terms link, back to home link)
- Uses `vi.hoisted()` pattern for mock availability in hoisted `vi.mock()` calls

**Test counts:**

| Category       | Count   | Framework                |
| -------------- | ------- | ------------------------ |
| API Unit Tests | 332     | Jest                     |
| Web Unit Tests | 253     | Vitest + Testing Library |
| Shared Package | 46      | Vitest                   |
| **Total**      | **631** |                          |

**CI Run:** `24158484682` ✅ | **Deploy Staging Run:** `24158484680` ✅

**Deployment:** ✅ CI passed, staging deployed successfully (2026-04-08)

**Routes accessible:**

- `/en/legal/terms` — English Terms of Use
- `/en/legal/privacy` — English Privacy Policy
- `/he/legal/terms` — Hebrew Terms of Use (RTL)
- `/he/legal/privacy` — Hebrew Privacy Policy (RTL)

## Iteration 4.9 Hotfix: Legal Pages Crash Fix + Dark Theme (2026-04-09)

**What was fixed:**

- Fixed legal pages crash caused by using `{variable}` ICU syntax inside `t.rich()` in server components — function references can't be serialized across the RSC→Client Component boundary
- Switched to `<tag>content</tag>` syntax for rich text in translations
- Added dark theme support (`dark:` Tailwind classes) to all legal page components

**CI Run:** `24187121578` ✅

## Iteration 4.10: How-to Guide Help Page (2026-04-09)

**What was implemented:**

- Created `/help` route — server component page with comprehensive getting-started guide
- 6 main sections: Getting Started, Managing Your Account, Using the Dashboard, Settings & Preferences, Security Tips, Getting Help
- 14 subsections covering account creation, email verification, login, account settings, social accounts, account deletion, dashboard overview, currency, timezone, language, passwords, security, forgot password, and contact/support
- Added Help link to Header navigation (visible to all users, both authenticated and unauthenticated)
- Server component using `getTranslations` from `next-intl/server`
- Rich text link for forgot-password using `<tag>content</tag>` syntax (safe for RSC)
- Dark theme support with `dark:` Tailwind classes throughout
- Responsive design with card-style subsection layout (bordered cards with rounded corners)
- Full bilingual content (English + Hebrew) with RTL support

**Key files created:**

- [`apps/web/src/app/[locale]/help/layout.tsx`](../apps/web/src/app/[locale]/help/layout.tsx) — Help pages layout wrapper
- [`apps/web/src/app/[locale]/help/page.tsx`](../apps/web/src/app/[locale]/help/page.tsx) — How-to Guide page (server component)
- [`apps/web/src/app/[locale]/help/help.spec.tsx`](../apps/web/src/app/[locale]/help/help.spec.tsx) — Help page tests (7 tests)

**Files modified:**

- [`apps/web/messages/en.json`](../apps/web/messages/en.json) — Added `help` namespace + `nav.help` key
- [`apps/web/messages/he.json`](../apps/web/messages/he.json) — Added Hebrew `help` namespace + `nav.help` key
- [`apps/web/src/components/layout/Header.tsx`](../apps/web/src/components/layout/Header.tsx) — Added Help navigation link
- [`apps/web/src/components/layout/Header.spec.tsx`](../apps/web/src/components/layout/Header.spec.tsx) — Added test for Help link

**Tests added:**

- [`help.spec.tsx`](../apps/web/src/app/[locale]/help/help.spec.tsx) — 7 tests (main title, subtitle, 6 section headings, 14 subsection headings, forgot password link, back to home link, renders without crashing)
- [`Header.spec.tsx`](../apps/web/src/components/layout/Header.spec.tsx) — 1 new test (help link present with correct href)

**Test counts:**

| Category       | Count   | Framework                |
| -------------- | ------- | ------------------------ |
| API Unit Tests | 332     | Jest                     |
| Web Unit Tests | 261     | Vitest + Testing Library |
| Shared Package | 46      | Vitest                   |
| **Total**      | **639** |                          |

**CI Run:** `24191198081` ✅ | **Deploy Staging Run:** `24191198100` ✅

**Deployment:** ✅ CI passed, staging deployed successfully (2026-04-09)

**Routes accessible:**

- `/en/help` — English How-to Guide
- `/he/help` — Hebrew How-to Guide (RTL)

## Iteration 4.11: Registration Consent Checkbox + Global Footer (2026-04-09)

**What was implemented:**

**Part 1 — Registration Consent Checkbox:**

- Added consent checkbox to [`RegisterForm.tsx`](../apps/web/src/components/auth/RegisterForm.tsx) below password fields, above submit button
- Checkbox label uses `t.rich()` with `<terms>` and `<privacy>` tags linking to `/legal/terms` and `/legal/privacy`
- Submit button is disabled until consent checkbox is checked (in addition to existing empty-fields check)
- Form validation: consent must be checked to submit — shows error message if attempting to submit without consent
- Links use Next.js `Link` component from `next-intl` navigation (same-tab navigation)
- Dark theme support with `dark:` Tailwind classes on checkbox and label

**Part 2 — Global Footer:**

- Created [`Footer.tsx`](../apps/web/src/components/layout/Footer.tsx) client component using `useTranslations('footer')`
- Horizontal navigation links: Terms of Use, Privacy Policy, Help (separated by `|` dividers on desktop)
- Dynamic copyright text with `{year}` placeholder (`t('copyright', { year })`)
- Responsive layout — links wrap on mobile, flex-wrap with gap
- Subtle styling: smaller text, muted gray colors, border-top separator
- Dark theme support throughout
- Added Footer to [`locale layout`](../apps/web/src/app/[locale]/layout.tsx) below ErrorBoundary children (appears on every page)

**Translation keys added:**

- `auth.consentLabel` — Rich text with `<terms>` and `<privacy>` tag placeholders (en + he)
- `auth.consentRequired` — Validation error message (en + he)
- `footer.terms`, `footer.privacy`, `footer.help`, `footer.copyright` — Footer navigation and copyright (en + he)

**Key files created:**

- [`apps/web/src/components/layout/Footer.tsx`](../apps/web/src/components/layout/Footer.tsx) — Global footer component
- [`apps/web/src/components/layout/Footer.spec.tsx`](../apps/web/src/components/layout/Footer.spec.tsx) — Footer tests (6 tests)

**Key files modified:**

- [`apps/web/src/components/auth/RegisterForm.tsx`](../apps/web/src/components/auth/RegisterForm.tsx) — Added consent checkbox with rich text labels
- [`apps/web/src/components/auth/RegisterForm.spec.tsx`](../apps/web/src/components/auth/RegisterForm.spec.tsx) — Added 5 consent tests + updated existing tests for consent flow
- [`apps/web/src/app/[locale]/layout.tsx`](../apps/web/src/app/[locale]/layout.tsx) — Added Footer import and rendering
- [`apps/web/messages/en.json`](../apps/web/messages/en.json) — Added auth consent + footer translations
- [`apps/web/messages/he.json`](../apps/web/messages/he.json) — Added Hebrew auth consent + footer translations

**Tests added/updated:**

- [`Footer.spec.tsx`](../apps/web/src/components/layout/Footer.spec.tsx) — 6 tests (footer element, copyright text, terms/privacy/help links with correct hrefs, navigation element)
- [`RegisterForm.spec.tsx`](../apps/web/src/components/auth/RegisterForm.spec.tsx) — 5 new consent tests (checkbox rendered, disabled without consent, enabled with consent, submit with consent, consent link hrefs) + updated 3 existing tests to include consent checkbox click

**Test counts:**

| Category       | Count   | Framework                |
| -------------- | ------- | ------------------------ |
| API Unit Tests | 332     | Jest                     |
| Web Unit Tests | 272     | Vitest + Testing Library |
| Shared Package | 46      | Vitest                   |
| **Total**      | **650** |                          |

**CI Run:** `24192569435` ✅

**Deployment:** ✅ CI passed, staging deployed successfully (2026-04-09)

## Iteration 4.12: Integration + E2E Tests for Phase 4 (2026-04-09)

**What was implemented:**

Comprehensive integration tests (API) and E2E Playwright tests (web) covering all Phase 4 features, split into logically grouped files for clear naming and organization.

**API Integration Tests (4 spec files + shared helpers):**

- [`helpers.ts`](../apps/api/test/integration/helpers.ts) — Shared `bootstrapTestApp()`, `registerUser()`, `loginUser()`, `hashToken()` helpers
- [`email-verification.integration.spec.ts`](../apps/api/test/integration/email-verification.integration.spec.ts) — 7 tests: token creation on register, verify with valid/invalid/empty token, resend verification, already verified user, no auth
- [`password-reset.integration.spec.ts`](../apps/api/test/integration/password-reset.integration.spec.ts) — 9 tests: forgot-password generic message, token creation in DB, reset with valid/invalid/expired/used tokens, old password fails after reset, invalid email format
- [`account-deletion.integration.spec.ts`](../apps/api/test/integration/account-deletion.integration.spec.ts) — 7 tests: soft-delete, wrong confirmation, cancel deletion, cancel for active account, login-based reactivation, expired grace period
- [`profile-update.integration.spec.ts`](../apps/api/test/integration/profile-update.integration.spec.ts) — 8 tests: currency, timezone, both, invalid currency, empty body, no auth, persistence in login/me responses

**Playwright E2E Tests (3 spec files):**

- [`legal-pages.spec.ts`](../apps/web/e2e/legal-pages.spec.ts) — 8 tests: terms/privacy rendering, cross-links, Hebrew/RTL, non-empty content
- [`help-page.spec.ts`](../apps/web/e2e/help-page.spec.ts) — 5 tests: guide title, section headings, Hebrew/RTL, non-empty content
- [`registration-consent.spec.ts`](../apps/web/e2e/registration-consent.spec.ts) — 5 tests: checkbox presence, disabled without consent, terms/privacy links, link navigation

**Staging E2E Tests (4 spec files):**

- [`legal-pages.staging.spec.ts`](../apps/web/e2e/staging/legal-pages.staging.spec.ts) — 4 tests: terms/privacy accessibility and cross-links
- [`help-page.staging.spec.ts`](../apps/web/e2e/staging/help-page.staging.spec.ts) — 2 tests: guide rendering and section headings
- [`footer.staging.spec.ts`](../apps/web/e2e/staging/footer.staging.spec.ts) — 3 tests: presence, links, copyright
- [`registration-consent.staging.spec.ts`](../apps/web/e2e/staging/registration-consent.staging.spec.ts) — 2 tests: checkbox and consent links

**Test counts:**

| Category              | Count   | Framework                |
| --------------------- | ------- | ------------------------ |
| API Unit Tests        | 332     | Jest                     |
| API Integration Tests | 31      | Jest + Supertest         |
| Web Unit Tests        | 272     | Vitest + Testing Library |
| Web E2E Tests         | 18      | Playwright               |
| Web Staging E2E Tests | 11      | Playwright               |
| Shared Package        | 46      | Vitest                   |
| **Total**             | **710** |                          |

**CI Run:** `24194477791` ✅

**Deployment:** ✅ CI passed (2026-04-09). Playwright E2E tests run in CI only.

## Iteration 4.13: Haraka SMTP Infrastructure (2026-04-10)

### Env Var Deduplication (2026-04-10)

**What was implemented:**

Refactored all Haraka SMTP environment variables to derive from existing secrets (DRY principle), eliminating the need for redundant GitHub Secrets like `STAGING_HARAKA_MAIL_DOMAIN`, `PRODUCTION_HARAKA_MAIL_HOSTNAME`, `STAGING_SMTP_FROM`, etc.

**Derivation rules (from `SERVER_NAME`, which comes from `CLOUDFLARE_*_SUBDOMAIN`):**

- `HARAKA_MAIL_DOMAIN` = `${SERVER_NAME}` (same value)
- `HARAKA_MAIL_HOSTNAME` = derived by [`entrypoint.sh`](../infrastructure/haraka/entrypoint.sh:8) as `mail.${HARAKA_MAIL_DOMAIN}`
- `SMTP_FROM` = `MyFinPro <noreply@${SERVER_NAME}>` (derived in Docker Compose)
- `SMTP_HOST` = `haraka` (static: Docker service name)
- `SMTP_PORT` = `25` (static: internal SMTP)
- `SMTP_SECURE` = `false` (static: internal network)

**Removed redundant vars:** `SMTP_USER`, `SMTP_PASS` (not needed for internal Haraka relay), `HARAKA_MAIL_HOSTNAME` env var (auto-derived by entrypoint).

**Files changed (8 files):**

- [`docker-compose.staging.infra.yml`](../docker-compose.staging.infra.yml) — Haraka: `HARAKA_MAIL_DOMAIN: ${SERVER_NAME}`
- [`docker-compose.production.infra.yml`](../docker-compose.production.infra.yml) — Same
- [`docker-compose.staging.app.yml`](../docker-compose.staging.app.yml) — API: static SMTP + derived `SMTP_FROM`
- [`docker-compose.production.app.yml`](../docker-compose.production.app.yml) — Same
- [`docker-compose.staging.yml`](../docker-compose.staging.yml) — Standalone: both Haraka + API changes
- [`docker-compose.production.yml`](../docker-compose.production.yml) — Same
- [`.env.staging.template`](../.env.staging.template) — Documentation updated
- [`.env.production.template`](../.env.production.template) — Documentation updated

**CI/CD workflows:** No changes needed — `SERVER_NAME` already exported by both staging and production deploy workflows.

**Only genuinely new secret needed:** `DKIM_PRIVATE_KEY` (actual cryptographic key, can't be derived).

**Tests:** All existing tests pass (332 API unit + 272 web unit). No test changes needed — this is infrastructure-only.

## Phase 4 Production Merge

- **Date**: April 9, 2026
- **Merged**: develop → main
- **Merge Commit**: `ad84f6e`
- **CI Run**: `24195385169` (Deploy Production)
- **Status**: ✅ Deployed to production
- **Features**:
  - Email verification (backend + frontend)
  - Password reset (backend + frontend)
  - Account deletion with 30-day grace period (backend + frontend + scheduler)
  - Account settings page (connected accounts, currency, timezone preferences)
  - Terms of Use and Privacy Policy pages (bilingual EN/HE)
  - How-to Guide help page
  - Registration consent checkbox
  - Global footer with legal/help links
  - Comprehensive integration and E2E tests
- **Iterations**: 4.1–4.12 (15 iterations including 4.7.1, 4.7.2)
- **Total tests**: 710 (332 API unit + 31 integration + 272 web unit + 18 E2E + 11 staging E2E + 46 shared)

## Haraka SMTP Email Delivery Fix (2026-04-11)

**Problem:** Emails sent via Haraka on staging never arrived. Multiple layered issues discovered and fixed.

**Root causes & fixes (5 commits):**

1. **Missing relay plugin** (`e0ea13b`) — Haraka rejected all outbound mail with `550 I cannot deliver mail` because `connection.relaying` was never set. Added `relay` plugin to [`infrastructure/haraka/config/plugins`](../infrastructure/haraka/config/plugins) and created [`relay_acl_allow`](../infrastructure/haraka/config/relay_acl_allow) with Docker network CIDRs.

2. **Nodemailer auth with empty credentials** (`e0ea13b`) — Nodemailer always included `auth: { user: '', pass: '' }` even for internal Haraka relay. Fixed [`mail.service.ts`](../apps/api/src/mail/mail.service.ts:28) to only include auth when `SMTP_USER` is set.

3. **Node.js 24 incompatibility** (`d5870b8`) — Downgraded Haraka Dockerfile from `node:24-alpine` to `node:22-alpine` for stability.

4. **DKIM pipe crash** (`c29e3f1`) — Both `haraka-plugin-dkim` and built-in `dkim_sign` caused `Error: Cannot pipe while currently piping` in `haraka-message-stream`. DKIM temporarily disabled.

5. **Wrong sender domain** (`2b23b10`) — `SMTP_FROM` used `${SERVER_NAME}` which on staging was `stage-myfin.michnik.pro` (no SPF record). Gmail rejected with `550 5.7.26 unauthenticated sender`. Introduced `MAIL_DOMAIN` env var (always production domain) for `SMTP_FROM` and `HARAKA_MAIL_DOMAIN` in all compose files and deploy workflows.

**Verification:** Test email successfully delivered to Gmail via TLS 1.3 with `response="OK"` from `gmail-smtp-in.l.google.com`. Email lands in spam (expected without DKIM).

**Files changed (across 5 commits):**

- [`infrastructure/haraka/config/plugins`](../infrastructure/haraka/config/plugins) — Added relay, disabled dkim_sign
- [`infrastructure/haraka/config/relay_acl_allow`](../infrastructure/haraka/config/relay_acl_allow) — New: Docker network CIDRs
- [`infrastructure/haraka/Dockerfile`](../infrastructure/haraka/Dockerfile) — Node 22, removed haraka-plugin-dkim
- [`infrastructure/haraka/entrypoint.sh`](../infrastructure/haraka/entrypoint.sh) — dkim_sign.ini config
- [`apps/api/src/mail/mail.service.ts`](../apps/api/src/mail/mail.service.ts) — Conditional auth
- [`apps/api/src/mail/mail.service.spec.ts`](../apps/api/src/mail/mail.service.spec.ts) — Test for no-auth
- All 6 Docker Compose files — `MAIL_DOMAIN` instead of `SERVER_NAME` for mail
- Both deploy workflows — Added `MAIL_DOMAIN` env var
- Both `.env.*.template` files — Updated documentation

## DKIM Signing via Nodemailer (2026-04-11)

**Problem:** Haraka's DKIM plugins (`haraka-plugin-dkim` and built-in `dkim_sign`) both crash with `Error: Cannot pipe while currently piping` in `haraka-message-stream`. This is a known upstream issue.

**Solution:** Move DKIM signing from Haraka to Nodemailer. Nodemailer has built-in DKIM support that signs messages before handing them to the SMTP transport.

**Implementation:**

- Add DKIM configuration to [`mail.service.ts`](../apps/api/src/mail/mail.service.ts) when `DKIM_PRIVATE_KEY` env var is set
- Extract domain from `SMTP_FROM` for DKIM `domainName` (reuses existing env var, DRY)
- Selector `mail` matches the DNS TXT record (`mail._domainkey`)
- 2048-bit RSA key pair (private key in `DKIM_PRIVATE_KEY` secret, public key in DNS)
- Pass `DKIM_PRIVATE_KEY` to API containers in Docker Compose files
- Export `DKIM_PRIVATE_KEY` in deploy workflows for docker-compose
- Remove DKIM plugins from Haraka (now relay-only)
- SPF, DKIM, DMARC DNS records all configured and passing

**Verification:** Email delivered to Gmail with `dkim=pass`, `spf=pass`, `dmarc=pass` — lands in inbox (not spam).

**Files changed:**

- [`apps/api/src/mail/mail.service.ts`](../apps/api/src/mail/mail.service.ts) — DKIM config from env vars
- [`apps/api/src/mail/mail.service.spec.ts`](../apps/api/src/mail/mail.service.spec.ts) — DKIM configuration tests
- [`apps/api/.env.example`](../apps/api/.env.example) — Added `DKIM_PRIVATE_KEY`
- [`infrastructure/haraka/config/plugins`](../infrastructure/haraka/config/plugins) — Removed DKIM plugins
- [`docker-compose.staging.app.yml`](../docker-compose.staging.app.yml) — `DKIM_PRIVATE_KEY` to API
- [`docker-compose.production.app.yml`](../docker-compose.production.app.yml) — Same
- [`docker-compose.staging.yml`](../docker-compose.staging.yml) — Same
- [`docker-compose.production.yml`](../docker-compose.production.yml) — Same
- Both deploy workflows — Export `DKIM_PRIVATE_KEY`

## Email Verification Race Condition Fix (2026-04-11)

**Problem:** The verify-email page's `useEffect` had `refreshUser` in its dependency array. When `AuthProvider`'s silent refresh updated `accessToken`, `refreshUser` got a new identity (function reference), causing the `useEffect` to fire twice. The first API call succeeded (200), consuming the token, then the second API call failed (400 — token already used), overwriting the success state with "invalid".

**Fixes:**

1. **useRef guard** — Added a `hasVerified` ref to prevent duplicate verification API calls
2. **Dependency cleanup** — Removed `refreshUser` from useEffect dependency array (only `token` needed)
3. **Error code mismatch** — Fixed error code strings to match backend `AUTH_ERRORS` constants:
   - `EMAIL_VERIFICATION_EXPIRED` → `AUTH_VERIFICATION_TOKEN_EXPIRED`
   - `EMAIL_ALREADY_VERIFIED` → `AUTH_EMAIL_ALREADY_VERIFIED`
4. **Token-used handling** — Handle `AUTH_VERIFICATION_TOKEN_USED` as already-verified state (show success, not error)

**Files changed:**

- [`apps/web/src/app/[locale]/auth/verify-email/page.tsx`](../apps/web/src/app/[locale]/auth/verify-email/page.tsx) — useRef guard, dependency fix, error codes
- [`apps/web/src/app/[locale]/auth/verify-email/verify-email.spec.tsx`](../apps/web/src/app/[locale]/auth/verify-email/verify-email.spec.tsx) — Tests for token-used and already-verified error codes

## Phase 4 Final Production Merge (2026-04-11)

- **Date**: April 11, 2026
- **Merged**: develop → main
- **Includes**: Iteration 4.13 (Haraka SMTP with DKIM via Nodemailer) + email verification race condition fix
- **Phase 4 fully complete**: all 15 iterations (4.1–4.13, including 4.7.1, 4.7.2)
- **Features delivered in Phase 4**:
  - Email verification (backend + frontend)
  - Password reset (backend + frontend)
  - Account deletion with 30-day grace period (backend + frontend + scheduler)
  - Account settings page (connected accounts, currency, timezone preferences)
  - Terms of Use and Privacy Policy pages (bilingual EN/HE)
  - How-to Guide help page
  - Registration consent checkbox
  - Global footer with legal/help links
  - Self-hosted Haraka SMTP server (relay-only mode in Docker)
  - DKIM signing via Nodemailer (2048-bit RSA, selector `mail`)
  - SPF, DKIM, DMARC DNS records configured and passing
  - All env vars derived from existing secrets (DRY)
  - Email verification race condition fix (useRef guard)
  - Comprehensive integration and E2E tests

## Post-Phase 4 Fix: Consolidate FRONTEND_URL to SERVER_NAME (2026-04-12)

- **Date**: April 12, 2026
- **Commit**: `c072f85` (develop), merged to main
- **Production deploy**: CI run `24311815361` — success

**Problem**: Email links (verify, reset, cancel-deletion) and Google OAuth callback redirect used a separate `FRONTEND_URL` env var. Both `FRONTEND_URL` and `SERVER_NAME` were derived from the same `CLOUDFLARE_*_SUBDOMAIN` GitHub Secret in deploy workflows.

**Fix**: Consolidated to a single variable. The API now derives the frontend base URL as `https://${SERVER_NAME}` at runtime, with `http://localhost:3000` fallback for local dev. Removed `FRONTEND_URL` from all deploy workflows, Docker Compose files, and env templates.

**Files changed (11):**

- [`apps/api/src/mail/mail.service.ts`](../apps/api/src/mail/mail.service.ts) — Read `SERVER_NAME` instead of `FRONTEND_URL`
- [`apps/api/src/auth/auth.controller.ts`](../apps/api/src/auth/auth.controller.ts) — Read `SERVER_NAME` for Google OAuth redirect
- [`apps/api/src/mail/mail.service.spec.ts`](../apps/api/src/mail/mail.service.spec.ts) — Updated test config
- [`apps/api/src/auth/auth.controller.spec.ts`](../apps/api/src/auth/auth.controller.spec.ts) — Updated test config and expectations
- [`docker-compose.production.app.yml`](../docker-compose.production.app.yml) — Pass `SERVER_NAME` to API (was `FRONTEND_URL`)
- [`docker-compose.staging.app.yml`](../docker-compose.staging.app.yml) — Pass `SERVER_NAME` to API (was `FRONTEND_URL`)
- [`.github/workflows/deploy-production.yml`](../.github/workflows/deploy-production.yml) — Removed `FRONTEND_URL` from env/envs/exports
- [`.github/workflows/deploy-staging.yml`](../.github/workflows/deploy-staging.yml) — Removed `FRONTEND_URL` from env/envs/exports
- [`apps/api/.env.example`](../apps/api/.env.example) — Updated documentation
- [`.env.production.template`](../.env.production.template) — Updated documentation
- [`.env.staging.template`](../.env.staging.template) — Updated documentation

## Post-Phase 4: Infrastructure Improvements (Before Phase 5)

Three infrastructure tasks to complete before starting Phase 5. See [`docs/post-phase-4-design.md`](post-phase-4-design.md) for the full design document.

| Iteration | Objective                                                              | Status      |
| --------- | ---------------------------------------------------------------------- | ----------- |
| 4.14      | NPM fix — delete `.npmrc` (all settings match pnpm 10 defaults)        | ✅ Complete |
| 4.15      | Backup fix — MariaDB container, Prisma schema, checkout v4             | ✅ Complete |
| 4.16      | URL redesign — backend: add `locale` to UpdateProfileDto + DRY fix     | ✅ Complete |
| 4.17      | URL redesign — i18n config: `localePrefix: 'never'`, proxy matcher     | ✅ Complete |
| 4.18      | URL redesign — locale switcher: cookie-based + login sync              | ✅ Complete |
| 4.19      | URL redesign — settings: Language dropdown + timezone auto-detect      | ✅ Complete |
| 4.20      | URL redesign — redirects: old `/en/`, `/he/` URLs + OAuth callback fix | ✅ Complete |
| 4.21      | URL redesign — tests: E2E + unit test updates for prefix-free URLs     | ✅ Complete |
