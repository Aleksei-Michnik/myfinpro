# Phase 2 — Google Authentication

## Overview

Phase 2 adds Google OAuth authentication as a second auth provider. Users can sign in or register with their Google account, and existing email/password accounts are automatically linked when the Google email matches. This phase introduces Passport Google Strategy, OAuth flow with state parameter protection, a frontend callback page, and account linking logic.

## Architecture Decisions

- **Passport Google Strategy**: Uses `passport-google-oauth20` with Passport's standard OAuth2 flow
- **State Parameter**: Session-based CSRF protection via `express-session` (memory store dev / Redis store prod)
- **Account Linking**: If a Google sign-in email matches an existing user, the `oauthProvider` and `oauthId` fields are linked silently
- **New User Creation**: Google users without a matching email get a new account with `passwordHash = null` (no password — OAuth only)
- **Token Flow**: After Google callback, API generates JWT access token + refresh cookie, then redirects to frontend `/[locale]/auth/callback?token=xxx`
- **Frontend Token Handling**: Callback page extracts token from URL, calls `/auth/me` to fetch user profile, sets auth state

## Iteration 2.1+2.2: Backend — Google OAuth Strategy + Endpoints + Account Linking

**What was implemented:**

- Added `OAuthProvider` enum and `oauthProvider`/`oauthId` fields to User model (Prisma migration)
- Created Google Passport strategy (`passport-google-oauth20`) with profile → GoogleProfile mapping
- Created GoogleAuthGuard with session-based state parameter support
- Added `express-session` middleware for OAuth state CSRF protection
- Created OAuthService with `findOrCreateGoogleUser()` account linking logic
- Added `GET /auth/google` (redirect to Google consent) and `GET /auth/google/callback` (callback handler)
- Callback handler generates tokens via existing login flow, then redirects to frontend with access token in URL
- Docker Compose env passthrough for `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET`
- CI/CD configuration updates for Google OAuth secrets
- Graceful fallback when Google credentials not configured (dummy values to prevent app crash)

**Key files created/modified:**

- [`apps/api/prisma/migrations/20260321223147_phase2_oauth_provider/migration.sql`](../apps/api/prisma/migrations/20260321223147_phase2_oauth_provider/migration.sql) — OAuth fields migration
- [`apps/api/src/auth/strategies/google.strategy.ts`](../apps/api/src/auth/strategies/google.strategy.ts) — Google Passport strategy
- [`apps/api/src/auth/guards/google-auth.guard.ts`](../apps/api/src/auth/guards/google-auth.guard.ts) — Google auth guard with session state
- [`apps/api/src/auth/services/oauth.service.ts`](../apps/api/src/auth/services/oauth.service.ts) — OAuth account find/create/link service
- [`apps/api/src/auth/auth.controller.ts`](../apps/api/src/auth/auth.controller.ts) — Added `googleAuth()` + `googleCallback()` endpoints
- [`apps/api/src/auth/auth.service.ts`](../apps/api/src/auth/auth.service.ts) — Added `findOrCreateGoogleUser()` method
- [`apps/api/src/auth/auth.module.ts`](../apps/api/src/auth/auth.module.ts) — Added PassportModule, Google strategy, OAuthService

**Tests added:**

- [`apps/api/src/auth/strategies/google.strategy.spec.ts`](../apps/api/src/auth/strategies/google.strategy.spec.ts) — Google strategy tests
- [`apps/api/src/auth/services/oauth.service.spec.ts`](../apps/api/src/auth/services/oauth.service.spec.ts) — OAuth service tests (find, create, link)
- Updated [`apps/api/src/auth/auth.controller.spec.ts`](../apps/api/src/auth/auth.controller.spec.ts) — Google endpoint tests
- Updated [`apps/api/src/auth/auth.service.spec.ts`](../apps/api/src/auth/auth.service.spec.ts) — findOrCreateGoogleUser tests
- 198 API unit tests passing

**Issues encountered:**

1. **Docker Compose env passthrough** — `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` needed to be explicitly passed in docker-compose files
2. **Session middleware for state parameter** — Google OAuth requires `state` param in session to prevent CSRF; added `express-session` to `main.ts` with conditional Redis/memory store
3. **Graceful fallback** — App must not crash if Google OAuth secrets are missing (dev environments without Google setup)

---

## Iteration 2.3+2.4: Frontend — Google Button + Callback Page + Account Linking

**What was implemented:**

- Created OAuth callback page (`/[locale]/auth/callback`) — extracts token from URL, calls `loginWithToken()`, redirects on success/failure
- Added `loginWithToken(token)` method to AuthContext — sets token, fetches user profile via `GET /auth/me` with Bearer token
- Enabled Google button in LoginForm — navigates to `/api/v1/auth/google` on click (full page redirect to API)
- Added Google button to RegisterForm with "Or sign up with" divider
- Added i18n translations (en + he) for OAuth flow: `googleSignInProgress`, `oauthError`, `oauthSuccess`, `orSignUpWith`, `signInWithGoogle`
- Updated all auth mock contexts across test files to include `loginWithToken`

**Key files created/modified:**

- [`apps/web/src/app/[locale]/auth/callback/page.tsx`](../apps/web/src/app/[locale]/auth/callback/page.tsx) — OAuth callback page
- [`apps/web/src/lib/auth/auth-context.tsx`](../apps/web/src/lib/auth/auth-context.tsx) — Added `loginWithToken` method
- [`apps/web/src/components/auth/LoginForm.tsx`](../apps/web/src/components/auth/LoginForm.tsx) — Enabled Google button
- [`apps/web/src/components/auth/RegisterForm.tsx`](../apps/web/src/components/auth/RegisterForm.tsx) — Added Google sign-up button
- [`apps/web/messages/en.json`](../apps/web/messages/en.json) — Added OAuth i18n strings
- [`apps/web/messages/he.json`](../apps/web/messages/he.json) — Added Hebrew OAuth translations

**Tests added/modified:**

- [`apps/web/src/app/[locale]/auth/callback/callback.spec.tsx`](../apps/web/src/app/[locale]/auth/callback/callback.spec.tsx) — 6 tests: token extraction, loading state, success redirect, missing token, failed login, network error
- [`apps/web/src/lib/auth/auth-context.spec.tsx`](../apps/web/src/lib/auth/auth-context.spec.tsx) — 3 new tests: loginWithToken success, API failure, network error
- [`apps/web/src/components/auth/LoginForm.spec.tsx`](../apps/web/src/components/auth/LoginForm.spec.tsx) — Updated: Google button enabled + navigates to OAuth endpoint
- [`apps/web/src/components/auth/RegisterForm.spec.tsx`](../apps/web/src/components/auth/RegisterForm.spec.tsx) — 2 new tests: Google button + divider
- [`apps/web/e2e/auth.spec.ts`](../apps/web/e2e/auth.spec.ts) — 3 new E2E tests: Google button navigation, callback with token, callback without token
- All existing tests updated with `loginWithToken` in mocks

## Phase 2 Test Summary

| Category       | Count    | Notes                                                              |
| -------------- | -------- | ------------------------------------------------------------------ |
| API Unit Tests | 198      | +21 from Phase 1 (Google strategy, OAuth, controller, service)     |
| Web Unit Tests | ~155     | +17 from Phase 1 (callback, auth-context, LoginForm, RegisterForm) |
| Playwright E2E | ~65      | +15 from Phase 1 (Google button, callback) across 5 browsers       |
| Shared Package | 46       | Unchanged                                                          |
| **Total**      | **~464** | +69 tests from Phase 1                                             |

## OAuth Flow Diagram

```
User clicks "Google" → window.location.href = /api/v1/auth/google
  → API redirects to Google consent screen (with state param in session)
  → Google authenticates → redirects to /api/v1/auth/google/callback
  → API validates profile → findOrCreateGoogleUser (links or creates)
  → API generates JWT + refresh cookie
  → API redirects to /en/auth/callback?token=xxx
  → Frontend callback page extracts token
  → Calls GET /auth/me with Bearer token
  → Sets user in auth context → redirects to /dashboard
```

## Status: ✅ COMPLETE

- All 4 iterations (2.1–2.4) implemented
- Backend Google OAuth strategy + account linking + endpoints
- Frontend callback page + Google buttons + loginWithToken
- All tests passing (198 API + ~155 web + ~65 E2E)
- Build clean, typecheck clean
