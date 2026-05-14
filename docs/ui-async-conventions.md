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

## Migration scope (iteration 6.16.2)

**Migrated:**

- `/payments` filter loading — full state machine (URL deferred until commit, `<LoadingOverlay>`, `<RetryReturnDialog>`).
- Page navigation flash — `<UIStatusProvider>` registers a 250 ms page-scope op on `usePathname` changes; `<PageProgressBar>` reflects.
- Star toggle — `useStarToggle` rebuilt on top of `useAsyncOperation({ scope: 'control' })`. The star button shows `<ButtonSpinner>` while in flight.
- `<PaymentsList>` "Load more" pagination — `useAsyncOperation({ scope: 'container' })` with `<InlineLoader>` inside the button and inline retry on failure.

**Deferred to future iterations:**

- Comment input/list (Phase 6 future iteration).
- Payment form dialog save (Phase 6 future iteration).
- Delete payment confirm (Phase 6 future iteration).
- Categories CRUD (Phase 6 future iteration).
- Dashboard widgets (Phase 10; widgets are read-only, low-urgency).

## Rule (recorded in `.kilocode/rules/dna.md`)

> Any new fetch or mutation MUST use `useAsyncOperation()` from [`apps/web/src/lib/ui/`](../apps/web/src/lib/ui/index.ts). Pick the appropriate scope. Do not implement ad-hoc `useState<boolean>(loading)` / inline spinner / try-catch error state.

Searching the migrated files for `setLoading(true)` / inline `useState<boolean>(loading)` / inline rotating SVGs must find zero matches.
