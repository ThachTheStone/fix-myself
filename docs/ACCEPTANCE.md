# Acceptance status

Where each acceptance test in [SRS.md](../SRS.md) section 9 stands, as of 2026-11-23. "Automated" means a test in
`tests/` exercises it on every run; "on device" means a person has to do it on the real PC or phone. Run the automated
checks with `npm test` and `npm run test:browser` (quit the installed Fix Myself first: the Chrome extension test needs
port 42631).

| Test | Status | Evidence | Still needed |
|---|---|---|---|
| A-01 Windows sign-in | Built, partly automated | Login session starts once per planning day and survives restart (`tests/model.test.js`). | On device: sign out and in, offline too. Turn startup off and check it no longer opens. |
| A-02 Chrome blocking | Built, automated in Chromium | Extension blocks new and existing tabs, keeps the session when the app closes, releases at expiry (`tests/browser.e2e.js`, Chromium test). | On device: your regular Chrome profile, a direct link, offline. |
| A-03 POCO pilot | Not built | — | Android blocking (FOC-07) and a real phone. |
| A-04 Phone reconnect | Not built | — | Network sync service and FOC-06. |
| A-05 Calendar | Not built | — | Google OAuth app (CAL-01 to CAL-03). |
| A-06 AI approval | Not built | — | An AI provider (AI-01 to AI-04). |
| A-07 Reminders | Built, automated | `A-07: reminders follow their triggers…` (`tests/model.test.js`). | On device: one real notification on Windows. |
| A-08 GitHub import | Not built | — | GitHub App (GH-01 to GH-06). |
| A-09 Review and usage gaps | Partly built | Task review and workout photo staying local (`tests/model.test.js`). | Android usage reporting is not built. |
| A-10 Offline changes | Built, automated | `A-10: conflicting offline edits…` (`tests/model.test.js`), two-profile sync (`tests/browser.e2e.js`). | On device: two real devices with a sync file. |
| A-11 Block rules | Built, mostly automated | Schedules, midnight windows, change delay, cancel, sync (`tests/blockrules.test.js`, `tests/browser.e2e.js`); extension keeps rules with the app closed (Chromium test); review of pauses, passes and reasons (BLK-10). | On device: steps below. |
| A-12 Allowed apps | Built, automated, and run once on the dev PC | Guard rules, Pause countdown in the main process, partial coverage (`tests/appguard.test.js`); dialog and review (`tests/browser.e2e.js`). The real Electron app minimized Notepad within a second during a session that allowed only VS Code, gave a pass after the countdown, and listed it in Review. | On device: steps below, especially an app run as administrator and a full-screen app. |

## On-device steps for tonight

Start the new build: quit Fix Myself from the notification area, then run `npm run desktop` from a terminal outside
VS Code (or `npm run desktop:package` and install from `release/`). Reload the Fix Myself Focus extension at
`chrome://extensions` (version 0.4.0).

**A-12 Allowed apps**
1. Settings → App presets: name it "Coding", add VS Code and Claude, choose Block, save.
2. Today: choose "Coding", Start focus. Open Notepad or any other app: it should be minimized and Fix Myself should
   explain why. Open File Explorer, Settings and Task Manager: they should stay.
3. Edit the preset (add an app). The running session should keep its old list. Restart Fix Myself: same.
4. Make a second preset with Pause, start a session after the first ends, wait out the countdown, take a pass, and check
   the app is let through until the pass ends. Blocked websites must still have no continue button.
5. Right-click an app → Run as administrator, bring it to the front: Today should say some windows could not be limited.
6. Review: the apps section lists what was stopped, paused and passed, with your reasons.

**A-11 Block rules**
1. Settings → Block rules: a Scheduled Block rule for a site with a window that covers now, and an Always Pause rule for
   another site.
2. Open both sites in Chrome. Block shows no way through; Pause counts down, then lets you continue with a reason.
3. Wait for the pass to end: the site pauses again. Start focus with that site in the focus list: it is blocked.
4. Disable a rule: it keeps applying until the change delay ends. Cancel a waiting change: the rule stays.
5. Quit Fix Myself: rules still apply in Chrome.
6. Review: block rule activity per site with busiest hours and your pass reasons.
