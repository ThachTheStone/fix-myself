# Task: Task tree, child tasks under a parent (TASK-03 to TASK-06)

## Goal
A task can have child tasks, which can have their own children, up to 5 levels. Each child is a full task. A parent
completes only when its children are done. The Tasks view shows the tree. A task's page shows its ancestors, its
children and their progress, and focus time rolled up over the subtree. Sync keeps the tree valid.

## Read first
- `AGENTS.md`, `docs/MULTI_AGENT.md` (section "Quy tắc bắt buộc cho worker").
- `SRS.md`: TASK-01 to TASK-06, WB-01 to WB-04, FOC-11, SYS-02; acceptance test A-17.
- Code, `app/model.js`:
  - Task records and saving: `TASK_FIELDS`, `blankTask`, `validateChanges`, `saveTask` (including the strict guards),
    `toggleTask`, `setTaskStatus`, `deleteTask`.
  - Today and selection: `nextTask`, `inboxTasks`, `todayView`.
  - Sync: `mergeSync`, `mergeFields`, `stampOf`.
  - Time and holds: `taskFocusMinutes`, `focusTimeReview`, `tickStrict`, `focus.strict`.
- Code, `app/main.js`: `renderTaskLists`, `renderTasks`, `taskMeta`, `renderDetail`, `wireDetail`, `editTask`.
- `index.html` (Tasks view, task detail), `app/i18n.js`, `tests/model.test.js`, `tests/browser.e2e.js`.

## Decisions already made

**Data**
- Add the task field `parentId`: a task id or `null`.
  - Add `'parentId'` to `TASK_FIELDS` and `parentId: null` to `blankTask`.
  - Older tasks have no `parentId`, so read it as `task.parentId ?? null` everywhere.
  - No state version change.
- Children are found by scanning `state.tasks`. Add `childrenOf(state, id)`, `ancestorsOf(state, id)` (nearest
  first) and `subtreeIds(state, id)` (excluding `id`). Guard every walk with a visited set so damaged data cannot
  loop.
- Constants: `MAX_TREE_DEPTH = 5` (a top-level task is depth 1) and `MAX_CHILDREN = 50`.

**Moving and adding** (`validateChanges` case `parentId`, with the checks in `saveTask`)
- `null` means top level. Otherwise the id must be an existing task, or throw `'This parent task no longer exists.'`
- Each of these throws `'A task cannot move under itself or its own child tasks.'`:
  - The task itself as its parent.
  - Any task in its own subtree as its parent.
- Depth: `depth(newParent) + 1 + height(task's subtree) - 1` must be at most `MAX_TREE_DEPTH`, else throw
  `'Task trees can be at most 5 levels deep.'` `height` counts levels, so a leaf is 1.
- If the new parent already has `MAX_CHILDREN` other children, throw `'A task can have at most 50 child tasks.'`
- If the task is active and the new parent or any of its ancestors is closed (completed or canceled), throw
  `'Reopen the parent task first.'`
- New export `addChildTask(state, parentId, fields, ctx)`, which calls `captureTask` with `parentId` set. The same
  checks apply.

**Status rules**
- Completing or canceling a task that has any active child throws `'Complete or cancel its child tasks first.'`
- When a task becomes active again (status `open` or `in_progress`), reopen each closed ancestor, nearest first. Use
  `saveTask` with `status: 'open'`, so their timelines record `reopened`.
  - Use the same `ctx`.
  - The existing guard rules still apply to those saves.
- `deleteTask` throws `'Delete or move its child tasks first.'` when the task has children.

**Strict holds** (WB-02 to WB-04): let the held task be `H`.
- While a hold is active, each of these throws `'Open child tasks cannot be removed during a strict block.'`:
  - Deleting or canceling an active task in `subtreeIds(H)`.
  - Moving an active task out of `H`'s subtree.
- Completing `H` already needs its whole subtree done, through the status rule above. No other change to
  `tickStrict`.

**Sync repair** (`mergeSync`, after tasks are merged and before `reconcileReminders`)
- Orphans: a task whose `parentId` does not match an existing task gets `parentId: null`.
- Cycles: for each cycle, set `parentId: null` on the task in the cycle with the newest `stamps.parentId`. Break a tie
  by the lower id.
- Each repair stamps `parentId` with the merge's `ctx`, so the repair syncs onward. It changes no other field and adds
  no timeline event.
- `summary` gains `repaired` (a count).
- Depth over the limit after a merge is left as is; local edits keep enforcing the limit.

**Selection and rollups**
- `inboxTasks` leaves out tasks whose `parentId` is not `null`.
- `nextTask`: an explicitly chosen next action is kept. The automatic fallback skips tasks that have an active child.
- New `childProgress(state, id)` returns `{ done, total }`. It counts direct children only, and `done` means
  completed or canceled.
- New `subtreeFocusMinutes(state, id, now)`: `taskFocusMinutes` of the task plus all of its subtree.
- New `deadlineAfterParent(state, task)`: true when both have deadlines and the child's is later.
- `focusTimeReview` keeps listing each task's own time. Do not roll it up there.

**UI**
- **Tasks view.** The inbox and planned lists show only tasks without a parent. Each task with children gets:
  - a collapse toggle (a `<button>` with `aria-expanded`);
  - its children nested beneath it in a `<ul>` with indentation, recursively.

  Collapsed state lives in a module `Set` and is not saved. The closed list stays flat.
- **Task rows** (`taskMeta`): when the task has children, add "{done}/{total} child tasks".
- **Task detail:**
  - A breadcrumb of ancestors as links, from the top level down.
  - A "Child tasks" section listing each child as a link with its status, and the progress line
    "{done} of {total} child tasks done".
  - An "Add child task" input and button, which call `addChildTask`.
  - A "Parent task" select holding "Top level" plus every task the move checks would allow. That means not the task
    itself, not its subtree, and nothing that would break the depth limit or sit under a closed ancestor. It saves
    through `editTask({ parentId })`.
  - The focus time line becomes "Focus time: {own}". When the task has children, add " · with child tasks: {total}".
  - When `deadlineAfterParent` is true, show "Due after its parent task."
- New strings go under the `tree.` prefix in English and Vietnamese. New model errors go in `ERRORS_VI`.

## Changes after critique (these replace the decisions above where they differ)
- **C1, whole subtree.**
  - Completing or canceling throws `'Complete or cancel its child tasks first.'` when any task in `subtreeIds(id)` is
    active, not only a direct child.
  - During a hold on `H`, moving a task out of `H`'s subtree throws when that task or anything in its subtree is
    active. This also covers a closed child that has an open grandchild.
- **C2, repair at read time, never written.** Replace the "Sync repair" section.
  - Add `effectiveParents(state)`. It returns a `Map` from task id to effective parent id, computed once per state; it
    may be memoised on the state object identity.
  - A task whose stored parent is in `state.deleted`, or is not among the tasks, is top level.
  - A cycle is broken at the task with the newest `stamps.parentId`, the lower id winning a tie. That task is top level.
  - Every tree walk, view, rollup, move check and hold check uses this map, never `task.parentId` directly.
  - `mergeSync` writes nothing for the tree and creates no conflict for it.
  - `summary.repaired` is the number of tasks whose effective parent differs from the stored one.
  - `resolveConflict` needs no special case: the map covers whatever it produces.
- **C3, sync validation.** In `validatePayload`, a task's `parentId` must be `undefined`, `null`, or a string of 1 to 64
  characters. Otherwise throw `'The sync file contains an invalid task.'`
- **C4, when each check runs.**
  - The "closed ancestor" check (`'Reopen the parent task first.'`) runs only when `parentId` changes or a task is
    created.
  - The active-descendants check runs only when status changes to completed or canceled. Editing other fields of a
    closed parent that sync left with open children still works.
  - Auto-reopen of ancestors runs after the main save, on the resulting state, from the top ancestor down. It is skipped
    inside `applyPendingBlockChanges`.
  - `mergeSync` never reopens ancestors.
- **C5, next action descends.**
  - When the automatic `nextTask` candidate has active descendants, use its first active leaf instead (depth first, in
    `state.tasks` order).
  - An explicit `nextActionId` that has active descendants is kept as the user chose it.
- **C6, where children appear.**
  - Children nest under their effective parent in whichever list the parent appears.
  - When the effective parent is `null`, or is closed while the child is active, the child shows at the top level of
    its own list.
  - Children keep their order in `state.tasks`.
- **C7, strict eligibility.** WB-01 now accepts active child tasks. A task may have an open strict block when it has
  subtasks, criteria, or at least one active task in its subtree. Update the check in `saveTask` and its error stays
  the same.
- **C8, display.** The task detail focus line keeps the effort estimate (FOC-11). The format is "Focus time: {own} ·
  estimate {effort} · with child tasks: {total}", and each part shows only when it applies.
- **Extra tests**:
  - a 3-node cycle;
  - two devices merging the same cycle in opposite orders reach the same effective tree, with no `conflicts`;
  - a tombstoned parent compared with a parent that is merely missing;
  - `resolveConflict` choosing a value that makes a cycle;
  - a payload with a number or object as `parentId`;
  - editing the title of a closed parent that has an open child after sync;
  - completing `H` during a hold while a grandchild is open under a closed child, which throws;
  - next action descending to a leaf of a pinned parent;
  - strict eligibility through an active child.

## Steps
1. Model: field, selectors, move checks, status rules, delete rule, strict hold rule. Tests.
2. Sync repair. Tests.
3. Selection and rollups. Tests.
4. UI: Tasks tree, rows, detail. Browser test.
5. Docs:
   - README: a short "Child tasks" section.
   - `docs/ARCHITECTURE.md`: a TASK-03 to TASK-06 status row, and a data-table row for `parentId`.

## Out of scope
- AI breakdown, drag-and-drop in the tree, and showing the tree in the calendar.
- Any change to work blocks, the strict hold mechanics, the extension or `desktop/*`.
- Converting checklist subtasks into child tasks.

## Tests that define "done"
- `tests/model.test.js`:
  - Add children 3 levels deep.
  - Moving refuses: under itself, under a descendant, past 5 levels (a 2-level subtree moved under a depth-4 task),
    the 51st child, and an open task under a completed parent.
  - Completing or canceling a parent with an open child throws. It completes once the children are done.
  - Reopening a grandchild reopens the completed parent and grandparent, with `reopened` events.
  - Deleting a parent with children throws.
  - During a hold on a parent, deleting, canceling or moving out an open child throws. Ticking and completing the child
    works.
  - Sync: an orphan after a merge becomes top level. A two-device move cycle is broken at the task moved last.
    `summary.repaired` is counted. A repaired `parentId` carries the merge stamp.
  - Selection and rollups:
    - The inbox leaves out children.
    - The automatic `nextTask` skips a parent with an open child but keeps an explicit choice.
    - `childProgress`, `subtreeFocusMinutes` (with an open segment on a child) and `deadlineAfterParent`.
- `tests/browser.e2e.js`:
  - Create "Payment module" and add the child "Query database", then add "Read variables" under it.
  - The Tasks view shows the three indented.
  - The child's page shows the breadcrumb.
  - Completing the module shows the error.
  - The module shows "0 of 1 child tasks done".
- Commands: `npm test`, `npm run build`, `git diff --check`,
  `node --test --test-skip-pattern="Chromium blocks" tests/browser.e2e.js`.
- Do not run the Chromium extension test. Do not start Electron.

## Commit
- Branch: `agent/task-tree`. Base: the commit the worktree starts from.
  Commit trailer: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Commit before you finish. Do not push.

## Hard rules
Follow `docs/MULTI_AGENT.md` → "Quy tắc bắt buộc cho worker". Never stop processes you did not start, stay inside this
worktree, do not rewrite history, do not change `SRS.md`. If a decision above seems wrong or two decisions conflict,
stop and say so.

## Finish with
What changed (files), exact test results, commit hashes (`git log --oneline -3`), open questions.
