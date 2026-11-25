# Task: Floating countdown on Windows (FOC-12)

## Goal
During a focus session on Windows, the user can show a small window that stays on top of other windows. It shows the
time left and the session's task name, or **Wandering**. The window can be moved, remembers its position, can let
clicks pass through, opens from Today or the notification area icon, and closes when the session ends.

## Read first
- `AGENTS.md`, `docs/MULTI_AGENT.md` (section "Quy tắc bắt buộc cho worker").
- `SRS.md`: FOC-12, FOC-09, FOC-10, WB-02, APP-04; acceptance test A-14 (last sentence).
- Code:
  - `desktop/main.cjs` (`createWindow`, `createTray`, `registerHandlers`, `fromApp`, `toRenderer`, `appPids`) and
    `desktop/preload.cjs`.
  - `app/model.js` (`isSessionRunning`, `focus.strict`, `defaultState().preferences`, `migrateState`).
  - `app/main.js` (`renderTimer` and its signature string, `syncChrome`, `boot`, the `windows-settings` block).
  - `index.html` (focus panel), `app/i18n.js`, `package.json` (`build.files`), `tests/model.test.js`.

## Decisions already made

**Where it runs.** Windows desktop only (`process.platform === 'win32'` in main, `desktop?.platform === 'win32'` in the
renderer). The browser preview and Android never show the control.

**Model (`app/model.js`)**
- Device-local preference `preferences.miniTimer: { enabled: false, clickThrough: false }`. Add it to
  `defaultState().preferences`. The existing preference merge in `migrateState` fills it for saved v3 states; check
  that it does.
- New `setMiniTimer(state, changes)`: shallow-merges `enabled` and `clickThrough` (both coerced with `Boolean`) into
  `preferences.miniTimer`, and returns the same object when nothing changes. Preferences are not synced, so there is
  no stamp.
- New `export function miniTimerView(state, now = new Date())`: returns `null` unless `isSessionRunning`. Otherwise it
  returns `{ endAt, taskTitle, paused, strict }`:
  - `taskTitle` is the session task's title, or `null` for wandering or a task that no longer exists.
  - `paused` is `focus.segmentStart == null`.
  - `strict` is `Boolean(focus.strict)`.

**Renderer (`app/main.js`, `index.html`)**
- Focus panel: add `#mini-timer-toggle`, a checkbox "Floating timer", shown only on Windows. Under it, add
  `#mini-timer-through`, a checkbox "Let clicks pass through", shown only when the first box is checked. Both call
  `setMiniTimer` through `attempt`. Settings has no extra control.
- New `publishMiniTimer()`:
  - It sends `desktop.setMiniTimer(payload)`.
  - When the preference is enabled and `miniTimerView` is not `null`, the payload is `{ show: true, endAt, label,
    status, clickThrough }`.
  - `label` is the task title, or `t('mini.wandering')`.
  - `status` is `t('mini.strict')` when `strict`, else `t('mini.paused')` when `paused`, else `''`.
  - In every other case the payload is `{ show: false }`.
- Call `publishMiniTimer()` whenever the `renderTimer` signature changes; add `paused` and `strict` to the signature.
  Also call it after `setMiniTimer` and after a language change. Do not call it every second: the floating window
  counts down by itself.
- `desktop.onMiniTimerToggle(() => attempt(() => setMiniTimer(state, { enabled: !state.preferences.miniTimer.enabled })))`
  handles the tray item.
- Strings under the `mini.` prefix in English and Vietnamese:
  - `toggle` "Floating timer"
  - `clickThrough` "Let clicks pass through"
  - `wandering` "Wandering"
  - `paused` "Paused"
  - `strict` "Strict block"
  - `tray` "Floating timer"
  - `hint` "Shows the time left on top of other windows."

**Main process: new `desktop/mini-timer.cjs`**
- `validMiniView(value)`: returns a clean object or `null`.
  - `{ show: false }` is valid.
  - With `show: true` it needs `endAt` as a safe integer, `label` as a string of 1 to 160 characters, `status` as a
    string of 0 to 40 characters, and `clickThrough` as a boolean.
  - Any other key makes it invalid.
- `placeWindow(saved, workAreas, size)`: a pure function.
  - When `saved` (`{ x, y }`) keeps the whole window inside one of the `workAreas` (`{ x, y, width, height }`), it
    returns `saved`.
  - Otherwise it returns the top-right corner of the first work area, inset 16 px.
- `createMiniTimer({ BrowserWindow, screen, userDataPath, preloadPath, htmlPath })` returns
  `{ apply(view), destroy() }`.
  - The window is 240 × 72, `frame: false`, `resizable: false`, `skipTaskbar: true`, `alwaysOnTop: true`, and has
    `setAlwaysOnTop(true, 'screen-saver')`.
  - Its `webPreferences` are `sandbox: true, contextIsolation: true, nodeIntegration: false` and the mini preload.
    Block navigation and window opening as in `createWindow`.
  - Show it with `showInactive()` so it never takes focus from the app the user is working in.
  - `apply({ show: true, … })` creates the window if needed, positions it, shows it, sets
    `setIgnoreMouseEvents(clickThrough, { forward: true })`, and sends `mini:view` with
    `{ endAt, label, status }`.
  - `apply({ show: false })` hides the window; it is not destroyed.
  - Save the position to `join(userDataPath, 'mini-timer.json')` on `moved`, at most once per second. Read it once
    when the window is first created. A missing or broken file falls back to `placeWindow` defaults.
- `desktop/main.cjs`:
  - Create the mini timer after the app is ready, on Windows only.
  - `ipcMain.handle('desktop:mini-timer', …)`: run `fromApp`, then `validMiniView`, then throw `'Invalid floating
    timer.'` if it is invalid, else `apply`.
  - Add a tray menu item `{ label: 'Floating timer', click: () => toRenderer('desktop:mini-toggle') }` above the
    separator. The tray menu stays in English, as today (SYS-08 lists it as untranslated).
  - Destroy the mini timer in `before-quit`.
  - The window's renderer process is part of `app.getAppMetrics()`, so `appPids` already counts it as Fix Myself
    (APP-04). Do not change the guard.
- `desktop/preload.cjs`: add `setMiniTimer: (view) => ipcRenderer.invoke('desktop:mini-timer', view)` and
  `onMiniTimerToggle: (callback) => ipcRenderer.on('desktop:mini-toggle', () => callback())`.
- New `desktop/mini-preload.cjs`: exposes only `fixMyselfMini.onView(callback)` for `mini:view`.
- New `desktop/mini-timer.html` and `desktop/mini-timer.js`, both static and not built by Vite.
  - Add a CSP meta tag `default-src 'self'; style-src 'self' 'unsafe-inline'`.
  - The body is draggable (`-webkit-app-region: drag`).
  - Background `#183d2f` and text `#f6f5ef`. Status text is mint `#d7efad`.
  - The time left is large and uses tabular figures: `h:mm:ss` from one hour up, `m:ss` below. The label is on one
    line with an ellipsis, and the status follows it when it is not empty.
  - The script ticks every second from the last `endAt`, shows `0:00` once it is past, and sets all text with
    `textContent`. It does not load anything from the network.
- `package.json` `build.files` already includes `desktop/**/*`; confirm that the new files are packaged.

## Steps
1. Model: preference, `setMiniTimer`, `miniTimerView`. Tests in `tests/model.test.js`.
2. `desktop/mini-timer.cjs` pure functions with tests in a new `tests/minitimer.test.js`.
   - Valid views and each invalid case.
   - A saved position inside the area, outside it, and partly outside it.
   - Two work areas.
3. The window factory, the main and preload wiring, and the static page.
4. Renderer controls and publishing.
5. Docs:
   - README focus section: one sentence about the floating timer.
   - `docs/ARCHITECTURE.md`: the FOC-12 status row and the desktop entry.
   - `docs/ACCEPTANCE.md`: if it has an A-14 row, note that the floating timer still needs to be tried on a real
     machine.

## Out of scope
- Android and the browser preview, task workspaces (WS), the calendar view (PLAN), and any change to the app guard,
  the Chrome bridge or the extension.
- Translating the tray menu.
- Controls inside the floating window: it has no buttons, so pause, End and exit stay in Today.

## Tests that define "done"
- `tests/model.test.js`:
  - `miniTimerView` returns `null` with no session and after End.
  - It returns the task title, `null` for wandering, `paused` after `pauseFocus`, and `strict` during a hold.
  - `setMiniTimer` returns the same object when nothing changes.
  - A v3 state saved without `miniTimer` loads with the defaults.
- `tests/minitimer.test.js` as in step 2. It must not require `electron`: `createMiniTimer` receives Electron objects
  as arguments.
- Commands: `npm test`, `npm run build`, `git diff --check`,
  `node --test --test-skip-pattern="Chromium blocks" tests/browser.e2e.js`.
- Do not run the Chromium extension test. Do not start Electron: the user's desktop app may be running. The
  orchestrator checks the window on the real machine.

## Commit
- Branch: `agent/foc-12-floating-timer`. Base: the commit the worktree starts from (it contains this brief).
  Commit trailer: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Commit your work before you finish; uncommitted work counts as not done. Do not commit `AGENT_BRIEF.md` or
  `CLINE_TASK*.md`. Do not push.

## Hard rules
Follow `docs/MULTI_AGENT.md` → "Quy tắc bắt buộc cho worker". Never stop processes you did not start, stay inside this
worktree, do not rewrite history, do not change `SRS.md`. If a decision above seems wrong, stop and say so in your final
message instead of choosing differently.

## Finish with
What changed (files), exact test results, commit hashes, open questions.
