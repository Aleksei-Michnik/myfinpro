---
name: learn
description: The self-improving step of this agent suite — harvests what a session or an orchestrated run taught (corrections from the owner, commands that failed and what worked, drift between docs and code, decisions taken, mis-routed or under-triggered skills and agents, sibling-repo convention changes) and applies each lesson to the one layer where it will be seen next time — AGENTS.md, a path rule, a skill, an agent, or a wiki page — then appends to wiki/learnings.md and validates the whole suite. Use at the end of every orchestrated run, right after any correction from the owner, after a debugging session that found a trap, after an infra-sync that reported a convention change, and whenever you notice an agent lacked context it needed. Run it from an Opus-or-better session: it edits instructions, the widest blast radius there is.
argument-hint: "[optional: the finding to record]"
---

# Learn

Instructions in this repo change only through this procedure, so that every lesson lands in the
layer that will actually be loaded when it matters, sizes stay within caps, and the record in
`wiki/learnings.md` explains later why a rule exists.

## 1. Harvest

Scan the conversation (and, when run by the orchestrator, the coordination `status.md`,
`questions.md` and tester verdicts) for signals:

| Signal                                                                  | Usually becomes                            |
| ----------------------------------------------------------------------- | ------------------------------------------ |
| Owner said "no / don't / never / always / instead / actually"           | rule or role behaviour                     |
| A command failed and a different one worked                             | gotcha + skill fix                         |
| A doc and the code disagreed                                            | wiki fact, drift note                      |
| A decision was taken by the owner                                       | `wiki/decisions.md` row                    |
| An agent lacked context, or read far more than it needed                | routing row, `skills:` preload, wiki split |
| A skill or agent did not trigger when it should have (or fired wrongly) | pushier / narrower `description`           |
| The tester returned the same "not met" twice for one cause              | coder procedure step                       |
| `infra-sync` reported a sibling convention change                       | name alignment, `infra-context`            |

If `$ARGUMENTS` names a finding, start from it. One finding = one row; do not merge.

## 2. Classify — smallest layer that is seen at the right time

| Layer                         | Put here when…                                        | Cap       |
| ----------------------------- | ----------------------------------------------------- | --------- |
| `AGENTS.md`                   | it bites in every session regardless of files or role | 160 lines |
| `.claude/rules/<area>.md`     | it is tied to a path family (`paths:`)                | 60 lines  |
| `.claude/skills/<x>/SKILL.md` | it is a procedure or a check                          | 200 lines |
| `.claude/agents/<role>.md`    | it changes how one role reads, decides or reports     | 80 lines  |
| `wiki/<page>.md`              | it is a fact about the system, dated                  | 200 lines |
| `wiki/decisions.md`           | it is a binding decision with a why                   | 200 lines |
| `wiki/gotchas.md`             | symptom → cause → fix                                 | 200 lines |

## 3. Apply

- Minimal edit; date facts that can go stale; replace a superseded line instead of adding a
  contradiction next to it. Over the cap ⇒ push detail down a layer or split a wiki page and add
  it to `wiki/README.md` and the routing table.
- Never write a secret, address, username or hostname. Never change the model tiers, the
  production rules or a "Never" list on your own — propose them to the owner in the report.
- Description tuning: name the concrete situation in the `description` ("Use when … even if the
  user does not say …"), keep it under ~600 characters, and check it does not now overlap
  another skill's trigger.
- If the lesson is also true for the sibling suite in `~/Aleksei-Michnik/green-fluffy`, say so in
  the report; do not edit that repo.

## 4. Record

Append to `wiki/learnings.md` (newest last): `| YYYY-MM-DD | finding | evidence (file, commit,
command) | applied to (paths) |`.

## 5. Validate

`node .claude/skills/learn/scripts/validate.mjs` — frontmatter fields, size caps, `skills:`
references, routing-table and wiki-index completeness, wiki link targets, leak patterns. Then
prettier on every changed markdown file. Fix until it passes; a red validator is not a finished
run.

## 6. Report

Table: finding → layer/path → one-line change. Then proposals that need the owner (tier or rule
changes), and anything you could not verify.
