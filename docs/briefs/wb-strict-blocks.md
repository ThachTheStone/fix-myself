# Task: Strict work blocks (WB-01, WB-02, WB-03, WB-04)

## Goal
A work block can be marked strict. When it starts, Fix Myself holds a focus session on its task: no pause, no End, no
task change. If the task is not done when the block ends, the hold extends in 15-minute steps up to twice the block's
length. The only way out before that is an emergency exit with a 2-minute countdown and a reason. Loosening a strict
block waits for the change delay. The weekly review lists how each strict block ended.

## Read first
- `AGENTS.md`, `docs/MULTI_AGENT.md` (section "Quy tắc bắt buộc cho worker").
- `SRS.md`: WB-01 to WB-04, FOC-04, FOC-09, FOC-10, BLK-06, BLK-09; acceptance test A-15.
- Code, `app/model.js`: `validateChanges` (`workBlocks`, `subtasks`, `criteria`), `saveTask`, `toggleTask`,
  `setTaskStatus`, `deleteTask`, `ROOT_FIELDS`, `setRoot`, `delayValue`, `delayMoment`, `DEFAULT_CHANGE_DELAY`,
  `saveBlockRule` (the pattern for pending weakening changes), `cancelPendingRuleChange`, `isSessionRunning`,
  `startFocus`, `addSegment`, `pauseFocus`, `endFocus`, `settleFocus`, `migrateState` (v3 path), `exportSync`,
  `validatePayload`, `mergeSync` (how `focusSegments` are merged), `focusTimeReview`.
- Code, `app/main.js`: `renderTimer`, `renderDetail` (block list), `wireDetail` (`block-form`), `renderReview`,
  `boot` and its 1-second interval, `nativeReminders`, `attempt`, `editTask`.
- `index.html` (focus panel, block form, Review), `app/i18n.js` (`ERRORS_VI`), `tests/model.test.js`,
  `tests/browser.e2e.js`.

## Decisions already made

**Constants** (`app/model.js`): `STRICT_EXTENSION_MINUTES = 15`, `STRICT_EXIT_SECONDS = 120`,
`STRICT_OUTCOMES = ['on_time', 'extended', 'limit_reached', 'exited', 'canceled']`.

**Data**. State stays `version: 3`; `migrateState` defaults any missing new field.
- Work block: `{ id, start, end, strict }`. `validateChanges` keeps `strict: Boolean(block.strict)`. It is part of
  the existing `workBlocks` task field, so it syncs with it.
- Synced root field `pendingBlockChanges: [{ id, taskId, blockId, block, effectiveAt, createdAt }]`. `block` is the
  new `{ id, start, end, strict }` or `null` for removal. Add to `defaultState`, `ROOT_FIELDS`, `exportSync`,
  the `rootLocal` object in `mergeSync`. Written only through `setRoot`.
- Synced `strictLog: [{ id, blockId, taskId, outcome, reason, at }]`, `at` ISO, `reason` `''` unless exited.
  Add to `defaultState` (synced part), `exportSync`, and `mergeSync` exactly like `focusSegments`: union by id, local copy
  wins on a duplicate id, drop entries whose `taskId` is in the merged `deleted`. `deleteTask` drops its entries.
- `validatePayload`, when the fields are present: `pendingBlockChanges` entries need string `id`, `taskId`,
  `blockId`, `effectiveAt` and `createdAt` that parse as dates, and `block` that is `null` or has parseable `start`
  before `end`. `strictLog` entries need string `id`, `blockId`, `taskId`, `outcome` in `STRICT_OUTCOMES`, string
  `reason` of at most 200 characters, and `at` that parses. Otherwise throw
  `'The sync file contains an invalid strict block record.'`.
- Device-local `focus.strict`: `{ blockId, taskId, blockStart, blockEnd, holdUntil, limit, exitRequestedAt }`. All
  are Unix ms except the ids; `exitRequestedAt` is `null` until requested. `limit = blockEnd + (blockEnd - blockStart)`.
  It is `undefined` or `null` when no hold is active.

**WB-01: strictness and weakening** (inside `saveTask`, after `after` is built)
- An "open strict block" is one with `strict` and `end > now`.
- If `after` has any open strict block and has no subtasks and empty `criteria`, throw
  `'Add subtasks or completion criteria before making a block strict.'` This also stops removing the last subtask or
  the criteria from such a task.
- For each open strict block `b` in `before.workBlocks`, with `a` the block with the same id in `after.workBlocks`:
  the edit weakens `b` when `a` is missing, `a.strict` is false, `a.end - a.start < b.end - b.start`, or
  `a.start > b.start`.
- When a block is weakened and the change delay (`settings.changeDelay`, read as in `saveBlockRule`) is not 0: put `b`
  back into `after.workBlocks` in place of `a` (sorted by start), and add `{ id: newId(), taskId, blockId: b.id,
  block: a ?? null, effectiveAt: delayMoment(...), createdAt }` to `pendingBlockChanges`, replacing any earlier
  pending entry for the same `blockId`. Every non-weakening part of the same edit applies at once. With delay 0, the
  edit applies at once.
- `saveTask` skips the weakening check when `ctx.applyingPending === true`, which is used only by
  `applyPendingBlockChanges`.
- New `applyPendingBlockChanges(state, ctx)`: for each entry with `effectiveAt <= now`, replace the block with `block`
  or remove it, through `saveTask` with `applyingPending`. Drop entries whose task or block no longer exists. Remove
  the applied entries. Return the same object when nothing is due.
- New `cancelPendingBlockChange(state, id, ctx)`, like `cancelPendingRuleChange`.
- `deleteTask` and any status change to `canceled` throw
  `'Remove strict from this task’s work blocks first.'` when the task has an open strict block, or is the task of
  an active hold (`state.focus?.strict?.taskId`).
- Setting status `completed` during an active hold for that task throws
  `'Tick every subtask before completing this task.'` when any subtask is not done.

**WB-02 and WB-03: the hold**. New `tickStrict(state, ctx)` returns the same object when nothing changes.
1. With an active hold (`focus.strict` set):
   - If its task is `completed`: log `on_time` when `completedAt <= blockEnd`, else `extended`, then clear the hold.
   - If its task is missing or `canceled`: log `canceled`, then clear the hold.
   - Otherwise, while `now >= holdUntil`: if `holdUntil >= limit`, log `limit_reached`, clear the hold, and stop.
     Else `holdUntil = min(holdUntil + 15 min, limit)`.
   - Whenever the hold continues: `endAt = max(endAt, holdUntil)` and `blockUntil = max(blockUntil, endAt)`.
2. With no hold: find the strict block with the earliest start among active tasks where `start <= now < end` and no
   `strictLog` entry has its `blockId`. If one is found:
   - With no running session, call `startFocus(state, now, { taskId, device, presetId })`, where `presetId` is
     `preferences.autoAppPreset` when that preset exists, else leave it out.
   - With a running session on another task or with no task, close its open segment at `now` (as `pauseFocus` does),
     set `focus.taskId` to the block's task, and set `segmentStart: now`. With a running session on the same task,
     only set `segmentStart: now` if it was paused.
   - Then set `focus.strict` with `holdUntil = blockEnd`, `exitRequestedAt: null`, and apply the `endAt`/`blockUntil`
     rule above.
- "Clear the hold" sets `focus.strict = null` and leaves the session running; the rest of it follows FOC-04 and
  FOC-10.
- A log entry is `{ id: newId(), blockId, taskId, outcome, reason: '', at: now ISO }`.
- `pauseFocus` and `endFocus` throw `'A strict block is holding this session.'` while `focus.strict` is set.
  `startFocus` already does nothing while a session runs.

**WB-04: emergency exit**
- `requestStrictExit(state, ctx)` sets `exitRequestedAt: now` if a hold is active and it is not set yet.
- `cancelStrictExit(state, ctx)` sets it back to `null`.
- `exitStrictHold(state, reason, ctx)`: throw `'Wait for the countdown to finish.'` unless `exitRequestedAt` is set and
  at least `STRICT_EXIT_SECONDS` have passed. Trim the reason; throw `'Enter a reason to exit.'` if it is empty or over
  200 characters. Log `exited` with the reason and clear the hold. Website blocking is untouched.
- New `strictReview(state, startDay, endDay)`: log entries whose `at` falls on a planning day in the range. Returns
  `{ counts: { on_time, extended, limit_reached, exited, canceled }, exits: [{ at, title, reason }] }`, with exits
  newest first and `title` taken from the task.

**UI** (`index.html`, `app/main.js`)
- `block-form` gains a checkbox `strict`, labelled "Strict: hold me on this task until it is done".
- Each block row shows a "Strict" tag when strict, and a checkbox that toggles `strict` through `editTask`.
- Under the block list, show this task's `pendingBlockChanges`: "Waiting until {time}: remove {range}" or
  "Waiting until {time}: change to {range}", followed by "(not strict)" when the new block is not strict, and a
  Cancel button.
- The 1-second interval and `boot` run, in this order: `applyPendingBlockChanges`, then `tickStrict` when
  `!nativeReminders` (not on Android), then `settleFocus`. Each result is applied with `applyState` only if it
  changed.
- Focus panel during a hold:
  - Hide `#focus-task`, `#pause-focus` and `#end-focus`.
  - Status reads "Strict block: {title}. Holding until {holdUntil}." After `blockEnd`, it reads "Extended until
    {holdUntil}, at most until {limit}."
  - Show `#strict-exit` "Emergency exit". After it is pressed, show a countdown "You can exit in {m:ss}" that is
    computed from `exitRequestedAt`, a reason input (maxlength 200), `#strict-exit-confirm` "Exit strict block"
    (disabled until the countdown ends), and "Stay".
- Errors from the model show in the existing feedback places. Add each new error to `ERRORS_VI`.
- Review: a "Strict blocks" section after "Focus time":
  - The line "{on_time} on time · {extended} after extension · {limit_reached} reached the limit · {exited} exited ·
    {canceled} canceled".
  - Then each exit as "{date} · {title}: {reason}".
  - When all counts are 0, show the empty state "No strict blocks in this period."
- All new strings go through `t()` in English and Vietnamese under the `strict.` prefix. Text is set as text, never as
  HTML.

## Steps
1. Model WB-01, including the weakening rules, pending changes and the guards. Tests.
2. Model WB-02 to WB-04: `tickStrict`, exit and `strictReview`. Tests.
3. Sync fields. Tests.
4. UI and one browser test.
5. Docs:
   - README: one short paragraph on strict blocks.
   - `docs/ARCHITECTURE.md`: move WB-01 to WB-04 into a status row. In "Thay đổi dữ liệu cho SRS 0.6", replace
     `focus.strictBlockId` with `focus.strict` and the outcome list with `STRICT_OUTCOMES`, and add
     `pendingBlockChanges`.

## Out of scope
- Opening the task workspace at the hold start (WS-02 is not built), the calendar marker (PLAN-01), the floating
  countdown (FOC-12).
- `extension/*`, `desktop/*`, block rules, presets, reminders, `SRS.md`.
- Strict blocks missed entirely while the app was closed: they get no log entry.

## Tests that define "done"
- `tests/model.test.js`, new cases:
  - Marking a block strict on a task with no subtasks and no criteria throws. Removing the last subtask of such a task
    throws.
  - With delay 10, each of these waits: unmarking strict, shortening, moving later, and removing the block. The block
    stays as it was, and a pending entry has the right `effectiveAt`. Moving earlier with the same length, and making
    the block longer, apply at once. With delay 0 the edit applies at once. A mixed edit (a title change plus
    unmarking strict) applies the title at once and queues the strict change.
  - `applyPendingBlockChanges` applies due entries, ignores later ones, and drops entries for deleted tasks.
    `cancelPendingBlockChange` removes an entry.
  - Deleting or canceling a task with an open strict block throws.
  - `tickStrict` at the block start with no session starts a task session with the hold. With a running wandering
    session, the old segment closes and the session moves to the task. Calling it again changes nothing.
  - `pauseFocus` and `endFocus` throw during a hold.
  - Completing the task with an open subtask throws during a hold. Ticking all subtasks and completing logs `on_time`.
  - Past the block end with the task open, the hold extends by 15 minutes and `endAt` follows. Completing then logs
    `extended`. Running far past `limit` logs `limit_reached` once, and the session keeps its other state.
  - Exit: `exitStrictHold` before the countdown throws, and with an empty reason throws. After 120 s it logs `exited`
    with the reason, the hold is cleared, and `blockUntil` is unchanged. A block already in `strictLog` does not start
    again.
  - A task canceled on another device (applied through `mergeSync`) logs `canceled` on the next tick.
  - Sync: `strictLog` unions by id and drops entries of deleted tasks. `pendingBlockChanges` merges as a root field.
    An invalid entry of either throws. A payload without the new fields merges.
  - `strictReview` counts by planning day and lists exits newest first.
- `tests/browser.e2e.js`:
  - Create a task with one subtask and add a strict block from 1 minute ago to 30 minutes ahead. Reload.
  - Today shows "Strict block", and Pause and End are hidden.
  - Completing the task shows the subtask error.
  - Emergency exit shows the countdown with the Exit button disabled.
- Commands: `npm test`, `npm run build`, `git diff --check`,
  `node --test --test-skip-pattern="Chromium blocks" tests/browser.e2e.js`.
- Do not run the Chromium extension test (port 127.0.0.1:42631 may belong to the user's desktop app).

## Commit
- Branch: `agent/wb-strict-blocks`. Base: the commit the worktree starts from (it contains this brief).
  Commit trailer: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Commit your work before you finish; uncommitted work counts as not done. Do not commit `AGENT_BRIEF.md` or
  `CLINE_TASK*.md`. Do not push.

## Hard rules
Follow `docs/MULTI_AGENT.md` → "Quy tắc bắt buộc cho worker". Never stop processes you did not start, stay inside this
worktree, do not rewrite history, do not change `SRS.md`. If a decision above seems wrong, stop and say so in your final
message instead of choosing differently.

## Finish with
What changed (files), exact test results, commit hashes, open questions.
