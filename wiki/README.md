# Wiki — deep knowledge, loaded on demand

`AGENTS.md` is the index; `docs/` holds the designs and progress journals (what was built and
why); this directory holds what a specialist needs to work correctly in one area without
re-reading them. Read a page only when its topic is in play — the routing table in `AGENTS.md`
says which. Every page states the date its facts were checked; code wins over docs, and drift is
noted on the page.

| Page                                                 | Read when                                                                            |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------ |
| [architecture-map.md](architecture-map.md)           | Orienting: monorepo map, modules, request/auth/queue/SSE flow, invariants            |
| [conventions.md](conventions.md)                     | Writing any code or commit: layout, naming, DRY/no-legacy, docs rules                |
| [data-model.md](data-model.md)                       | Any schema change; understanding a model's relations and scoping                     |
| [auth-and-groups.md](auth-and-groups.md)             | Auth, sessions, providers, account lifecycle, groups, security invariants            |
| [transactions.md](transactions.md)                   | Transactions, attributions, categories, schedules, plans, dashboard, realtime        |
| [receipts-and-llm.md](receipts-and-llm.md)           | Receipt intake, extraction pipeline, LLM providers and BYOK                          |
| [products-catalog.md](products-catalog.md)           | Product registry, aliases, matcher, barcode, Open Food Facts, images                 |
| [analytics-and-budgets.md](analytics-and-budgets.md) | Analytics engine and query API; budgets, periods, alerts                             |
| [ui-design-system.md](ui-design-system.md)           | Designing or building any page or component; async, realtime, i18n, themes           |
| [testing.md](testing.md)                             | Writing or running tests; what CI gates; verdict standard                            |
| [deployment-and-ops.md](deployment-and-ops.md)       | Compose, workflows, blue/green, backups, the shared edge, secrets policy             |
| [infra-context.md](infra-context.md)                 | Anything deploy-shaped or local-dev-shaped; what the sibling infra work changes here |
| [roadmap.md](roadmap.md)                             | What is left, dependencies, in-flight branches, external blockers                    |
| [decisions.md](decisions.md)                         | Before re-deciding anything (stack, patterns, ownership, process)                    |
| [gotchas.md](gotchas.md)                             | A command or flow fails in a surprising way                                          |
| [learnings.md](learnings.md)                         | Append-only log written by the `learn` skill; skim for recent changes                |

Editing rules: verified facts only, dated; first line `# Title (checked YYYY-MM-DD)`; no
addresses, usernames, hostnames-as-config or secrets (public repository); a page stays under 200
lines — split and index instead of growing; changes go through the `learn` skill, which runs
`node .claude/skills/learn/scripts/validate.mjs`.
