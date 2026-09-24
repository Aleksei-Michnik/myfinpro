---
name: release
description: Owner-invoked procedure to promote develop to main and watch the deployment — preconditions, the explicit merge commit, CI watching without sleep or pipelines, post-release checks. Only a person runs this; it is never triggered by an agent on its own.
disable-model-invocation: true
argument-hint: '[phase or scope, e.g. "Phase 9"]'
---

# Release: develop → main

A push to `main` deploys production today (workflow `deploy-production.yml`; the sibling infra
decision is to make it dispatch-only — until then, the push _is_ the deploy). This procedure is
therefore the owner's; an agent prepares and reports, the owner pushes.

## Preconditions

1. `develop` is green: `gh run list --limit 5 --branch develop` — CI, staging deploy and
   `test-staging` all succeeded for the head commit.
2. The owner has verified staging for the scope being released.
3. `docs/progress.md` and the phase progress doc are up to date (`progress-log`); every commit in
   `git log --oneline main..develop` is expected.

## Merge

```bash
git fetch origin && git checkout main && git pull --ff-only origin main
git merge develop --no-ff -m "Merge $ARGUMENTS into main"
```

Always a merge commit with an explicit message (repo rule). Run `commit-hygiene`'s check on the
message. Resolve nothing on `main`: if the merge conflicts, abort and fix on `develop`.

## Push and watch (owner)

```bash
git push origin main
gh run list --limit 5 --branch main
gh run watch <run-id> --exit-status
```

Watch directly — no `sleep`, no `| tail`/`| head` on `gh run watch`. On failure, the rollback
procedure is in `wiki/deployment-and-ops.md`; do not retry the deploy blindly.

## After

Mark the phase complete in `docs/progress.md` (date, "live in production"), commit as
`docs: mark <scope> as complete, production deployment verified`, and record any surprise via
the `learn` skill.
