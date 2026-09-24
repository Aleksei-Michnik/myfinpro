---
paths:
  - 'apps/web/**'
---

# Web rules

- Read `wiki/ui-design-system.md` before building or changing a surface; `docs/ui-async-conventions.md`
  and `docs/ui-realtime-conventions.md` are binding.
- Every fetch or mutation uses `useAsyncOperation()` from `@/lib/ui` with the right scope
  (`page` / `container` / `control`) and its standard visualizations. No ad-hoc loading state.
- Every user-facing string is a next-intl key in **both** `apps/web/messages/en.json` and `he.json`
  (`i18n` skill; parity script). Hebrew is RTL and gendered — never a copied English structure.
- Reuse `src/components/ui/*` and the domain folder before writing a component; routes live under
  `src/app/[locale]/`, clients and types under `src/lib/<domain>/`.
- Both themes, mobile-first; test with Testing Library next to the component, Playwright in
  `apps/web/e2e/` for user-visible flows.
- Verify: `pnpm --filter web typecheck && pnpm --filter web lint && pnpm --filter web test:unit`.
