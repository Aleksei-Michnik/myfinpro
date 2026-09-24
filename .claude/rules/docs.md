---
paths:
  - 'docs/**'
  - 'IMPLEMENTATION-PLAN.md'
  - 'SPECIFICATION-USER-STORIES.md'
---

# Documentation rules

- `docs/progress.md` is an index only (phase table, 2–4 sentence summary per phase, links).
  Iteration detail goes to `docs/phase-<N>-progress.md` — format in the `progress-log` skill.
- Design documents are one per phase or topic: `docs/phase-<N>[-<topic>]-design.md`; UI specs in
  `docs/ui/<N.m>-<surface>.md`; RCAs as `docs/phase-<N.m>-rca.md`.
- `IMPLEMENTATION-PLAN.md` and the user stories are the owner's; agents report contradictions
  and update `wiki/roadmap.md`, they do not re-plan.
- Facts only, dated where they can go stale; no hostnames, addresses, usernames or secrets;
  prettier after editing (`pnpm format` covers markdown).
