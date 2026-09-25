# Web UI & design system (checked 2026-09-24)

Read when: building or changing anything the user sees in `apps/web` — a component, a page, a dialog, a string, a loading state.

## Principles the code actually holds

- **Tailwind 4, CSS-first.** No `tailwind.config.*` exists; the theme is declared in an `@theme`
  block in `apps/web/src/app/globals.css` and consumed as utility classes. Styling is utility
  classes in JSX — there are no CSS modules and no styled-components.
- **Both themes, always.** Every surface carries explicit `dark:` variants (1302 occurrences in
  `src/`). A new component without `dark:` overrides is incomplete.
- **Logical CSS for RTL.** Use `ms-/me-/ps-/pe-/start-/end-/text-start/text-end` (74 uses); physical
  `ml-/mr-/pl-/pr-/text-left/right` survives in 5 places only and is not to be extended. Hebrew
  renders the whole app mirrored via `<html dir="rtl">`, so any hard-coded side is a bug.
- **Mobile-first**, in the Tailwind sense: base classes are the phone layout, `sm:`/`md:`/`lg:`
  add width. Dense lists ship two renderings — cards under `md:hidden`, a table under
  `hidden md:block` (`src/components/transaction/TransactionsList.tsx`).
- **No ad-hoc async state.** Every fetch/mutation goes through `useAsyncOperation()` (below).
- **No hardcoded user-facing strings.** Every string is a `next-intl` key in `apps/web/messages/`.

## Theme, tokens, dark mode

| Thing        | Where                                                         | Note                                                                                            |
| ------------ | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Color scale  | `globals.css` `@theme` → `--color-primary-50…950` (sky blue)  | Everything else uses Tailwind's stock `gray`/`red`/`green` ramps                                |
| Page surface | `:root` `--foreground-rgb`, `--background-start/end-rgb`      | `body` is a vertical gradient between start and end                                             |
| Font         | `@theme --font-sans` = `'Inter', ui-sans-serif, system-ui, …` | Inter is **not** loaded (no `next/font`, no stylesheet link) — falls back to the system UI font |
| Dark mode    | `@media (prefers-color-scheme: dark)` in `globals.css`        | OS preference only                                                                              |
| Animations   | `.mfp-spinner`, `.mfp-progress-bar`, `.mfp-countdown`         | RTL flips `transform-origin`; all three are neutralised under `prefers-reduced-motion`          |

**Drift:** there is no `data-theme` attribute, no pre-hydration theme script and no in-app theme
switch (nothing under `src/app/[locale]/settings` mentions theme) — dark mode follows the OS and
cannot be overridden. Typography beyond the font stack is not tokenised: sizes/weights come per
component from Tailwind's scale (`Button` `sizeStyles`: `sm` `text-sm`, `md`/`lg` `text-base`/`lg`).

## `src/components/ui` inventory

| Component            | Purpose                                                                                                                                           | Key props                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `Button`             | The button. 4 variants, 3 sizes, `dark:` per variant                                                                                              | `variant` `primary\|secondary\|outline\|danger`, `size` `sm\|md\|lg`                             |
| `Dialog`             | THE modal shell: backdrop, panel, heading, behaviour. `panel` (centred) or `sheet` (bottom sheet ≤ sm)                                            | `open`, `onClose`, `title`, `size` `sm\|md\|lg\|full`, `variant`, `testId`, `footer`, `busy`     |
| `Input`              | Labelled text input with error state                                                                                                              | `label`, `error`, `size` `sm\|md`; forwards ref + all input attrs                                |
| `Select`             | Labelled select — the `<Input>` contract, options as children                                                                                     | as `Input` + `fullWidth`                                                                         |
| `Textarea`           | Labelled textarea — the `<Input>` contract                                                                                                        | as `Input`                                                                                       |
| `Checkbox`           | Box + label (+ description) in one `<label>`                                                                                                      | `label`, `description`, `error`, `align` `start\|center`                                         |
| `input-styles.ts`    | `controlClass()` — THE control style shared by Input / Select / Textarea; `inputClass` = the `sm` size                                            | `size`, `error`, `fullWidth` (a function, not a component)                                       |
| `Card`               | THE bordered surface: page sections, list rows, panels. `cardClass()` for a `<details>` or a `<Link>`                                             | `as`, `padding` `none\|sm\|md\|lg`, `muted`                                                      |
| `Badge`              | THE chip: scope, category, role, status                                                                                                           | `tone` `neutral\|primary\|success\|warning\|danger`, `size` `sm\|md`                             |
| `PageHeader`         | Title (+ eyebrow, description) and the action row of a page                                                                                       | `title`, `description`, `actions`, `as` `h1\|h2`, `size` `md\|lg`                                |
| `EmptyState`         | "Nothing here" — dashed frame by default, plain line inside a card                                                                                | `title`, `description`, `action`, `icon`, `bordered`                                             |
| `Tabs`               | Controlled tab strip (`TransactionsScopeTabs` is a wrapper that builds the items)                                                                 | `items`, `current`, `onChange`, `disabled`, `ariaLabel`                                          |
| `Stat`               | A labelled figure (dashboard totals, account balances)                                                                                            | `label`, `value`, `hint`, `tone`, `size`                                                         |
| `styles.ts`          | `focusRing`, `surfaceClass`, `borderClass`, `cx()` — the fragments a component needs                                                              | — (strings and a helper)                                                                         |
| `Spinner`            | SVG spinner primitive; `aria-hidden`, caller announces                                                                                            | `size` `sm`(12px)`\|md`(16)`\|lg`(32), `color`                                                   |
| `ButtonSpinner`      | Spinner sized for inside a button (control-scope ops)                                                                                             | `size`, `data-testid` (default `button-spinner`)                                                 |
| `InlineLoader`       | `role=status` spinner + optional label, for "Load more"                                                                                           | `label`, `size`                                                                                  |
| `LoadingOverlay`     | Dimmed absolute overlay for container-scope ops; 150 ms debounce, swallows clicks                                                                 | `active`, `message`, `delayMs`                                                                   |
| `PageProgressBar`    | Singleton 3px top bar; determinate, driven by `useNavProgress()`                                                                                  | `label`; mounted once in `[locale]/layout.tsx`                                                   |
| `RetryReturnDialog`  | Portal `alertdialog` for page/container failures; focus trap, ESC = return, 5 s auto-retry countdown                                              | `open`, `reason`, `httpStatus`, `autoRetryMs`, `onRetry`, `onReturn`                             |
| `InlineErrorBanner`  | `role=alert` strip for control-scope failures (never a modal)                                                                                     | `reason`, `httpStatus`, `message`, `onRetry`, `retrying`                                         |
| `ConfirmDialog`      | THE generic destructive-action confirm modal — a composition of `Dialog`                                                                          | `title`, `message`, `confirmLabel`, `cancelLabel`, `danger`, `busy`                              |
| `DocumentViewer`     | Full-screen viewer for images (zoom/pan/swipe) and PDFs, multi-page                                                                               | `open`, `pages: ViewerPage[]`, `initialIndex`, `loadError`, `title`                              |
| `FileCaptureButtons` | THE browse + camera pair over two hidden inputs                                                                                                   | `accept`, `multiple`, `onFiles(files, 'picker'\|'camera')`, `testIdPrefix`, ref → `openPicker()` |
| `CopyField`          | THE read-only value + `Copy` pair (invite link, revealed API token); clipboard with a select-text fallback and a polite `role=status` result line | `value`, `label`, `multiline`, `describedById`, `testId`, `onCopied`                             |
| `RowActionsMenu`     | `⋮` row menu, portalled + `position: fixed` so table overflow can't clip it; flips and clamps to viewport                                         | `triggerLabel`, `items[]`, `popoverWidthPx`                                                      |
| `Toast`              | `ToastProvider` + `ToastContainer` + `useToast()`                                                                                                 | types `success\|error\|warning\|info`                                                            |
| `ErrorBoundary`      | Class boundary with reset button; dev-only error text                                                                                             | `fallback`                                                                                       |

## Async-operation contract (condensed)

Full rules: [ui-async-conventions.md](../docs/ui-async-conventions.md). Import everything from
`@/lib/ui` (`src/lib/ui/index.ts`), never from the individual modules.

| Scope       | Use for                                 | Visualization                               | Primary timeout |
| ----------- | --------------------------------------- | ------------------------------------------- | --------------: |
| `page`      | route-level loads, route-level failures | `<PageProgressBar>` + `<RetryReturnDialog>` |             8 s |
| `container` | section refresh, filters, "Load more"   | `<LoadingOverlay>` + `<RetryReturnDialog>`  |             5 s |
| `control`   | button-driven mutation                  | `<ButtonSpinner>` + `<InlineErrorBanner>`   |            10 s |

Retry timeout is 30 s for all three. `op.run()` never throws (resolves `undefined` on failure) and
preserves `previousData`; it aborts the previous in-flight op and on unmount.

Forbidden: ad-hoc `useState<boolean>(loading)`, inline try/catch loading state, hand-rolled
rotating SVGs, `<RetryReturnDialog>` on a control-scope failure (use the banner — §"Inline error
banner"), and **writing the URL before the data commits** — `/transactions` keeps
`committedFilters` separate from the pending intent and calls `router.replace()` only inside the
success branch (`src/app/[locale]/transactions/transactions-list-client.tsx`).

`AbortError` must never reach the user: the hook returns to `idle` (not `error`) on abort unless the
primary timeout caused it. Page-level orchestrators must also call `useResetOnLocaleChange(...)` so
an en ↔ he switch clears stale errors and re-fetches quietly.

Hooks in `src/lib/ui`: `useAsyncOperation`, `useUIStatus`/`useNavProgress` (nav progress state
machine — 100 ms debounce, eases to 90 %, 200 ms fade, 30 s safety stop), `useBodyScrollLock`
(counter-based, so nested dialogs release correctly), `useResetOnLocaleChange`.

## Realtime UI contract (condensed)

Full rules: [ui-realtime-conventions.md](../docs/ui-realtime-conventions.md).

- Realtime is **advisory freshness only**. Mutations go over HTTP and update state from the HTTP
  response, never from the SSE echo; a missed event must not break correctness.
- Subscribe with `useRealtimeEvents(filter, handler)` — one hook call per event type, narrowest
  filter possible, no wrapping `useEffect`, handlers idempotent (replace-by-id, tolerate deletes of
  already-gone rows).
- **Every subscribing view must also call `useRealtimeResync(() => reload())`** — the server bus has
  no replay, so a hidden/backgrounded tab loses events; `resyncToken` bumps on reconnect-after-gap.
- Reconnect: exponential backoff 1→30 s, suspended while `document.hidden`, stops after 5
  consecutive errors, resumes on a `token-refreshed` message on `BroadcastChannel('auth')`. Never
  gate a workflow on `connectionStatus === 'connected'`.
- Dashboard pattern: one top-level subscription, 500 ms debounce into a `refreshKey` bump that
  re-mounts sections (`src/app/[locale]/dashboard/dashboard-client.tsx`).

## i18n

- Locales `en` (default) + `he`, `localePrefix: 'never'` — the locale lives in the `NEXT_LOCALE`
  cookie, not the path (`src/i18n/routing.ts`). The switcher in `layout/Header.tsx` writes the
  cookie and calls `router.refresh()`.
- Navigate with `Link`/`useRouter`/`usePathname` from `@/i18n/navigation`, never `next/link`.
- Messages: `apps/web/messages/{en,he}.json`, 1487 lines each, 17 top-level namespaces — `common`,
  `ui`, `nav`, `home`, `auth`, `toast`, `dashboard`, `groups`, `settings`, `legal`, `help`,
  `footer`, `transactions`, `categories`, `receipts`, `products`, `budgets`. Shared UI copy lives
  under `ui.loading` / `ui.errors` / `common.viewer`.
- Both files must stay key-for-key identical; `src/lib/transaction/__tests__/i18n-key-shape.test.ts`
  flattens both and asserts parity plus "no key resolves through its own namespace twice" (the
  `transactions.transactions.scope.personal` bug).
- Plurals are ICU (`{count, plural, =1 {…} other {# …}}`); Hebrew uses the same form — no `select`
  / explicit gender arguments exist in the message files. Hebrew gender is handled by writing the
  string to agree with its subject (e.g. feminine agreement with תנועה) — see
  [phase-8-ux-followups-design.md §2.4](../docs/phase-8-ux-followups-design.md).
- RTL: `[dir='rtl']` rules in `globals.css` flip the toast slide-in and the progress/countdown
  origins; `src/lib/swipe.ts` (`isRtl`, `swipeDelta`, `arrowKeyDelta`, 40 px threshold) is the
  shared RTL-aware carousel math — reuse it, do not re-derive direction.

## Accessibility (evidenced in code)

- Skip link to `#main-content` in `layout/AppShell.tsx`; pages own their own `<main>` landmark.
- Loading affordances: `role="status"` + `aria-live="polite"` + `aria-busy="true"`.
  `PageProgressBar` is `role="progressbar"` with min/max and `hidden`/`aria-hidden` when idle.
- Dialogs: `role="dialog"` (`alertdialog` for `RetryReturnDialog`), `aria-modal`, focus trap, focus
  restored to the previously focused element, ESC + backdrop close, body scroll locked.
- Control-scope buttons set `disabled` **and** `aria-busy` while in flight.
- Shared focus ring constant `focusRing` in `layout/Header.tsx` / `layout/Sidebar.tsx`.
- Contrast is checked per iteration, not tooled: the `danger` button is `bg-red-600` on white
  (≈5.94:1) light / `bg-red-500` (≈4.83:1) dark — see `docs/phase-6-progress.md` "Visual contrast".
- `prefers-reduced-motion` is honoured globally in `globals.css`; 15 further references in `src/`.

## Page templates

| Template         | Reference                                                                                                                                                                                                                                                   |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| List + filters   | `src/app/[locale]/transactions/transactions-list-client.tsx` + `components/transaction/{TransactionsFilters,TransactionsScopeTabs,TransactionsList,TransactionRow}.tsx` — URL-synced filters, committed-only controls, container-scope refresh, "Load more" |
| Row actions      | `components/ui/RowActionsMenu.tsx` used from `TransactionRow`                                                                                                                                                                                               |
| Detail page      | `src/app/[locale]/transactions/[transactionId]/transaction-detail-client.tsx` + `TransactionDetailHeader`, `TransactionCommentList/Input`, `TransactionDocuments`                                                                                           |
| Dialog / sheet   | `components/ui/Dialog.tsx` — every modal; `useDialogBehaviour` (ESC, focus trap, focus restore, scroll lock) for the two full-screen surfaces that keep their own chrome (`DocumentViewer`, `BarcodeScannerDialog`)                                         |
| Form dialog      | `components/transaction/TransactionFormDialog.tsx` (control-scope save, per-field domain errors, inline banner for transport errors) inside `<Dialog size="lg">`                                                                                            |
| Delete / confirm | `components/transaction/DeleteTransactionDialog.tsx`, `components/ui/ConfirmDialog.tsx`                                                                                                                                                                     |
| List + empty     | `<Card as="li">` rows in a `space-y-2` list; `<EmptyState>` when the list is empty (`bordered={false}` inside a card)                                                                                                                                       |
| Page heading     | `<PageHeader title description actions>` — one `h1` style (`text-2xl font-bold`); `size="lg"` on the marketing, legal and help pages                                                                                                                        |
| Walkthrough      | `components/product/ItemWalkthroughDialog.tsx` — keyboard-first (↑/↓, 1–9, Enter, S, N, ←/→, Esc), focus trapped, steps announced via `aria-live`, per-step server persist so closing mid-way is safe                                                       |
| Review / cards   | `src/app/[locale]/receipts/[receiptId]/receipt-review-client.tsx` + `components/receipt/ReceiptItemCard.tsx`                                                                                                                                                |
| App shell        | `components/layout/{AppShell,Header,Sidebar,Footer}.tsx` — sidebar for authed users (drawer on mobile, closes on navigation)                                                                                                                                |

## Formatting helpers — use these, never `toFixed`

| Need                            | Helper                                                                                   |
| ------------------------------- | ---------------------------------------------------------------------------------------- |
| cents → currency string         | `formatAmount(cents, currency, locale)` — `src/lib/transaction/formatters.ts`            |
| signed amount by direction      | `formatSignedAmount(...)` (sign comes from direction, not the number)                    |
| timestamp → date+time           | `formatOccurredAt` / date only `formatOccurredDate` / tooltip `formatOccurredAtAbsolute` |
| `<input type="datetime-local">` | `nowLocalIso`, `isoToLocalInput`, `localInputToIso` — `src/lib/datetime.ts`              |
| typed amount → cents            | `parseAmountToCents(raw)` — `src/lib/money.ts` (≤2 decimals, else `null`)                |

Money is integer cents end to end. The user's timezone is detected by
`components/auth/TimezoneDetector.tsx` via `Intl.DateTimeFormat().resolvedOptions().timeZone`.

## Testing expectations

Spec next to the component (`Button.tsx` / `Button.spec.tsx`), Vitest + Testing Library, jsdom,
`TZ=UTC` pinned. Prefer `data-testid` (829 in `src/`, 76 in `e2e/`) plus role/label queries. E2E
flows live in `apps/web/e2e/`. Details: [testing.md](testing.md).

## Known gotchas

- The `<LoadingOverlay>` 150 ms debounce means a fast response shows nothing — assert on the
  operation, not the overlay, in tests.
- Locale switch aborts in-flight fetches; without `useResetOnLocaleChange` the abort surfaced as a
  bogus "no access" banner on staging (6.16.5).
- `useBodyScrollLock` is module-global and counter-based — always pass the real `active` flag rather
  than mounting it conditionally in a way that skips the cleanup.
- `<Dialog>` dismisses on backdrop **mousedown** (a selection drag ending outside must not close
  it); specs fire `mouseDown` on `<testId>-backdrop`, which is no longer the dialog element.
- Tailwind resolves competing utilities by stylesheet order, not string order: never hand a kit
  component a class that fights one of its own (`w-full` vs `w-auto`) — size through the props
  (`padding`, `size`, `fullWidth`), and use `wrapperClassName="contents"` when a control must not
  add a layout box.
- `RowActionsMenu` must stay portalled; the desktop transactions table wrapper has
  `overflow-x: auto` and clips an in-flow popover.
- Nested-namespace `useTranslations('x')` + `t('x.y')` silently renders the literal key — the
  i18n-key-shape test guards only the paths it enumerates.
