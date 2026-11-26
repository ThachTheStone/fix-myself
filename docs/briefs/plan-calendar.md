# Task: Calendar view for work blocks (PLAN-01, PLAN-02)

## Goal
A new **Calendar** page shows work blocks in a day or week grid, like a calendar app. On Windows and in the browser
preview, the user can drag a block to move it, drag its bottom edge to change its length, and drag over empty time to
create a block for a chosen task. Deadlines and strict blocks are marked. Android shows the same grid but cannot edit it.

## Read first
- `AGENTS.md`, `docs/MULTI_AGENT.md` (section "Quy tắc bắt buộc cho worker").
- `SRS.md`: PLAN-01, PLAN-02, TASK-02, REM-01, WB-01, SYS-07; acceptance test A-16.
- Code:
  - `app/model.js`: `saveTask` (with the strict weakening rules and `pendingBlockChanges`), `isActive`,
    `planningDay`, `localDate`, `addDays`.
  - `extension/block-schedule.js`: `startOfDay`.
  - `app/main.js`: `VIEWS`, `navigate`, `render`, `attempt`, `h`, `cached`, `formatTime`, `formatRange`,
    `formatDay`, `weekRange`, `nativeReminders`, `renderReview` (for the prev / this week / next pattern), and the
    mission dialog (for the `<dialog>` pattern).
  - `index.html`: nav, the Review view header and the mission dialog. `app/styles.css`, `app/i18n.js`,
    `tests/browser.e2e.js`.

## Decisions already made

**New module `app/calendar.js`.** It holds pure functions only, with no DOM. Times are ISO strings in and out.
Positions are minutes from the start of a planning day in `timeZone`, found with `startOfDay(day, timeZone)` from
`extension/block-schedule.js`.
- `export const SNAP_MINUTES = 15;`
- `export function calendarDays(state, startDay, count, now = new Date())`. For each of the `count` days from
  `startDay` it returns `{ day, isToday, blocks, deadlines }`.
  - Blocks come from every task except `canceled` ones.
  - Each block item is `{ taskId, blockId, title, status, strict, pending, start, end, top, height, column, columns,
    continuesBefore, continuesAfter }`.
  - `top` and `height` are minutes, clipped to the day. A block that crosses midnight appears on each day it touches,
    and its `continues*` flags show that.
  - `pending` is true when `pendingBlockChanges` has an entry for that `blockId`.
  - Overlapping blocks within a day split into side-by-side columns. Sort by `top` and then by longer first, and give
    each block the first free column. `columns` is the number of columns in its overlap group (blocks that overlap one
    another directly or through others).
  - Each deadline item is `{ taskId, title, at, top }`, for tasks that are not `canceled` and not `completed` and whose
    deadline falls on that day.
- `export function snap(minutes)`: rounds to the nearest `SNAP_MINUTES`.
- `export function movedBlock(block, deltaMinutes)`: returns `{ ...block, start, end }` shifted by
  `snap(deltaMinutes)`. The length is kept.
- `export function resizedBlock(block, deltaMinutes)`: moves `end` by `snap(deltaMinutes)`, never shorter than
  `SNAP_MINUTES`.
- `export function rangeToBlock(day, fromMinutes, toMinutes, timeZone)`: returns `{ start, end }` ISO. The values are
  snapped, ordered, and at least `SNAP_MINUTES` long.

**Page** (`index.html`, `app/main.js`)
- Add `'calendar'` to `VIEWS` and a nav link "Calendar" between Tasks and Review. `navigate` renders it when shown,
  and `render()` re-renders it only while it is the current view.
- Header: the range label, buttons ← / "Today" / →, and a toggle between "Day" and "Week". Week is the default and
  starts Monday (`weekRange`). The choice lives in a module variable and is not saved.
- Grid: one column per day with its weekday and date. The hour labels 00:00 to 23:00 run down the side, and one hour
  is 48 px. On first open, the grid scrolls to 07:00.
- Today's column shows a "now" line, updated by the existing 1-second interval at most once a minute.
- Each block is a `<button>` positioned with `top`, `height`, `column` and `columns`.
  - It shows the task title and the time range.
  - It carries a "Strict" tag when `strict`, a "Change waiting" tag when `pending`, and muted styling when the task is
    completed.
  - Its accessible name is "{title}, {range}" plus the tags.
  - Clicking it (pointer moved less than 4 px) or pressing Enter opens `#task/<id>`.
- Each deadline is a thin line with the label "Due: {title}" at its time.

**Editing.** Editing is on where `!nativeReminders` (Windows and the browser preview). On Android the grid is
read-only and blocks only open their task.
- **Move.** Pointer-drag a block vertically, and across day columns in week view. Show the snapped new time while
  dragging. On release, call `saveTask(state, taskId, { workBlocks })` through `attempt`, replacing that block with
  `movedBlock(...)`, plus the day shift when it changed column.
- **Resize.** A handle 6 px high on the block's bottom edge, using `resizedBlock`.
- **Create.** Pointer-drag over empty grid time, or click an empty slot for a 1-hour block, then open
  `<dialog id="calendar-dialog">`. It holds:
  - a select of active tasks, with the next action first and the rest by title;
  - a "Strict" checkbox;
  - the range as text;
  - Create and Cancel buttons.

  Create appends `{ start, end, strict }` to that task's `workBlocks` through `saveTask`. With no active tasks, the
  dialog shows "Add a task first." and only Cancel.
- Press Escape during a drag to cancel it.
- All errors from `saveTask` appear in `#calendar-feedback` (`role="status"`) through `translateError`. For example,
  making a past block strict shows `Only upcoming work blocks can be strict.`
- When an edit was queued instead of applied (the task's block stays the same and a new `pendingBlockChanges` entry
  exists for it), show "This strict block changes at {time}." in `#calendar-feedback`.
- Nothing else in the model changes: deadlines stay fixed (TASK-02), and reminders and the timeline are updated by
  `saveTask`.

**Strings.** Add them under the `calendar.` prefix in English and Vietnamese:
- Page: `nav` "Calendar", `title` "Calendar", `day` "Day", `week` "Week", `today` "Today", `prev` "Previous",
  `next` "Next".
- Block tags and deadlines: `strict` "Strict", `pending` "Change waiting", `due` "Due: {title}".
- Create dialog: `newBlock` "New work block", `task` "Task", `create` "Create", `cancel` "Cancel",
  `noTasks` "Add a task first.".
- Feedback: `waiting` "This strict block changes at {time}.", `moved` "Block moved.", `created` "Block added.".
- Help line: `readOnly` "Edit blocks on your computer.", shown on Android.

## Steps
1. `app/calendar.js` with tests in a new `tests/calendar.test.js`:
   - A block in a non-UTC planning time zone lands on the right day and minute.
   - A block crossing midnight is split in two, with the `continues*` flags set.
   - Overlap columns: two overlapping blocks get 2 columns. A chain A–B–C where A and C do not overlap is one group:
     C reuses column 0 and `columns` is 2.
   - Canceled tasks are left out and completed tasks are kept.
   - Deadline placement, and the `pending` flag.
   - `snap`, `movedBlock`, `resizedBlock` (minimum length), and `rangeToBlock` (reversed range, minimum length).
2. Page, grid and read-only rendering.
3. Editing: move, resize, create, feedback.
4. A browser test in `tests/browser.e2e.js`:
   - Create a task with a block tomorrow 10:00–11:00. Open Calendar and step to the week with tomorrow if needed.
   - The block shows. Drag it down by 96 px (2 hours) with the mouse.
   - The task detail shows 12:00–13:00, and the deadline is unchanged.
   - Drag over an empty range to create a block for the task through the dialog, and see it appear.
5. Docs:
   - README: a short "Calendar" section.
   - `docs/ARCHITECTURE.md`: a PLAN-01 and PLAN-02 status row and the new module in the table of parts.

## Out of scope
- Google Calendar busy time (CAL-01). The calendar view's structure must not assume it, but do not build it.
- Editing on Android, keyboard moving and resizing (task detail stays the keyboard path), month view, and dragging
  the top edge.
- Any change to `saveTask`, the strict rules, the floating timer, the extension or `desktop/*`.

## Tests that define "done"
- `tests/calendar.test.js` as in step 1, and the browser test in step 4.
- Commands: `npm test`, `npm run build`, `git diff --check`,
  `node --test --test-skip-pattern="Chromium blocks" tests/browser.e2e.js`.
- Do not run the Chromium extension test. Do not start Electron.

## Commit
- Branch: `agent/plan-calendar`. Base: the commit the worktree starts from (it contains this brief).
  Commit trailer: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Commit your work before you finish; uncommitted work counts as not done. Do not commit `AGENT_BRIEF.md` or
  `CLINE_TASK*.md`. Do not push.

## Hard rules
Follow `docs/MULTI_AGENT.md` → "Quy tắc bắt buộc cho worker". Never stop processes you did not start, stay inside this
worktree, do not rewrite history, do not change `SRS.md`. If a decision above seems wrong, stop and say so in your final
message instead of choosing differently.

## Finish with
What changed (files), exact test results, commit hashes, open questions.
