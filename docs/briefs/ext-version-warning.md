# Task: Warn when a Chrome profile runs an outdated extension (FOC-05)

## Goal
When a paired Chrome profile runs an older Fix Myself extension than the one shipped with the app, Settings says so and
tells the user to press Reload in `chrome://extensions`. Today also shows a short warning. This happened in practice: an
unpacked extension loaded before block rules existed silently ignored them.

## Read first
- `AGENTS.md`, `docs/MULTI_AGENT.md` (section "Quy tắc bắt buộc cho worker").
- `SRS.md`: FOC-05, BLK-07, SYS-04.
- Code:
  - `extension/worker.js` (`report`), `extension/manifest.json`.
  - `desktop/focus-bridge.cjs` (`validReport`, `MAX_REPORT_BYTES`).
  - `app/model.js` (`recordChromeReports`, `chromeCoverage`, `COVERAGE_STALE_MS`).
  - `app/main.js` (`renderCoverage`, `renderTimer`, the focus-status text).
  - `tests/bridge.test.js`, `tests/model.test.js`.

## Decisions already made
- **Extension.** `report()` adds `version: chrome.runtime.getManifest().version`. Bump `extension/manifest.json`
  from `0.4.0` to `0.5.0`.
- **Bridge** (`validReport`):
  - `version` is optional.
  - When present, it must be a string matching `/^\d{1,5}(\.\d{1,5}){0,3}$/`. Otherwise reject the whole report
    (`null`), as for other bad fields.
  - The cleaned report carries `version` (or `null` when it was missing).
- **Model:**
  - New `export function compareVersions(a, b)`. It compares dot-separated integers, treats missing parts as 0, and
    returns -1, 0 or 1.
  - `recordChromeReports` stores `version: report.version ?? null` on the profile.
  - `chromeCoverage(state, now, expectedVersion = null)` adds `version` and `outdated` to each profile.
    `outdated` is `true` when `expectedVersion` is given and either `version` is `null` (extensions before 0.5.0 sent
    none) or `compareVersions(version, expectedVersion) < 0`.
- **Renderer:**
  - `app/main.js` gets the shipped version with `import extensionManifest from '../extension/manifest.json';` (Vite
    supports JSON imports). Pass `extensionManifest.version` to `chromeCoverage` everywhere it is called.
  - In `renderCoverage`, add one more line under each outdated profile: "Extension {version} is older than
    {expected}. Open chrome://extensions and press Reload on Fix Myself." When `version` is `null`, use
    "an older version" in place of `{version}`.
  - In the Today focus status, when any profile that is `current` is `outdated`, append "Chrome extension needs a
    reload; see Settings."
  - Strings go under `settings.extensionOutdated`, `settings.extensionOlder` and `focus.extensionReload`, in English
    and Vietnamese.

## Steps
1. Extension report field and manifest bump.
2. Bridge validation. In `tests/bridge.test.js`:
   - A report with a valid version passes and carries it.
   - A report without a version passes with `null`.
   - `'1.x'`, `42` and a 30-character string each reject the report.
3. Model. In `tests/model.test.js`:
   - `compareVersions`: `0.4.0` against `0.5.0`, `0.5` against `0.5.0`, and `1.10` against `1.9`.
   - `chromeCoverage` marks `null` and older versions outdated and the same or a newer version not outdated. With no
     `expectedVersion`, nothing is outdated.
4. Renderer lines.
5. Docs:
   - `docs/ARCHITECTURE.md`: FOC-05 row, one sentence.
   - README: in the Chrome setup section, one sentence saying the app warns when the unpacked extension needs a
     Reload.

## Out of scope
Auto-updating the extension, Chrome Web Store packaging, and any change to blocking, rules or the focus payload.

## Tests that define "done"
- The tests in steps 2 and 3.
- Commands: `npm test`, `npm run build`, `git diff --check`,
  `node --test --test-skip-pattern="Chromium blocks" tests/browser.e2e.js`.
- Do not run the Chromium extension test. Do not start Electron.

## Commit
- Branch: `agent/ext-version-warning`. Base: the commit the worktree starts from.
  Commit trailer: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Commit before you finish. Do not push.

## Hard rules
Follow `docs/MULTI_AGENT.md` → "Quy tắc bắt buộc cho worker". Never stop processes you did not start, stay inside this
worktree, do not rewrite history, do not change `SRS.md`. If a decision above seems wrong, stop and say so.

## Finish with
What changed (files), exact test results, commit hashes, open questions.
