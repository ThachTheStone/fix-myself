# Software Requirements Specification
## Personal planning and focus app

| Document field | Value |
|---|---|
| Version | 0.5 |
| Status | Draft for implementation |
| Date | 2026-11-23 |
| Initial platforms | Windows 11 and privately installed Android |
| Primary Windows browser | Google Chrome |
| Android pilot | Xiaomi HyperOS `1.0.17.0.UNLMIXM`. Likely POCO X6 Pro 5G running Android 14, pending confirmation in About phone. |

## 1. Purpose and scope

The app helps one person remember their mission and schedule, turn commitments into achievable work, and reduce unplanned scrolling. It opens the **Today** view at Windows sign-in. During a focus session, attempts to open selected distractions bring the person back to today's plan. A session can also allow only the Windows apps the person chose for that work. Outside focus, block rules the person sets in advance limit the cues that start unplanned scrolling. A weekly review shows task delivery, completion quality, distraction trends, and recorded workouts.

| Capability | Windows 11 | Android private pilot |
|---|---|---|
| Daily planning | Today at sign-in, task inbox, commitments, timeline, and reminders | Today, task inbox, commitments, timeline, and reminders |
| Focus | First sign-in session and manual sessions. Chrome website blocking ships first. Edge follows in compatibility testing. |
| Allowed apps | Optional per-session list of allowed Windows apps, chosen at session start from presets | Not available. Android app interception follows FOC-07. |
| Block rules | Scheduled or always-on Pause and Block rules for websites in Chrome | Rules sync to the phone. App rules follow after FOC-07 validation. | Optional participation in a synced desktop session. Native-app blocking is subject to on-device validation. |
| Distraction reporting | Blocked attempts in enabled Chrome profiles | Estimated foreground time for selected apps, usage alerts, and interruption counts when blocking is active |
| Integrations | Google Calendar, GitHub issue import, and optional AI planning | Same account, imported tasks, plan, and AI approval flow |
| Weekly review | Task outcomes, distraction trends, and workout entries | Same review, workout logging, and photo attachment |

**Future scope.** iPhone support, additional desktop platforms, Windows app blocking outside focus sessions, Android website blocking, and direct Strava activity display. A public Android release requires its own distribution and permission review.

## 2. Terms and key views

- **Mission** is a short statement of the outcome or direction the user wants to keep in mind.
- **Inbox** holds newly captured and imported tasks before the user commits or adds them to Today.
- **Commitment** records the outcome the user intends to deliver and the time they committed to it.
- **Work block** reserves time on the schedule. A task may have several work blocks.
- **Deadline** is when the outcome is due. It may exist without a work block.
- **Today** shows the mission, priorities, next action, planned work, approaching deadlines, carryovers, and focus status.
- **Block rule** is a user-defined list of websites with a schedule and a strength. It applies whether or not a focus session is running.
- **Pause** is a rule strength that delays a visit and lets the user continue for a limited pass after stating a reason. **Block** allows no way through while the rule is active.
- **App preset** is a named list of allowed Windows apps with a strength. Choosing one when a focus session starts limits that session to those apps.
- **Focus intervention** shows why a selected site or app is blocked, the time remaining, and the next action from Today.
- **Weekly review** shows delivery, quality review, distraction trends, and workout check-ins.

## 3. Daily plan, commitments, and reminders

| ID | Requirement |
|---|---|
| DAY-01 | When startup is enabled, the Windows app shall open Today after interactive sign-in. It shall display the local plan while connected services refresh in the background. Startup runs in the signed-in user's session. Its launch order is controlled by Windows. [Windows startup behavior](https://support.microsoft.com/en-us/windows/experience/startup-boot/configure-startup-applications-in-windows) |
| DAY-02 | The user shall be able to set a mission, pin up to three priorities, and choose a next action. Today shall show carryovers from previous days. Adding a carryover to today's plan shall preserve its existing deadline. |
| TASK-01 | The app shall support quick capture with a title and an initial open status. Optional fields shall include mission, priority, next action, subtasks, effort estimate, completion criteria, planned work blocks, and deadline. Supported task states shall be open, in progress, completed, and canceled. |
| TASK-02 | The user shall be able to record a commitment and attach it to a task. The timeline shall show the commitment time, scheduled work, original and revised deadlines, completion, and reopen events. Rescheduling a work block shall leave the deadline unchanged. |
| REM-01 | The user shall be able to set reminders for a planned start or deadline, configure lead times, snooze a reminder, and choose a default notification device. Updating the triggering time shall replace future reminders tied to that trigger. Completing or canceling a task shall cancel its pending reminders. |
| REM-02 | The app shall schedule reminders locally where permitted. It shall restore pending reminders after restart and show when notification permission is missing or delivery timing is approximate. After a long offline or suspended period, overdue reminders shall be grouped when the app next runs. [Android notification permission](https://developer.android.com/develop/ui/views/notifications/notification-permission) · [Android alarm scheduling](https://developer.android.com/develop/background-work/services/alarms) |

## 4. Focus sessions and blocking

| ID | Requirement |
|---|---|
| FOC-01 | In setup, the user shall enable automatic focus, choose a duration, and select distractions. YouTube, Facebook, and Instagram shall be offered as starting choices. The first Windows sign-in of each planning day shall start the session when the app receives the startup signal. The app shall allow manual focus sessions as well. |
| FOC-02 | The app shall record one automatic session per planning day and persist its end time. Signing back in, waking from sleep, or restarting on the same day shall preserve that end time. A manual launch shall display the current session state. If a new planning day starts during an already active session, it shall continue to its recorded end time without a second overlapping session. |
| FOC-03 | The Chrome extension shall block selected domains and subdomains in enabled profiles during an active session. It shall cover direct navigation and selected sites in tabs already open at session start. Unlisted sites shall remain accessible. Feed-only and Shorts-only rules require separate compatibility testing. [Chrome filtering API](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest) · [Chrome navigation API](https://developer.chrome.com/docs/extensions/reference/api/webNavigation) |
| FOC-04 | The intervention shall show the reason, session end time, and today's next action, with a way to open Today. During an active session the app shall provide no early-end or continue-anyway control. The user can edit exceptions, block lists, and durations for future sessions. OS and browser controls shall remain accessible. |
| FOC-05 | The browser extension shall use a valid locally stored rule set and session when offline and release its block at the stored expiry. The app shall show coverage by supported browser profile. A missing or disabled extension shall appear as unavailable when the app can determine that state. An extension that cannot verify a valid active session shall allow access and show degraded coverage when available. |
| FOC-06 | When the phone opts in to desktop focus, it shall apply a synced session until the desktop session's end time. A session received halfway through shall use the remaining time. A session received after expiry shall be skipped. Usage alerts remain independently configurable. |
| FOC-07 | On the pilot phone, a user-enabled service shall be evaluated for intercepting selected native apps during focus and showing the intervention. Enforcement shall follow user-configured rules and operate independently of the AI. The dialer, emergency functions, and system settings shall be excluded. [Android usage statistics](https://developer.android.com/reference/android/app/usage/UsageStatsManager) · [Android background activity restrictions](https://developer.android.com/guide/components/activities/secure-bal) · [Android restricted settings](https://support.google.com/android/answer/12623953) |
| FOC-08 | If Android blocking cannot be enabled, loses permission, or fails validation on the pilot build, the phone shall show **Alerts only**. Usage reporting and reminders shall continue where permitted. The Android blocking requirement remains open until the on-device acceptance test passes. |

### Block rules outside focus

Block rules limit the cues that start a habit loop at times the user chooses. They are configured on the **Block rules** page in Settings. Windows Chrome enforces them first. Android app rules are future scope and depend on FOC-07.

| ID | Requirement |
|---|---|
| BLK-01 | The user shall create, name, edit, enable, disable, and delete block rules. Each rule shall list websites as domain names that also cover subdomains, and shall have one schedule and one strength. The app shall offer the focus distraction list as starting choices. The app shall validate domains as in FOC-03 and allow up to 20 rules with up to 30 domains each. Unlisted sites shall remain accessible. |
| BLK-02 | A rule's schedule shall be **Always** or **Scheduled**. A scheduled rule shall have one or more time windows, each with selected days of the week and a start and end time. A window may cross midnight; it belongs to the day it starts. Schedules shall use the planning time zone. |
| BLK-03 | A **Block** rule shall show the intervention with the rule name, the time the rule stops applying, the mission, and today's next action, with a way to open Today. It shall provide no continue control while the rule applies. |
| BLK-04 | A **Pause** rule shall show the same intervention with a countdown. After the countdown the user may enter an optional reason and continue. Continuing grants a pass for that site in that browser profile. When the pass expires, the next visit pauses again. The defaults are a 15-second countdown and a 10-minute pass. The user may set the countdown from 5 to 60 seconds and the pass from 1 to 30 minutes for each rule. |
| BLK-05 | When rules overlap, the strongest applies: an active focus session first, then **Block**, then **Pause**. A focus session shall not start or extend a pass. A pass granted before a focus session shall end when the session starts for sites on the focus list. |
| BLK-06 | Changes that weaken protection shall take effect after a change delay. They include disabling or deleting a rule, removing a domain, removing or shortening a time window, changing **Block** to **Pause**, lengthening a pass, shortening a countdown, and shortening the delay itself. Changes that strengthen protection shall apply on the next rule check. Settings shall show each pending change with the time it takes effect and let the user cancel it. The user chooses the delay: none, 10 minutes (default), 1 hour, or the start of the next planning day. |
| BLK-07 | The extension shall store the current rule set and evaluate schedules locally, so rules keep applying while the desktop app is closed or offline. Rule changes shall reach paired profiles on the next check. Tabs already open on a site shall be covered when a rule starts applying. Coverage shall be shown as in FOC-05. The app may stop enforcing only according to the user's rules or a change that has completed its delay. |
| BLK-08 | Rules shall be part of the synced plan so every device shows the same rules. Rule changes shall merge field by field. A pending weakening change shall keep its original effective time on every device. |
| BLK-09 | Only the user shall create or change rules, through the Settings page. The AI assistant and imported data shall not create, change, pause, or bypass rules, and the app shall provide no remote unlock. |
| BLK-10 | The weekly review shall show, separately from focus blocking and for each site, visits stopped by **Block**, pauses, and passes taken, with an hour-of-day breakdown. Reasons entered for passes shall be listed for the user. The extension shall report only daily counts and reasons for listed sites, not URLs, page content, or other browsing. |
| BLK-11 | Future scope: a daily time limit as a third schedule type, after the extension can measure active time on listed sites; and the same rules for Android apps once FOC-07 passes A-03. |

### Allowed apps during focus

An app preset limits a focus session to the Windows apps the user chose for that work, for example VS Code and Claude Desktop for a coding session. Presets are optional: a session without one blocks only the selected websites. This section applies to the Windows desktop app.

| ID | Requirement |
|---|---|
| APP-01 | The user shall create, name, edit, and delete app presets in Settings. Each preset shall list allowed apps and have one strength, **Block** or **Pause**. The user shall add apps by choosing from apps with an open window or apps in the Start menu, not by typing a program name. The app shall identify an app by its executable path and show its display name and icon. The app shall allow up to 10 presets with up to 30 apps each. |
| APP-02 | Starting a manual focus session shall let the user choose a preset or **No app limit**, with the last choice preselected. The user shall choose a default preset for automatic sessions, which is **No app limit** until set. The session shall store a copy of the chosen preset when it starts. Editing or deleting a preset shall apply to sessions that start afterwards, and the allowed list of a running session shall not change until it ends, including after a restart on the same day. |
| APP-03 | During a session with a preset, when a window of an app that is not allowed comes to the foreground, the app shall minimize that window and show the intervention with the preset name, the session end time, the allowed apps, and today's next action, with a way to open Today. The app shall not close, end, or change the blocked app, and shall not block its background work, audio, or notifications. Apps that were already open when the session started shall be covered when they come to the foreground. |
| APP-04 | Fix Myself and Windows controls shall always be allowed and shall not be listed in presets: the taskbar, Start, search, File Explorer, Settings, Task Manager, the sign-in, lock and security prompts, and accessibility tools such as Narrator, Magnifier, and the on-screen keyboard. Open and save dialogs shown by an allowed app shall be allowed. |
| APP-05 | With **Block**, the intervention shall provide no continue control until the session ends. With **Pause**, it shall show a countdown; after it the user may enter an optional reason and continue, which grants a pass for that app. When the pass expires, the next time the app comes to the foreground pauses again. Passes shall end when the session ends. Countdown and pass settings shall follow BLK-04. This continue control is an exception to FOC-04 and applies only to apps, never to the session's blocked websites. |
| APP-06 | A browser shall be treated like any other app. When an allowed Chrome is used, the session's website blocking and block rules shall still apply. |
| APP-07 | App limits shall need the desktop app to be running. If the app cannot watch the foreground window, for example because a blocked app runs as administrator, Settings and Today shall show that app limits are unavailable or partly covered. Website blocking shall continue unaffected. |
| APP-08 | Presets shall be part of the synced plan and merge field by field, so every Windows device shows the same presets. An app that is not installed on a device shall be shown as missing there. Only the user shall create or change presets through Settings; the AI assistant shall not create, change, or bypass them, as in BLK-09. |
| APP-09 | The app shall record, for each app, attempts stopped by **Block**, pauses, and passes taken, with pass reasons, for the weekly review, separately from website blocking. It shall record only the app's display name, executable path, and time, never window titles or content. |
| APP-10 | Future scope: allowed websites in a preset, app limits outside focus sessions as block rules, and Android app presets once FOC-07 passes A-03. |

## 5. Google Calendar and the AI assistant

| ID | Requirement |
|---|---|
| CAL-01 | The user shall connect Google Calendar through OAuth and select calendars for planning availability. The first-release design shall read free/busy information and write approved work blocks to a dedicated app-created calendar. The app shall have no editing capability for existing appointments on other calendars. [Google Calendar scopes](https://developers.google.com/workspace/calendar/api/auth) · [Freebusy API](https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query) |
| CAL-02 | The app shall schedule around busy time, recurring events, all-day events marked busy, work hours, and breaks. It shall label stale availability and check for conflicts again immediately before writing. If a conflict appears or availability cannot be checked, the app shall keep the proposal pending and show what needs review. |
| CAL-03 | Each app-created calendar block shall retain its originating task link and provider event identifier. The app shall show external edits and deletions. It shall reconcile retries so a timed-out write does not create a duplicate event. A partially applied batch shall show the result for each item. [Google Calendar sync](https://developers.google.com/workspace/calendar/api/guides/sync) |
| AI-01 | An optional AI provider shall help clarify outcomes, split work into achievable steps, estimate effort, and propose a schedule. When available time is insufficient, the proposal shall identify what does not fit and present choices about scope, priority, or deadlines. |
| AI-02 | The app shall preview each proposed create or update, listing the affected record and new values. The user shall be able to approve, revise, or reject individual changes. Approval applies to the reviewed values. If the underlying record changes before execution, the app shall request another review. |
| AI-03 | The app shall execute approved actions only through supported operations for tasks, app-created calendar blocks, reminders, and future focus settings. The action log shall show what was approved and the result. This permission model excludes terminal command execution, arbitrary file access, unrestricted OS control, and operation of the Android blocking service. |
| AI-04 | The app shall validate AI output and treat imported text as data. Calendar event descriptions, browser content, workout photos, Strava data, and raw phone usage shall stay outside AI inputs. The app shall perform calendar conflict checks. Manual planning, reminders, and focus shall remain usable if AI is unavailable. |

**Example workflow.** A task is committed for Friday at 17:00. The assistant proposes an outline, a draft, and a review, then previews blocks around existing meetings. The user approves the blocks. Moving the draft block to Thursday preserves Friday's deadline.

## 6. GitHub issues as tasks

| ID | Requirement |
|---|---|
| GH-01 | The user shall connect GitHub through a GitHub App with read-only Issues access to selected repositories. The app shall support public and private repositories within the user's authorized access. Repository selection and app permissions shall limit the scope of imports. [GitHub App installation](https://docs.github.com/en/apps/using-github-apps/installing-a-github-app-from-a-third-party) · [GitHub App user authorization](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app) |
| GH-02 | The default import rule shall put open issues assigned to the connected user into the task inbox from selected repositories. The user shall also be able to import a specific issue by GitHub URL if it is in an authorized repository. The app shall filter out pull requests from the Issues API response. [GitHub Issues API](https://docs.github.com/en/rest/issues/issues#list-repository-issues) |
| GH-03 | The app shall create at most one linked task per GitHub issue for the account, using GitHub's issue identifier to reconcile automatic import, manual import, retries, and concurrent sync. It shall display the repository, issue number, title, canonical link, labels, assignees, and GitHub status. Imported tasks shall support commitments, subtasks, personal deadlines, work blocks, reminders, and completion review. |
| GH-04 | The app shall refresh source metadata, display the last successful sync time, and preserve the user's edits to their personal task. Closed, reopened, or reassigned issues shall be flagged for review. A previously imported issue shall remain linked if it stops matching the import filter. Local task completion and GitHub issue state shall each have their own status. The integration shall have read-only access, so issue edits and closures happen in GitHub. |
| GH-05 | When a user asks the AI to plan an imported task, they shall choose which issue context to share before any GitHub-sourced text is sent to the provider. The app shall honor repository access restrictions, and text from an issue shall never authorize an app action. |
| GH-06 | Planned tasks shall remain available offline, with freshness displayed. If the user disconnects GitHub or the app detects revoked repository access, it shall stop refreshing and remove the affected imported issue details from its cache, including on the next sync from linked devices. User-authored notes, commitments, and schedules shall be preserved. |

**Example workflow.** An assigned issue appears in the inbox. The user commits to fixing it, adds a personal deadline, and approves a work block around meetings. If a teammate closes the GitHub issue, the app asks the user to review the task and keeps its planned block until the user changes it.

## 7. Weekly review and workout evidence

| ID | Requirement |
|---|---|
| REV-01 | The selected date range shall show commitments due, completed commitments, on-time completions, and carryovers. The denominator for on-time rate shall be commitments due in that period, excluding cancellations. The numerator shall be those completed by their applicable deadline. Show original and revised deadlines alongside rescheduled items. Display undated tasks separately and show an unavailable rate when there are no eligible commitments. |
| REV-02 | The assistant shall review a selected task against its recorded completion criteria. It shall ask what was delivered and what evidence the user has, then propose **Met**, **Partly met**, or **Needs review**. The user shall confirm the result. Tasks can remain **Unreviewed**, including when criteria were never defined. |
| REV-03 | Distraction reporting shall show estimated Android foreground minutes by selected app and Windows blocked attempts by site. The user shall be able to set daily thresholds for tracked Android apps. The app shall mark data gaps and show week-over-week comparisons when periods have comparable coverage. Minutes and blocked attempts shall be displayed independently. |
| REV-04 | The user shall be able to log workout date, type, and duration, and optionally attach a photo through the device picker. The app shall label entries **Self-reported** or **Photo attached**. By default, only the workout entry syncs and the photo stays on the device that added it. [Android photo picker](https://developer.android.com/training/data-storage/shared/photopicker) |
| REV-05 | The first release shall use manual check-ins and photo evidence. A future Strava card may show the connected user's own recent activity if Strava permits the registered use. That integration shall apply the provider's authorization, caching, and deletion rules. Strava data and derived data shall stay outside AI review and combined dashboard analytics. [Strava API policy](https://www.strava.com/legal/api_policy) · [Strava webhooks](https://developers.strava.com/docs/webhooks/) |

## 8. Data, permissions, and quality requirements

| ID | Requirement |
|---|---|
| SYS-01 | The system shall use stable IDs for tasks, commitments, work blocks, reminders, focus sessions, synced devices, and approved actions. Integration links shall retain provider identifiers and last successful refresh times. Daily boundaries shall use the user's planning time zone. Running session end times shall remain fixed when time zones change. |
| SYS-02 | Windows and Android shall cache Today, tasks, reminders, and active focus rules for offline use. The user shall be able to edit tasks offline. Reconnect shall reconcile updates without duplication. Conflicting edits to the same field shall surface both values for resolution. Deletions shall propagate so reconnecting devices cannot restore removed items silently. |
| SYS-03 | Pair devices to the same private account. Integrations and OS permissions shall be opt-in. Credentials shall be stored using protected storage, and network traffic shall be encrypted. The user shall be able to unlink a device, disconnect an integration, and see which capabilities depend on each permission. |
| SYS-04 | With user consent, sync only the daily totals needed for the phone usage report. Raw usage events shall stay on the phone. The app shall avoid collecting notification text, keystrokes, screenshots, page contents, and full browsing history. The extension shall receive only the planning data required for its intervention. |
| SYS-05 | The user shall be able to export and delete user-created records and control usage-data retention. The account and integration screens shall explain which information is stored locally and which is synced. |
| SYS-06 | Proposed pilot targets are a cached Today view within two seconds of app startup, Today visible within ten seconds of Windows invoking the startup app on the pilot PC, and ordinary updates syncing within 30 seconds when both devices are online. OS scheduling and external service delays shall be measured separately. |
| SYS-07 | Today and intervention screens shall support keyboard navigation on Windows, screen reader labels on both platforms, and readable text at increased system font sizes. Status indicators shall include usable text or an equivalent accessible label. |
| SYS-08 | The user shall be able to choose English or Vietnamese for the interface in Settings. The change shall apply immediately without a restart and persist on that device. The first launch shall follow the system language. Dates and times shall use the chosen language. User-entered text shall not be translated. |

## 9. Acceptance tests

| Test | Pass condition |
|---|---|
| A-01 · Windows sign-in | The first sign-in opens cached Today and starts the configured focus session, including offline. A same-day restart preserves the end time. Disabling startup stops automatic launch. |
| A-02 · Chrome blocking | In the user's regular Chrome profile, open each selected site from a new tab, direct link, or pre-existing tab. Today and the remaining time are shown during focus. Repeat offline. Unlisted sites remain accessible. Selected sites work again at expiry without a browser restart. |
| A-03 · POCO pilot | Confirm model, Android version, and HyperOS build on the actual phone. Verify usage reporting independently. Verify that opening a selected app from the launcher, Recents, a notification, or a deep link shows the intervention. Repeat after reboot and with Battery Saver enabled. Confirm access resumes at the original end time. Permission revocation shall be reflected as reduced coverage when observed. |
| A-04 · Phone reconnect | Reconnect halfway through a desktop session and verify that the phone uses the original end time. Reconnect after expiry and verify it skips the expired session. |
| A-05 · Calendar conflict and retry | Add a meeting after creating a proposal. Verify that the new conflict requires review. Simulate a timeout after creating an event and verify that retry leaves one event. |
| A-06 · AI approval | Reject a proposal and verify no changes occur. Approve only one item in a second proposal and verify only that item changes. Make a task edit between preview and approval and verify that the stale action requires another review. |
| A-07 · Reminders | Reschedule a work block and verify the deadline stays the same. Edit the deadline and verify its reminder is replaced. Complete the task and verify pending reminders are canceled. |
| A-08 · GitHub import and sync | Assign yourself an issue in an authorized repository and confirm it appears once on both devices. Import the same URL and verify there is still one task. Schedule the task, close the issue on GitHub, and verify the app flags it while preserving the schedule. Complete the local task and verify the weekly review records it. Remove repository access and verify cached source metadata is removed when the app detects revocation. |
| A-09 · Review and usage gaps | Confirm task-quality review and add a workout photo. Verify the workout entry syncs while the photo stays local by default. Revoke usage access and verify the affected period appears as incomplete or unavailable. |
| A-10 · Offline changes | Edit the same task field on both devices while offline, reconnect, and verify the app presents both values. Delete a task on one device and ensure an offline copy cannot restore it on reconnect. |
| A-11 · Block rules | Create a scheduled **Block** rule and an always-on **Pause** rule. Verify the Block rule applies only in its window, including a window that crosses midnight, and reopens access at its end. On the Pause rule, wait out the countdown, take a pass, and verify the site pauses again when the pass expires. Start a focus session and verify that focus sites are blocked despite a pass. Disable a rule and verify it keeps applying until the change delay ends. Cancel a pending change and verify the rule stays. Close the desktop app and verify the rules still apply. Verify the weekly review shows pauses, passes, and reasons separately from focus blocking. |
| A-12 · Allowed apps | Create a **Block** preset allowing VS Code and Claude Desktop and start a manual session with it. Verify both apps work, and that bringing another app to the front, including one opened before the session, minimizes it and shows the intervention without closing it. Verify Explorer, Settings, Task Manager and open and save dialogs stay usable. Edit the preset during the session and verify the running session keeps its list; restart the app and verify the same. Repeat with **Pause**: wait out the countdown, take a pass, and verify the app pauses again when the pass expires and that blocked websites still offer no continue. Run a blocked app as administrator and verify partial coverage is shown. |

## 10. Implementation sequence and open validation

1. Validate Windows sign-in and Chrome blocking. In parallel with that implementation phase, validate Android usage and app interruption on the actual POCO device. Treat Android blocking as unverified until A-03 passes.
2. Build Today, the task inbox, commitments, deadlines, reminders, and device sync.
3. Integrate GitHub issue import, Google Calendar, and the approval-based AI assistant.
4. Deliver the weekly dashboard, Android usage alerts, and manual and photo-backed workout tracking. Add Edge compatibility testing after the Chrome baseline.
5. Evaluate a permitted Strava activity display and iPhone focus support. Validate individual Screen Time authorization and the distribution entitlement before committing to equivalent iPhone blocking. [Apple Screen Time API](https://developer.apple.com/videos/play/wwdc2022/110336/) · [Apple Family Controls entitlement](https://developer.apple.com/documentation/xcode/configuring-family-controls)

| Open item | How it will be resolved |
|---|---|
| Exact Android model and version | Verify **Settings → About phone** on the pilot device. The supplied build is consistent with a POCO X6 Pro 5G on Android 14. [Xiaomi device FAQ](https://www.mi.com/global/support/faq/details/KA-90062/) |
| Android blocking reliability | Run A-03 on the private install and record the permission, launch path, battery mode, and outcome. |
| Configurable defaults | The user chooses focus duration, distractions, working hours, calendar sources, GitHub repositories, and reminder device during setup. |
| App limit detection | Validate foreground-window detection and minimizing on the pilot PC, in the Electron app with a native helper or in the planned .NET app, including apps running as administrator and full-screen apps. |
| Block rule defaults | The 15-second countdown, 10-minute pass, and 10-minute change delay are proposed defaults to adjust after pilot use. |
| Integration choices to validate | The dedicated Google calendar, assigned-issue auto-import, local-only photos, and pilot performance targets are proposed first-release defaults. |
