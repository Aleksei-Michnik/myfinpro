# Phase 5 — Group Management

## Iteration 5.1: Group Schema Migration (2026-04-19)

- **Date**: April 19, 2026
- **Commit**: `d2d5725` (develop)
- **CI run**: `24614249699` — success
- **Deploy Staging run**: `24614249696` — success

**Changes**: Added 3 new database models for group management.

**New models:**

- **Group** — `groups` table: id, name, type (default: "family"), defaultCurrency, createdById, timestamps
- **GroupMembership** — `group_memberships` table: explicit many-to-many between Group and User with role field (default: "member"), unique constraint on [groupId, userId], cascade delete
- **GroupInviteToken** — `group_invite_tokens` table: SHA-256 hashed invite tokens with expiry, used tracking, cascade delete on group

**Design decisions:**

- No foreign key from `Group.createdById` to `User` — avoids circular relation complexity
- Expand-only migration (new tables only) — safe for blue-green deployment
- `groupMemberships` relation added to existing `User` model
- Indexes on all foreign keys and commonly queried fields (createdById, userId, groupId, expiresAt)

**Files changed:**

- [`apps/api/prisma/schema.prisma`](../apps/api/prisma/schema.prisma) — Added Group, GroupMembership, GroupInviteToken models + User relation
- [`apps/api/prisma/migrations/20260418212111_phase5_group_management/migration.sql`](../apps/api/prisma/migrations/20260418212111_phase5_group_management/migration.sql) — Migration SQL

## Iteration 5.2: Group CRUD API + Shared Types (2026-04-23)

- **Date**: April 23, 2026
- **Commit**: `774e3a7` (develop)
- **CI run**: `24852376331` — success
- **Deploy Staging run**: `24852376296` — success

**Changes**: Implemented the Group module backend — REST CRUD API with role-based access guards and shared type constants.

**Shared package** ([`packages/shared`](../packages/shared)):

- Added [`group.types.ts`](../packages/shared/src/types/group.types.ts) with `GROUP_TYPES` (`['family']`), `GROUP_ROLES` (`['admin', 'member']`), `INVITE_TOKEN_EXPIRY_DAYS = 7`, plus `GroupType` / `GroupRole` type aliases
- Barrel export in [`types/index.ts`](../packages/shared/src/types/index.ts)
- Unit tests in [`__tests__/group.test.ts`](../packages/shared/src/__tests__/group.test.ts)

**API Group module** ([`apps/api/src/group`](../apps/api/src/group)):

- [`GroupService`](../apps/api/src/group/group.service.ts) — `createGroup` (transaction: creates Group + adds creator as `admin` GroupMembership), `getUserGroups` (returns all groups the user belongs to with member count and user's role), `getGroup` (returns group detail with full member list), `updateGroup`, `deleteGroup`. All mutations write to `auditLog`.
- [`GroupController`](../apps/api/src/group/group.controller.ts) — REST endpoints: `POST /groups`, `GET /groups`, `GET /groups/:id`, `PATCH /groups/:id`, `DELETE /groups/:id`. Uses `JwtAuthGuard` globally + `GroupMemberGuard` for read and `GroupAdminGuard` for mutate/delete. Full Swagger documentation with `@ApiTags('Groups')`, `@ApiBearerAuth()`, `@ApiOperation`, `@ApiResponse`. Rate limited with `@CustomThrottle({ limit: 10, ttl: 60000 })`.
- [`CreateGroupDto`](../apps/api/src/group/dto/create-group.dto.ts) / [`UpdateGroupDto`](../apps/api/src/group/dto/update-group.dto.ts) — `class-validator` DTOs with `@IsIn([...GROUP_TYPES])` and `@IsIn([...CURRENCY_CODES])` from shared constants.
- [`GroupMemberGuard`](../apps/api/src/group/guards/group-member.guard.ts) / [`GroupAdminGuard`](../apps/api/src/group/guards/group-admin.guard.ts) — Verify membership via `prisma.groupMembership.findUnique({ where: { groupId_userId } })`. Admin guard additionally checks `membership.role === 'admin'`. Both attach `request.groupMembership` for downstream handlers.
- [`GROUP_ERRORS`](../apps/api/src/group/constants/group-errors.ts) — error code constants (`GROUP_NOT_FOUND`, `GROUP_NOT_A_MEMBER`, `GROUP_NOT_AN_ADMIN`, `GROUP_ALREADY_A_MEMBER`, `GROUP_INVITE_TOKEN_*`, `GROUP_CANNOT_REMOVE_LAST_ADMIN`, `GROUP_CANNOT_LEAVE_AS_LAST_ADMIN`).
- [`GroupModule`](../apps/api/src/group/group.module.ts) — imports `PrismaModule`, provides `GroupService` + both guards, exports `GroupService`. Registered in [`AppModule`](../apps/api/src/app.module.ts).

**Tests added:**

- [`group.service.spec.ts`](../apps/api/src/group/group.service.spec.ts) — 15 tests: create (creator becomes admin via transaction), list (empty + populated), get (with members + not found), update (name/type/currency), delete (audit log written).
- [`group.controller.spec.ts`](../apps/api/src/group/group.controller.spec.ts) — 14 tests: each endpoint returns correct status, DTO validation (missing name, invalid type, invalid currency), guard overrides pattern.

**Files changed:**

- [`packages/shared/src/types/group.types.ts`](../packages/shared/src/types/group.types.ts)
- [`packages/shared/src/types/index.ts`](../packages/shared/src/types/index.ts)
- [`packages/shared/src/__tests__/group.test.ts`](../packages/shared/src/__tests__/group.test.ts)
- [`apps/api/src/group/constants/group-errors.ts`](../apps/api/src/group/constants/group-errors.ts)
- [`apps/api/src/group/dto/create-group.dto.ts`](../apps/api/src/group/dto/create-group.dto.ts)
- [`apps/api/src/group/dto/update-group.dto.ts`](../apps/api/src/group/dto/update-group.dto.ts)
- [`apps/api/src/group/guards/group-member.guard.ts`](../apps/api/src/group/guards/group-member.guard.ts)
- [`apps/api/src/group/guards/group-admin.guard.ts`](../apps/api/src/group/guards/group-admin.guard.ts)
- [`apps/api/src/group/group.service.ts`](../apps/api/src/group/group.service.ts)
- [`apps/api/src/group/group.controller.ts`](../apps/api/src/group/group.controller.ts)
- [`apps/api/src/group/group.module.ts`](../apps/api/src/group/group.module.ts)
- [`apps/api/src/group/group.service.spec.ts`](../apps/api/src/group/group.service.spec.ts)
- [`apps/api/src/group/group.controller.spec.ts`](../apps/api/src/group/group.controller.spec.ts)
- [`apps/api/src/app.module.ts`](../apps/api/src/app.module.ts) — Registered `GroupModule`

## Iteration 5.3: Group List and Create UI (2026-04-23)

- **Date**: April 23, 2026
- **Commit**: `ce007ed` (develop)
- **CI run**: `24854372223` — success
- **Deploy Staging run**: `24854372255` — success

**Changes**: Implemented the frontend group list page with a create-group dialog, a new `GroupProvider` React context for state management, and a GroupCard component. Added a "Groups" link to the authenticated header navigation and full i18n translations for English and Hebrew.

**Frontend group module** ([`apps/web/src/lib/group`](../apps/web/src/lib/group)):

- [`types.ts`](../apps/web/src/lib/group/types.ts) — `GroupSummary`, `GroupMember`, `GroupDetail`, `CreateGroupData`, `UpdateGroupData` interfaces mirroring the API response shape.
- [`group-context.tsx`](../apps/web/src/lib/group/group-context.tsx) — `GroupProvider` + `useGroups()` hook. Uses `useAuth().getAccessToken()` for bearer-token auth and the same `API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api/v1'` pattern as auth-context. Exposes `groups`, `isLoading`, `fetchGroups`, `createGroup`, `updateGroup`, `deleteGroup`. Auto-fetches groups when the user becomes authenticated and clears state on logout.

**Group UI components** ([`apps/web/src/components/group`](../apps/web/src/components/group)):

- [`GroupCard.tsx`](../apps/web/src/components/group/GroupCard.tsx) — Clickable card linking to `/groups/{id}` with group name heading, type badge (translated via `GROUP_TYPES` from shared), currency code, pluralised member count (`{count, plural, ...}`), and admin/member role badge. Graceful fallback to raw type/role when unknown. Follows the same `rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800` styling as the account settings sections.
- [`CreateGroupDialog.tsx`](../apps/web/src/components/group/CreateGroupDialog.tsx) — Modal dialog styled like `DeleteAccountDialog`. Form fields: name (required), type dropdown (populated from `GROUP_TYPES`, default "family"), currency dropdown (populated from `CURRENCY_CODES`, default "USD"). Create button is disabled until a non-whitespace name is entered. Shows loading state (`Creating...`) while submitting, success / error toasts via `useToast()`, and closes on success; errors keep the dialog open.

**Groups list page** ([`apps/web/src/app/[locale]/groups`](../apps/web/src/app/[locale]/groups)):

- [`page.tsx`](../apps/web/src/app/[locale]/groups/page.tsx) — Wrapped in `ProtectedRoute`. Shows page title, a "Create Group" button in the header (when there are groups), a responsive `grid-cols-1 md:grid-cols-2 gap-4` grid of `GroupCard`s, a skeleton loader while fetching the first time, and a prominent empty state ("You don't have any groups yet" + "Create your first group to get started.") with a large CTA when the user has no groups.

**Header navigation** ([`apps/web/src/components/layout/Header.tsx`](../apps/web/src/components/layout/Header.tsx)):

- Added a "Groups" link (`t('nav.groups')`) to the authenticated nav between Dashboard and Settings, following the same styling as the existing links.

**Locale layout** ([`apps/web/src/app/[locale]/layout.tsx`](../apps/web/src/app/[locale]/layout.tsx)):

- Added `<GroupProvider>` wrapping `<ToastProvider>` inside the existing `<AuthProvider>` so the group context can read the current access token.

**i18n translations**:

- [`apps/web/messages/en.json`](../apps/web/messages/en.json) — Added `nav.groups: "Groups"` and a full `groups.*` section: `title`, `createGroup`, `noGroups`, `createFirst`, pluralised `memberCount`, `role.admin`/`role.member`, `type.family`, and the `create.*` dialog strings.
- [`apps/web/messages/he.json`](../apps/web/messages/he.json) — Same keys with Hebrew translations ("הקבוצות שלי", "צור קבוצה", etc.) — verified to work with the existing RTL layout.

**Tests added**:

- [`GroupCard.spec.tsx`](../apps/web/src/components/group/GroupCard.spec.tsx) — 10 tests: renders name, translated type badge, pluralised member count (singular + plural), currency, admin/member role badges, absence of role badge when undefined, correct link href, fallback to raw type for unknown values.
- [`CreateGroupDialog.spec.tsx`](../apps/web/src/components/group/CreateGroupDialog.spec.tsx) — 10 tests: does not render when closed, renders all form fields when open, create button disabled until a non-whitespace name is entered, calls `createGroup` with trimmed name / selected type / currency, shows the `Creating...` loading state, displays error toast on failure, cancel button invokes `onClose` without calling the API.
- [`groups.spec.tsx`](../apps/web/src/app/[locale]/groups/groups.spec.tsx) — 8 tests: renders title, empty state with CTA when no groups, skeleton while loading, grid of cards when groups exist, both header and empty-state CTAs open the create dialog, cancel closes the dialog.
- [`Header.spec.tsx`](../apps/web/src/components/layout/Header.spec.tsx) — Added a test verifying the `Groups` link renders with `href="/groups"` when authenticated.

**Results**:

- All 303 web unit tests pass (up from 274 before this iteration, +29 new tests).
- Full monorepo `pnpm run test` passes: 303 web + 365 api + shared/eslint-config suites.
- CI (`24854372223`) and Deploy Staging (`24854372255`) on `develop` both green.

**Files changed:**

- [`apps/web/src/lib/group/types.ts`](../apps/web/src/lib/group/types.ts)
- [`apps/web/src/lib/group/group-context.tsx`](../apps/web/src/lib/group/group-context.tsx)
- [`apps/web/src/components/group/GroupCard.tsx`](../apps/web/src/components/group/GroupCard.tsx)
- [`apps/web/src/components/group/GroupCard.spec.tsx`](../apps/web/src/components/group/GroupCard.spec.tsx)
- [`apps/web/src/components/group/CreateGroupDialog.tsx`](../apps/web/src/components/group/CreateGroupDialog.tsx)
- [`apps/web/src/components/group/CreateGroupDialog.spec.tsx`](../apps/web/src/components/group/CreateGroupDialog.spec.tsx)
- [`apps/web/src/app/[locale]/groups/page.tsx`](../apps/web/src/app/%5Blocale%5D/groups/page.tsx)
- [`apps/web/src/app/[locale]/groups/groups.spec.tsx`](../apps/web/src/app/%5Blocale%5D/groups/groups.spec.tsx)
- [`apps/web/src/app/[locale]/layout.tsx`](../apps/web/src/app/%5Blocale%5D/layout.tsx) — Wrap children in `<GroupProvider>`
- [`apps/web/src/components/layout/Header.tsx`](../apps/web/src/components/layout/Header.tsx) — Added Groups link
- [`apps/web/src/components/layout/Header.spec.tsx`](../apps/web/src/components/layout/Header.spec.tsx) — Added Groups link test
- [`apps/web/messages/en.json`](../apps/web/messages/en.json)
- [`apps/web/messages/he.json`](../apps/web/messages/he.json)

## Iteration 5.4: Invite Token API (2026-04-23)

- **Date**: April 23, 2026
- **Commit**: `e508f3d` (develop)
- **CI run**: `24858515179` — success
- **Deploy Staging run**: `24858515183` — success

**Changes**: Added group invite token generation and acceptance endpoints to the API following the existing UUID v4 → SHA-256 token pattern used in [`EmailVerificationService`](../apps/api/src/auth/services/email-verification.service.ts). The raw UUID is returned to the inviter once; only the SHA-256 hash is persisted.

**GroupService new methods** ([`apps/api/src/group/group.service.ts`](../apps/api/src/group/group.service.ts)):

- `createInvite(groupId, userId)` — Generates `crypto.randomUUID()` raw token, hashes with SHA-256, stores in `GroupInviteToken` with `expiresAt = now + INVITE_TOKEN_EXPIRY_DAYS` (7 days) from `@myfinpro/shared`, writes `GROUP_INVITE_CREATED` audit log, returns `{ token, expiresAt }`.
- `getInviteInfo(rawToken)` — Hashes the incoming raw token, looks up by `tokenHash` including the related group, validates the token is not expired and not used, then fetches the inviter's name. Returns `{ groupId, groupName, groupType, inviterName }`. Falls back to `"Unknown"` when the inviter has been deleted.
- `acceptInvite(rawToken, userId)` — Validates the token, checks the user isn't already a member via the `groupId_userId` unique index, then in a single transaction marks the token as used (sets `usedAt` + `usedByUserId`) and creates a `GroupMembership` with role `'member'`. Writes a `GROUP_MEMBER_JOINED` audit log and returns the group summary with updated `memberCount`.
- Shared `ensureInviteUsable()` private helper centralises the three validation checks (invalid / used / expired) with the correct error codes from [`GROUP_ERRORS`](../apps/api/src/group/constants/group-errors.ts).
- Shared `hashToken()` private helper mirrors the `EmailVerificationService` pattern (SHA-256 hex).

**GroupController new endpoints** ([`apps/api/src/group/group.controller.ts`](../apps/api/src/group/group.controller.ts)):

- `POST /groups/:id/invites` — Admin-only. Guards: `JwtAuthGuard` + `GroupAdminGuard`. Rate-limited `10 req/min`. Returns `{ token, expiresAt }`.
- `GET /groups/invite/:token` — Any authenticated user. Guard: `JwtAuthGuard`. Rate-limited `30 req/min`. Returns `{ groupId, groupName, groupType, inviterName }` so the accept page can render "Alice invited you to join Family X".
- `POST /groups/invite/:token/accept` — Any authenticated user. Guard: `JwtAuthGuard`. Rate-limited `5 req/min`. Returns the group summary.
- **Route ordering**: The two `invite/:token*` routes are declared **before** the `:id` routes so NestJS does not match the literal `invite` segment as a group ID. The admin `POST /groups/:id/invites` endpoint is declared **after** `:id` because its path starts with the `:id` parameter.

**New error codes used** (already defined in [`group-errors.ts`](../apps/api/src/group/constants/group-errors.ts)):

- `GROUP_INVITE_TOKEN_INVALID` — Unknown token hash (`404 NotFoundException`)
- `GROUP_INVITE_TOKEN_EXPIRED` — Token past `expiresAt` (`400 BadRequestException`)
- `GROUP_INVITE_TOKEN_USED` — Token already accepted (`400 BadRequestException`)
- `GROUP_ALREADY_A_MEMBER` — User is already a member of the group (`409 ConflictException`)

**Tests added**:

- [`group.service.spec.ts`](../apps/api/src/group/group.service.spec.ts) — 14 new invite tests: `createInvite` generates a UUID v4 token + 64-char SHA-256 hash, stores `groupId` / `createdById`, sets expiry ~7 days ahead, writes audit log; `getInviteInfo` returns the expected shape for a valid token, throws `INVITE_TOKEN_INVALID` / `INVITE_TOKEN_EXPIRED` / `INVITE_TOKEN_USED` with the correct error codes, falls back to `"Unknown"` when the inviter is missing; `acceptInvite` creates the membership, marks the token used within a transaction, writes the audit log, throws `ALREADY_A_MEMBER` + skips the transaction when the user is already a member, and bubbles the same invalid/expired/used errors.
- [`group.controller.spec.ts`](../apps/api/src/group/group.controller.spec.ts) — 3 new endpoint tests covering the `createInvite`, `getInviteInfo`, and `acceptInvite` handlers each delegating correctly to the service.

**Results**:

- All 43 group tests pass (14 controller + 29 service).
- Full monorepo `pnpm run test` passes: 379 api + 303 web + shared/eslint-config suites (all green).
- CI (`24858515179`) and Deploy Staging (`24858515183`) on `develop` both green.

**Files changed:**

- [`apps/api/src/group/group.service.ts`](../apps/api/src/group/group.service.ts) — Added `createInvite`, `getInviteInfo`, `acceptInvite`, `ensureInviteUsable`, `hashToken`
- [`apps/api/src/group/group.controller.ts`](../apps/api/src/group/group.controller.ts) — Added 3 invite endpoints with correct route ordering
- [`apps/api/src/group/group.service.spec.ts`](../apps/api/src/group/group.service.spec.ts) — Added invite unit tests
- [`apps/api/src/group/group.controller.spec.ts`](../apps/api/src/group/group.controller.spec.ts) — Added invite endpoint tests

## Iteration 5.5: Accept Invite UI + Join Flow (2026-04-24)

- **Date**: April 24, 2026
- **Commit**: `d7af50d` (develop)
- **CI run**: `24878841627` — success
- **Deploy Staging run**: `24878841574` — success

**Changes**: Implemented the frontend UI for accepting group invites. The page lives at `/groups/invite/[token]`, is wrapped in `ProtectedRoute`, loads invite details from the iteration 5.4 API, and lets the user accept or decline the invitation.

**Frontend types** ([`apps/web/src/lib/group/types.ts`](../apps/web/src/lib/group/types.ts)):

- Added `InviteInfo` interface (`groupId`, `groupName`, `groupType`, `inviterName`) mirroring the `GET /groups/invite/:token` response.

**GroupContext extensions** ([`apps/web/src/lib/group/group-context.tsx`](../apps/web/src/lib/group/group-context.tsx)):

- Added `getInviteInfo(token)` — `GET /groups/invite/:token` with bearer auth, returns `InviteInfo`.
- Added `acceptInvite(token)` — `POST /groups/invite/:token/accept`, refreshes the local group list on success, returns the joined `GroupSummary`.
- Introduced a shared `throwApiError()` helper that parses the API's `{ message, errorCode }` envelope and rethrows an `Error` with an attached `.errorCode` property, so the UI can distinguish `GROUP_INVITE_TOKEN_INVALID` / `_EXPIRED` / `_USED` / `GROUP_ALREADY_A_MEMBER`.

**Invite page** ([`apps/web/src/app/[locale]/groups/invite/[token]/page.tsx`](../apps/web/src/app/%5Blocale%5D/groups/invite/%5Btoken%5D/page.tsx)):

- `'use client'` page extracting `token` via `useParams()` from `next/navigation`, using the `@/i18n/navigation` router for locale-aware navigation.
- Loading state: skeleton card while fetching invite details.
- Error state: dedicated error card with a localised title per error kind (`invalid`, `expired`, `used`, `generic`) and a "Go to Groups" button.
- Success state: card with group name (large, bold), translated type badge, "Invited by {name}" line, and two buttons — "Decline" (secondary → navigates to `/groups`) and "Accept & Join" (primary).
- Accept flow: disables the button, shows "Joining..." state, navigates to `/groups/{groupId}` on success with a success toast, shows "You're already a member" info toast and navigates after 1.5s on `GROUP_ALREADY_A_MEMBER`, shows a localised error toast and re-enables the button for other errors.

**i18n translations** (added under existing `groups.*` namespace):

- [`apps/web/messages/en.json`](../apps/web/messages/en.json) — `groups.invite.*`: `title`, `joinMessage`, `invitedBy`, `accept`, `accepting`, `decline`, `acceptSuccess`, `alreadyMember`, `goToGroups`, `loading`, `error.{invalid,expired,used,generic}`.
- [`apps/web/messages/he.json`](../apps/web/messages/he.json) — Same keys with Hebrew translations.

**Tests added**:

- [`invite.spec.tsx`](../apps/web/src/app/%5Blocale%5D/groups/invite/%5Btoken%5D/invite.spec.tsx) — 11 tests: loading skeleton, successful render (group name, type, inviter), error cards for invalid / expired / used / generic tokens, "Go to Groups" navigation on error, Accept flow success + toast + navigation, `GROUP_ALREADY_A_MEMBER` handling with fake timers advancing the 1.5s delay, non-member error toast with button re-enabled, Decline navigation.

**Results**:

- All 11 new invite tests pass. Full web suite: 314 web unit tests passing.
- Full monorepo `pnpm run test` passes: 379 api + 314 web + 54 shared.
- CI (`24878841627`) and Deploy Staging (`24878841574`) on `develop` both green.

**Note on login redirect**: The existing `ProtectedRoute` already preserves the return URL via `?redirect=...`, so after logging in the user is returned to the invite page without any extra work.

**Files changed:**

- [`apps/web/src/lib/group/types.ts`](../apps/web/src/lib/group/types.ts) — Added `InviteInfo`
- [`apps/web/src/lib/group/group-context.tsx`](../apps/web/src/lib/group/group-context.tsx) — Added `getInviteInfo`, `acceptInvite`, `throwApiError`
- [`apps/web/src/app/[locale]/groups/invite/[token]/page.tsx`](../apps/web/src/app/%5Blocale%5D/groups/invite/%5Btoken%5D/page.tsx) — New invite page
- [`apps/web/src/app/[locale]/groups/invite/[token]/invite.spec.tsx`](../apps/web/src/app/%5Blocale%5D/groups/invite/%5Btoken%5D/invite.spec.tsx) — New tests
- [`apps/web/messages/en.json`](../apps/web/messages/en.json) — `groups.invite.*`
- [`apps/web/messages/he.json`](../apps/web/messages/he.json) — Hebrew translations

## Iteration 5.6: Group Dashboard View (2026-04-24)

- **Date**: April 24, 2026
- **Commit**: `efc7cd0` (develop)
- **CI run**: `24882200339` — success
- **Deploy Staging run**: `24882200336` — success

**Changes**: Implemented the single-group dashboard page that closes the navigation loop after an invite is accepted. The page lives at `/groups/[groupId]`, is wrapped in `ProtectedRoute`, loads the group via the existing iteration 5.2 `GET /groups/:id` endpoint (which already returns full member details via Prisma `include`), and renders the group header, a placeholder overview section, and a sortable member list.

**GroupContext extension** ([`apps/web/src/lib/group/group-context.tsx`](../apps/web/src/lib/group/group-context.tsx)):

- Added `getGroup(groupId)` that calls `GET /groups/:id` with bearer auth, reuses the shared `throwApiError()` helper introduced in iteration 5.5, and returns the existing `GroupDetail` type.

**Dashboard page** ([`apps/web/src/app/[locale]/groups/[groupId]/page.tsx`](../apps/web/src/app/%5Blocale%5D/groups/%5BgroupId%5D/page.tsx)):

- `'use client'` page extracting `groupId` via `useParams()` from `next/navigation`, locale-aware navigation via `@/i18n/navigation`.
- **Loading state**: skeleton card with animated placeholder bars for header and member rows.
- **Error state**: dedicated error card with localised title ("Group not found or you don't have access") and a "Back to Groups" button — covers both 404 (group missing) and 403 (not a member) without leaking distinguishing detail.
- **Header**: large group name, type badge (translated via `groups.type.*`), currency badge (monospace font), and a "Settings" button linked to the future `/groups/{groupId}/settings` page. The settings button is rendered only when the current user's membership role is `admin`.
- **Overview**: placeholder card with icon and localised "More features coming soon — budgets, expenses, and shared goals." message.
- **Members**: heading "Members (N members)" with ICU pluralisation; list of rows with a 10×10 avatar displaying the first letter of the member's name, name (with "(You)" suffix for the current user), email, admin badge (rendered only for admins), and a "Joined {date}" line using `toLocaleDateString(locale)` with short-month formatting. Rows are sorted admins-first, then by `joinedAt` ascending.

**i18n translations** (added under existing `groups.*` namespace, keeping DRY by sharing `groups.role.*` / `groups.type.*` with the list and card):

- [`apps/web/messages/en.json`](../apps/web/messages/en.json) — `groups.dashboard.*`: `loading`, `notFound`, `backToGroups`, `settingsButton`, `overviewTitle`, `overviewPlaceholder`, `membersTitle`, `memberCount` (plural form), `joinedOn`, `you`.
- [`apps/web/messages/he.json`](../apps/web/messages/he.json) — Same keys with Hebrew translations.

**GroupCard**: already clickable via a `Link` from `@/i18n/navigation` pointing at `/groups/{group.id}` (introduced in iteration 5.3). No changes required, existing test `renders link to the group detail page` already covers navigation.

**Tests added**:

- [`dashboard.spec.tsx`](../apps/web/src/app/%5Blocale%5D/groups/%5BgroupId%5D/dashboard.spec.tsx) — 14 tests: loading skeleton render; header rendering with name, type badge, currency badge; member count pluralisation for both plural and singular; member row rendering with name and email; `(You)` marker on the current user only; admin badge shown only for admin members; sort order (admins first then by `joinedAt` ascending); Settings button rendered for admins with correct `href`; Settings button hidden for non-admin members; error card render on a rejected `getGroup`; "Back to Groups" navigation from the error card; overview placeholder render; joined date line present with "Joined " prefix.

**Results**:

- All 14 new dashboard tests pass. Full web suite: 328 web unit tests passing.
- Full monorepo `pnpm run test` passes: 379 api + 328 web + 54 shared.
- CI (`24882200339`) and Deploy Staging (`24882200336`) on `develop` both green.

**Backend**: no changes required — the iteration 5.2 `GroupService.getGroup()` already includes `memberships.include.user` and maps to the full `GroupDetail` shape (`id`, `name`, `email`, `role`, `joinedAt` per member), and the controller already wires the `GroupMemberGuard` so the endpoint returns 403 for non-members and 404 for missing groups.

**Files changed:**

- [`apps/web/src/lib/group/group-context.tsx`](../apps/web/src/lib/group/group-context.tsx) — Added `getGroup(groupId)` and exposed it on the context
- [`apps/web/src/app/[locale]/groups/[groupId]/page.tsx`](../apps/web/src/app/%5Blocale%5D/groups/%5BgroupId%5D/page.tsx) — New dashboard page
- [`apps/web/src/app/[locale]/groups/[groupId]/dashboard.spec.tsx`](../apps/web/src/app/%5Blocale%5D/groups/%5BgroupId%5D/dashboard.spec.tsx) — New tests
- [`apps/web/messages/en.json`](../apps/web/messages/en.json) — `groups.dashboard.*`
- [`apps/web/messages/he.json`](../apps/web/messages/he.json) — Hebrew translations

## Iteration 5.7: Group Settings + Member Management UI (2026-04-24)

- **Date**: April 24, 2026
- **Commit**: `9b85f75` (develop)
- **CI run**: `24889057760` — success (1m33s)
- **Deploy Staging run**: `24889057828` — success (5m24s)

**Changes**: Closed the group-management loop by implementing the admin-only group settings page. The page lives at `/groups/[groupId]/settings`, is wrapped in `ProtectedRoute`, and bundles group info editing, invite-link generation, member-role management, member removal, and a typed-name delete flow. Two new REST endpoints were added to back the member-management UI.

**Backend** — `apps/api/src/group`:

- `GROUP_ERRORS.CANNOT_REMOVE_SELF: 'GROUP_CANNOT_REMOVE_SELF'` added to the error catalogue ([`constants/group-errors.ts`](../apps/api/src/group/constants/group-errors.ts)).
- New [`UpdateMemberRoleDto`](../apps/api/src/group/dto/update-member-role.dto.ts) with `role` validated via `@IsIn([...GROUP_ROLES])`.
- `GroupService.updateMemberRole(groupId, targetUserId, actorUserId, newRole)`:
  - 404 `GROUP_NOT_A_MEMBER` if the target user is not a member.
  - Returns early without writes when role is unchanged.
  - When demoting the last admin, counts remaining admins via `groupMembership.count({ role: 'admin', NOT: { userId: targetUserId } })` and throws 409 `GROUP_CANNOT_REMOVE_LAST_ADMIN` if none remain.
  - Persists the update and writes an audit log with `action: 'group.member.role_changed'`, `details: { targetUserId, oldRole, newRole }`.
- `GroupService.removeMember(groupId, targetUserId, actorUserId)`:
  - 400 `GROUP_CANNOT_REMOVE_SELF` if the actor attempts to remove themselves (directs them to the leave flow).
  - 404 `GROUP_NOT_A_MEMBER` if the target is not a member.
  - Last-admin protection: identical admin-count check; throws 409 `GROUP_CANNOT_REMOVE_LAST_ADMIN` when removing the sole admin.
  - Deletes the membership and writes audit log `action: 'group.member.removed'`, `details: { targetUserId }`.
- [`GroupController`](../apps/api/src/group/group.controller.ts) exposes:
  - `PATCH /groups/:id/members/:userId` with `JwtAuthGuard + GroupAdminGuard`, 200 returning the updated membership.
  - `DELETE /groups/:id/members/:userId` with `JwtAuthGuard + GroupAdminGuard`, 204 No Content.
- Tests: 13 new cases across [`group.service.spec.ts`](../apps/api/src/group/group.service.spec.ts) and [`group.controller.spec.ts`](../apps/api/src/group/group.controller.spec.ts) covering success, `NOT_A_MEMBER`, last-admin protection, unchanged-role no-op, self-removal blocked, DTO validation, and controller delegation.

**Frontend — GroupContext extension** ([`group-context.tsx`](../apps/web/src/lib/group/group-context.tsx)):

- `createInvite(groupId)` — `POST /groups/:id/invites`, returns `{ token, expiresAt, inviteUrl }`. Backend returns a path-only `inviteUrl` (e.g. `/groups/invite/:token`); the context prepends `window.location.origin` client-side so consumers always receive an absolute URL.
- `updateMemberRole(groupId, userId, role)` — `PATCH /groups/:id/members/:userId` with `{ role }` body.
- `removeMember(groupId, userId)` — `DELETE /groups/:id/members/:userId`.
- `refreshGroup(groupId)` — simple wrapper around `getGroup()` used by callers after mutations.
- `updateGroup` and `deleteGroup` were migrated from a legacy inline error parser to the shared `throwApiError()` helper so all group-context calls consistently attach `.errorCode` to thrown errors (required by the new settings page for localising error toasts).

**InviteLink component** ([`InviteLink.tsx`](../apps/web/src/components/group/InviteLink.tsx)):

- Props: `groupId`.
- Renders a "Generate Invite Link" button; on click calls `createInvite(groupId)` and shows a loading state.
- On success: read-only input with the full URL, a Copy button (uses `navigator.clipboard.writeText` when available, falls back to `input.select()` + `document.execCommand('copy')` for SSR/older browsers), an "Expires on {date}" line using `toLocaleString(locale)`, and a "Generate new link" button.
- Toast notifications for copy success and API failure; all strings via `useTranslations('groups.settings.invite')`.

**MemberManagement component** ([`MemberManagement.tsx`](../apps/web/src/components/group/MemberManagement.tsx)):

- Props: `group: GroupDetail`, `currentUserId: string`.
- Renders the member list sorted admins-first then by `joinedAt`, each row showing avatar, name (with "(You)" marker), email, joined date, a native `<select>` role dropdown, and a Remove button.
- Current-user row: role dropdown and remove button both disabled — the user must use the leave flow (iteration 5.8) to self-demote/transfer admin.
- Role change dispatches `updateMemberRole` with an `onUpdated` callback; removal opens a simple div-based confirmation dialog (mirrors the `DeleteAccountDialog` pattern) before calling `removeMember`.
- Error codes from the context (`GROUP_CANNOT_REMOVE_LAST_ADMIN`, `GROUP_NOT_A_MEMBER`, `GROUP_CANNOT_REMOVE_SELF`) are mapped to localised toast messages.

**Settings page** ([`/groups/[groupId]/settings/page.tsx`](../apps/web/src/app/%5Blocale%5D/groups/%5BgroupId%5D/settings/page.tsx)):

- `'use client'` wrapped in `ProtectedRoute`, extracts `groupId` via `useParams()` from `next/navigation`.
- On mount calls `getGroup(groupId)`; shows a loading skeleton while pending.
- Non-admin detection: renders a dedicated "no permission" card with a "Back to Group" link.
- Load failure (404/403): error card with a "Back to Groups" button.
- **Group Info** card — inputs for name (text), type (dropdown sourced from `GROUP_TYPES`), default currency (dropdown sourced from `CURRENCIES`); Save button wired to `updateGroup()` with loading state and localised success/error toasts; refreshes the group on success.
- **Invite Members** card — renders `<InviteLink groupId={groupId} />`.
- **Members** card — renders `<MemberManagement group={group} currentUserId={user.id} />` with an `onUpdated` refresh handler.
- **Danger Zone** card (red border) — "Delete Group" button opens a confirmation dialog that requires the user to type the group name (mirrors the [`DeleteAccountDialog`](../apps/web/src/components/auth/DeleteAccountDialog.tsx) pattern — confirm button disabled until the input matches `group.name` exactly, with a mismatch error when partial). On confirm calls `deleteGroup(groupId)`, navigates to `/groups`, and shows the success toast.

**Dashboard wiring**: the Settings button in the group dashboard (iteration 5.6) already pointed at `/groups/{groupId}/settings`; no changes required — the link now resolves to a real page.

**i18n translations** — new `groups.settings.*` namespace added to both [`en.json`](../apps/web/messages/en.json) and [`he.json`](../apps/web/messages/he.json):

- Top-level: `title`, `loading`, `noPermission`, `backToGroup`, `backToGroups`.
- `info.*` — `title`, `nameLabel`, `typeLabel`, `currencyLabel`, `saveButton`, `saving`, `saveSuccess`, `saveError`.
- `invite.*` — `title`, `description`, `generateButton`, `generating`, `copyButton`, `copied`, `linkLabel`, `expiresOn` (with `{date}` ICU arg), `regenerateButton`, `error`.
- `members.*` — `title` (with `{count}` ICU arg), `roleLabel`, `admin`, `member`, `removeButton`, `removeConfirmTitle`, `removeConfirmMessage` (with `{name}`), `removeConfirmButton`, `cancelButton`, `roleChangeSuccess`, `removeSuccess`, and a nested `errors.*` block (`cannotRemoveLastAdmin`, `cannotRemoveSelf`, `notAMember`, `generic`).
- `dangerZone.*` — `title`, `deleteHeading`, `deleteDescription`, `deleteButton`, `dialogTitle` (with `{name}`), `dialogMessage`, `dialogInputPlaceholder`, `dialogConfirmButton`, `dialogCancelButton`, `mismatchError`, `deleteSuccess`, `deleteError`.

**Tests added**:

- [`InviteLink.spec.tsx`](../apps/web/src/components/group/InviteLink.spec.tsx) — 6 tests: generate button render, successful link generation, clipboard copy with toast, API error toast, clipboard-unavailable fallback to `select()`, regenerate flow replacing the previous link.
- [`MemberManagement.spec.tsx`](../apps/web/src/components/group/MemberManagement.spec.tsx) — 12 tests: member list render, sort order (admins first then by `joinedAt`), disabled controls on current-user row, role change success with refresh callback, role change API failure toast, remove opens confirmation dialog, cancel closes it, confirm calls `removeMember` + toast + refresh, error code mapping (`CANNOT_REMOVE_LAST_ADMIN`, `CANNOT_REMOVE_SELF`, `NOT_A_MEMBER`, generic).
- [`settings.spec.tsx`](../apps/web/src/app/%5Blocale%5D/groups/%5BgroupId%5D/settings/settings.spec.tsx) — 10 tests: loading skeleton, non-admin permission card with correct back-link, load-error card with navigation, all four cards render for admins, info form prefill, save flow with success toast and payload assertion, delete dialog mismatch/match state, delete-confirmation flow calling `deleteGroup` and navigating to `/groups`, invite and member sections render inside the page.

**Results**:

- Full `pnpm run test` on develop: **api 394/394 • web 356/356 • shared 54/54** — all passing.
- Prettier applied to all 15 changed files; no lint regressions (the pre-existing import-order annotation on `invite/[token]/page.tsx` is unrelated and unchanged by this iteration).
- CI (`24889057760`, 1m33s) and Deploy Staging (`24889057828`, 5m24s) on `develop` both green.

**Files changed:**

- [`apps/api/src/group/constants/group-errors.ts`](../apps/api/src/group/constants/group-errors.ts) — `CANNOT_REMOVE_SELF` code.
- [`apps/api/src/group/dto/update-member-role.dto.ts`](../apps/api/src/group/dto/update-member-role.dto.ts) — new DTO.
- [`apps/api/src/group/group.service.ts`](../apps/api/src/group/group.service.ts) — `updateMemberRole()`, `removeMember()`.
- [`apps/api/src/group/group.controller.ts`](../apps/api/src/group/group.controller.ts) — PATCH/DELETE endpoints.
- [`apps/api/src/group/group.service.spec.ts`](../apps/api/src/group/group.service.spec.ts) — new tests.
- [`apps/api/src/group/group.controller.spec.ts`](../apps/api/src/group/group.controller.spec.ts) — new tests.
- [`apps/web/src/lib/group/group-context.tsx`](../apps/web/src/lib/group/group-context.tsx) — `createInvite`, `updateMemberRole`, `removeMember`, `refreshGroup`, `InviteCreatedResult`; `updateGroup`/`deleteGroup` migrated to `throwApiError`.
- [`apps/web/src/components/group/InviteLink.tsx`](../apps/web/src/components/group/InviteLink.tsx) + [`InviteLink.spec.tsx`](../apps/web/src/components/group/InviteLink.spec.tsx).
- [`apps/web/src/components/group/MemberManagement.tsx`](../apps/web/src/components/group/MemberManagement.tsx) + [`MemberManagement.spec.tsx`](../apps/web/src/components/group/MemberManagement.spec.tsx).
- [`apps/web/src/app/[locale]/groups/[groupId]/settings/page.tsx`](../apps/web/src/app/%5Blocale%5D/groups/%5BgroupId%5D/settings/page.tsx) + [`settings.spec.tsx`](../apps/web/src/app/%5Blocale%5D/groups/%5BgroupId%5D/settings/settings.spec.tsx).
- [`apps/web/messages/en.json`](../apps/web/messages/en.json) — `groups.settings.*`.
- [`apps/web/messages/he.json`](../apps/web/messages/he.json) — Hebrew translations.

## Iteration 5.8: Leave Group + Audit Logging Review (2026-04-24)

- **Date**: April 24, 2026
- **Commit**: `fcf9c39` (develop)
- **CI run**: `24899736063` — success
- **Deploy Staging run**: `24899736079` — success (1m46s)

**Changes**: Completed Phase 5 group-management by adding a self-service "Leave Group" flow and reviewing/hardening audit logging across all group operations. Users can now leave groups from the dashboard; when the last admin is also the last member, the group is deleted as a convenience ("last one out, turn off the lights").

**Backend** — [`apps/api/src/group`](../apps/api/src/group):

- `GroupService.leaveGroup(groupId, userId)` in [`group.service.ts`](../apps/api/src/group/group.service.ts):
  - Looks up the caller's membership (guard already enforces member access; this is a defence-in-depth check → 404 `GROUP_NOT_A_MEMBER`).
  - Counts total members, and admins if the caller is an admin.
  - **Last admin + other members** → throws 409 `GROUP_CANNOT_LEAVE_AS_LAST_ADMIN` with a message telling the user to promote another member first.
  - **Last admin + only member** → deletes the whole group (cascade removes memberships/invites) and writes two audit logs: `group.member.left` (with `wasLastAdmin: true`) and `group.deleted_on_leave`.
  - **Normal case** → deletes the caller's `GroupMembership` and writes `group.member.left` (with `wasLastAdmin: false`).
  - All audit log writes are wrapped in `try/catch` and logged via `this.logger.warn(...)` so an audit failure never breaks the main operation.
- [`group.controller.ts`](../apps/api/src/group/group.controller.ts) exposes `POST /groups/:id/leave` with `JwtAuthGuard + GroupMemberGuard`, 204 No Content, throttled at 10 requests per minute.
- Swagger responses: 401, 403 (non-member), 404, 409 (last admin).
- 6 new unit tests in [`group.service.spec.ts`](../apps/api/src/group/group.service.spec.ts): normal leave, admin leaves with co-admin, last-admin-blocked, last-member-deletes-group, not-a-member (404), and audit-log-failure-is-swallowed. 2 new controller tests in [`group.controller.spec.ts`](../apps/api/src/group/group.controller.spec.ts): delegation + error propagation.

**Audit logging review** — Verified audit logs already exist (or were added in this iteration) for every group operation:

| Service method             | Action                            | Status      |
| -------------------------- | --------------------------------- | ----------- |
| `createGroup`              | `GROUP_CREATED`                   | ✓ 5.2       |
| `updateGroup`              | `GROUP_UPDATED` (details.changes) | ✓ 5.2       |
| `deleteGroup`              | `GROUP_DELETED`                   | ✓ 5.2       |
| `createInvite`             | `GROUP_INVITE_CREATED`            | ✓ 5.4       |
| `acceptInvite`             | `GROUP_MEMBER_JOINED`             | ✓ 5.5       |
| `updateMemberRole`         | `group.member.role_changed`       | ✓ 5.7       |
| `removeMember`             | `group.member.removed`            | ✓ 5.7       |
| `leaveGroup`               | `group.member.left`               | ✓ 5.8 (new) |
| `leaveGroup` (last member) | `group.deleted_on_leave`          | ✓ 5.8 (new) |

Action-name style is historically mixed (`UPPER_SNAKE_CASE` in older iterations, `dot.notation` in newer ones); left as-is to preserve historical audit continuity. Noted for a possible future clean-up.

**Permission hardening review** — Verified guard coverage across [`group.controller.ts`](../apps/api/src/group/group.controller.ts):

- Admin-only: `PATCH /:id`, `DELETE /:id`, `POST /:id/invites`, `PATCH /:id/members/:userId`, `DELETE /:id/members/:userId` all use `JwtAuthGuard + GroupAdminGuard`.
- Member-only: `GET /:id`, `POST /:id/leave` use `JwtAuthGuard + GroupMemberGuard`.
- `GET /groups` uses only `JwtAuthGuard` (filters by `userId` server-side).
- `GET /groups/invite/:token` and `POST /groups/invite/:token/accept` use only `JwtAuthGuard` (no membership yet).

No permission gaps found; no code changes needed.

**Frontend** — [`group-context.tsx`](../apps/web/src/lib/group/group-context.tsx):

- New `leaveGroup(groupId)` method — `POST /groups/:id/leave`, uses the shared `throwApiError()` helper so the thrown `Error` carries an `.errorCode` (e.g. `GROUP_CANNOT_LEAVE_AS_LAST_ADMIN`). On success, removes the group from the local `groups[]` state.

**Group dashboard page** — [`/groups/[groupId]/page.tsx`](../apps/web/src/app/%5Blocale%5D/groups/%5BgroupId%5D/page.tsx):

- Added a "Leave Group" button in the header action area next to the (admin-only) Settings button. Visible to **all members** including admins.
- Style: white background with a red border/text, deliberately less prominent than the full-red "Delete Group" button in Settings.
- Click opens an inline confirmation dialog ("Leave {name}?" + Cancel/Leave) — no typed-name gate, since leaving is reversible (re-invite) whereas deleting is not.
- On success: `addToast('success', "You've left {name}")` and `router.push('/groups')`.
- On `GROUP_CANNOT_LEAVE_AS_LAST_ADMIN`: localised error toast. All other errors: generic fallback toast.

**i18n** ([`en.json`](../apps/web/messages/en.json), [`he.json`](../apps/web/messages/he.json)): added `groups.dashboard.leaveButton`, `leaveConfirmTitle`, `leaveConfirmMessage`, `leaveConfirmButton`, `leaveCancelButton`, `leaveSuccess`, and `leaveErrors.lastAdmin` / `leaveErrors.generic`.

**Tests** — [`dashboard.spec.tsx`](../apps/web/src/app/%5Blocale%5D/groups/%5BgroupId%5D/dashboard.spec.tsx): 6 new tests — button visible for admins and for non-admin members, dialog opens on click, Cancel closes without calling the API, success path calls `leaveGroup` + navigates + success toast, last-admin error toast, generic error toast.

**Test totals**: 402 backend + 363 frontend tests pass (`pnpm run test`).

**Files touched**:

- [`apps/api/src/group/group.service.ts`](../apps/api/src/group/group.service.ts) — `leaveGroup()`.
- [`apps/api/src/group/group.controller.ts`](../apps/api/src/group/group.controller.ts) — `POST :id/leave`.
- [`apps/api/src/group/group.service.spec.ts`](../apps/api/src/group/group.service.spec.ts) + [`group.controller.spec.ts`](../apps/api/src/group/group.controller.spec.ts).
- [`apps/web/src/lib/group/group-context.tsx`](../apps/web/src/lib/group/group-context.tsx) — `leaveGroup` method.
- [`apps/web/src/app/[locale]/groups/[groupId]/page.tsx`](../apps/web/src/app/%5Blocale%5D/groups/%5BgroupId%5D/page.tsx) + [`dashboard.spec.tsx`](../apps/web/src/app/%5Blocale%5D/groups/%5BgroupId%5D/dashboard.spec.tsx).
- [`apps/web/messages/en.json`](../apps/web/messages/en.json), [`he.json`](../apps/web/messages/he.json).

## Iteration 5.11: Password Change (2026-04-24)

- **Date**: April 24, 2026
- **Commit**: `2f85f6a` (develop)
- **CI run**: `24902520185` — success (1m28s)
- **Deploy Staging run**: `24902520204` — success

**Changes**: Final functional iteration of Phase 5. Authenticated users can now change their password from the Account Settings page. OAuth-only users (no `passwordHash`) see a friendly info card directing them to the password-reset flow instead of the form.

**Backend** — [`apps/api/src/auth`](../apps/api/src/auth):

- [`ChangePasswordDto`](../apps/api/src/auth/dto/change-password.dto.ts) — `currentPassword` (required string) + `newPassword` (8–128 chars, must contain upper/lower/digit via `@Matches`).
- [`AUTH_ERRORS`](../apps/api/src/auth/constants/auth-errors.ts) — three new codes: `PASSWORD_NOT_SET: 'AUTH_PASSWORD_NOT_SET'`, `INVALID_CURRENT_PASSWORD: 'AUTH_INVALID_CURRENT_PASSWORD'`, `PASSWORD_SAME_AS_CURRENT: 'AUTH_PASSWORD_SAME_AS_CURRENT'`.
- [`AuthService.changePassword(userId, dto)`](../apps/api/src/auth/auth.service.ts):
  - Loads the user (selects `passwordHash`).
  - Throws 400 `PASSWORD_NOT_SET` when `passwordHash === null` (OAuth-only users).
  - Verifies `currentPassword` via the existing `PasswordService` (argon2id — matches the rest of the codebase); throws 400 `INVALID_CURRENT_PASSWORD` on mismatch.
  - Throws 400 `PASSWORD_SAME_AS_CURRENT` when the new password equals the current one (checked via `passwordService.verify` against the existing hash, not string comparison, to stay consistent with hashed storage).
  - Hashes the new password and updates the user.
  - Invalidates all refresh tokens via `refreshTokenService.revokeAllUserTokens(userId)` (reuses the existing helper used by the password-reset flow).
  - Writes an audit log with `action: 'auth.password_changed'`, `entity: 'User'`, `entityId: userId`.
- [`AuthController`](../apps/api/src/auth/auth.controller.ts) exposes `POST /auth/change-password` with `JwtAuthGuard`, rate-limited via `@CustomThrottle({ limit: 5, ttl: 60000 })`, returns 204 No Content. Full Swagger annotations.
- [`ValidatedUser`](../apps/api/src/auth/interfaces/validated-user.interface.ts) grew a new `hasPassword: boolean` field. Every AuthService method that returns a user (register, login, Google/Telegram find-or-create, refresh, `getUser`, `updateProfile`) now sets `hasPassword: user.passwordHash !== null`. `getUser()` selects `passwordHash` on the Prisma query and strips it from the returned object after deriving the flag.

**Backend tests**:

- [`auth.service.spec.ts`](../apps/api/src/auth/auth.service.spec.ts) — 7 new cases for `changePassword`: success path (updates hash, revokes tokens, writes audit log), wrong current password, OAuth-only user, same-as-current password, and explicit assertions for refresh-token revocation and audit-log payload. Existing `mockUser` fixtures throughout the file were updated to include `passwordHash` + `hasPassword: true`.
- [`auth.controller.spec.ts`](../apps/api/src/auth/auth.controller.spec.ts) — 5 tests covering happy path, delegation to the service, and validation-error propagation.
- [`password-change.integration.spec.ts`](../apps/api/test/integration/password-change.integration.spec.ts) — 7 integration tests: register → change password → login with new password succeeds → login with old password fails; plus 401/400 coverage, audit log creation check, and refresh-token revocation check against the real DB.

**Frontend** — [`apps/web/src](../apps/web/src):

- [`User`](../apps/web/src/lib/auth/types.ts) type grew `hasPassword: boolean`.
- [`AuthContext`](../apps/web/src/lib/auth/auth-context.tsx) — new `changePassword(currentPassword, newPassword)` method POSTing to `/auth/change-password` with bearer auth. Introduced an `ApiError` class (extends `Error`, adds `errorCode`) and `throwApiError()` helper mirroring the group-context pattern so consumers can switch on `.errorCode`.
- [`ChangePasswordForm`](../apps/web/src/components/auth/ChangePasswordForm.tsx) component:
  - Three password inputs (current, new, confirm) each with the show/hide eye toggle reused from the existing reset/login flows.
  - Reuses the shared [`PasswordStrength`](../apps/web/src/components/auth/PasswordStrength.tsx) component for the new password field.
  - Client-side validation: all required, new ≥ 8 chars, matches confirm, and must differ from current before hitting the API.
  - On success: clears the form + success toast. Error codes are mapped to localised toasts (`AUTH_PASSWORD_NOT_SET`, `AUTH_INVALID_CURRENT_PASSWORD`, `AUTH_PASSWORD_SAME_AS_CURRENT`, generic fallback).
- [`Account Settings page`](../apps/web/src/app/%5Blocale%5D/settings/account/page.tsx) — a new "Password" section between Preferences and Delete Account:
  - Renders `<ChangePasswordForm />` when `user.hasPassword === true`.
  - Renders an info card with a link to `/auth/forgot-password` when the user has no password set (OAuth-only).

**i18n** — new `settings.account.password.*` namespace in [`en.json`](../apps/web/messages/en.json) and [`he.json`](../apps/web/messages/he.json): labels (`title`, `changeHeading`, `currentPasswordLabel`, `newPasswordLabel`, `confirmPasswordLabel`), show/hide toggle text, submit/submitting strings, success message, OAuth-only copy, and a nested `errors.*` block (`currentRequired`, `newRequired`, `confirmRequired`, `newTooShort`, `passwordMismatch`, `sameAsCurrent`, `invalidCurrent`, `passwordNotSet`, `generic`). Hebrew translations follow the existing style and RTL conventions used elsewhere in the settings namespace.

**Frontend tests**:

- [`ChangePasswordForm.spec.tsx`](../apps/web/src/components/auth/ChangePasswordForm.spec.tsx) — 11 tests: renders fields, show/hide toggle, required-field validation, min-length check, mismatch check, same-as-current pre-check, loading state, success path (toast + form cleared), and error-code → localised toast mapping for all three server error codes.
- [`account-settings.spec.tsx`](../apps/web/src/app/%5Blocale%5D/settings/account/account-settings.spec.tsx) — 3 new tests verifying the Password section renders the form when `hasPassword: true` and the OAuth-only notice (with link to `/auth/forgot-password`) when `hasPassword: false`. The existing mock user was updated with the `hasPassword` field and `changePassword: vi.fn()`.
- [`auth-context.spec.tsx`](../apps/web/src/lib/auth/auth-context.spec.tsx) — 2 new tests for the `changePassword` method: success path (204 → no throw) and error-code propagation (4xx → rethrows with `.errorCode`).

**Results**:

- Backend: `pnpm test` → **415/415** passing (29 suites).
- Frontend: `pnpm test` → **379/379** passing (35 suites).
- Prettier applied to all 17 changed files; typecheck clean on both `apps/api` and `apps/web`.
- CI (`24902520185`, 1m28s) and Deploy Staging (`24902520204`) on `develop` both green.

**Security notes**:

- Old password is verified via argon2 — never compared as plaintext.
- `PASSWORD_SAME_AS_CURRENT` is checked against the stored hash, not against `currentPassword` in-memory, so even if the frontend validation is bypassed the server still rejects unchanged passwords.
- All refresh tokens are revoked immediately after a password change, so any attacker holding a stolen refresh token loses access at the next token-refresh cycle. The current access token remains valid until its 15-minute expiry by design (classic trade-off — avoiding forced re-login while still bounding the compromise window).

**Files touched**:

- [`apps/api/src/auth/dto/change-password.dto.ts`](../apps/api/src/auth/dto/change-password.dto.ts) — new DTO.
- [`apps/api/src/auth/constants/auth-errors.ts`](../apps/api/src/auth/constants/auth-errors.ts) — new error codes.
- [`apps/api/src/auth/interfaces/validated-user.interface.ts`](../apps/api/src/auth/interfaces/validated-user.interface.ts) — `hasPassword`.
- [`apps/api/src/auth/auth.service.ts`](../apps/api/src/auth/auth.service.ts) — `changePassword()`, `hasPassword` on every return site.
- [`apps/api/src/auth/auth.controller.ts`](../apps/api/src/auth/auth.controller.ts) — `POST /auth/change-password`.
- [`apps/api/src/auth/auth.service.spec.ts`](../apps/api/src/auth/auth.service.spec.ts) + [`auth.controller.spec.ts`](../apps/api/src/auth/auth.controller.spec.ts) — new tests + fixture updates.
- [`apps/api/test/integration/password-change.integration.spec.ts`](../apps/api/test/integration/password-change.integration.spec.ts) — new integration suite.
- [`apps/web/src/lib/auth/types.ts`](../apps/web/src/lib/auth/types.ts) — `hasPassword` on User.
- [`apps/web/src/lib/auth/auth-context.tsx`](../apps/web/src/lib/auth/auth-context.tsx) — `changePassword`, `ApiError`, `throwApiError`.
- [`apps/web/src/lib/auth/auth-context.spec.tsx`](../apps/web/src/lib/auth/auth-context.spec.tsx) — new tests.
- [`apps/web/src/components/auth/ChangePasswordForm.tsx`](../apps/web/src/components/auth/ChangePasswordForm.tsx) + [`ChangePasswordForm.spec.tsx`](../apps/web/src/components/auth/ChangePasswordForm.spec.tsx).
- [`apps/web/src/app/[locale]/settings/account/page.tsx`](../apps/web/src/app/%5Blocale%5D/settings/account/page.tsx) + [`account-settings.spec.tsx`](../apps/web/src/app/%5Blocale%5D/settings/account/account-settings.spec.tsx).
- [`apps/web/messages/en.json`](../apps/web/messages/en.json), [`apps/web/messages/he.json`](../apps/web/messages/he.json).

## Post-5.11 Polish: Dark-mode Contrast Fixes for Phase 5 Form Labels

User reported that form labels in several Phase 5 screens (Group Information form on
`/groups/[groupId]/settings`, Change Password form on `/settings/account`) were barely
legible in dark mode. Root cause: the shared [`Input`](../apps/web/src/components/ui/Input.tsx:1)
component's `<label>` used `text-gray-700` with no `dark:` variant, and the `<input>` itself
had no dark styles, so all labels rendered by `<Input />` (Group Name, Current/New/Confirm
Password, etc.) had insufficient contrast on a dark background.

Fix: added `dark:text-gray-300` to the label, dark background/text/placeholder classes to the
input, and `dark:text-red-400` to the error message inside [`Input`](../apps/web/src/components/ui/Input.tsx:1).
All other Phase 5 `<label>` elements and muted helper texts already had matching
`dark:text-gray-300` / `dark:text-gray-400` variants, so the one-file change propagates to
every form using `<Input />`. Tests: 379/379 frontend tests still pass.

## Phase 5 Complete — Production Deployment Verified

Phase 5 (Group Management & Password Change) merged from `develop` to `main` and deployed
to the production environment.

- **Plan update commit** (develop): `57d1545` — docs: update IMPLEMENTATION-PLAN.md with
  Phase 5 scope changes.
- **Merge commit** (main): `7bae5dd` — Merge Phase 5 with `--no-ff`, detailed commit body
  documenting 5.1–5.8 (Group Management), 5.11 (Password Change), polish, skipped items
  (5.9, 5.10, 5.12 — already covered by Phase 4) and deferred items (5.13, 5.14 — data
  export, post-Phase 6).
- **Production deploy run ID**: `24904752930` — completed successfully on 2026-04-24.
  Jobs: Validate Deployment ✓, Wait for CI ✓, Verify Staging Tests ✓, Build & Push Images
  ✓ (2m33s), Deploy to Production ✓ (1m49s, blue-green).
- **Test summary**: 415 API tests + 379 web tests + 54 shared tests, all passing; CI and
  staging tests green on the merged commit.

All iterations are now live in the production environment.
