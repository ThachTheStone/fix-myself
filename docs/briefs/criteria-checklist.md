# Task: Completion criteria become a checklist (TASK-01, WB-01, REV-02, SRS 0.8)

## Goal
A task has one optional checklist named "Completion criteria" / "Tiêu chí hoàn thành". The separate "Subtasks" /
"Việc con" checklist and the free-text "Completion criteria" textarea disappear. Child tasks ("Công việc con",
TASK-03) are unchanged.

## Read first
- `AGENTS.md`, `docs/MULTI_AGENT.md` (section "Quy tắc bắt buộc cho worker").
- `SRS.md` 0.8: TASK-01, WB-01, REV-02, A-15.
- Code: `app/model.js` (`blankTask`, `migrateState`, `validateChanges` cases `criteria` and `subtasks`,
  `strictEligible`, `checkAncestorsNeedIt`, `saveTask` strict checks, `mergeSync`), `app/main.js` (task meta around
  line 557, detail render around 748 and 834, review panel around 901, form submit around 2177 and 2196),
  `index.html` lines 160-161 and 206-214, `app/i18n.js`, `tests/model.test.js`, `tests/browser.e2e.js` lines 78 and 623.

## Decisions already made
- **Storage key stays `task.subtasks`** (`[{ id, title, done }]`, max 50, title max 160). It is a synced field, and
  renaming it would break sync with older files and devices. Add a comment at `blankTask` and in `TASK_FIELDS`:
  "`subtasks` holds the completion criteria checklist (SRS 0.8); the old text `criteria` is folded into it."
  Do not rename the key anywhere in data, sync or tests' stored shapes.
- **Optional:** an empty array means "no criteria". No null in storage; the UI just shows the empty list.
- **Old text `criteria`** is folded into the checklist by a new exported pure function `foldCriteria(task)`:
  - If `task.criteria` is a non-empty string after trim: split on line breaks, trim each line, strip a leading
    bullet (`-`, `*`, `•`, `+`, or `1.`/`1)` style numbers) and drop empty lines. A line over 160 characters is cut at
    the last space at or before 160 (or at 160 if there is none) and the rest continues as the next item.
  - Item ids are deterministic: `crit-` + task.id + `-` + index (0-based over the produced items), so two devices
    folding the same text produce the same ids. Skip an item whose id already exists in `task.subtasks`.
  - Items are appended after existing `subtasks`, `done: task.status === 'completed'`. If the total would pass 50,
    the extra items are dropped (accepted loss; real data is a few lines).
  - Return `{ ...task, subtasks: [...], criteria: '' }`. Do not touch `stamps` or `supersedes`. If `criteria` is
    empty, return the task unchanged (same object). The function must be idempotent.
- Apply `foldCriteria` to every task (a) in `migrateState` on both branches (v1 path and v2/v3 path), and (b) to every
  task in the state returned by `mergeSync` (an older device or file can still send text `criteria`). No
  `STATE_VERSION` or `SYNC_SCHEMA` bump. Keep `'criteria'` in `TASK_FIELDS` so old values still merge.
- `validateChanges` case `criteria` (used by older callers and the AI action API): fold the given text into the
  checklist of the task being edited with the same rules (ids from `foldCriteria` on the merged result) and store
  `criteria: ''`. The result must pass the 50-item limit; if not, throw `'Add up to 50 completion criteria.'`.
- `strictEligible` = `task.subtasks.length > 0 || hasActiveDescendant(...)`. Remove the `criteria` text from it
  and from `checkAncestorsNeedIt` (text is always empty after folding).
- Completing a task outside a strict hold stays allowed with unticked criteria (unchanged behaviour). During a hold
  the existing rules stay: all must be ticked, and unticked ones cannot be removed.
- **Error and label text** (replace the old strings; keep i18n lookups by English string as today):
  - `'Add up to 50 subtasks.'` → `'Add up to 50 completion criteria.'` / "Chỉ thêm tối đa 50 tiêu chí hoàn thành."
  - `'Enter a subtask title.'` → `'Enter a criterion.'` / "Nhập nội dung tiêu chí."
  - cleanText label `'A subtask'` → `'A criterion'`, with its `field.*` mapping "Tiêu chí".
  - `'Tick every subtask before completing this task.'` → `'Tick every completion criterion before completing this task.'`
    / "Hãy tích đủ mọi tiêu chí hoàn thành trước khi hoàn thành việc này."
  - `'Open subtasks cannot be removed during a strict block.'` → `'Unticked criteria cannot be removed during a strict block.'`
    / "Không thể gỡ tiêu chí chưa tích trong khối nghiêm ngặt."
  - `'Add subtasks or completion criteria before making a block strict.'` → `'Add completion criteria or a child task before making a block strict.'`
    / "Thêm tiêu chí hoàn thành hoặc công việc con trước khi đặt khối nghiêm ngặt."
  - `'A strict block on its parent task needs it. Add subtasks or criteria to the parent first.'` →
    `'A strict block on its parent task needs it. Add completion criteria to the parent first.'` /
    "Khối nghiêm ngặt của công việc cha cần công việc này. Hãy thêm tiêu chí hoàn thành cho công việc cha trước."
- **UI** (`index.html`, `app/main.js`, `app/i18n.js`):
  - Delete the criteria textarea (lines 160-161) and its form field handling (`fields.criteria` in render and submit).
  - The checklist section becomes the criteria section: ids `criteria-label`, `criteria-list`, `criteria-form`,
    `criteria-title`, `criteria-feedback`; focus key prefix `criterion:`. Heading key `detail.criteria`
    "Completion criteria" / "Tiêu chí hoàn thành". Add a muted help line under the heading, key `detail.criteriaHelp`:
    "Tick each one when it is true. The task counts as done when all are ticked." / "Tích từng tiêu chí khi đã đạt.
    Việc được coi là xong khi đã tích đủ." Input placeholder `detail.criterionPlaceholder` "Add a criterion, e.g. Report
    sent to the client" / "Thêm tiêu chí, ví dụ: Đã gửi báo cáo cho khách"; hidden label `detail.newCriterion` "New
    criterion" / "Tiêu chí mới"; remove button aria `detail.removeCriterion` "Remove criterion {title}" / "Gỡ tiêu chí
    {title}". Move this section to where the textarea was is NOT required; keep its current position.
  - Task meta `meta.criteria`: "{done}/{total} criteria" / "{done}/{total} tiêu chí" (replaces `meta.subtasks`).
  - Review panel: when the checklist is not empty, show `detail.reviewCriteria` as
    "Completion criteria: {done}/{total} ticked" / "Tiêu chí hoàn thành: đã tích {done}/{total}" followed by a list of
    the items, each prefixed "✓ " or "☐ ". Empty checklist keeps `detail.reviewNoCriteria`. Cache key uses
    `task.subtasks`, not `task.criteria`.
  - Remove the unused keys `detail.subtasks`, `detail.newSubtask`, `detail.subtaskPlaceholder`,
    `detail.removeSubtask`, `meta.subtasks`, `detail.criteriaPlaceholder` in both languages.
- Docs: `README.md` (lines 50 and 54 mention subtasks or criteria), `docs/ARCHITECTURE.md` lines 11, 38, 134 and the
  known-limit line 143 (the gap "set text criteria then delete open subtasks before the block" is gone: deleting the
  last criterion before the block now fails the WB-01 check; deleting some is still allowed before the block starts,
  say so), and the data table: note that `subtasks` stores the criteria checklist and text `criteria` is folded.

## Steps
1. `foldCriteria` + wiring in `migrateState`, `mergeSync`, `validateChanges`; strict eligibility changes.
2. UI and i18n changes.
3. Update tests: every existing test that used text `criteria` to make a task strict-eligible switches to a checklist
   item or keeps text and asserts it was folded. Update e2e lines 78 and 623 to add a criterion through the new form.
4. Docs.

## Out of scope
Child tasks, the AI assistant flow, Android-specific code, the extension, cloud sync files (`app/cloud*.js`), any
confirmation dialog when completing with unticked criteria.

## Tests that define "done"
- New unit tests in `tests/model.test.js`:
  - `foldCriteria`: multi-line text with bullets and blank lines; a 400-character line splits at spaces; idempotent
    (fold twice = fold once); deterministic ids equal across two calls on copies; completed task gives `done: true`;
    existing items kept first; overflow past 50 dropped; empty criteria returns the same object.
  - `migrateState` of a v3 state with text criteria gives a checklist and `criteria: ''`.
  - `mergeSync` where the remote task (older device) has newer-stamped text criteria: result has the folded items and
    no duplicates when merged again.
  - `saveTask(..., { criteria: 'a\nb' })` appends two items.
  - A task whose only criteria came from folded text is strict-eligible (it has items); a task with an empty
    checklist and no active child is not.
- Commands: `npm test`, `npm run build`, `git diff --check`,
  `node --test --test-skip-pattern="Chromium blocks" tests/browser.e2e.js`.
- Do not run the Chromium extension test (port 127.0.0.1:42631 may belong to the user's desktop app).

## Commit
- Branch: `agent/criteria-checklist`. Base: the commit named in the dispatch message. Commit trailer:
  `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Do not commit `AGENT_BRIEF.md` or `CLINE_TASK*.md`. Do not push.

## Hard rules
Follow `docs/MULTI_AGENT.md` → "Quy tắc bắt buộc cho worker". In particular: never stop processes you did not start,
stay inside this worktree, do not rewrite history, do not change `SRS.md`. Set `FIX_MYSELF_WORKER=1`; never start
Electron.

## Finish with
What changed (files), exact test results, commit hashes, open questions.
