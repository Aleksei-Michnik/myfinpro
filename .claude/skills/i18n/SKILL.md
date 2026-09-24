---
name: i18n
description: Rules and tooling for user-facing text — next-intl keys in apps/web/messages/en.json and he.json, key parity check script, Hebrew gender and RTL rules, mail templates, and what to hand to the i18n-translator. Use whenever a UI or email string is added, changed or removed, and before declaring a UI iteration done.
---

# i18n (en + he)

Two locales, key-for-key equal (1131 leaf keys each as of 2026-09-24). `localePrefix: 'never'`:
the locale comes from cookie/detection, never the URL. Namespaces (top-level keys): `common`,
`ui`, `nav`, `home`, `auth`, `toast`, `dashboard`, `groups`, `settings`, `legal`, `help`,
`footer`, `transactions`, `categories`, `receipts`, `products`, `budgets`.

## Procedure

1. Add the key under the surface's namespace in `en.json`, in the neighbours' style (nested by
   component or state; ICU for plurals: `{count, plural, one {…} other {…}}`).
2. Add the Hebrew value in `he.json` at the same path. Draft it yourself; mark uncertain ones in
   the report for the `i18n-translator`.
3. Check parity: `node .claude/skills/i18n/scripts/parity.mjs` (exits non-zero on missing or
   orphan keys; warns on Hebrew values that look untranslated).
4. Mail templates in the API carry the same voice; both locales render.
5. `pnpm --filter web test:unit` — a key-shape test guards the transaction namespace.

## Hebrew rules

- RTL: the layout mirrors; numbers, currency codes, barcodes and Latin product names stay LTR —
  isolate them with the formatting helpers rather than embedding in text.
- Gender: no ICU `select` is used in this project; strings are phrased to agree with their
  subject (feminine agreement with תנועה for transactions). Prefer neutral phrasing where natural.
- Finance vocabulary: reuse the terms existing keys use before inventing a new one.

## Never

Hardcode a user-facing string; copy the English structure into Hebrew; leave a key in one file
only; put locale segments in backend-generated links (the web redirects them, but it is drift).
