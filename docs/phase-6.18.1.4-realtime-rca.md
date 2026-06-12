# Phase 6.18.1.4-hotfix · Part 2 — RCA: realtime cross-tab sync does not propagate to UI

**Date**: 2026-06-12
**Status**: diagnosis only — no fix in this iteration
**Symptoms (staging smoke test, after Phase B auth fix):**

1. Payment added in tab A does not appear in tab B (Dashboard view).
2. Editing a payment in tab A does not update values in tab B.
3. On the payment detail view, neither comments nor payment info syncs across tabs.
4. DevTools shows events on `/events/stream` — apparently only `ping` heartbeats.

---

## 1. The hypothesized root cause is DISPROVED

The working hypothesis ("plumbing shipped with **no producers wired and no
subscribers** — per the original 6.18.1.4 commit message") is **false for the
code currently deployed**. That commit message was accurate at the time, but
iterations 6.18.1.4.1–6.18.1.4.3 subsequently landed and are on
`origin/develop` (and therefore on staging, which was redeployed for the
Phase B hotfix `a629b4a`/`a6fcf79`):

```
d256af0 feat(phase-6.18.1.4.3): wire schedule lifecycle events to realtime EventBus + frontend subscriptions
c151819 feat(phase-6.18.1.4.2): wire comment events to realtime EventBus + frontend subscriptions
01368ed feat(phase-6.18.1.4.1): wire payment events to realtime EventBus + frontend subscriptions
```

### Grep evidence — backend producers EXIST

`rg "eventBus.publish" apps/api/src --type ts` (non-test files):

| Producer                                                                                             | Events published                                                                                 |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| [`payment.service.ts:346`](../apps/api/src/payment/payment.service.ts:346)                           | `payment.created`                                                                                |
| [`payment.service.ts:822-880`](../apps/api/src/payment/payment.service.ts:822)                       | `payment.updated`, `payment.deleted`, `payment_attribution.added`, `payment_attribution.removed` |
| [`payment.service.ts:1062-1083`](../apps/api/src/payment/payment.service.ts:1062)                    | delete path: `payment.deleted`, `payment_attribution.removed`, `payment.updated`                 |
| [`payment-comment.service.ts:290-298`](../apps/api/src/payment/payment-comment.service.ts:290)       | `comment.created`, `comment.updated`, `comment.deleted`                                          |
| [`payment-schedule.service.ts:643-650`](../apps/api/src/payment/payment-schedule.service.ts:643)     | `schedule.created/updated/paused/resumed/cancelled/deleted`                                      |
| [`payment-occurrence.processor.ts:236`](../apps/api/src/payment/payment-occurrence.processor.ts:236) | `occurrence.created`                                                                             |

Recipient scoping exists too:
[`payment-event-recipients.ts:26`](../apps/api/src/payment/utils/payment-event-recipients.ts:26)
computes `userIds` from personal attributions + group memberships, creator
always included. `EventBus` ([`event-bus.service.ts:28`](../apps/api/src/realtime/event-bus.service.ts:28))
drops events with empty `userIds`; [`EventBus.subscribeForUser()`](../apps/api/src/realtime/event-bus.service.ts:42)
filters per user. `EventBus` is exported from
[`realtime.module.ts:34`](../apps/api/src/realtime/realtime.module.ts:34) and injected into the payment services.

### Grep evidence — frontend subscribers EXIST (for some views)

`rg "useRealtimeEvents" apps/web/src` (non-test files):

| Subscriber                                                                                                                     | Events consumed                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| [`PaymentsList.tsx:214-254`](../apps/web/src/components/payment/PaymentsList.tsx:214) (/payments page)                         | `payment.created/updated/deleted`, `payment_attribution.removed`, `occurrence.created` |
| [`payment-detail-client.tsx:112-152`](../apps/web/src/app/%5Blocale%5D/payments/%5BpaymentId%5D/payment-detail-client.tsx:112) | `payment.updated/deleted`, `payment_attribution.removed`, `schedule.*`                 |
| [`PaymentCommentList.tsx:165-187`](../apps/web/src/components/payment/PaymentCommentList.tsx:165)                              | `comment.created/updated/deleted` (idempotent dedupe vs. optimistic local rows)        |
| [`RecurringOccurrencesSection.tsx:79`](../apps/web/src/components/payment/RecurringOccurrencesSection.tsx:79)                  | `occurrence.created`                                                                   |

`RealtimeProvider` is mounted globally
([`layout.tsx:56`](../apps/web/src/app/%5Blocale%5D/layout.tsx:56) via
[`AuthenticatedRealtimeProvider.tsx:13`](../apps/web/src/lib/realtime/AuthenticatedRealtimeProvider.tsx:13)),
and nginx proxies the SSE location unbuffered
([`ssl.conf.template:42-54`](../infrastructure/nginx/conf.d/ssl.conf.template:42)).

So "zero publish call sites / zero subscribers" is **not** the root cause.

---

## 2. Genuine root causes

### RC1 (primary): hidden tabs are deliberately disconnected from SSE, and there is no catch-up on re-focus

[`realtime-context.tsx:186-201`](../apps/web/src/lib/realtime/realtime-context.tsx:186):

```ts
const onVisibility = () => {
  if (document.hidden) {
    close(); // ← EventSource torn down for ANY background tab
    setStatus('disconnected');
  } else {
    failureCountRef.current = 0;
    connect(); // ← reconnects the stream, but does NOT resync state
  }
};
```

In the canonical smoke test — two tabs in the **same browser window** — tab B
is `document.hidden === true` the entire time the user is acting in tab A.
Consequences, in order:

1. Tab B's `EventSource` is **closed** at the moment the mutation happens in
   tab A. The event is fanned out only to live subscriptions of the rxjs
   `Subject` ([`event-bus.service.ts:19`](../apps/api/src/realtime/event-bus.service.ts:19)) — tab B is not connected, so the event is gone.
2. The `Subject` has **no buffer** and the server implements **no
   `Last-Event-ID` replay** — [`events.controller.ts:8-9`](../apps/api/src/realtime/events.controller.ts:8) explicitly says the
   `id:` field is sent but "consumers … may use it for replay if they
   choose"; nothing on the server can actually replay (in-memory bus, no
   ring buffer).
3. When the user switches back to tab B, the provider only re-opens the
   stream ([`realtime-context.tsx:195`](../apps/web/src/lib/realtime/realtime-context.tsx:195)); **no view refetches its data**.
   Tab B therefore renders stale payment rows / detail / comments forever
   (until manual reload).

This single defect fully explains symptoms 2 and 3, and contributes to 1.
It also explains observation 4: the user watches DevTools in the visible
tab; the moment they switch away to make the change, that tab's stream is
closed — so its captured stream shows only heartbeats.

**Acceptance criterion "Tab B reflects changes within ~2 s" can never pass
for same-window tabs with this policy** — the channel is live-only and the
tab that needs the update is, by definition, hidden when the update happens.

### RC2: the Dashboard view has zero realtime subscriptions

`rg "useRealtimeEvents|realtime" apps/web/src/components/dashboard` → **0
results**. [`dashboard-client.tsx:21-56`](../apps/web/src/app/%5Blocale%5D/dashboard/dashboard-client.tsx:21) composes `TotalsCard`,
`ScopeEntryCards`, `RecentActivity`, `StarredPayments` — all fetch-on-mount,
refreshed only by the local `refreshKey` bump (quick-add in the _same_ tab,
[`dashboard-client.tsx:45`](../apps/web/src/app/%5Blocale%5D/dashboard/dashboard-client.tsx:45), or locale switch). 6.18.1.4.1 wired the
`/payments` list ([`PaymentsList.tsx`](../apps/web/src/components/payment/PaymentsList.tsx)) but **never the dashboard widgets**.
So symptom 1 reproduces even with two fully visible windows.

### RC3 (aggravating): reconnect gaps lose events even for visible tabs

Any reconnect window (exponential backoff 1–30 s,
[`realtime-context.tsx:41-48`](../apps/web/src/lib/realtime/realtime-context.tsx:41); permanent silence after 5 consecutive
failures, [`realtime-context.tsx:137-139`](../apps/web/src/lib/realtime/realtime-context.tsx:137)) silently drops events for the
same reason as RC1: no replay, no resync. Same defect class, lower
probability of being the observed cause.

### Latent (not the active cause, must be tracked): in-process EventBus

The bus is a process-local rxjs `Subject`. Today each environment runs a
single API container behind nginx ([`ssl.conf.template:18-20`](../infrastructure/nginx/conf.d/ssl.conf.template:18) routes to one
active slot), so this is currently safe — but events will not cross
blue/green slots during a deploy overlap, and any future horizontal
scale-out breaks delivery entirely. The fix is a Redis-backed pub/sub
behind the same `EventBus` interface (out of scope here).

### Eliminated alternatives

| Hypothesis                                                | Verdict    | Evidence                                                                                                                                           |
| --------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| No backend producers wired                                | ✗          | §1 grep table — every domain service publishes                                                                                                     |
| No frontend subscribers                                   | ✗          | §1 grep table — list/detail/comments/occurrences subscribe                                                                                         |
| `EventBus` not importable into PaymentModule              | ✗          | exported at [`realtime.module.ts:34`](../apps/api/src/realtime/realtime.module.ts:34), injected in all 4 producers                                 |
| nginx buffering swallowing events                         | ✗          | dedicated unbuffered SSE location; pings observably arrive                                                                                         |
| Wrong recipient computation (`userIds` excludes the user) | ✗ (likely) | creator always included ([`payment-event-recipients.ts:32`](../apps/api/src/payment/utils/payment-event-recipients.ts:32)); same user in both tabs |
| Mutations and SSE hitting different API processes         | ✗ (today)  | single container per env; nginx upstream pins the active slot — kept as **latent** risk above                                                      |

---

## 3. The wrong decision that caused this

The realtime channel was treated as a **guaranteed-delivery transport**, when
it was actually built as a **live-only, fire-and-forget stream** — and then a
power-saving policy (close the stream for hidden tabs) was added on top
without any state-resync mechanism. Specifically:

1. **6.18.1.4 design**: `Last-Event-ID` was emitted but replay was
   deliberately deferred ("consumers in 6.18.1.4.1+ may use it … if they
   choose") and then never implemented. Missed-event handling was nobody's
   acceptance criterion.
2. **Hidden-tab disconnect** was adopted as if it were free, but it converts
   "rare missed events during reconnect" into "**all** events missed in the
   primary acceptance scenario" (background tab in the same window).
3. **The dashboard was skipped** when subscriptions were wired in
   6.18.1.4.1 — the iteration wired the `/payments` list and detail pages
   and was marked done without an inventory of every payment-displaying
   surface.
4. **Tests were green because they test the wrong layer**: unit tests emit
   synthetic events directly into a mounted, "visible" component
   ([`use-realtime-events.test.tsx`](../apps/web/src/lib/realtime/__tests__/use-realtime-events.test.tsx),
   [`PaymentCommentList.spec.tsx:240`](../apps/web/src/components/payment/PaymentCommentList.spec.tsx:240), backend spec mocks assert
   `publish()` was called). No test exercises the
   _hidden-tab → publish → re-focus_ sequence, and there is no two-context
   e2e test for the epic acceptance ("tab B reflects changes within ~2 s").
   The pipeline pieces all pass in isolation; the end-to-end property was
   never tested.

---

## 4. Minimal fix plan (next phase)

### Frontend (primary)

1. **Resync-on-reconnect signal** in
   [`realtime-context.tsx`](../apps/web/src/lib/realtime/realtime-context.tsx): expose a `resyncToken: number` on the
   context, incremented whenever the stream (re)opens **after a gap** —
   i.e., on `es.onopen` following a `close()` from the visibility handler,
   backoff path, or token-refresh reconnect (skip the very first open of a
   mount to avoid double-fetch). This is the single chokepoint; no new
   transport machinery.
2. **Subscribed views refetch on `resyncToken` change** (each already owns
   an idempotent loader via `useAsyncOperation()` + `usePayments()`):
   - [`PaymentsList.tsx`](../apps/web/src/components/payment/PaymentsList.tsx) → re-run `fetchList` (first page, current filters).
   - [`payment-detail-client.tsx`](../apps/web/src/app/%5Blocale%5D/payments/%5BpaymentId%5D/payment-detail-client.tsx) → `getPayment` + `getSchedule` (404 ⇒ redirect, same as the existing `payment_attribution.removed` handler).
   - [`PaymentCommentList.tsx`](../apps/web/src/components/payment/PaymentCommentList.tsx) → `listComments` (replace list; existing id-dedupe keeps it idempotent).
   - [`RecurringOccurrencesSection.tsx`](../apps/web/src/components/payment/RecurringOccurrencesSection.tsx) → `listOccurrences`.

   Refetch-on-resync is inherently idempotent: it overwrites local state
   with server truth, so echoes of the tab's own mutations are harmless.

3. **Dashboard subscriptions (RC2)** — single chokepoint in
   [`dashboard-client.tsx`](../apps/web/src/app/%5Blocale%5D/dashboard/dashboard-client.tsx): subscribe once to `payment.created`,
   `payment.updated`, `payment.deleted`, `payment_attribution.removed`,
   `occurrence.created` and bump the **existing** `refreshKey`
   ([`dashboard-client.tsx:24`](../apps/web/src/app/%5Blocale%5D/dashboard/dashboard-client.tsx:24)) — exactly the mechanism quick-add already
   uses, so all four widgets refetch. Debounce (~500 ms) to coalesce
   attribution+update bursts from a single edit. Also bump on
   `resyncToken`.

### Backend

No producer work needed — all domain services already publish with
audience-scoped `userIds` (§1). Two follow-ups, **not** required for the
acceptance to pass:

- (Later) `Last-Event-ID` replay via a small per-user ring buffer in
  `EventBus`, to shrink the reliance on full refetches.
- (Later, pre-scale-out) Redis pub/sub behind the `EventBus` interface so
  events cross process boundaries.

### Tests

- **Unit (web)**: `realtime-context` — hidden→visible bumps `resyncToken`
  exactly once per reconnect; backoff-reconnect bumps it; first mount does
  not. `PaymentsList` / detail / comments / occurrences — refetch fires on
  `resyncToken` change. `dashboard-client` — `payment.created` event bumps
  `refreshKey`; widgets remount.
- **E2E (staging, Playwright)**: two browser contexts logged in as the same
  user — (a) both pages visible: create payment in A ⇒ row visible in B
  ≤ 2 s; (b) tab-switch flow: hide B, mutate in A, refocus B ⇒ B shows the
  change after resync. Same pattern for edit and comment.
- **API**: existing producer specs already cover emission; add one
  integration test asserting a live SSE consumer receives `payment.created`
  end-to-end (controller + bus + service, no mocks).

### Staging verification to discriminate RC1 vs RC2 after the fix

1. Two **separate visible windows** on `/payments` — sync must work (RC1/RC3 fix).
2. Same-window two tabs — switch back to tab B must show the change (resync).
3. Dashboard in tab B — totals/recent/starred refresh (RC2 fix).
