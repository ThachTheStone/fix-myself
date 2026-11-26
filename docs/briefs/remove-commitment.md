# Task: Remove commitments; the deadline is the promise (TASK-02, REV-01, SRS 0.9)

## Goal
The "Commitment" panel disappears from the task page. A task's deadline is what counts in the weekly delivery review,
and what "delivered" means is its completion criteria checklist. An old commitment's outcome text becomes a criterion.

## Read first
- `AGENTS.md`, `docs/MULTI_AGENT.md` (section "Quy tắc bắt buộc cho worker").
- `SRS.md` 0.9: glossary (Deadline, Inbox), TASK-02, REV-01.
- `docs/briefs/criteria-checklist.md` and its code: `criteriaItems`, `foldTaskCriteria`, `foldAllCriteria` in
  `app/model.js`. This task extends that fold; do not build a second mechanism.
- Code: `app/model.js` (`blankTask`, `TASK_FIELDS`, `validateChanges` case `commitment`, `timelineEvents` around 518,
  `inboxTasks` around 1060, `deliveryReview` around 2133), `app/main.js` (lines ~580, 736, 812, 822, 836-846, 1594,
  2212-2217, and the review page rendering of `undated`), `index.html` 176-189 and 336, `app/i18n.js`,
  `tests/model.test.js` (115, 133-150, 238-260 and any inbox test), `tests/browser.e2e.js` test at line 59.

## Decisions already made
- **Storage key `commitment` stays** in `blankTask` (value `null`) and in `TASK_FIELDS`, so old files and devices still
  merge. Comment it: "kept for sync with older versions; folded into the criteria checklist (SRS 0.9)".
- **Fold.** Extend `foldTaskCriteria(task, c)`: besides text `criteria`, if `task.commitment` is non-null, take
  `commitment.outcome` (string, may be empty) as one more criteria text, folded with the same `criteriaItems` rules
  (dedupe by normalised title, title-hash ids, 50 cap, `done: status === 'completed'`), and set `commitment: null`.
  It is the same stamped edit: when `commitment` changes, set `stamps.commitment = stampOf(c)` and clear
  `supersedes.commitment`; when `subtasks` changes, stamp it as today. Order: existing items, then text criteria,
  then the outcome. An empty outcome only clears `commitment`. No timeline event. Idempotent. The call sites stay as
  they are (after `readState` in main.js, end of `mergeSync`, end of `resolveConflict`).
- **The early return in `foldTaskCriteria` changes**: return the same object only when text `criteria` is empty AND
  `commitment == null`. Put the outcome handling inside the fold, not after that return.
- **Length and cap.** An outcome may be up to 240 characters; `criteriaItems` splits lines over 160, so a long
  outcome may become two criteria. That is accepted; test it, do not "fix" it. In the fold, items past 50 are dropped
  as today (`.slice(0, 50)`), so at the cap the outcome is lost; in the `saveTask` path, passing 50 throws
  `'Add up to 50 completion criteria.'` as the `criteria` path does. Tests at 49 and 50 existing items.
- **Sync conflict for `commitment`.** In `mergeFields`, for the field `commitment` only, never list a conflict: when
  the conflict condition holds, take the remote value if it is non-null (the end-of-merge fold then turns it into a
  criterion and clears it), else keep local. Test: an older device edits the outcome within one base after this
  device folded → no conflict, the new outcome ends up as a criterion.
- **`validateChanges` case `commitment`** (older callers): an object whose outcome is empty or whitespace is a no-op
  (no error, `commitment: null`); remove the `'Describe the outcome you are committing to.'` error, the `field.outcome`
  key and their translations. `null` → no change to the checklist and `commitment: null`.
  An object → its `outcome` folds into the checklist the same way as a `criteria` text (after `subtasks`, after
  `criteria`), and `commitment` stays `null`. `committedAt` is ignored. Remove the
  `'Choose a valid commitment time.'` error and its translation.
- **Timeline.** `timelineEvents` no longer creates `committed` or `commitment_removed` events. Old events of those
  types still render with their existing labels (keep `event.committed`, `event.commitment_removed` and the
  `case 'commitment_removed'` rendering in main.js).
- **Inbox.** `inboxTasks` replaces `!task.commitment` with `!task.deadline`: a task with a deadline leaves the inbox.
- **Delivery review.** `deliveryReview` counts every non-canceled task with a deadline in the range (no commitment
  filter). Remove `undated` from its result and remove the review page's undated section (`index.html` ~336 and the
  list it belongs to, `review.undatedEmpty` and any other undated keys, and their rendering in main.js). Rename local
  variables away from "committed". The page labels that say "commitments" now say "tasks", e.g.
  "No completed commitments in this period." → "No completed tasks in this period." / "Không có task nào hoàn thành
  trong khoảng này." Check every `review.*` string in both languages for the word commitment / cam kết.
- **UI.** Remove the commitment panel (`index.html` 176-189), its render block, its submit and remove handlers, the
  `meta.committed` badge in the task list meta and in `detail-status`, `commitment-feedback` in the feedback id list,
  and the i18n keys `detail.commitment`, `detail.removeCommitment`, `detail.committedTime`, `meta.committed`, the
  outcome/committed-at labels and placeholders, in both languages. In the sync conflict list, map field `commitment`
  to the "Completion criteria" label (like `subtasks` and `criteria`); keep `formatValue` for `commitment` returning
  the outcome, for old stored conflicts.
- More strings to rewrite for the deadline rule (both languages): `index.html` ~115, 120, 122 and `i18n.js` ~116-119
  (`tasks.inboxHelp` "…planned or committed to" → "…until it has a deadline, a planned day, a work block or a
  priority"; `tasks.planned` "Planned and committed" → "Planned"; `tasks.plannedEmpty` drop "or commit to a task");
  `review.statDue` "Commitments due" → "Tasks due" / "Task đến hạn". "Priority" in the SRS inbox rule is `pinned` in
  code. Finish with `grep -rni "commit" app index.html README.md docs/ARCHITECTURE.md docs/ANDROID.md` and leave only
  sync-compat code, old event labels, and git-related words.
- Docs also: `docs/ANDROID.md` ~36 ("commitment sắp tới hạn" → "task sắp tới hạn"), `docs/ARCHITECTURE.md` line 11.
- Accepted behaviour changes (write them in ARCHITECTURE.md): old committed tasks with no deadline, planned day,
  block or pin return to the inbox; every deadlined task, child tasks included, counts in the on-time rate, and past
  weeks' rates change accordingly.
- `settings.exported` text: drop "commitments" ("Your tasks, settings and workout entries were exported…"), both
  languages.
- Docs: `README.md` line 3 and any commitment mention; `docs/ARCHITECTURE.md` (TASK-01/02 status row, the data table:
  `commitment` kept for sync and folded; REV-01 row); `docs/ACCEPTANCE.md` if it mentions commitments.

## Steps
1. Model: fold extension, `validateChanges`, timeline, inbox, delivery review.
2. UI and i18n.
3. Tests and docs.

## Out of scope
Criteria UI, child tasks, cloud files (`app/cloud*.js`), the extension, Android-specific code, the AI assistant.

## Tests that define "done"
- `tests/model.test.js`:
  - Fold: a task with `commitment: { outcome: 'Proposal sent', committedAt }` and no criteria gets one criterion
    "Proposal sent" and `commitment: null`, stamps set on `subtasks` and `commitment`; a task whose criteria text
    already has "proposal  sent" gets no duplicate; empty outcome only clears; completed task → ticked; fold twice =
    once; two devices folding the same task converge with no conflict and exportSync reaches a fixed point.
  - An older device sends a newer-stamped `commitment` after this device folded: merging folds it again, no duplicate.
  - `saveTask(..., { commitment: { outcome: 'x' } })` appends "x" and keeps `commitment: null`; `{ commitment: null }`
    changes nothing.
  - The timeline test no longer expects `committed`; an old state that already holds a `committed` event keeps it.
  - REV-01: on-time rate over tasks with a deadline in the range, excluding canceled; no `undated` key.
  - Inbox: a captured task with a deadline is not in the inbox; without one (and no planned day, block, priority) it is.
- `tests/browser.e2e.js`: rewrite the test at line 59 so the task leaves the inbox by getting a deadline (no
  commitment form), keeping its block-move and sync-to-another-profile checks. Rename it accordingly.
- Commands: `npm ci`, `npm test`, `npm run build`, `git diff --check`,
  `node --test --test-skip-pattern="Chromium blocks" tests/browser.e2e.js` (all should pass).
- Do not run the Chromium extension test (port 127.0.0.1:42631 may belong to the user's desktop app).

## Commit
- Branch: `agent/remove-commitment`. Base: the commit named in the dispatch message. Commit trailer:
  `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Do not commit `AGENT_BRIEF.md` or `CLINE_TASK*.md`. Do not push.

## Hard rules
Follow `docs/MULTI_AGENT.md` → "Quy tắc bắt buộc cho worker". In particular: never stop processes you did not start,
stay inside this worktree, do not rewrite history, do not change `SRS.md`. Set `FIX_MYSELF_WORKER=1`; never start
Electron.

## Finish with
What changed (files), exact test results, commit hashes, open questions.
