# Task: Task workspaces (WS-01 to WS-05)

## Goal
A task keeps the websites, files, folders and Windows apps used to work on it. **Open workspace** opens all of them at
once. Websites sync between devices; local items stay on the computer that added them. Websites covered by focus or a
block rule are reported, not opened. The apps of a task session's workspace are allowed during that session in
addition to its preset.

## Read first
- `AGENTS.md`, `docs/MULTI_AGENT.md` (section "Quy tắc bắt buộc cho worker").
- `SRS.md`: WS-01 to WS-05, FOC-09, APP-01 to APP-04, BLK-01, WB-02, SYS-04; acceptance test A-13.
- Code:
  - `app/model.js`: `TASK_FIELDS`, `blankTask`, `validateChanges`, `saveTask`, `deleteTask`, `startFocus`,
    `appLimitSnapshot`, `activeBlockRules`, `isFocused`, `normalizeDomains`, `mergeSync`.
  - `desktop/main.cjs`: `registerHandlers`, `fromApp`, `listOpenApps` usage, `desktop:app-limit`.
  - `desktop/apps.cjs`, `desktop/app-guard.cjs` (`validLimit`), `desktop/preload.cjs`.
  - `app/main.js`: `renderDetail`, `wireDetail`, `renderTimer`, `publishAppLimit`, `nativeReminders`, `desktop`.
  - `index.html` (task detail, focus panel), `app/i18n.js`, `tests/model.test.js`, `tests/appguard.test.js`.

## Decisions already made

**Websites: synced task field `links`** (`app/model.js`)
- Each link is `{ id, url, label }`. Add `'links'` to `TASK_FIELDS` and `links: []` to `blankTask`. Migration leaves
  old tasks with `links` undefined, so read it as `task.links ?? []` everywhere.
- `validateChanges` case `links`:
  - It must be an array of at most 20 entries.
  - Each `url` is trimmed, at most 2048 characters, and parses with `new URL`. Its protocol must be `http:` or
    `https:`; otherwise throw `'Add websites as http or https links.'`
  - `label` is trimmed and at most 80 characters. It defaults to the URL's hostname.
  - `id` is kept or generated.
- New `export function linkBlock(state, url, now = new Date())`. It returns `{ source: 'focus' }` when `isFocused`
  and the host matches a focus domain. It returns `{ source: 'rule', name }` for the first active block rule
  (`activeBlockRules`) whose domain matches. Otherwise it returns `null`. A host matches a domain when it equals it
  or ends with `'.' + domain`.

**Local items: owned by the main process** (`desktop/workspaces.cjs`, new). The renderer never sends a path to open.
- The main process keeps a registry in `join(userData, 'workspace-items.json')`:
  `{ [itemId]: { taskId, kind: 'file' | 'folder' | 'app', path, label } }`. It is read once at startup. A missing or
  broken file means an empty registry. Every change is written back.
- IPC handlers, all behind `fromApp`, Windows only:
  - `desktop:workspace-pick` `{ taskId, kind }`, with `kind` either `file` or `folder`:
    - Opens `dialog.showOpenDialog(mainWindow, { properties: [kind === 'file' ? 'openFile' : 'openDirectory'] })`.
    - Cancel returns `null`.
    - A file whose extension is one of `.exe .bat .cmd .com .ps1 .vbs .vbe .js .jse .wsf .msi .lnk .scr .hta`
      (case-insensitive) throws `'Add apps from the app list instead.'`
    - Otherwise it creates an item with `label` set to the base name and returns `{ id, kind, label }`.
  - `desktop:workspace-add-app` `{ taskId, path }`: the path must equal, case-insensitively, the `path` of an entry
    in a fresh `listOpenApps()` result. If not, throw `'Choose an app from the list.'` It returns
    `{ id, kind: 'app', label }`, with `label` set to the list entry's name.
  - `desktop:workspace-list` `taskId`: returns `[{ id, kind, label, missing }]`, where `missing` is
    `!existsSync(path)`.
  - `desktop:workspace-remove` `id`.
  - `desktop:workspace-prune` `taskIds`: an array of the task ids that still exist. It removes the items of any other
    task. The renderer calls it at boot and after a sync merge.
  - `desktop:workspace-open` `{ taskId, urls }`:
    - `urls` holds at most 20 http or https strings of at most 2048 characters. The renderer has already left out
      blocked ones.
    - Websites open with `shell.openExternal`.
    - Each registry item of the task opens as follows. Files and folders use `shell.openPath`; a non-empty error
      string counts as a failure. Apps use `spawn(path, [], { detached: true, stdio: 'ignore', cwd: dirname(path) })`
      followed by `.unref()`, and a missing path counts as a failure.
    - It returns `[{ label, ok }]`. Nothing already open is closed.
  - `desktop:workspace-apps` `taskId`: returns `[{ path, name }]` of the task's app items. It is used for the
    session copy below.
- Validate every argument's shape and size in the handlers: string ids of at most 64 characters, at most 500 task ids
  for prune, and at most 20 items per task. Adding a local item when the task already has 20 items in total throws
  `'Add up to 20 items to a workspace.'` The renderer passes the current link count as `linkCount` in pick and
  add-app; the handler checks `linkCount + local items < 20`.
- `preload.cjs` exposes one function per handler.

**Session copy of workspace apps (WS-04)**
- When `startFocus` is called with a `taskId` on Windows, the renderer first awaits `desktop.workspaceApps(taskId)`
  and passes them as `options.workspaceApps`. This also applies to `tickStrict` starting a hold: let `tickStrict`
  accept `ctx.workspaceApps(taskId)` returning an array, or a `[]` default. Keep this synchronous by having the
  renderer pre-fetch the apps of tasks with a strict block today into a `Map` at boot and after edits.
- `startFocus` stores `focus.workspaceApps`: the passed array, at most 20 entries, each `{ path, name }`.
- `appLimitSnapshot`: when the session has a preset, its `apps` are the preset apps plus `focus.workspaceApps`,
  de-duplicated by lower-cased path. With no preset it stays `null`, because a session without a preset limits no
  apps.
- `desktop/app-guard.cjs` `validLimit`: allow up to 50 apps, since a preset holds 30 and a workspace 20.

**UI**
- Task detail gets a "Workspace" section:
  - Links listed as anchors with `target="_blank"` and `rel="noopener noreferrer"`, plus an "Add website" form with a
    URL and an optional label.
  - On Windows, local items with a kind tag and a "Not on this computer" tag when `missing`. The buttons are
    "Add file", "Add folder" and "Add app"; Add app picks from `listApps()`, the same picker presets use.
  - A Remove button on every item.
  - An "Open workspace" button.
- When adding a link that `linkBlock` reports, still save it, but show "{host} is blocked by {the focus list | rule
  name}. Change it in Settings." with a link to `#settings`.
- **Open workspace.** On Windows, call `workspace-open` with the unblocked links. Show "Opened {n} items." and list
  every failed label, and every blocked link with the message above. On other platforms, open each unblocked link
  with `window.open(url, '_blank', 'noopener')`.
- Show the Open workspace button on Today next to "Working on: {title}" while a task session runs, and next to the
  strict hold status (WB-02).
- WS-05: nothing opens on its own. Do not call Open workspace from boot, `onLogin` or `tickStrict`.
- New strings go under the `workspace.` prefix in English and Vietnamese. New model errors go in `ERRORS_VI`.

## Steps
1. Model: `links`, `linkBlock`, the `workspaceApps` session copy, and the `appLimitSnapshot` merge. Tests.
2. `desktop/workspaces.cjs`: put the registry logic in pure functions that take the file contents and the Electron
   objects as arguments. Tests in a new `tests/workspaces.test.js`:
   - Extension blocking, item limits, prune, and the app path check against a given list.
   - The bad-argument cases.
   - A broken registry file.
3. Main-process handlers and preload. Guard limit set to 50, with a test in `tests/appguard.test.js`.
4. UI on task detail and Today.
5. A browser-preview test in `tests/browser.e2e.js`:
   - Add a link to a task and see it listed.
   - Add `youtube.com` while a focus session runs and see the blocked message.
   - Remove a link.
6. Docs: README section "Task workspace", `docs/ARCHITECTURE.md` status row and desktop entry.

## Out of scope
- Opening workspaces automatically, and Android local items.
- Closing apps.
- Editing the preset from the workspace, and the calendar.
- Any change to block rules, strict rules or the extension.

## Tests that define "done"
- The tests in steps 1, 2, 3 and 5.
- Commands: `npm test`, `npm run build`, `git diff --check`,
  `node --test --test-skip-pattern="Chromium blocks" tests/browser.e2e.js`.
- Do not run the Chromium extension test. Do not start Electron.

## Commit
- Branch: `agent/ws-task-workspaces`. Base: the commit the worktree starts from.
  Commit trailer: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Commit before you finish. Do not push.

## Hard rules
Follow `docs/MULTI_AGENT.md` → "Quy tắc bắt buộc cho worker". Never stop processes you did not start, stay inside this
worktree, do not rewrite history, do not change `SRS.md`. If a decision above seems wrong or two decisions conflict,
stop and say so.

## Finish with
What changed (files), exact test results, commit hashes, open questions.
