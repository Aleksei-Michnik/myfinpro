---
paths:
  - 'infrastructure/**'
  - 'scripts/**'
  - '.github/**'
  - 'docker-compose*.yml'
  - '.env*'
  - 'Dockerfile*'
---

# Infrastructure rules

- Read `wiki/deployment-and-ops.md` and `wiki/infra-context.md` first; if the sync date there is
  older than 7 days or the task is deploy-shaped, run the `infra-sync` skill.
- Public repository: server-specific values come from GitHub Actions secrets and environment;
  never write addresses, usernames or hostnames-as-configuration into files or messages.
- Images at the pinned versions (`stack-versions`), actions pinned, least-privilege `permissions:`,
  secrets by name only.
- The edge nginx is shared with other tenants: `nginx -t` inside the container, then reload —
  never restart, never edit its own files. Never `docker compose down -v` an infra compose file:
  the production DB and uploads live in those volumes.
- Production deploys are the owner's; do not add or change a trigger that deploys on merge.
- Verify locally what can be verified: `docker compose config -q`, image builds, `nginx -t`,
  shell scripts with `bash -n` and `shellcheck` when available; say what could only be checked
  after a push.
