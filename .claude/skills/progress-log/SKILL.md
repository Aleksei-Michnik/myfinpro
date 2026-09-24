---
name: progress-log
description: How to record a finished iteration in the project's progress documentation — the per-phase progress file format (heading levels, dates, commits, test counts), the index-only rule for docs/progress.md, and the update sequence. Use when an iteration, hotfix or post-phase task is done, or when a progress doc looks stale versus git log.
---

# Progress log

`docs/progress.md` is an **index only**: the phase table, a 2–4 sentence summary per phase, the
`Last updated` and `Current work` lines, links. Iteration detail lives in
`docs/phase-<N>-progress.md`. Design docs stay separate (`docs/phase-<N>[-<topic>]-design.md`).

## Phase progress file

- Heading 1, once, first line: `# Phase <N> — <Name>`; then a kickoff line linking the design doc.
- Heading 2 per subphase (iteration, sub-iteration, hotfix, post-phase task):
  `## <N.m> — <Title> (<YYYY-MM-DD>)`.
- Heading 3 for details when a subphase grows (`### Scope`, `### API`, `### Web`, `### Tests`,
  `### Decisions`); never deeper than heading 4.
- Record: commit hashes (CI run ids when known), what shipped, decisions made and why, test counts
  per suite ("api unit 1155 green"), code referenced with relative markdown links.

## When an iteration is finished

1. Append the heading-2 section to `docs/phase-<N>-progress.md` (create the file with its
   heading 1 on the phase's first iteration).
2. Update the phase row in the index table and its summary in `docs/progress.md`, plus
   `Last updated` and `Current work`.
3. If the iteration changed an invariant, a decision or a dependency, update the matching
   `wiki/` page (`roadmap.md` at minimum) — the `learn` skill lists the targets.
4. Prettier on the changed docs. Commit as `docs(phase-<N>): …` only when asked.

## Example

```markdown
## 12.2 — /start + account linking (2026-08-03)

Commit `def5678`. Deep-link token flow reusing the Phase 3 connected-accounts service (no new
auth path — DRY).

### Tests

Bot suite 21 green; api suite unchanged.
```
