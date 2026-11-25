# Task: Focus sessions linked to a task, pause and end, focus time per task (FOC-09, FOC-10, FOC-11)

## Goal
Starting focus lets the user pick one task or **No task** (wandering). During the session the user can pause and resume
time recording and end the session; ending stops time and app limits but websites stay blocked until the original end
time. Recorded time shows on the task and, per task and wandering, in the weekly review. Time records sync.

## Read first
- `AGENTS.md`, `docs/MULTI_AGENT.md` (section "Quy tắc bắt buộc cho worker").
- `SRS.md`: FOC-02, FOC-04, FOC-09, FOC-10, FOC-11, APP-02, SYS-01; acceptance test A-14 (first four sentences only).
- `docs/ARCHITECTURE.md` → "Thay đổi dữ liệu cho SRS 0.6" (the `focus.*` and `focusSegments` rows).
- Code, `app/model.js`: `STATE_VERSION`, `defaultState`, `migrateState`, `context`, `newId`, `planningDay`,
  `localDate`, `deleteTask`, `isFocused`, `startFocus`, `onLogin`, `focusSnapshot`, `appLimitSnapshot`, `exportSync`,
  `validatePayload`, `mergeSync`, `deliveryReview` (for the day-range pattern).
- Code, `app/main.js`: `syncChrome`, `renderTimer`, `applyState`, `attempt`, `renderDetail`, `renderReview`, the
  `start-focus` click handler in `wireToday`, `boot`, and the interval that calls `renderTimer`.
- `index.html` (focus panel, task detail, Review view), `app/i18n.js`, `tests/model.test.js`, `tests/browser.e2e.js`.

## Decisions already made

**State v3 (`app/model.js`)**
- `STATE_VERSION` 2 → 3. `defaultState()` gains `focusSegments: []` in the synced part (above the "Device-local"
  comment).
- `migrateState` accepts version 2 and 3. For 2 (and the existing 1 path), set `focusSegments: []` and upgrade a
  stored `focus` with `{ sessionId: newId(), taskId: null, startedAt: focus.endAt, blockUntil: focus.endAt,
  segmentStart: null, endedAt: null }` added to its existing fields. The result has `version: 3`. For 3, default
  `focusSegments` to `[]` when it is not an array.

**Focus record** (device-local, `state.focus`):
`{ sessionId, taskId, startedAt, endAt, blockUntil, domains, apps, segmentStart, endedAt }`. Times are Unix ms.
`taskId` is a task id or `null` (wandering). `segmentStart` is the start of the open segment, or `null` while paused or
after the end. `endedAt` is set by **End session**. `endAt` is when recording and app limits stop; `blockUntil` is when
website blocking stops and is never earlier than `endAt`.

**Segment** (synced, `state.focusSegments`): `{ id, sessionId, taskId, start, end, deviceId }`, `start`/`end` ISO
strings, `deviceId` from `ctx.device`. Never stored when `end <= start`. Segments are immutable: no stamps.

**Functions** (all in `app/model.js`; `ctx` as in other functions, `{ now, device }`)
- `isFocused(focus, now)` keeps its name and now means "website blocking active":
  `Boolean(focus && (focus.blockUntil ?? focus.endAt) > now)`.
- New `export function isSessionRunning(focus, now = Date.now())`:
  `Boolean(focus && !focus.endedAt && focus.endAt > now)`.
- `startFocus(state, now, options)`: return `state` unchanged if `isSessionRunning`. `options.taskId` undefined or
  `null` → wandering; otherwise it must be an existing task with `isActive(task)`, else throw
  `'Choose an open task for this session.'`. New focus: `sessionId: newId()`, `startedAt: now`,
  `endAt: now + focusMinutes`, `segmentStart: now`, `endedAt: null`. If the previous focus is still blocking
  (`isFocused`), `domains` is the union of its `domains` and the preference domains, and
  `blockUntil = max(endAt, previous blockUntil)`; otherwise `domains` from preferences and `blockUntil = endAt`.
  Preset handling (`options.presetId`) stays as it is.
- `onLogin` is unchanged: the automatic session is wandering.
- New `pauseFocus(state, ctx)`: if running and `segmentStart` set, append the segment `[segmentStart, now]` and set
  `segmentStart: null`. Otherwise return `state` unchanged.
- New `resumeFocus(state, ctx)`: if running and `segmentStart` is `null`, set `segmentStart: now`. Otherwise unchanged.
- New `endFocus(state, ctx)`: if running, close the open segment at `now` (if any), set `segmentStart: null`,
  `endedAt: now`. `blockUntil` is not changed. Otherwise unchanged.
- New `settleFocus(state, ctx)`: if `state.focus.segmentStart` is set and `now >= endAt`, close the segment at `endAt`
  and set `segmentStart: null`. Return the same `state` object when there is nothing to do.
- `deleteTask`: also drop that task's segments; if `state.focus?.taskId === id`, set `focus.taskId = null` (the rest
  of the session counts as wandering).
- `appLimitSnapshot`: use `isSessionRunning` instead of `isFocused`, so End session lifts app limits.
- `focusSnapshot`: unchanged condition (`isFocused`), but send `endAt: blockUntil`, and `nextAction` = the session
  task's title when a running session has a task, else today's next task as now. Strip the new fields the same way
  `apps` is stripped: the bridge receives only `endAt`, `domains`, `nextAction`.
- New `export function taskFocusMinutes(state, taskId, now = new Date())`: sum of that task's segments plus the open
  segment of a running session for that task (`segmentStart` to `min(now, endAt)`), `Math.round(ms / 60_000)`.
- New `export function focusTimeReview(state, startDay, endDay, now = new Date())`: segments whose start falls on a
  planning day (`localDate(start, settings.timeZone)`) from `startDay` to `endDay`, plus the open segment as above.
  Returns `{ byTask: [{ taskId, title, minutes }], wanderingMinutes, totalMinutes }`. `byTask` skips tasks that no
  longer exist, sorts by minutes descending then title, and leaves out entries that round to 0.

**Sync**
- `exportSync` adds `focusSegments` to `data`. The payload `version` stays 1; the field is optional.
- `validatePayload`: when present, `focusSegments` must be an array of objects with string `id`, `sessionId`,
  `start`, `end`, `deviceId` and `taskId` string or `null`; else throw `'The sync file contains an invalid focus record.'`.
- `mergeSync`: union local and remote segments by `id` (keep the local copy on a duplicate id), then drop any whose
  `taskId` is in the merged `deleted`.

**UI** (`index.html`, `app/main.js`)
- Focus panel, before `#focus-preset`: `<select id="focus-task">` with label "Task for this session". Options:
  "No task (wandering)" (value `''`), then active tasks: the next action first, then pinned, then the rest by title.
  Preselect the next action if it is active, else `''`. Hidden while a session is running.
- While a session runs: `#focus-current` shows "Working on: {title}" or "Wandering session"; `#pause-focus` toggles
  "Pause" / "Resume"; `#end-focus` "End session". No confirmation dialog.
- When the session has ended but `isFocused` is still true: the start controls are shown again and the status reads
  "Session ended. Sites stay blocked until {time}." (time via the existing time formatter).
- `renderTimer` counts down to `endAt` only while `isSessionRunning`. Replace the `previousFocusStatus` boolean with a
  string of `running|blocking|endAt|blockUntil|taskId` and call `syncChrome()` whenever it changes.
- In the interval that calls `renderTimer`, and once in `boot` after `onLogin`, run `settleFocus(state, ctx())` and
  `applyState` it if it returned a different object.
- Task detail: "Focus time: {duration}", followed by " · estimate {duration}" when `effortMinutes` is set. Duration
  format: under 60 minutes use `common.minutesShort`; otherwise "{h} h {m} min".
- Review: a "Focus time" section after the delivery stats: one list item per task "{title} · {duration}", then
  "Wandering · {duration}", empty state "No focus time in this period." when `totalMinutes` is 0.
- All new strings through `t()` in English and Vietnamese under the `focusTask.` prefix. Text is set as text, never HTML.

## Steps
1. Model: v3 migration, focus record, the new and changed functions above. Tests in `tests/model.test.js`.
2. Sync: export, validate, merge. Tests in `tests/model.test.js`.
3. UI: focus panel, task detail, Review. Test in `tests/browser.e2e.js`.
4. Docs: README focus section, two sentences on choosing a task, pause and End session. `docs/ARCHITECTURE.md`:
   move FOC-09 to FOC-11 out of the "Chưa làm" row into a new status row describing what was built.

## Out of scope
- FOC-12 (floating countdown), strict work blocks (WB-*), workspaces (WS-*), the calendar view, Supabase.
- `extension/*` and `desktop/focus-bridge.cjs`: the bridge payload shape does not change.
- Any change to block rules, presets, reminders, or `SRS.md`.

## Tests that define "done"
- `tests/model.test.js`, new cases:
  - v2 state with a running focus migrates to v3 with the defaults above; v3 round-trips.
  - Start with a task, pause after 10 min, resume, settle after `endAt`: two segments, total equals session length
    minus the pause. A session settled long after `endAt` stops at `endAt`.
  - Start with a completed task throws; start with no task gives `taskId: null`.
  - End session: segment closed at end time, `appLimitSnapshot` is `null`, `focusSnapshot` still returns
    `endAt === blockUntil`; starting a new session afterwards keeps the old `blockUntil` when later and unions domains.
  - `pauseFocus`/`resumeFocus`/`endFocus`/`settleFocus` return the same object when there is nothing to do.
  - Deleting the session's task drops its segments and makes the session wandering.
  - `taskFocusMinutes` includes the open segment; `focusTimeReview` groups by planning day in a non-UTC time zone,
    separates wandering, skips deleted tasks and zero entries.
  - Sync: segments from two devices union by id; a duplicate id is kept once; a segment of a deleted task is dropped;
    a payload without `focusSegments` still merges; an invalid segment throws.
- `tests/browser.e2e.js`: create a task, choose it, start focus, see "Working on", pause and see "Resume", end the
  session and see the "Session ended" status; open the task and see the "Focus time" line.
- Commands: `npm test`, `npm run build`, `git diff --check`,
  `node --test --test-skip-pattern="Chromium blocks" tests/browser.e2e.js`.
- Do not run the Chromium extension test (port 127.0.0.1:42631 may belong to the user's desktop app).

## Commit
- Branch: `agent/foc-09-11-task-time`. Base: the commit the worktree starts from (it contains this brief).
  Commit trailer: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` (or the trailer the dispatcher gives).
- Commit your work before you finish; uncommitted work counts as not done. Do not commit `AGENT_BRIEF.md` or
  `CLINE_TASK*.md`. Do not push.

## Hard rules
Follow `docs/MULTI_AGENT.md` → "Quy tắc bắt buộc cho worker". Never stop processes you did not start, stay inside this
worktree, do not rewrite history, do not change `SRS.md`. If a decision above seems wrong, stop and say so in your final
message instead of choosing differently.

## Finish with
What changed (files), exact test results, commit hashes, open questions.
