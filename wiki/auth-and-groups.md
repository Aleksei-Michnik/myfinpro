# Auth and groups (checked 2026-09-24)

Read when: touching identity, sessions, providers, account lifecycle, legal/help pages, or group membership and roles.

## Where it lives

| Area                    | Path                                                                                                                                |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| API auth (51 files)     | `apps/api/src/auth/` — `auth.controller.ts`, `auth.service.ts`, `services/`, `strategies/`, `guards/`, `utils/`, `dto/`             |
| API groups              | `apps/api/src/group/` — controller, service, `guards/group-{member,admin}.guard.ts`, `constants/group-errors.ts`                    |
| Mail                    | `apps/api/src/mail/mail.service.ts`                                                                                                 |
| Rate limiting           | `apps/api/src/common/throttler/`, `apps/api/src/common/decorators/throttle.decorator.ts`, `apps/api/src/config/throttler.config.ts` |
| Shared group vocabulary | `packages/shared/src/types/group.types.ts`                                                                                          |
| Web                     | `apps/web/src/lib/auth/`, `apps/web/src/lib/group/`, `apps/web/src/components/{auth,group,settings}/`                               |

Prisma models (`apps/api/prisma/schema.prisma`): `User`, `RefreshToken`, `OAuthProvider`, `EmailVerificationToken`, `PasswordResetToken`, `AuditLog`, `Group`, `GroupMembership`, `GroupInviteToken`. See [data-model.md](data-model.md).

## Token model

| Token       | Shape                                 | TTL from                                | Storage                                                                                                  |
| ----------- | ------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Access      | JWT HS256, `{sub,email,name}`         | `JWT_EXPIRATION` (default `15m`)        | JSON body → React state only; **and** `access_token` cookie (httpOnly, SameSite=Lax, path `/`)           |
| Refresh     | random UUID                           | `JWT_REFRESH_EXPIRATION` (default `7d`) | SHA-256 hash in `refresh_tokens`; raw in `refresh_token` cookie (httpOnly, SameSite=Strict, path `/api`) |
| Google link | JWT, `purpose: 'link_google'`, 10 min | hardcoded                               | `link_token` cookie (httpOnly, SameSite=Lax)                                                             |

- Signing secret: `JWT_SECRET`. `apps/api/src/auth/jwt-config.module.ts` and `strategies/jwt.strategy.ts` throw when it is unset outside `development`/`test`; the dev fallback string is unreachable in deployed envs.
- **Rotation + reuse detection** (`services/refresh-token.service.ts`): every `POST /auth/refresh` creates a new row, then revokes the old one with `replacedBy`. Presenting an already-revoked token revokes _every_ token of that user, writes `TOKEN_REUSE_DETECTED`, and 401s.
- The refresh token is never echoed in a response body — `AuthController.issueAuthCookies` strips it. The service layer is cookie-free; only the controller touches `Response`.
- `TokenService.setRefreshTokenCookie` also clears a legacy cookie at path `/api/v1/auth` on every set/clear: browsers send the more specific path first, which used to look like token reuse (phase-1 progress "Silent refresh — Missing User + Cookie Path").
- Web (`apps/web/src/lib/auth/auth-context.tsx`): access token in memory only (never `localStorage`), a 12-minute interval refresh (80 % of the 15-minute TTL), a shared single-flight refresh on any 401 via `configureApiAuth`, and a `BroadcastChannel('auth')` so sibling tabs reuse one refresh.

## Guards

| Guard                                  | Accepts                                                                                | Used on                                                                                                                                                   |
| -------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `JwtAuthGuard` (passport)              | `Authorization: Bearer` only                                                           | every mutating/auth'd auth and group route                                                                                                                |
| `CookieOrBearerAuthGuard`              | `access_token` cookie, else Bearer                                                     | read-only surfaces the browser cannot add headers to: SSE (`realtime/events.controller.ts`) and `<img>`-loaded product pictures (`product.controller.ts`) |
| `GoogleAuthGuard`                      | passport-google-oauth20, `state: true`                                                 | `GET /auth/google`, `GET /auth/google/callback`                                                                                                           |
| `GroupMemberGuard` / `GroupAdminGuard` | resolves `groupMembership` from `:id` + `request.user.sub`, attaches it to the request | group routes, always **after** `JwtAuthGuard`                                                                                                             |

Both header and cookie exist because `EventSource` and `<img>` cannot set headers; the header path stays for curl/non-browser clients. Any module using `CookieOrBearerAuthGuard` must import `JwtConfigModule` (`@UseGuards` instantiates the guard in the _host_ module).

## Passwords

Argon2id, 64 MB memory / 3 iterations / parallelism 4 / 32-byte output (`services/password.service.ts`). DTO rule (register, reset, change): 8–128 chars with at least one lower, one upper, one digit. `changePassword` rejects OAuth-only accounts (`AUTH_PASSWORD_NOT_SET`), a wrong current password, and a new password equal to the current one; on success it revokes **all** refresh tokens.

## Providers and account linking

| Provider | Entry                                            | Verification                                                                                                                           |
| -------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| local    | `POST /auth/register`, `POST /auth/login`        | Argon2id; email lowercased+trimmed on lookup                                                                                           |
| google   | `GET /auth/google` → `GET /auth/google/callback` | passport OAuth2 with `state: true` (needs express-session)                                                                             |
| telegram | `POST /auth/telegram/callback`                   | HMAC-SHA256 of the sorted data-check-string keyed by SHA-256(`TELEGRAM_BOT_TOKEN`), `auth_date` ≤ 24 h (`utils/telegram-auth.util.ts`) |

Linking rules (`auth.service.ts`):

- Google login: existing `OAuthProvider(google, id)` → that user. Else, only if Google reports `emailVerified`, an existing user with that email is silently linked. Else a new user with `passwordHash: null` is created in a transaction. Unverified Google email → 401 `OAUTH_EMAIL_NOT_VERIFIED`.
- Telegram login never matches by email; it always creates a new user with the placeholder address `telegram_<id>@telegram.user` and `emailVerified: false`.
- Linking from Settings (`GET /auth/google/link`, `POST /auth/link/telegram`) never switches accounts. If the identity already belongs to another user, `AccountMergeService.mergeUsers(current, other)` moves providers, memberships, transactions, categories and receipts across, adopts the source's real email / password hash when the target lacks them, then deletes the source row.
- Linking a verified Google email to a Telegram-only account replaces the placeholder email so email login and reset become possible.
- `DELETE /auth/connected-accounts/:provider` refuses to remove the last authentication method (`CANNOT_UNLINK_LAST_AUTH`).
- The Google link flow authenticates from the `access_token` cookie (a top-level navigation carries no header) and hands the intent across the OAuth round-trip in the `link_token` cookie.

## Account lifecycle

| Flow               | Token                                  | Rules                                                                                                                                                                                            |
| ------------------ | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Email verification | UUID, SHA-256 hashed, 24 h, single-use | new token invalidates previous unused ones; sent fire-and-forget at registration                                                                                                                 |
| Password reset     | UUID, SHA-256 hashed, 1 h, single-use  | `forgot-password` always returns the same message (no enumeration) and is a no-op for OAuth-only users; reset revokes all refresh tokens                                                         |
| Account deletion   | —                                      | requires the account email as confirmation; soft-delete (`isActive:false`, `deletedAt`, `scheduledDeletionAt = +30 d`), revokes all refresh tokens, deletes `UserLlmCredential` rows immediately |
| Reactivation       | —                                      | `POST /auth/cancel-deletion`, or any successful login/OAuth sign-in inside the grace window (`reactivateOnLogin`)                                                                                |
| Hard delete        | —                                      | `services/account-cleanup.service.ts`, `@Cron(EVERY_DAY_AT_3AM)`: deletes oauth providers, refresh/verification/reset tokens, then users whose `deletedAt` is older than 30 days                 |

Mails (`mail.service.ts`): verification, password reset, deletion confirmation, deletion cancelled. Never throws — falls back to console logging when `SMTP_HOST` is unset and swallows send errors. Env var names: `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `DKIM_PRIVATE_KEY` (Nodemailer signs with selector `mail` and the domain of `SMTP_FROM`), `SERVER_NAME` (builds link URLs).

Registration consent: a mandatory Terms + Privacy checkbox in `components/auth/RegisterForm.tsx`; no consent column is persisted.

## Settings, legal and help

- `apps/web/src/app/[locale]/settings/account/page.tsx` composes preferences (currency, timezone, language → `PATCH /auth/profile`), `ChangePasswordForm`, `ConnectedAccounts`, `DeletionBanner`/`DeleteAccountDialog` and `LlmSettingsSection`. Per-user LLM provider/model and BYOK keys are a separate subsystem — see [llm.md](receipts-and-llm.md).
- `components/auth/TimezoneDetector.tsx` pushes the browser timezone through `updateProfile` once, only while the stored timezone is still the `UTC` default; failures are swallowed.
- Legal and help pages are static server components under `app/[locale]/legal/{terms,privacy}` and `app/[locale]/help`, rendering `next-intl` keys `legal.*` / `help.*`. **Maintain the text in `apps/web/messages/{en,he}.json`, not in the TSX.**

## Rate limits

Global default: one `default` throttler, `RATE_LIMIT_TTL` / `RATE_LIMIT_MAX` (60000 ms / 60). `CustomThrottlerGuard` is the `APP_GUARD`; it resolves the client IP from `x-forwarded-for` then `x-real-ip` (shared edge nginx).

| Window | Limit | Routes                                                                                          |
| ------ | ----- | ----------------------------------------------------------------------------------------------- |
| 60 s   | 5     | register, login, telegram callback, link telegram, change-password, group delete, accept invite |
| 60 s   | 10    | refresh, logout, profile, google\*, group create/update/create-invite/leave                     |
| 60 s   | 20/30 | group member role + remove (20); group list/get/invite info (30)                                |
| 600 s  | 3     | send-verification-email, forgot-password, delete-account                                        |
| 600 s  | 5     | verify-email, reset-password, cancel-deletion                                                   |

## Audit log

`AuditLog{userId?, action, entity, entityId?, details?, ipAddress?, userAgent?}`. Auth: `USER_REGISTERED`, `USER_REGISTERED_OAUTH`, `USER_LOGIN`, `LOGIN_FAILED`, `USER_LOGOUT`, `TOKEN_REUSE_DETECTED`, `PASSWORD_RESET`, `auth.password_changed`, `OAUTH_PROVIDER_LINKED`, `OAUTH_PROVIDER_UNLINKED`, `ACCOUNT_MERGED`, `ACCOUNT_DELETION_REQUESTED`, `ACCOUNT_DELETION_CANCELLED`, `ACCOUNT_REACTIVATED_VIA_LOGIN`. Groups: `GROUP_CREATED`, `GROUP_UPDATED`, `GROUP_DELETED`, `GROUP_INVITE_CREATED`, `GROUP_MEMBER_JOINED`, `group.member.role_changed`, `group.member.removed`, `group.member.left`, `group.deleted_on_leave`. Naming is deliberately mixed (`UPPER_SNAKE` older, `dot.notation` newer) to preserve historical continuity — phase-5-progress §5.8.

## Groups

- Types: `GROUP_TYPES = ['family']`; roles: `GROUP_ROLES = ['admin','member']`; invites expire after `INVITE_TOKEN_EXPIRY_DAYS = 7` — all from `@myfinpro/shared`, never re-declared.
- Creator becomes `admin` in the same transaction as the group. `GroupMembership` is unique on `(groupId, userId)`.
- Invite flow: admin calls `POST /groups/:id/invites` → raw UUID returned once, only its SHA-256 hash is stored. `GET /groups/invite/:token` previews group + inviter; `POST /groups/invite/:token/accept` re-validates, refuses an existing member (409), then in one transaction marks `usedAt`/`usedByUserId` and creates a `member` membership. Invites are single-use.
- Membership rules: the last admin cannot be demoted or removed (409); an admin cannot remove themselves (400 `GROUP_CANNOT_REMOVE_SELF` — use leave).
- Leave (`POST /groups/:id/leave`, any member): last admin with other members → 409 `GROUP_CANNOT_LEAVE_AS_LAST_ADMIN`; last admin and only member → the group is deleted (cascades memberships and invites). Leave's audit writes are wrapped in try/catch so an audit failure never fails the operation.
- `Group.createdById` has **no** foreign key to `User` (phase-5 design "Design Decisions") — deliberate, avoids a circular relation.
- Downstream, "scope" means a `TransactionAttribution` row of `scopeType: 'personal' | 'group'`; list filters use `all | personal | group:<groupId>`. See [transactions.md](transactions.md).

## API surface

`/api/v1` prefix. Guard column: J = `JwtAuthGuard`, G = `GoogleAuthGuard`, M = `GroupMemberGuard`, A = `GroupAdminGuard`, — = public.

| Method | Path                                    | Guard | Body/param DTO                            |
| ------ | --------------------------------------- | ----- | ----------------------------------------- |
| POST   | `/auth/register`                        | —     | `RegisterDto`                             |
| POST   | `/auth/login`                           | —     | `LoginDto`                                |
| POST   | `/auth/refresh`, `/auth/logout`         | —     | `refresh_token` cookie                    |
| GET    | `/auth/me`                              | J     | —                                         |
| PATCH  | `/auth/profile`                         | J     | `UpdateProfileDto`                        |
| POST   | `/auth/send-verification-email`         | J     | —                                         |
| GET    | `/auth/verify-email?token=`             | —     | query token                               |
| POST   | `/auth/forgot-password`                 | —     | `ForgotPasswordDto`                       |
| POST   | `/auth/reset-password`                  | —     | `ResetPasswordDto`                        |
| POST   | `/auth/change-password` (204)           | J     | `ChangePasswordDto`                       |
| POST   | `/auth/delete-account`                  | J     | `DeleteAccountDto`                        |
| POST   | `/auth/cancel-deletion`                 | J     | —                                         |
| GET    | `/auth/google`, `/auth/google/callback` | G     | —                                         |
| GET    | `/auth/google/link`                     | —\*   | `access_token` cookie (\*verified inline) |
| POST   | `/auth/telegram/callback`               | —     | `TelegramAuthDto`                         |
| POST   | `/auth/link/telegram`                   | J     | `TelegramAuthDto`                         |
| GET    | `/auth/connected-accounts`              | J     | —                                         |
| DELETE | `/auth/connected-accounts/:provider`    | J     | `google` \| `telegram`                    |
| POST   | `/groups` (201) · GET `/groups`         | J     | `CreateGroupDto`                          |
| GET    | `/groups/invite/:token`                 | J     | raw token                                 |
| POST   | `/groups/invite/:token/accept`          | J     | raw token                                 |
| GET    | `/groups/:id`                           | J+M   | —                                         |
| PATCH  | `/groups/:id` · DELETE `/groups/:id`    | J+A   | `UpdateGroupDto`                          |
| POST   | `/groups/:id/invites` (201)             | J+A   | —                                         |
| PATCH  | `/groups/:id/members/:userId`           | J+A   | `UpdateMemberRoleDto`                     |
| DELETE | `/groups/:id/members/:userId` (204)     | J+A   | —                                         |
| POST   | `/groups/:id/leave` (204)               | J+M   | —                                         |

`/groups/invite/:token` is declared **before** `/groups/:id` so Nest does not match `invite` as an id.

## Web routes and the prefix-free URL rule

`app/[locale]/auth/{login,register,forgot-password,reset-password,verify-email,callback}`, `app/[locale]/groups/{,[groupId],[groupId]/settings,invite/[token]}`, `app/[locale]/settings/account`, `app/[locale]/legal/{terms,privacy}`, `app/[locale]/help`.

`apps/web/src/i18n/routing.ts` sets `locales: ['en','he']`, `defaultLocale: 'en'`, `localePrefix: 'never'`, `localeCookie: NEXT_LOCALE` (1 year), `localeDetection: true`. `apps/web/src/proxy.ts` is the next-intl middleware (Next 16 renamed `middleware.ts` → `proxy.ts`); its matcher skips `api`, `_next`, `_vercel` and any path with a dot, and it rewrites `/x` to `/<locale>/x` internally. **User-visible URLs never carry a locale segment**; the `[locale]` folder stays because next-intl needs it. `next.config.ts` 301-redirects `/{locale}/...` → `/...`. Locale is chosen by cookie → `Accept-Language` → `en`; the auth context re-syncs `NEXT_LOCALE` from `user.locale`.

## Tests

`apps/api/test/integration/`: `auth`, `email-verification`, `password-reset`, `password-change`, `account-deletion`, `telegram-auth`, `profile-update` (Testcontainers, real DB). Unit specs sit next to every auth/group source file. `apps/web/e2e/auth.spec.ts` (338 lines) covers login/register pages, unauthenticated redirects, silent refresh across reload, the Google button and callback page, and connected accounts; `registration-consent.spec.ts`, `legal-pages.spec.ts`, `help-page.spec.ts`, `footer.spec.ts` cover Phase 4 surfaces. **Groups have no integration or e2e test** — unit specs only.

## Security invariants (keep true)

1. Access token in memory on the web client; never `localStorage` — it survives XSS otherwise.
2. Refresh tokens stored only as SHA-256 hashes; raw value only in the httpOnly cookie.
3. Every refresh rotates; reusing a revoked token revokes the whole user's tokens.
4. Never return `refreshToken` in a response body.
5. Revoke all refresh tokens on password change, password reset and deletion request.
6. Email verification / reset / invite tokens: UUID, hashed at rest, single-use, expiring.
7. `forgot-password` and login return the same answer whether or not the account exists.
8. Only link a Google identity by email when the provider reports `emailVerified`.
9. Never leave an account with zero authentication methods (unlink safety check).
10. Deletion needs the account email as confirmation; grace period is 30 days, secrets (LLM keys) are wiped at once.
11. All DTOs validated by class-validator; auth/group errors carry an `errorCode` constant, never a raw message.
12. Every auth and group mutation writes an `AuditLog` row.

## Drift and gotchas

- `docs/phase-3-design.md` §4.2a and its security checklist describe OIDC JWT verification via Telegram JWKS; the code verifies **HMAC-SHA256** Login Widget data. `docs/phase-3-progress.md` records the pivot back — code and progress doc win.
- `docs/post-phase-4-design.md` §1.14 says to drop the locale segment from the Google callback redirect; `auth.controller.ts` still redirects to `/<locale>/auth/callback` (and mail links to `/<locale>/auth/...`). It works only via the `next.config.ts` 301s.
- `mail.service.ts` builds a deletion-cancel link to `/auth/cancel-deletion?token=...` with the literal token `'login-to-cancel'`; that page does not exist. Cancelling works by logging in or via `POST /auth/cancel-deletion`.
- `throttler.config.ts` exposes `authTtl`/`authLimit` (`RATE_LIMIT_AUTH_TTL`/`RATE_LIMIT_AUTH_MAX`) that nothing reads — per-route limits are hardcoded in `@CustomThrottle`. Same for the unused `AuthRateLimit`/`PublicRateLimit`/`RelaxedRateLimit` decorators.
- `LocalStrategy` is registered but `LocalAuthGuard` is unused: `POST /auth/login` calls `authService.validateUser` directly.
- `refreshTokenService.cleanupExpiredTokens()` exists but no cron calls it; only `AccountCleanupService` is scheduled.
- Argon2id verification runs before reactivation on login, so a soft-deleted account cannot be revived by a wrong password.

## Deep dives

- Phase 1 sessions and threat model — `docs/phase-1-design.md` §7 "Iteration 1.5: JWT Issuance", §8 "Iteration 1.6: Token Refresh API", §15 "Security Architecture".
- Google OAuth and linking — `docs/phase-2-design.md` §3 "Iteration 2.2: Backend Integration", §5 "Iteration 2.4: Account Linking", §6 "Security Considerations".
- Telegram — `docs/phase-3-design.md` §3 "Iteration 3.1", §5 "Iteration 3.3: Connected Accounts API"; `docs/phase-3-progress.md` "Key architecture decisions".
- Mail, verification, reset, deletion, legal/help — `docs/phase-4-design.md` §2–§14, §16 "Security Architecture"; SMTP host design `docs/phase-4-smtp-design.md`.
- Groups — `docs/phase-5-design.md` §"Database Schema", §"API Endpoints"; `docs/phase-5-progress.md` §5.8 "Leave Group + Audit Logging Review".
- URL redesign — `docs/post-phase-4-design.md` §"Part 1: URL Translation Redesign".
- Cross-cutting security — `IMPLEMENTATION-PLAN.md` §4 "Security Architecture".
