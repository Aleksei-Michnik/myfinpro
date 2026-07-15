# UI realtime conventions

> Phase 6 · Iteration 6.18.1.4 — SSE infrastructure shipped. This document
> defines how product code should consume realtime events going forward.

## When to use realtime

Realtime is for **read-only UI freshness only**. Use it to:

- update list/detail views when the user (or a co-collaborator on a shared
  group) changes data on another tab or device,
- nudge a comment thread, schedule card, or starred indicator without a
  manual refresh,
- mark a transaction as deleted/updated in the cache.

Realtime is **never the source of truth**:

- All mutations still go through the regular HTTP API. The UI updates the
  store on the HTTP response, not on the SSE echo.
- A missed event must never break correctness. Lists and details continue
  to refresh on navigation / explicit refetch.
- An event may arrive for a record the UI doesn't have loaded — that's a
  no-op.

## Idempotency

The browser may receive **duplicate events** after a reconnect or when
multiple tabs share the same authenticated session. Handlers must be
idempotent:

- Replace-by-id on `*.created` / `*.updated` instead of append-blindly.
- Tolerate `*.deleted` for a record that's already gone.
- Treat each event as authoritative for its `transactionId` / `commentId` /
  `scheduleId` — don't merge fields from stale local state.

## Per-component pattern

```tsx
import { useRealtimeEvents } from '@/lib/realtime/use-realtime-events';

useRealtimeEvents({ type: 'comment.created', transactionId }, (event) => {
  setComments((current) => mergeComment(current, event.comment));
});
```

Rules:

- **Tight filter, single subscription.** Always pass the narrowest filter
  you need (`transactionId`, `parentTransactionId`, `commentId`). Avoid wildcard
  subscriptions — they make idempotency harder and waste re-renders.
- **One hook = one event type.** Subscribing to multiple event types from
  the same component means multiple hook calls. The discriminated union
  in [`apps/web/src/lib/realtime/realtime-types.ts`](../apps/web/src/lib/realtime/realtime-types.ts) gives
  you exhaustive type narrowing.
- **Never mutate from inside the handler.** Read current state via the
  setter callback; the handler may run while a render is pending.
- **No effects with cleanup logic.** The hook handles unsubscribe — do
  not wrap calls in `useEffect`.

## Auth + heartbeat

- The browser authenticates the SSE stream via the **`access_token`
  cookie** set on every login / register / refresh / OAuth callback.
  EventSource cannot send `Authorization` headers, hence the cookie path.
  See [`apps/api/src/auth/utils/auth-cookie.ts`](../apps/api/src/auth/utils/auth-cookie.ts).
  Cookie writes happen at the **controller layer** only — the auth
  service returns pure data (`{ user, accessToken, refreshToken }`) and
  the controller is the single place that touches the `Response`
  object. See [`apps/api/src/auth/auth.controller.ts`](../apps/api/src/auth/auth.controller.ts).
- The existing **`Authorization: Bearer` header flow is unchanged** — the
  cookie is purely additive. Programmatic clients (curl, tests, future
  non-browser consumers) keep using the header.
- **Two refresh paths keep both the cookie and the Bearer token fresh:**
  1. **Proactive interval** in `auth-context.tsx` — calls
     `POST /auth/refresh` every 12 minutes (≈ 80% of the 15-minute JWT
     TTL). Updates both stored tokens; the response also rewrites the
     `access_token` cookie so the SSE connection stays valid.
  2. **Reactive 401-retry interceptor** in
     [`apps/web/src/lib/api-client.ts`](../apps/web/src/lib/api-client.ts).
     Any HTTP call that returns 401 triggers one refresh attempt
     (single-flight: concurrent 401s share the same in-flight refresh
     promise) and the original request is retried with the new token.
     On success the interceptor posts `{ type: 'token-refreshed' }` on
     `BroadcastChannel('auth')` so other tabs and the realtime provider
     can react.
- The server emits a **30-second `{ type: 'ping' }` heartbeat** to keep
  idle proxies (Cloudflare, nginx) from dropping the connection. The
  client ignores pings except as a liveness signal.
- Each event carries an SSE `id:` field. The browser's native EventSource
  sends `Last-Event-ID` on automatic reconnect; producers in the next
  iteration may use it for replay if needed.

## Path conventions

The SSE endpoint lives at **`/api/v1/events/stream`** — the same
`/api/v1/` prefix used by every other API endpoint
(see [`apps/api/src/main.ts`](../apps/api/src/main.ts)). There is no
versionless path; `/api/v1/` is the consistent, only API root in this
project. Nginx has a dedicated `location` block for this URL purely to
disable proxy buffering — the URL itself is not special.

## Reconnect behavior

- Exponential backoff: 1s → 2s → 4s → … capped at 30s.
- The connection is **suspended** while `document.hidden` is true (Page
  Visibility API). It resumes on `visibilitychange`. This saves a TCP
  socket per backgrounded tab.
- `connectionStatus` is exposed via `useRealtime()` for UI affordances
  (e.g. a subtle "reconnecting…" indicator). Don't gate any required
  workflow on `connected`.

## Gap recovery — `resyncToken` (Phase 6 · 6.18.1.4-hotfix part 2)

**The realtime channel is advisory.** The in-memory server bus has no
buffer and no `Last-Event-ID` replay, so every event published while
this tab's stream was closed (hidden tab, backoff window, broadcast
reconnect) is **lost forever**. Without a recovery mechanism the
close-on-hidden policy makes a backgrounded tab go silently stale.

To make this correct, the provider exposes `resyncToken: number` on the
context value. It increments on every **reconnect-after-gap** — i.e.,
any `onopen` that follows a previously created EventSource (visibility
hide→show, error→backoff reconnect, broadcast-driven reconnect). The
very first open of a session does **not** bump (no gap to recover; the
view has just fetched on mount).

**Contract**: every view that subscribes to realtime events MUST refetch
its data when `resyncToken` changes. Use the shared hook so it stays
DRY:

```tsx
import { useRealtimeResync } from '@/lib/realtime/use-realtime-resync';

useRealtimeResync(() => {
  void load(); // your idempotent loader — overwrites local state
});
```

Refetch-on-resync is inherently idempotent: it overwrites local state
with server truth, so echoes of the tab's own mutations are harmless.

The hook skips the very first effect run — views fetch on mount via
their own effect, the hook only reacts to subsequent token changes.

### Dashboard debounce policy

The dashboard subscribes once at the top level
([`apps/web/src/app/[locale]/dashboard/dashboard-client.tsx`](../apps/web/src/app/%5Blocale%5D/dashboard/dashboard-client.tsx))
to the transaction events that touch any of its widgets:

- `transaction.created`
- `transaction.updated`
- `transaction.deleted`
- `transaction_attribution.removed`
- `occurrence.created`

Each event schedules a `refreshKey` bump after a **500 ms** debounce
window — a single edit on /transactions typically emits update + attribution
add + attribution remove, and we want one refresh, not three. The bump
re-mounts every section so each widget re-fetches with its own existing
loader. `resyncToken` changes also bump `refreshKey` (immediately, no
debounce).

- **Failure cap.** After **5 consecutive `error` events** (without a
  successful `open` in between) the provider stops scheduling reconnects
  and stays quiet. The app keeps working via regular HTTP fetches —
  realtime is best-effort. The counter resets on a successful reconnect
  and on every visibility-resume so a returning user gets a fresh
  budget. See `MAX_CONSECUTIVE_FAILURES_FOR_TESTS` in
  [`apps/web/src/lib/realtime/realtime-context.tsx`](../apps/web/src/lib/realtime/realtime-context.tsx).
- **No independent token refresh.** The realtime provider does **not**
  call `/auth/refresh` on its own. When the SSE stream is rejected (most
  likely a 401 because the cookie expired) the provider just stops and
  waits. The first regular fetch that hits a 401 triggers the api-client
  interceptor, which refreshes the cookie and posts
  `{ type: 'token-refreshed' }` on `BroadcastChannel('auth')`. The
  realtime provider listens on that channel and reconnects (with a
  reset failure counter) the moment it sees the message. This keeps
  refresh logic in one place — the api-client — and avoids the 10×
  401-storm we used to see when both layers retried independently. See
  [`docs/phase-6.18.1.4-rca.md`](./phase-6.18.1.4-rca.md) for the
  original incident.

## Future work (not blocking)

- **Multi-instance fan-out.** Today the `EventBus` is in-process — a
  transaction service running on instance A cannot reach an SSE client on
  instance B. When we scale beyond a single API replica, swap the
  underlying `Subject` for **Redis Pub/Sub** (already in our stack via
  BullMQ). The bus interface stays the same.
- **Event replay via `Last-Event-ID`.** The wire protocol already carries
  the id. A future iteration can persist a short rolling window of events
  per user and replay missed events on reconnect.
- **Server-side filter shortcuts.** Today every event is fanned out to
  every subscriber whose `userIds` matches; for very large groups we may
  add per-(transaction, comment) topics if profiling shows it matters.

## Testing

- Component tests should stub `EventSource` (see
  [`apps/web/src/lib/realtime/__tests__/realtime-context.test.tsx`](../apps/web/src/lib/realtime/__tests__/realtime-context.test.tsx)).
- Backend unit tests use the `EventBus` directly — no HTTP needed (see
  [`apps/api/src/realtime/event-bus.service.spec.ts`](../apps/api/src/realtime/event-bus.service.spec.ts)).
- Smoke test against staging:
  `curl -N --cookie "access_token=<jwt>" https://<host>/api/v1/events/stream`
  should hold open and emit ping lines every 30s.
