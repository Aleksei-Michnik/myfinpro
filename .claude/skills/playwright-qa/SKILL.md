---
name: playwright-qa
description: Agentic QA of a web surface with Playwright — drive the real app in a headless browser to check a flow works and is usable (both locales, both colour schemes, phone viewport, keyboard, console errors), take screenshots for review, and turn what you learn into a committed e2e spec. Use after building or changing any user-visible flow, before declaring a UI iteration done, when the owner asks "does it work / is it usable", and for exploratory testing of a page even if no spec exists yet.
---

# Playwright QA

Specs in `apps/web/e2e/*.spec.ts` are the durable record; this skill is how an agent _looks_ at a
surface first. Both need a running stack (`local-stack`): web on `PORT`, API on `API_PORT`, mock
extraction provider. Never point this at production.

## Setup (once per machine)

`pnpm --filter web exec playwright install chromium` — the browser build must match
`@playwright/test` in `apps/web/package.json` (a version mismatch fails with "Executable doesn't
exist"). Only chromium is needed for agentic runs; CI installs `--with-deps chromium` itself.

## Exploratory session

Write a throwaway spec as `apps/web/e2e/qa-<surface>.spec.ts` (the config's `testDir`), run it,
then delete it or promote it (below) — a `qa-*` file is never committed:

```ts
// apps/web/e2e/qa-<surface>.spec.ts
import { test, expect, devices } from '@playwright/test';
test.use({ baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000' });
test('explore', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  // register a fresh user through the UI (copy registerFreshUser from e2e/budgets.spec.ts)
  await page.goto('/accounts');
  await page.screenshot({ path: 'shots/accounts-en-light.png', fullPage: true });
  expect(errors, errors.join('\n')).toEqual([]);
});
```

```
PLAYWRIGHT_BASE_URL=http://localhost:<PORT> pnpm --filter web exec playwright test e2e/qa-<surface>.spec.ts --project=chromium
```

`PLAYWRIGHT_BASE_URL` makes the config's `webServer` block reuse the running stack instead of
starting `pnpm run dev` on port 3000. Screenshots go under the scratchpad (absolute `path`).

Before trusting a red run: (1) the API env has `RECEIPT_EXTRACTION_PROVIDER=mock`; (2) run
with `--workers=1` — parallel specs each register a user and trip the auth throttle; (3) if a
route answers Next's 404 page after a big refactor, stop the server, `rm -rf apps/web/.next`
and start again (stale Turbopack cache); (4) a list renders a card **and** a table row per item,
so count inside `transactions-list-desktop` (or the card list), never on the page; (5) the
retry dialog carries no `dialog` role — detect it by its text or testid, and know that a full
page load of `/transactions` in dev opens it on `develop` too (`wiki/gotchas.md`); (6) a
Hebrew run needs a user whose profile locale is `he` — the cookie alone is overwritten at login. (7) A prefix locator
(`[data-testid^="import-row-"]`) also matches longer testids such as `import-row-counts-…` —
anchor it on the element (`tr[data-testid^=…]`) before trusting a count.

Check, and screenshot, every combination that the conventions promise:

| Dimension     | How                                                                                                             |
| ------------- | --------------------------------------------------------------------------------------------------------------- |
| Locale        | `en` default; Hebrew via the header switcher or `context.addCookies([{ name: 'NEXT_LOCALE', value: 'he', … }])` |
| Colour scheme | `test.use({ colorScheme: 'dark' })` — dark follows the OS preference, there is no in-app switch                 |
| Viewport      | `test.use({ ...devices['Pixel 5'] })` for the card layout, desktop for tables                                   |
| Keyboard      | `page.keyboard.press('Tab')` through a dialog; ESC closes; focus returns to the trigger                         |
| Errors        | `pageerror` + console `error` collectors — any entry is a finding                                               |
| Async states  | Slow the API with `page.route('**/api/v1/**', r => setTimeout(() => r.continue(), 800))` to see overlays        |

Read the screenshots (the Read tool renders PNGs): overlapping text, clipped RTL layouts, invisible
placeholders in dark mode and untranslated keys (`accounts.list.title` rendered literally) are all
findings. Report them with the screenshot path and the element's `data-testid`.

## From exploration to a spec

Keep what proved the flow: a fresh user per run, `data-testid` hooks (add them to the component if
missing — never brittle CSS selectors), assertions on outcomes (a card appears, an amount reads
`₪1,234.00`), no `waitForTimeout`. Put it in `apps/web/e2e/<surface>.spec.ts` following
`budgets.spec.ts`; if the flow needs a file, add a small synthetic fixture under
`apps/web/e2e/fixtures/` (never real bank data) and use `setInputFiles`.

## Verdict

Per acceptance criterion: **met / not met**, with the command, the screenshot paths and the console
collector result. "The page renders" is not a verdict; "a user can complete the flow in both
locales without a console error" is.
