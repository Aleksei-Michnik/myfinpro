---
name: infra-sync
description: Procedure to refresh this repo's view of the shared infrastructure by reading the sibling repositories read-only — the private infra repo (plan, shared edge, mail relay, Mdock, deploy templates), the WordPress repo (newest deploy pattern), green-fluffy (agent-suite conventions) — and updating wiki/infra-context.md with dated facts and no sensitive values. Use before deploy, compose, CI or nginx work, on any infra question, or when the sync date is older than 7 days.
---

# Infra sync

Read-only over the siblings; write only `wiki/infra-context.md` (and a `wiki/decisions.md` row
when a decision binds this project). Public repo: roles, not values.

## Read (in this order)

1. `~/Aleksei-Michnik/infra/docs/notes/next-session.md` — top and the order-of-work table; the
   rows that name myfinpro (Mdock adoption, Phase 5 shared-edge move, relay migration).
2. `~/Aleksei-Michnik/infra/docs/notes/phase-2-pipeline.md` §1 (living status),
   `infra/docs/07-phase-5-shared-edge-neutralization.md`, `infra/mail/README.md`,
   `infra/mdock/{README.md,hosts.json}` (is this project registered? what upstream and network?),
   `infra/templates/` (does it exist yet?), `infra/edge/`.
3. `git -C ~/Aleksei-Michnik/infra log --since=<last sync date> --oneline`; same for `~/mrmichnik`
   (its `scripts/{deploy,rollback}.sh` and `.github/workflows/deploy-*.yml` are the newest
   reference implementation of the shared pattern) and `~/Aleksei-Michnik/green-fluffy`
   (`.claude/agents`, `.claude/skills`, `wiki/` — keep role and skill names aligned).

## Write

Update `wiki/infra-context.md`: the sync date line, the shared picture, the Mdock status, the
"open items that block this repo" list, and the "re-check" list. Each fact dated. Anything not
verifiable marked _unverified_. Never copy addresses, usernames, hostnames-as-config, keys.

## Report

Delta since last sync; blocked / unblocked / must-change items for this repo; exact lines
changed. If a sibling introduced a convention this suite should mirror (a new agent or skill
name), list it for the `learn` skill.
