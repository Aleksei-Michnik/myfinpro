# Phase 3 — Telegram Authentication

## Overview

Phase 3 adds Telegram as a third authentication provider. Users can sign in or register with their Telegram account via the official Telegram Login SDK popup. The implementation uses HMAC-SHA256 verification of the classic hash-based auth data.

**Key architecture decisions:**

- **Telegram Login SDK v3** (`oauth.telegram.org`) — popup-based flow with `response_type=post_message`, using `window.open` + `postMessage` listener
- **HMAC-SHA256 verification** — backend verifies hash using bot token as key (classic Telegram Login Widget approach)
- **POST-based flow** — frontend sends `{id, first_name, auth_date, hash, ...}` to `POST /api/v1/auth/telegram/callback`
- **No email from Telegram** — placeholder email `telegram_{id}@telegram.user` used
- **Two separate bots** — staging and production each have their own Telegram bot (BotFather domain restriction)
- **`NEXT_PUBLIC_TELEGRAM_BOT_ID`** — numeric bot ID derived from bot token at build time in CI/CD
- **Connected Accounts API** — `GET /connected-accounts`, `POST /link/telegram`, `DELETE /connected-accounts/:provider`
- **Safety check** — cannot unlink last auth method

**Architectural journey:** Initially planned as OIDC JWT verification (via Telegram's JWKS endpoint + `jose` library), but pivoted back to HMAC-SHA256 after discovering that the Telegram Login SDK v3 popup returns classic hash-based data (`{id, first_name, auth_date, hash}`), not an `id_token`. The SDK's `response_type=post_message` flow communicates via `postMessage` from the popup to the opener window.

## Iteration 3.1: Backend — Telegram Auth Endpoint (Initial)

**What was implemented (then updated in 3.2):**

- `POST /api/v1/auth/telegram/callback` endpoint
- `TelegramAuthDto` — initially accepted HMAC fields, updated to `{id_token}` in 3.2
- `verifyTelegramAuth()` utility — initially HMAC-SHA256, replaced with `verifyTelegramIdToken()` in 3.2
- `findOrCreateTelegramUser()` in AuthService — creates user with placeholder email
- Prisma schema already had `telegramId` field from Phase 2 migration
- Rate limiting: 5 requests/minute on telegram callback

## Iteration 3.2: Frontend + Backend JWT Migration + CI/CD

**What was implemented:**

**Backend (JWT migration):**

- Added `jose` dependency for OIDC JWT verification
- Rewrote `telegram-auth.util.ts` — `verifyTelegramIdToken()` using `createRemoteJWKSet` + `jwtVerify` against Telegram's JWKS
- Updated `TelegramAuthDto` to accept `{id_token: string}` instead of HMAC fields
- Updated `auth.controller.ts` — extracts bot ID from token, verifies JWT, builds `TelegramProfile` from claims
- CSP headers updated for `oauth.telegram.org` (scriptSrc, frameSrc, connectSrc)

**Frontend:**

- `useTelegramLogin` hook — loads Telegram Login SDK, provides `triggerLogin()` function
- Custom-styled Telegram button in LoginForm and RegisterForm (app's own `Button` component)
- `loginWithTelegram` method in AuthContext — sends `{id_token}` to backend
- Graceful fallback: disabled button when `NEXT_PUBLIC_TELEGRAM_BOT_ID` is not set
- i18n translations added (en + he): `telegramAuthFailed`, `telegramAuthSuccess`, `telegramSignIn`

**Infrastructure:**

- CI/CD workflows updated with Telegram secrets and bot ID derivation
- `web.Dockerfile` — `ARG NEXT_PUBLIC_TELEGRAM_BOT_ID` in build stage
- Docker Compose files — `TELEGRAM_BOT_TOKEN` for API service
- `.env` templates updated

**Key files created/modified:**

- [`apps/api/src/auth/utils/telegram-auth.util.ts`](../apps/api/src/auth/utils/telegram-auth.util.ts) — JWT verification via JWKS
- [`apps/api/src/auth/dto/telegram-auth.dto.ts`](../apps/api/src/auth/dto/telegram-auth.dto.ts) — `{id_token}` DTO
- [`apps/api/src/auth/auth.controller.ts`](../apps/api/src/auth/auth.controller.ts) — Telegram callback endpoint
- [`apps/web/src/components/auth/TelegramLoginButton.tsx`](../apps/web/src/components/auth/TelegramLoginButton.tsx) — `useTelegramLogin` hook
- [`apps/web/src/components/auth/LoginForm.tsx`](../apps/web/src/components/auth/LoginForm.tsx) — Telegram button integration
- [`apps/web/src/components/auth/RegisterForm.tsx`](../apps/web/src/components/auth/RegisterForm.tsx) — Telegram button integration
- [`apps/web/src/lib/auth/auth-context.tsx`](../apps/web/src/lib/auth/auth-context.tsx) — `loginWithTelegram` method

**Tests added/updated:**

- `telegram-auth.util.spec.ts` — 7 tests for JWT verification (mocked `jose`)
- `auth.controller.spec.ts` — 6 tests for telegram callback (valid token, invalid, expired, not configured, bot ID extraction)
- `TelegramLoginButton.spec.tsx` — 10 tests for `useTelegramLogin` hook
- Updated all AuthContext mock consumers to include `loginWithTelegram`

## Iteration 3.3: Backend — Connected Accounts API + HMAC-SHA256 Rewrite

**What was implemented:**

**Backend (HMAC-SHA256 rewrite):**

- Reverted from OIDC JWT (`jose` + JWKS) back to HMAC-SHA256 verification after discovering the Telegram Login SDK v3 popup returns classic hash-based data, not `id_token`
- Rewrote `telegram-auth.util.ts` — `verifyTelegramAuth()` using `createHash('sha256')` + `createHmac('sha256')` with bot token as key
- Updated `TelegramAuthDto` to accept classic HMAC fields: `{id, first_name, last_name?, username?, photo_url?, auth_date, hash}`
- Auth date freshness check (max 24h)

**Connected Accounts API:**

- `GET /auth/connected-accounts` — returns `{hasPassword, providers[]}` for authenticated user
- `POST /auth/link/telegram` — links Telegram to existing user (with conflict detection)
- `DELETE /auth/connected-accounts/:provider` — unlinks provider with safety check (cannot unlink last auth method)
- Full unit tests for all three endpoints in `auth.controller.spec.ts` and `auth.service.spec.ts`

**Frontend (popup rewrite):**

- Rewrote `useTelegramLogin` hook — removed SDK dependency, builds popup URL directly with `response_type=post_message`
- Uses `window.open` + `postMessage` listener for auth result
- Popup close detection via timer
- `buildResult()` parser for the postMessage data

**Bug fixes during staging testing:**

- `client_id` vs `bot_id` — SDK v3 `auth()` requires `client_id`, not `bot_id`, which caused a synchronous throw
- `origin` parameter — SDK popup showed "origin required" because the auth URL was missing the `origin` query param
- `post_message` flow — SDK returns auth data via `postMessage` from popup to opener, not via callback function

## Iteration 3.4: Connected Accounts UI + Integration Tests + Progress Update

**What was implemented:**

**Frontend — Connected Accounts page:**

- `ConnectedAccountsPage` at `/settings/connected-accounts` — protected route wrapping `ConnectedAccounts` component
- `ConnectedAccounts` component — fetches and displays connected auth providers:
  - Email/Password card with "Connected"/"Not set" badge
  - Google card with Connect/Disconnect actions
  - Telegram card with Connect (via popup)/Disconnect actions
- Confirmation dialog before disconnect
- Error handling: "Cannot disconnect last auth method", conflict detection, network errors
- Toast notifications for success/error
- Loading states for fetch, link, and disconnect operations

**Navigation update:**

- Header now shows "Connected Accounts" link for authenticated users (desktop)

**i18n translations:**

- Added `settings.*` namespace with 16 keys in English (`en.json`)
- Added Hebrew translations (`he.json`) for all settings keys
- Added `nav.connectedAccounts` key to both locale files

**Integration tests (`telegram-auth.integration.spec.ts`):**

- `POST /auth/telegram/callback` — 7 tests (new user, existing user, invalid hash, expired, missing fields, cookie, JWT)
- `GET /auth/connected-accounts` — 3 tests (providers list, hasPassword flag, 401 without token)
- `POST /auth/link/telegram` — 4 tests (link to user, already linked to other, same user idempotent, 401)
- `DELETE /auth/connected-accounts/:provider` — 4 tests (unlink with password, last method rejection, 401, 404)

**Component tests (`ConnectedAccounts.spec.tsx`):**

- 12 tests including: renders providers, shows Connected/Not connected, Disconnect button, confirmation dialog, API calls, last auth method error, cancel confirmation

**E2E tests (added to `auth.spec.ts`):**

- Connected accounts page redirects to login when not authenticated
- Shows page with heading when authenticated
- Shows provider cards for each auth method

**Header tests updated:**

- Added test for "Connected Accounts" link when authenticated

**Key files created:**

- [`apps/web/src/components/auth/ConnectedAccounts.tsx`](../apps/web/src/components/auth/ConnectedAccounts.tsx) — Connected accounts management component
- [`apps/web/src/components/auth/ConnectedAccounts.spec.tsx`](../apps/web/src/components/auth/ConnectedAccounts.spec.tsx) — Component tests
- [`apps/web/src/app/[locale]/settings/connected-accounts/page.tsx`](../apps/web/src/app/[locale]/settings/connected-accounts/page.tsx) — Settings page
- [`apps/api/test/integration/telegram-auth.integration.spec.ts`](../apps/api/test/integration/telegram-auth.integration.spec.ts) — Integration tests
