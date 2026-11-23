# Task: <short title> (<SRS IDs>)

<!-- Copy to docs/briefs/<task>.md. Keep it to about one page: only what is specific to this task.
     Shared rules live in AGENTS.md and docs/MULTI_AGENT.md, so do not repeat them beyond the "Hard rules" pointer. -->

## Goal
<One or two sentences: the user-visible result.>

## Read first
- `AGENTS.md`, `docs/MULTI_AGENT.md` (section "Quy tắc bắt buộc cho worker").
- `SRS.md`: <requirement IDs and acceptance test IDs>.
- Code: <the exact files and functions to read>.

## Decisions already made
<Every design choice the worker must not re-decide: data shapes, function names, where code goes, edge cases and how to
handle them. If something is not decided here, the worker must ask, not guess.>

## Steps
1. <Concrete step: file, function, behaviour.>
2. <...>

## Out of scope
<What not to touch, including nearby improvements the worker might be tempted to make.>

## Tests that define "done"
- New tests: <file and cases, including edge cases>.
- Commands: `npm test`, `npm run build`, `git diff --check`,
  `node --test --test-skip-pattern="Chromium blocks" tests/browser.e2e.js`.
- Do not run the Chromium extension test (port 127.0.0.1:42631 may belong to the user's desktop app).

## Commit
- Branch: <branch>. Base: <commit>. Commit trailer: `Co-Authored-By: <worker> <email>`.
- Do not commit `AGENT_BRIEF.md` or `CLINE_TASK*.md`. Do not push.

## Hard rules
Follow `docs/MULTI_AGENT.md` → "Quy tắc bắt buộc cho worker". In particular: never stop processes you did not start,
stay inside this worktree, do not rewrite history, do not change `SRS.md`.

## Finish with
What changed (files), exact test results, commit hashes, open questions.
