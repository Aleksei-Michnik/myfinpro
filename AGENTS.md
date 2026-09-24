# MyFinPro — instructions index

Always loaded, for every AI client and every person. Everything deeper loads on demand: path rules
in `.claude/rules/`, procedures in `.claude/skills/`, roles in `.claude/agents/`, knowledge in
`wiki/`, designs and plans in `docs/` and `IMPLEMENTATION-PLAN.md`. `CLAUDE.md` is a symlink to
this file. **Public repository**: no file, message or doc names servers, addresses, users or
secrets — describe them by role.

## What this is

Personal/family finance app. pnpm 10 + Turborepo monorepo: `apps/api` (NestJS 11, Prisma 7 on
MySQL 9.7, BullMQ on Redis 8, SSE realtime, Anthropic-SDK receipt extraction), `apps/web`
(Next.js 16, React 19, Tailwind 4, next-intl `en` + `he`), `apps/bot` (Telegram, planned),
`packages/shared` (types, DTOs, constants). Node 26, TypeScript 6 — never older
(`stack-versions`). `develop` deploys staging; `main` deploys production. Phases 0–7 shipped,
8–10 in progress, 11–19 open — `wiki/roadmap.md`.

## Non-negotiables

- **Minimal and DRY.** Search before you write: grep for an existing helper, component, DTO,
  type or query by name and by behaviour, and extend it; a type used by API and web lives in
  `packages/shared`; never two constants that must hold the same value — derive one from the
  other. No abstraction, option or configurability nobody asked for. **No legacy paths**:
  replacing something removes the old one.
- **Verify before you claim.** Facts come from files or commands in this session; tests are run,
  not assumed; failures are reported with output. Design against the code, not the plan's ideal.
- **UI async goes through `useAsyncOperation()`** (`docs/ui-async-conventions.md`); realtime per
  `docs/ui-realtime-conventions.md`. Every user-facing string is a next-intl key in both locales.
- **Tests accompany every change**; prettier runs on every changed file before you finish.
- **Secrets**: never a value on disk, in a command line, a log or a message — names only.
  `.env*` stays untracked; `.kilocode/` is local and never staged.
- **Production is the owner's.** Agents never push `main`, deploy, merge to `main`, or touch
  staging/production servers. Today a push to `main` deploys production. The shared edge nginx is
  `nginx -t` then reload — never restart; never `docker compose down -v` an infra compose file.
- **Commit only when asked**, per `commit-hygiene`: no AI mentions or co-author trailers, no
  `--amend`, one logical change per commit, nothing sensitive in files or messages.
- **Plan scope is the owner's.** `IMPLEMENTATION-PLAN.md` is mirrored, not edited, by agents;
  contradictions are reported.

## Map

| Path                                                                       | What                                                                                                                        |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/<module>/`                                                   | NestJS modules: auth, group, transaction, category, receipt, product, analytics, budget, llm, mail, queue, realtime, common |
| `apps/api/prisma/`                                                         | schema, migrations (`<ts>_phase<N>_<m>_<topic>`), seed                                                                      |
| `apps/api/test/{integration,staging}/`                                     | Jest + Testcontainers; staging smoke suites                                                                                 |
| `apps/web/src/{app,components,lib}/`                                       | routes under `app/[locale]/`, `components/<domain>` + `ui`, `lib/<domain>` clients                                          |
| `apps/web/messages/{en,he}.json`                                           | translations; `apps/web/e2e/` Playwright                                                                                    |
| `packages/shared/src/`                                                     | cross-app types, DTOs, constants, `budget-period.ts`                                                                        |
| `docs/`                                                                    | `phase-<N>*-design.md`, `phase-<N>-progress.md`, `progress.md` index, RCAs, conventions, ops                                |
| `docs/ui/`                                                                 | UI specs written by `ui-designer` (`<N.m>-<surface>.md`)                                                                    |
| `wiki/`                                                                    | operational knowledge, one page per topic, loaded on demand (`wiki/README.md`)                                              |
| `infrastructure/`, `scripts/`, `docker-compose*.yml`, `.github/workflows/` | build, deploy, backup — `wiki/deployment-and-ops.md`                                                                        |

## Routing — situation → what to load

Load exactly what the row says; the wiki page is mandatory for the role, not optional.

| Situation                                                            | Agent                              | Skill                               | Wiki page                                    |
| -------------------------------------------------------------------- | ---------------------------------- | ----------------------------------- | -------------------------------------------- |
| Implement a phase or several iterations                              | `orchestrator`                     | `progress-log`                      | `roadmap`                                    |
| Iteration is only a table row; contracts needed; cross-module change | `architect`                        | `prisma-migrations`                 | `architecture-map`, domain page, `decisions` |
| New page, component, flow; UI inconsistency                          | `ui-designer`                      | `ui-conventions`, `i18n`            | `ui-design-system`                           |
| Change under `apps/api` or `packages/shared`                         | `api-coder`                        | `testing`, `prisma-migrations`      | domain page, `conventions`                   |
| Change under `apps/web`                                              | `web-coder`                        | `ui-conventions`, `i18n`, `testing` | `ui-design-system`, domain page              |
| Receipt extraction, LLM providers, prompts, BYOK                     | `api-coder`                        | `llm-extraction`                    | `receipts-and-llm`                           |
| Verify an iteration; gate a merge; raise coverage                    | `qa-tester`                        | `testing`, `local-stack`            | `testing`                                    |
| Usability or exploratory check of a user-visible flow                | `qa-tester`                        | `playwright-qa`, `local-stack`      | `ui-design-system`                           |
| Accounts, balances, transfers, statement import, connector           | `api-coder` / `web-coder`          | `testing`                           | `accounts-and-sync`                          |
| Change touches auth, scoping, uploads, LLM credentials, CI/deploy    | `security-reviewer` (after coding) | —                                   | `auth-and-groups`                            |
| Bug with unclear cause; staging/production incident                  | `debugger`                         | `local-stack`, `testing`            | `gotchas`                                    |
| Compose, Dockerfile, nginx, workflows, scripts, Mdock                | `devops`                           | `infra-sync`, `local-stack`         | `deployment-and-ops`, `infra-context`        |
| Infra question; `infra-context` sync older than 7 days               | `infra-scout`                      | `infra-sync`                        | `infra-context`                              |
| UI text added or changed                                             | `i18n-translator`                  | `i18n`                              | `ui-design-system` (i18n section)            |
| Schema change (any role)                                             | —                                  | `prisma-migrations`                 | `data-model`                                 |
| Iteration finished                                                   | —                                  | `progress-log`                      | —                                            |
| Asked to commit                                                      | —                                  | `commit-hygiene`                    | —                                            |
| Local stack up; version mismatch symptoms                            | —                                  | `local-stack`, `stack-versions`     | `gotchas`                                    |
| Merge `develop` → `main`, watch a deploy (owner-invoked)             | —                                  | `/release`                          | `deployment-and-ops`                         |
| End of a run; after a correction; a surprising finding               | —                                  | `learn`                             | `learnings`                                  |
| Orienting in the repo                                                | —                                  | —                                   | `architecture-map`, `conventions`            |

Domain pages: `transactions`, `receipts-and-llm`, `products-catalog`, `analytics-and-budgets`,
`auth-and-groups`, `accounts-and-sync`.

## Model policy — by complexity and blast radius

| Tier                                   | Model                    | Roles                                                                             |
| -------------------------------------- | ------------------------ | --------------------------------------------------------------------------------- |
| Decide (widest blast radius)           | `fable`, fallback `opus` | `architect`                                                                       |
| Coordinate, judge, repair instructions | `opus`                   | `orchestrator`, `security-reviewer`, `debugger`, `ui-designer`, `learn`           |
| Build well-specified work              | `sonnet`                 | `api-coder`, `web-coder`, `qa-tester`, `devops`, `i18n-translator`, `infra-scout` |

Escalate one tier when a task crosses module boundaries, touches auth, money, scoping or
migrations, or a coder has failed the same iteration twice. A coder never decides design
questions; it reports them to the architect through the orchestrator.

## Parallel work

Independent tasks run as parallel subagents, each in its own worktree (`isolation: "worktree"`)
on the phase branch `phase/<N>`; at most 3 implementation tracks. Prisma migrations are
serialized (one holder at a time). Integration is sequential and local: merge into `develop`,
regression by `qa-tester`, then live workers rebase. Workers talk through the orchestrator via a
coordination directory in its scratchpad. The optional Agent Teams feature is not required.

## Knowledge layers and maintenance

Index (this file) → path rules → skills → agents → `wiki/` → `docs/`. Size caps keep context cheap:
this file ≤ 160 lines, an agent ≤ 80, a skill ≤ 200, a wiki page ≤ 200 (split and index instead
of growing). The `learn` skill is the only way instructions change after a finding: it edits the
right layer, appends to `wiki/learnings.md` and runs `node .claude/skills/learn/scripts/validate.mjs`,
which every edit to `.claude/` or `wiki/` must pass. Sibling projects build the same suite
(`~/Aleksei-Michnik/green-fluffy`, private infra and WordPress repos) — keep role and skill names
aligned when adding one.
