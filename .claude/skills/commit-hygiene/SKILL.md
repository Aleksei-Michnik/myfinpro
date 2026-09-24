---
name: commit-hygiene
description: Procedure and checks for committing in this public repository — prettier on changed files, git identity check per clone, a staged-diff scan for addresses, hostnames, credentials and forbidden trailers, and the message rules (Conventional Commits, one logical change, no AI mentions or co-author trailers, no --amend). Use every time you are asked to commit or to write a commit message, and when reviewing a diff for leaks before a merge.
---

# Commit hygiene

Commit only when the task explicitly asks. Pushing, merging to `main` and deploying are the
owner's actions (`/release` for the owner's own procedure).

## Before `git commit`

1. **Identity**: `git config user.email` — clones of this repo differ (the global identity belongs
   to another organisation). It must be the owner's personal identity; if unsure, stop and ask.
2. **Format** every changed file: `/path/to/repo/node_modules/.bin/prettier --write <files>` or
   `pnpm format` (covers `ts,tsx,js,jsx,json,md,yaml,yml`). CI runs `format:check`.
3. **Stage explicitly** (`git add <files>`); never `git add -A`. Never stage `.env*`, `.kilocode/`,
   `node_modules`, screenshots of real data.
4. **Scan**: `bash .claude/skills/commit-hygiene/scripts/check-commit.sh "<message>"` — fails on
   IPv4 addresses, `user@host` patterns, private-key headers, `password=`/`token=` with values,
   `Co-Authored-By`, mentions of AI assistants in the message, staged `.env`/`.kilocode` files, and
   any regex listed in the optional local file `$HOME/.config/myfinpro/forbidden-patterns` (one
   per line — the place for the project's hostnames, which must not be written into this repo).

## Message

- Conventional Commits as the log uses them: `feat(receipts): …`, `fix(products): …`,
  `docs: …`, `test(phase-8.18): …`, `style(products): …`; lowercase subject, imperative, ≤ 72
  chars; body only when the why is not obvious.
- One logical change per commit (fix, feature, doc, test each separate). `--amend` only for a
  trivial fixup of your own unpushed commit.
- Nothing sensitive: no domain names, server names, addresses, usernames, keys, secret values.
- No AI or assistant mentions, no `Co-Authored-By` or `Generated-with` trailers — this repo's
  rule (sibling repos differ; follow the repo you are in).

## After

`git status` clean for the files you touched; `git log -1 --stat` matches what you intended.
Report the hash and the file list. Do not push.
