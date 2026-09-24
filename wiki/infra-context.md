# Infra context — what the shared infrastructure work changes here (synced 2026-09-24)

Read when: anything deploy-, compose-, nginx-, mail- or local-dev-shaped. Refresh with the
`infra-sync` skill (`infra-scout` agent) when this date is older than 7 days. Sources: the private
infra repo (`~/Aleksei-Michnik/infra`: `README.md`, `docs/notes/next-session.md`, `mdock/`), the
private WordPress repo (`~/mrmichnik`) and `~/Aleksei-Michnik/green-fluffy`, all read-only. This is a
**public** repository: servers, users and hostnames appear here by role only.

## The shared picture

- One shared host runs myfinpro (production + staging, blue/green behind the edge nginx this repo
  ships), the three WordPress sites (staging live with production data; production cutover
  pending) and, once deployed, green-fluffy. The old WordPress host is still production until the
  cutover and a 7-day soak.
- **The edge nginx is ours today and shared with other tenants.** Its compose is
  `docker-compose.shared-nginx.yml`; other projects render their vhosts into its `conf.d`, run
  `nginx -t` inside the container and reload — never restart. Infra Phase 5 (`infra/docs/07`)
  moves ownership to the infra repo _after_ the WordPress cutover, and then fixes our vhosts'
  resolver setup and moves our outbound mail to the shared relay (`next-session.md` §2 step 15).
  Until then: minimal edge changes, noted for upstreaming; literal `upstream` blocks and the
  commented HTTPS block in `infrastructure/nginx/ssl.conf.template` stay as they are.
- **Deploy pattern for every project**: CI builds images → GHCR → scp config + ssh → health-gated
  blue/green slot switch. Canonical templates (`infra/templates/`) do **not exist yet**
  (checked 2026-09-24); the WordPress repo's `scripts/{deploy,rollback}.sh` and
  `.github/workflows/deploy-*.yml` are the newest reference implementation.
- **Production never deploys as a side effect of a merge** (owner decision 2026-09-24). The
  WordPress repo already switched to `workflow_dispatch`-only with a confirmed ref
  (commit `f764e3e` there). Our `deploy-production.yml` still triggers on push to `main` — a
  pending change for `devops`, owner-approved in principle, not yet scheduled.
- **Mail**: a shared outbound relay runs on the shared mail network and does not sign DKIM; each
  client signs (we do, in `apps/api/src/mail/mail.service.ts`). Our per-environment Haraka
  containers still run; their retirement steps live in the infra repo's `mail/README.md`.
- **Secrets**: GitHub Actions secrets injected per run; no `.env` at rest on the host. Names only
  in files.
- **Pipefail trap fixed upstream**: `curl … | grep -q` under `set -o pipefail` reports a healthy
  slot as failed (`grep -q` closes the pipe, curl exits 23). The WordPress repo fixed it by
  grepping a saved body (`e169324`). Check our `scripts/deploy.sh` and `rollback.sh` for the same
  construct before trusting a "verification failed" (`gotchas.md`).

## Mdock — local front door (infra Phase 6, built 2026-09-24)

- `infra/mdock/` exists and is committed (`05b3a45`): `hosts.json` registry, `mdock.sh`
  (`up | down | status | certs | trust | browser`), Traefik v3.6 on `127.0.0.1:443` with a mkcert
  certificate, `browser.bat` (Windows Chrome, primary on this WSL2 workstation) and `browser.sh`.
  The WordPress repo has adopted it (`9e398e8`).
- **This project is already registered**: id `myfinpro`, upstream `myfinpro-nginx:80`,
  `hostHeader: localhost`, network `mdock_net`. Adoption here (`next-session.md` §2 step 5, our
  own small PR, `devops`): the local `nginx` service joins the external `mdock_net` network; the
  route comes from the registry's generated file provider, so **no hostname is written in this
  repo**; the published port may stay for the old workflow. Playwright cannot use Chrome resolver
  rules — keep base URLs env-driven.
- Docker Desktop on WSL2 forwards published ports to the Windows loopback; native WSL2 Docker
  would need `localhostForwarding`.

## Sibling agent suite (green-fluffy, same day)

Same layout: `AGENTS.md` (+ `CLAUDE.md` symlink), `.claude/{agents,rules,skills}`, `wiki/`.
Shared names to keep aligned: agents `architect`, `orchestrator`, `ui-designer`, `api-coder`,
`web-coder`, `qa-tester`, `security-reviewer`, `devops`, `infra-scout`, `i18n-translator`; skills
`commit-hygiene`, `i18n`, `infra-sync`, `learn`, `local-stack`, `prisma-migrations`,
`progress-log`, `stack-versions`, `testing`, `ui-conventions`. Theirs adds `porter`, `kb-curator`,
`iteration`, `privacy-guard`, `port-from-myfinpro`; ours adds `debugger`, `llm-extraction`,
`release`. Their commits carry an AI co-author trailer; ours must not.

## Open items that touch this repo

1. Mdock adoption: PR #51 (`feat/mdock` → `develop`, opt-in overlay `docker-compose.mdock.yml`, `MDOCK_DEV_ORIGINS` for Next dev origins, a "Local development" section in `docs/deployment.md`) is open and mergeable as of 2026-09-24 — owner's review.
2. Production backups: the infra session reports no crontab installed and empty backup directories on the host (unverified here); `deploy-production.yml` has no pre-deploy dump step.
3. Production workflow → dispatch-only with confirmed ref (owner decision; `devops`).
4. `deploy.sh`/`rollback.sh` pipefail verification check.
5. Infra Phase 5 (edge ownership, resolver fix, shared relay) — after the WordPress cutover; not ours to start.
6. Haraka retirement — per the infra repo's mail README, after Phase 5.

## Re-check on every sync

`infra/docs/notes/next-session.md` (top, §2 table), `infra/docs/notes/phase-2-pipeline.md` §1,
`infra/mdock/{hosts.json,README.md}`, `infra/templates/` (exists?), `infra/mail/README.md`,
`git -C ~/Aleksei-Michnik/infra log --since=<this date>`, `git -C ~/mrmichnik log --since=<this date>`,
`~/Aleksei-Michnik/green-fluffy/.claude` and `wiki/` for name drift.
