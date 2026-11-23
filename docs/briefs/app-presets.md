# Task: App presets and choosing one at focus start (APP-01, APP-02, APP-08)

## Goal
On the Windows desktop app, the user can create app presets (named lists of allowed apps, Block or Pause) in Settings,
pick apps from the apps that have an open window, and choose a preset or "No app limit" when starting focus. The running
session keeps a copy of the chosen preset. Presets sync. **Enforcement (hiding other apps) is not part of this task.**

## Read first
- `AGENTS.md`, `docs/MULTI_AGENT.md` (section "Quy tắc bắt buộc cho worker").
- `SRS.md`: section "Allowed apps during focus", APP-01, APP-02, APP-04 (only the always-allowed list), APP-08.
- Code: `app/model.js` (`ROOT_FIELDS`, `defaultState`, `migrateState`, `setRoot`, `startFocus`, `onLogin`,
  `focusSnapshot`, `exportSync`, `validatePayload`, `mergeSync` → `rootLocal`, `validateBlockRule`, `saveBlockRule`,
  `deleteBlockRule`), `app/main.js` (`renderRules`, `wireRules`, `wireToday`, `renderTimer`, `boot`),
  `desktop/main.cjs` (`fromApp`, `registerHandlers`), `desktop/preload.cjs`, `app/i18n.js`, `tests/blockrules.test.js`,
  `tests/bridge.test.js` (how CJS modules are imported in tests), `tests/browser.e2e.js` (block rule test).

## Decisions already made
**Data (app/model.js)**
- New synced root field `appPresets` (array, default `[]`). Add it to `ROOT_FIELDS`, `defaultState`, `migrateState`
  (non-array → `[]`), `exportSync.data`, `rootLocal` in `mergeSync`. In `validatePayload`, reject a preset without a
  string `id`, string `name` and array `apps` with `'The sync file contains an invalid app preset.'`.
- Preset shape: `{ id, name, apps: [{ path, name }], strength: 'block'|'pause', countdownSeconds, passMinutes }`.
  Countdown and pass reuse `COUNTDOWN_SECONDS` and `PASS_MINUTES` and the same messages as block rules.
- Export `MAX_APP_PRESETS = 10`, `MAX_PRESET_APPS = 30`, and
  `ALWAYS_ALLOWED_APPS = ['explorer.exe', 'systemsettings.exe', 'taskmgr.exe', 'applicationframehost.exe',
  'shellexperiencehost.exe', 'startmenuexperiencehost.exe', 'searchhost.exe', 'lockapp.exe', 'consent.exe',
  'narrator.exe', 'magnify.exe', 'osk.exe', 'fix myself.exe', 'electron.exe']` (lower-case file names).
- Export `isAlwaysAllowed(path)`: true when the lower-cased file name (after the last `\` or `/`) is in the list.
- Export `validateAppPreset(preset)`, which throws readable English messages:
  - name trimmed, 1–60 chars: `'Enter a preset name.'`, `'The preset name must be 60 characters or fewer.'`
  - each app: `path` is a string of at most 260 chars ending in `.exe` (case-insensitive), `name` trimmed, 1–80 chars
    (when empty, use the file name without `.exe`). Bad path: `'Choose apps from the list.'`
  - drop always-allowed apps silently; dedupe by lower-cased path, keeping the first
  - at least one app left: `'Add at least one app to the preset.'`; at most 30: `'Add up to 30 apps to a preset.'`
  - strength not block/pause: `'Choose Block or Pause for the preset.'`
- `saveAppPreset(state, id, changes, ctx)`: create (new UUID, max 10 → `'Add up to 10 presets.'`) or edit
  (missing id → `'This preset no longer exists.'`). It applies immediately through `setRoot(state, 'appPresets', …)`.
  There is **no change delay**: edits only affect sessions that start later (APP-02).
- `deleteAppPreset(state, id, ctx)`: removes it. If `preferences.autoAppPreset` or `preferences.lastAppPreset` equals
  that id, set it to `null`.
- New device-local preferences (not synced): `autoAppPreset: null`, `lastAppPreset: null`. Add them to
  `defaultState().preferences`. Export `setAutoAppPreset(state, id)` (`null` or an existing preset id, otherwise
  `'This preset no longer exists.'`).
- `startFocus(state, now = new Date(), options = {})`:
  - `options.presetId` is `undefined` → no app limit, exactly as now.
  - `null` → no app limit, and set `preferences.lastAppPreset = null`.
  - an id → find the preset (missing → throw `'This preset no longer exists.'`). Store a deep copy on the session as
    `focus.apps = { presetId, name, apps, strength, countdownSeconds, passMinutes }` and set
    `preferences.lastAppPreset = id`.
  - Without a preset, `focus.apps = null`. An already active session is returned unchanged, as now.
- `onLogin` passes `{ presetId: preferences.autoAppPreset }` when that preset still exists, otherwise `{ presetId: undefined }`.
- `focusSnapshot` must **not** include `apps`. Chrome receives only what it gets today.

**Desktop (new file desktop/apps.cjs)**
- `parseProcessList(text)`: parses the JSON output of the PowerShell command below. Accepts one object or an array,
  ignores entries without a string `Path`, uses `Name` or the file name without `.exe` as the name, dedupes by
  lower-cased path, and sorts by name (`localeCompare`). Returns `[{ path, name }]`. Invalid JSON or empty text → `[]`.
- `listOpenApps()`: `execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', CMD], { timeout: 10000,
  windowsHide: true })` and resolves with `parseProcessList(stdout)`. On error, resolve with `[]`.
  `CMD = "Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.Path } | Select-Object Path,
  @{n='Name';e={ if ($_.Description) { $_.Description } else { $_.ProcessName } }} | ConvertTo-Json -Compress"`.
- `desktop/main.cjs`: `ipcMain.handle('desktop:list-apps', async (event) => { fromApp(event); return listOpenApps(); })`
  only when `process.platform === 'win32'`. `desktop/preload.cjs`: `listApps: () => ipcRenderer.invoke('desktop:list-apps')`.

**UI**
- `index.html`: new `<section class="panel settings-panel" id="app-presets" aria-labelledby="presets-title" hidden>`
  right after `#block-rules`. `boot()` unhides it only when `desktop?.platform === 'win32'` and `desktop.listApps`
  exists. Contents, modelled on the block rule panel:
  - help text; a preset list (name, app count, strength, Edit and Delete buttons; Delete uses `confirmTwice` like rules);
    an empty-state line
  - a form with a hidden id, name, the chosen apps as a list with a Remove button each, a "Refresh open apps" button
    that calls `desktop.listApps()` and fills a select of open apps (always-allowed apps and already chosen apps
    removed), an "Add app" button, a strength select (Block it / Pause, then allow a pass), countdown and pass fields
    shown only for Pause, Save preset, Cancel edit, and feedback
  - a select "Preset for automatic sessions" (No app limit + presets), wired to `setAutoAppPreset`
- Today: next to `#start-focus` add `<select id="focus-preset" hidden>` with "No app limit" plus the presets, showing the
  `lastAppPreset` choice. It is visible only when the presets panel is enabled, at least one preset exists, and no
  session is running. The start button calls `startFocus(state, new Date(), { presetId })`, or omits `presetId`
  when the select is hidden.
- While a session with `focus.apps` runs, `#focus-status` adds a line such as "Apps: VS Code, Claude" through `t()`.
- Every new string goes through `t()` with English and Vietnamese entries under the `apps.` prefix. New model error
  messages get Vietnamese entries in `ERRORS_VI`.

## Steps
1. Model functions and state fields above, with unit tests.
2. `desktop/apps.cjs`, the IPC handler and preload, with unit tests for `parseProcessList`.
3. Settings panel, the Today select and the focus status line.
4. Browser test, then README section "App presets" (say enforcement is not built yet) and the APP row in
   `docs/ARCHITECTURE.md` (APP-01, APP-02 and APP-08 built; APP-03 to APP-07 and APP-09 not yet).

## Out of scope
- Watching the foreground window, minimizing apps, the intervention screen, passes, coverage (APP-03 to APP-07),
  review counts (APP-09), and the Start menu app list. Do not add native modules or new npm dependencies.
- No changes to the Chrome extension, `desktop/focus-bridge.cjs`, block rules, or `SRS.md`. Do not move existing
  Settings sections.

## Tests that define "done"
- New `tests/apppresets.test.js`: validation messages and limits (11th preset, 31st app); always-allowed apps dropped;
  dedupe by path regardless of case; edits apply immediately; delete clears `autoAppPreset` and `lastAppPreset`;
  `startFocus` with undefined, null, an id and a missing id; the session copy is unaffected when the preset is edited
  later; `onLogin` uses `autoAppPreset` and ignores a deleted one; `focusSnapshot` has no `apps`; `exportSync` and
  `mergeSync` carry `appPresets` (newer edit wins); an invalid preset in a sync payload is rejected; `parseProcessList`
  with a single object, an array, missing `Path`, duplicates and bad JSON.
- `tests/i18n.test.js` must still pass (both languages have every key).
- New browser test in `tests/browser.e2e.js`: use `page.addInitScript` to set `window.fixMyselfDesktop` to a fake with
  `platform: 'win32'`, `listApps` resolving to VS Code (`C:\\Apps\\Code.exe`), Claude (`C:\\Apps\\Claude.exe`) and
  `C:\\Windows\\explorer.exe`, and `status`, `setStartup`, `publishPlan`, `chromeReports`, `setBackground`, `show`
  resolving harmlessly. Create a preset with VS Code and Claude (Explorer must not be offered), check that the Today
  select offers it, start focus with it, and verify the status line lists both apps and that a reload keeps the session.
- Commands: `npm test`, `npm run build`, `git diff --check`,
  `node --test --test-skip-pattern="Chromium blocks" tests/browser.e2e.js`.
- Do not run the Chromium extension test (port 127.0.0.1:42631 may belong to the user's desktop app).

## Commit
- Branch: `agent/app-presets`. Base: `13c046a` (the commit the worktree starts from). Commit trailer: `Co-Authored-By: Cline (DeepSeek) <noreply@cline.bot>`.
- Small commits per step are fine. Do not commit `AGENT_BRIEF.md` or `CLINE_TASK*.md`. Do not push.

## Hard rules
Follow `docs/MULTI_AGENT.md` → "Quy tắc bắt buộc cho worker". In particular: never stop processes you did not start,
stay inside this worktree, do not rewrite history, do not change `SRS.md`. If a decision above seems wrong, stop and
say so in your final message instead of choosing differently.

## Finish with
What changed (files), exact test results, commit hashes, open questions.
