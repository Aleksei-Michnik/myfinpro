# UI realtime conventions

> Phase 6 · Iteration 6.18.1.4 — SSE infrastructure shipped. This document
> defines how product code should consume realtime events going forward.

## When to use realtime

Realtime is for **read-only UI freshness only**. Use it to:

- update list/detail views when the user (or a co-collaborator on a shared
  group) changes data on another tab or device,
- nudge a comment thread, schedule card, or starred indicator without a
  manual refresh,
- mark a payment as deleted/updated in the cache.

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
- Treat each event as authoritative for its `paymentId` / `commentId` /
  `scheduleId` — don't merge fields from stale local state.

## Per-component pattern

```tsx
import { useRealtimeEvents } from '@/lib/realtime/use-realtime-events';

useRealtimeEvents({ type: 'comment.created', paymentId }, (event) => {
  setComments((current) => mergeComment(current, event.comment));
});
```

Rules:

- **Tight filter, single subscription.** Always pass the narrowest filter
  you need (`paymentId`, `parentPaymentId`, `commentId`). Avoid wildcard
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
- The existing **`Authorization: Bearer` header flow is unchanged** — the
  cookie is purely additive. Programmatic clients (curl, tests, future
  non-browser consumers) keep using the header.
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

## Future work (not blocking)

- **Multi-instance fan-out.** Today the `EventBus` is in-process — a
  payment service running on instance A cannot reach an SSE client on
  instance B. When we scale beyond a single API replica, swap the
  underlying `Subject` for **Redis Pub/Sub** (already in our stack via
  BullMQ). The bus interface stays the same.
- **Event replay via `Last-Event-ID`.** The wire protocol already carries
  the id. A future iteration can persist a short rolling window of events
  per user and replay missed events on reconnect.
- **Server-side filter shortcuts.** Today every event is fanned out to
  every subscriber whose `userIds` matches; for very large groups we may
  add per-(payment, comment) topics if profiling shows it matters.

## Testing

- Component tests should stub `EventSource` (see
  [`apps/web/src/lib/realtime/__tests__/realtime-context.test.tsx`](../apps/web/src/lib/realtime/__tests__/realtime-context.test.tsx)).
- Backend unit tests use the `EventBus` directly — no HTTP needed (see
  [`apps/api/src/realtime/event-bus.service.spec.ts`](../apps/api/src/realtime/event-bus.service.spec.ts)).
- Smoke test against staging:
  `curl -N --cookie "access_token=<jwt>" https://<host>/api/v1/events/stream`
  should hold open and emit ping lines every 30s.
