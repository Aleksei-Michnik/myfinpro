# UI Async-Operation Conventions

> Status: **Active** since iteration 6.16.2 (Phase 6).
> All new fetches and mutations in `apps/web/src/` MUST follow these conventions.

## Why

Until iteration 6.16.2, every async UI surface managed its own `useState<boolean>(loading)`, ad-hoc try/catch error handling, and inline spinners. Each surface drifted: timeouts were inconsistent (or absent), in-flight ops weren't aborted on unmount, error messages didn't follow a shared language, and — most visibly — the `/payments` filter buttons advanced ahead of the data, painting "Income" green while the rows were still expense rows.

We solved this once with a single primitive (`useAsyncOperation`) plus three visualizations chosen by scope.

## Three scopes — one primitive

| Scope       | When                                                                        | Visualization                                                                                                                            | Default primary timeout | Default retry timeout |
| ----------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------: | --------------------: |
| `page`      | Route changes; full-page loads; failures requiring a route-level decision   | thin top progress bar (`<PageProgressBar>`) + `<RetryReturnDialog>` on failure                                                           |                     8 s |                  30 s |
| `container` | A section of a page is updating (filter changes, list refresh, "Load more") | dimmed overlay + spinner over the section (`<LoadingOverlay>`); `disabled` cascades to controls inside; `<RetryReturnDialog>` on failure |                     5 s |                  30 s |
| `control`   | A button-driven mutation (star, save, delete, send comment, create payment) | small spinner inside the button (`<ButtonSpinner>`); button is disabled and `aria-busy`                                                  |                    10 s |                  30 s |

All three scopes share one primitive: [`useAsyncOperation<T>()`](../apps/web/src/lib/ui/use-async-operation.ts). The component decides which visualization to render.

## `useAsyncOperation()` API

```ts
import { useAsyncOperation } from '@/lib/ui';

const op = useAsyncOperation<MyData>({
  scope: 'container', // 'page' | 'container' | 'control'
  defaultTimeoutMs: 5000, // optional; per-scope default otherwise
  retryTimeoutMs: 30000, // optional
  id: 'unique-id', // optional; defaults to a UUID
});

await op.run((signal) => fetchSomething(signal));
op.isLoading; // true while in flight
op.isError; // true on failure
op.error; // { reason: 'timeout' | 'network' | 'http' | 'aborted' | 'unknown', httpStatus?, message? }
op.data; // last successful value (preserved across errors)
await op.retry(); // re-issue the last op with retryTimeoutMs
op.cancel(); // abort, return to idle, KEEP previous data
op.reset(); // abort, clear data, return to idle
```

### Behaviour contract

- `run(op)` aborts any in-flight operation and starts a new one.
- On success, transitions to `success`; the returned promise resolves with the data.
- On any failure (network / HTTP / timeout / abort), transitions to `error` and resolves with `undefined` (does NOT throw — keeps callers ergonomic).
- Failed ops preserve `previousData` so callers can render stale data underneath an error overlay.
- Component unmount aborts the in-flight signal — no `setState on unmounted` warnings.

## URL handling — the bug fix

The /payments orchestrator (`payments-list-client.tsx`) demonstrates the rule:

> **Never write the URL before the data commits.**

Pattern:

1. User clicks a filter → orchestrator calls `commit(intent)`.
2. `commit()` runs the fetch through `useAsyncOperation`.
3. **On success**: atomically update `committedFilters`, `data`, AND call `router.replace(filtersToQuery(intent))`.
4. **On failure**: open `<RetryReturnDialog>`. `committedFilters` and the URL stay where they were.

The visual controls (filter buttons, scope tabs, starred toggle) bind to `committedFilters` only. Pending intent is invisible until commit. The Income button can no longer light up green while the rows are still expense rows.

## A11y mandates

- `<LoadingOverlay>` and `<InlineLoader>` use `role="status"`, `aria-live="polite"`, `aria-busy="true"`.
- `<RetryReturnDialog>` uses `role="alertdialog"`, `aria-modal="true"`, traps focus inside, restores focus to the previously-focused element on close.
- `<PageProgressBar>` uses `role="progressbar"` with `aria-valuemin=0`/`aria-valuemax=100` and **no** `aria-valuenow` (indeterminate semantics).
- Buttons with control-scope ops set `disabled={isLoading}` and `aria-busy={isLoading}`.
- All animations honour `prefers-reduced-motion`. Spinners stop rotating, the progress bar shows a steady low-opacity fill, the auto-retry countdown freezes at 0.
- ESC closes `<RetryReturnDialog>` (treated as Cancel/Return).

## Flicker prevention — the 150 ms threshold

`<LoadingOverlay>` debounces its `active` prop: it only renders after the prop has been `true` for ≥ 150 ms. Falling back to `false` is reflected immediately. This eliminates the flash on sub-second cached responses while still showing the overlay reliably on a slow connection.

## Auto-retry countdown

`<RetryReturnDialog>` has an animated 5 s countdown bar inside the Retry button. When it completes, retry fires automatically. The user can:

- Click Retry now → fire immediately.
- Click Cancel → close the dialog (no retry).
- Wait → automatic retry after 5 s (helpful on transient connectivity blips).

Pass `autoRetryMs={0}` to disable the auto-retry.

## Code examples

### Page-scope (route-level full load + auto progress bar)

```tsx
const op = useAsyncOperation<Page>({ scope: 'page' });

useEffect(() => {
  void op.run((signal) => api.getPage(id, signal));
}, [id]);
```

The `<PageProgressBar>` mounted in `[locale]/layout.tsx` automatically lights up while any page-scope op is active.

### Container-scope (section refresh)

```tsx
const op = useAsyncOperation<List>({ scope: 'container' });

const refresh = () =>
  op
    .run((signal) => api.list(filters, signal))
    .then((res) => {
      if (res) setRows(res.rows);
    });

return (
  <div className="relative">
    <Filters disabled={op.isLoading} onChange={refresh} />
    <Table rows={rows} />
    <LoadingOverlay active={op.isLoading} />
    <RetryReturnDialog
      open={op.isError}
      reason={op.error?.reason ?? 'unknown'}
      httpStatus={op.error?.httpStatus}
      onRetry={op.retry}
      onReturn={op.cancel}
    />
  </div>
);
```

### Control-scope (button mutation)

```tsx
const op = useAsyncOperation<{ ok: boolean }>({ scope: 'control' });

const handleClick = () => void op.run((signal) => api.save(payload, signal));

return (
  <button onClick={handleClick} disabled={op.isLoading} aria-busy={op.isLoading}>
    {op.isLoading ? <ButtonSpinner /> : 'Save'}
  </button>
);
```

## Inline error banner (control-scope failures)

Control-scope dialogs (form save, delete confirm, post comment) should NOT open `<RetryReturnDialog>` on failure — that pushes another modal on top of a user-driven action. Use the small inline banner instead.

```tsx
import { InlineErrorBanner } from '@/components/ui/InlineErrorBanner';

const op = useAsyncOperation<MyEntity>({ scope: 'control' });

return (
  <form
    aria-busy={op.isLoading || undefined}
    onSubmit={(e) => {
      e.preventDefault();
      runSave();
    }}
  >
    {/* … inputs … */}
    {op.isError && op.error && op.error.reason !== 'aborted' && (
      <InlineErrorBanner
        reason={op.error.reason}
        httpStatus={op.error.httpStatus}
        message={t('errorGeneric', { message: op.error.message ?? '' })}
        onRetry={() => void op.retry()}
        retrying={op.isLoading}
      />
    )}
    <button type="submit" disabled={op.isLoading} aria-busy={op.isLoading}>
      {op.isLoading ? <ButtonSpinner /> : t('save')}
    </button>
  </form>
);
```

The component renders `role="alert"` so AT announces the failure, plus a Retry button that re-issues the last op via `op.retry()` (using the 30-s retry timeout). Domain-error code paths (per-field errors) bypass the banner by throwing `new DOMException('domain', 'AbortError')` from inside `op.run(...)`, which lands the hook in `error` with `reason='aborted'` — gated out of the banner condition above.

## Migration scope

### Iteration 6.16.2 — Initial migration

- `/payments` filter loading — full state machine (URL deferred until commit, `<LoadingOverlay>`, `<RetryReturnDialog>`).
- Page navigation flash — `<UIStatusProvider>` registers a 250 ms page-scope op on `usePathname` changes; `<PageProgressBar>` reflects.
- Star toggle — `useStarToggle` rebuilt on top of `useAsyncOperation({ scope: 'control' })`. The star button shows `<ButtonSpinner>` while in flight.
- `<PaymentsList>` "Load more" pagination — `useAsyncOperation({ scope: 'container' })` with `<InlineLoader>` inside the button and inline retry on failure.

### Iteration 6.16.4 — Comments + form/delete dialogs + categories

- `<PaymentCommentInput>` — submit uses `scope='control'` with `<ButtonSpinner>` + inline error banner on network failure.
- `<PaymentCommentList>` — initial fetch + "Load earlier" use `scope='container'`. Per-comment edit save and soft-delete use `scope='control'` per row. `<RetryReturnDialog>` on initial-fetch failure. 410 Gone surfaces as a friendly "already removed" message + list refresh.
- `<PaymentFormDialog>` — save uses `scope='control'` with `<ButtonSpinner>`, disabled inputs, `aria-busy` on the form. Cancel triggers `cancel()`. Per-field domain errors (`PAYMENT_INVALID_*`) preserved.
- `<DeletePaymentDialog>` — delete uses `scope='control'`. Scope inputs disabled while in flight. Cancel aborts gracefully.
- `<PaymentCategoryPicker>` — self-fetch migrated to `scope='container'`.
- `categories-client` (`/settings/categories`) — initial fetch uses `scope='page'` so the top progress bar continues past the route change. `<RetryReturnDialog>` on failure with Return = navigate back to settings.
- `<CategoryListSection>` — controlled mode (data + loading from parent); renders `<LoadingOverlay>` during initial load.
- `<CategoryFormDialog>` — save uses `scope='control'`. `CATEGORY_SLUG_CONFLICT` → field error; network failures → inline banner.
- `<DeleteCategoryDialog>` — both attempts of the `CATEGORY_IN_USE` two-step flow share one hook; `replaceWithCategoryId` is a re-`run()` on the same hook instance.
- `category-context` — `AbortSignal` threaded through `fetchAll`, `create`, `update`, `remove`.

**Deferred (still self-fetch — out of scope by design):**

- Dashboard widgets (`<RecentActivity>`, `<StarredPayments>`, `<TotalsCard>`, `<ScopeEntryCards>`, `<GroupPaymentsTab>`) — read-only, low-priority.
- Auth flows (login, register, password change, email verification) — distinct surface, not requested.
- Group management (members, invites, settings) — same reasoning.

These will migrate when their next feature iteration touches them.

### Iteration 6.16.5 — AbortError silent no-op + locale-change reset hook

Two related staging UX fixes landed in `useAsyncOperation()` and the
surrounding ecosystem:

1. **AbortError is silent.** When `op()` rejects with a
   `DOMException('…', 'AbortError')` (or any object with
   `name === 'AbortError'`) the hook now transitions back to `idle`,
   preserving `previousData`, **unless** the abort was triggered by the
   primary timeout — in which case `reason='timeout'` is preserved.

   Rationale: the locale switcher (next-intl cookie + `router.refresh()`)
   could race the in-flight `/payments` fetch and surface the AbortError
   as a user-visible "no access" error banner. The hook must never bubble
   genuine cancellations to the UI.

   Domain-error code paths that intentionally throw
   `new DOMException('domain', 'AbortError')` to suppress the inline
   banner now leave the hook in `idle` rather than `error` with
   `reason='aborted'`. Per-field error state set _before_ the throw is
   unaffected; banner-gating logic (`showBanner = isError && reason !==
'aborted'`) keeps working because `isError` is now `false`.

2. **`useResetOnLocaleChange(onChange)`** — DRY hook in
   [`apps/web/src/lib/ui/use-reset-on-locale-change.ts`](../apps/web/src/lib/ui/use-reset-on-locale-change.ts).
   Subscribes to `useLocale()` from `next-intl` and fires `onChange()` on
   any locale flip (does NOT fire on initial mount). Page-level
   orchestrators MUST use it to clear page-scoped errors and re-issue
   their fetch on en ↔ he switches:
   - [`PaymentsListClient`](../apps/web/src/app/[locale]/payments/payments-list-client.tsx)
   - [`PaymentDetailClient`](../apps/web/src/app/[locale]/payments/[paymentId]/payment-detail-client.tsx)
   - [`DashboardClient`](../apps/web/src/app/[locale]/dashboard/dashboard-client.tsx)
   - [`CategoriesClient`](../apps/web/src/app/[locale]/settings/categories/categories-client.tsx)
   - [`GroupDashboardPage`](../apps/web/src/app/[locale]/groups/[groupId]/page.tsx)

3. **`UIStatusProvider`** also subscribes to `useLocale()` and fires
   `startNavigation()` on locale change, so the page progress bar shows
   during the locale switch (the next-intl flow bypasses the
   document-level click interceptor).

## Rule (recorded in `.kilocode/rules/dna.md`)

> Any new fetch or mutation MUST use `useAsyncOperation()` from [`apps/web/src/lib/ui/`](../apps/web/src/lib/ui/index.ts). Pick the appropriate scope. Do not implement ad-hoc `useState<boolean>(loading)` / inline spinner / try-catch error state.
>
> AbortError must NEVER surface as a user-visible error. The hook handles this automatically (idle + preserved `previousData`); page-level orchestrators must additionally call `useResetOnLocaleChange(reset)` so locale switches clear stale errors and re-fetch quietly.

Searching the migrated files for `setLoading(true)` / inline `useState<boolean>(loading)` / inline rotating SVGs must find zero matches.
