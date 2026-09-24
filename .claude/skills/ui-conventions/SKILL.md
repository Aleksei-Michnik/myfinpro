---
name: ui-conventions
description: The binding UI conventions of the web app, as a checklist — useAsyncOperation scopes and visualizations, realtime (SSE) refresh rules, i18n in both locales, RTL, both colour schemes, component reuse — with pointers to the two convention docs and the design-system wiki page. Use before building or reviewing any web surface, and before declaring a UI iteration done.
---

# UI conventions

Binding sources: `docs/ui-async-conventions.md`, `docs/ui-realtime-conventions.md`; the system
itself in `wiki/ui-design-system.md` (tokens, component inventory, page templates). Read the
sections relevant to the surface — this checklist does not replace them.

## Async operations (`@/lib/ui`)

- Every fetch and mutation runs through `useAsyncOperation()` with a scope: `page` (navigation and
  initial load → `<PageProgressBar>`), `container` (a region → `<LoadingOverlay>`), `control` (a
  button or row action → `<ButtonSpinner>`). Failures surface through the standard error and
  retry paths (`<RetryReturnDialog>`, `<InlineErrorBanner>`, toast) — never ad-hoc
  `useState(loading)`, inline spinners or `alert()`.
- Optimistic updates only where the convention doc allows; rollback on failure.

## Realtime

Surfaces that show shared data subscribe to the SSE events listed for their domain and refresh
per the realtime doc (invalidate, not re-render everything); reconnect and auth handling are
provided — do not add a second EventSource.

## Text, direction, theme

- Every string is a next-intl key in `apps/web/messages/en.json` **and** `he.json` (`i18n` skill).
- RTL-safe layout: logical properties (`ms-`, `pe-`, `text-start`), icons that mirror, numbers and
  Latin identifiers isolated in RTL text.
- Both colour schemes (dark follows `prefers-color-scheme`); check contrast of form labels and
  placeholders in dark mode — a recurring fix.

## Reuse

`components/ui/*` first (Button, Input, ConfirmDialog, RowActionsMenu, DocumentViewer,
FileCaptureButtons, Toast, …), then the domain folder. A new visual pattern needs a
`ui-designer` spec, not an ad-hoc component.

## Done means

Spec followed; async scopes right; both locales; RTL checked; both schemes checked; Testing
Library spec next to the component; Playwright flow when user-visible; `pnpm --filter web
typecheck && lint && test:unit` green; prettier run.
