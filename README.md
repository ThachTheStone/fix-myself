# Fix Myself

A local-first planner and focus timer for Windows 11 and Android. Set a mission, capture tasks into an inbox, commit to outcomes, schedule work blocks around deadlines, get reminders, and bring your next action into view when a focus session blocks a site in Chrome. A weekly review shows delivered commitments and workouts. See the [software requirements](SRS.md) for the full product scope.

## Project context

- [Agent guide](AGENTS.md)
- [Current architecture and proposed stack](docs/ARCHITECTURE.md)
- [Development and handoff workflow](docs/WORKFLOW.md)
- [Device acceptance checklist](docs/ACCEPTANCE.md)
- [Multi-agent workflow](docs/MULTI_AGENT.md): worker roles, brief template, `scripts/dispatch-cline.sh`, and the [run log](docs/agent-runs.md)
- [Android status and plan](docs/ANDROID.md) and [Supabase setup for account sync](docs/SUPABASE.md)

## Run the planner

Use Node.js 22.12 or later in the Node 22 series, or Node 24.

```sh
npm ci
npm run dev
```

The browser preview supports the planner and a local timer. For the Windows sign-in controls and Chrome pairing, run `npm run desktop` on Windows. Run `npm run desktop:package` on Windows to create the installer in `release/`.

VS Code's integrated terminal sets `ELECTRON_RUN_AS_NODE=1`, which stops Electron from opening a window. Run the desktop app from another terminal, or clear the variable first (`Remove-Item Env:ELECTRON_RUN_AS_NODE` in PowerShell).

On Windows, closing the window keeps Fix Myself running in the notification area so reminders and Chrome blocking continue. Choose **Quit Fix Myself** from the notification area icon to exit, or turn off **Keep running in the notification area** in Settings.

## Adding tasks

In **+ Add task**, choose **Save task** to add it quickly, or **Save and add details** to open the new task straight away with the cursor in **Next step**. After **Capture** on the Tasks page, follow **Add details →**. Select any task title in a list to open it.

## Language

Choose **English** or **Tiếng Việt** in **Settings → Language**. The change applies immediately and is remembered on that device. On first launch the app follows the system language. The Chrome extension and the Windows notification-area menu are still English only.

## Windows and Chrome setup

1. In the desktop app, add a task to Today and open **Settings**. Choose your duration and domains. To start focus automatically, enable both **Open Today when I sign in to Windows** and **Start focus on the first sign-in each day**.
2. In the Chrome profile you use, open `chrome://extensions`, enable **Developer mode**, and choose **Load unpacked**. Select the repository's `extension/` folder.
3. From **Settings → Pair Chrome** in the desktop app, copy the pairing code. Open the **Fix Myself Focus** extension and paste the code. The extension uses website permissions to find open tabs and redirect the selected sites in this profile.
4. Start focus from Today. Chrome checks for new sessions every 30 seconds. Choose **Check connection** in the extension to refresh immediately. During focus, blocked pages show your next action. After expiry, reload or follow **Open site** to return to the site. Choose a task for the session, or **No task (wandering)**, before you start. During a session you can **Pause** and **Resume** time recording or choose **End session**, which stops recording and app limits but keeps the sites blocked until the original end time. Focus time appears on the task and in the weekly review. On Windows, turn on **Floating timer** under the focus panel to show the time left and the task name in a small window on top of other apps; drag it to move it, or choose **Let clicks pass through**. It also opens from the notification area icon and closes when the session ends.

Pairing uses an authenticated loopback connection. The desktop app shares the active session's end time, domain list, and the next task title. An already received session remains usable if the desktop app closes.

Each paired profile reports back the days it was running and a daily count of blocked visits per domain. It sends no URLs, page content or browsing history. **Settings → Pair Chrome** lists each profile as covered or unavailable, and **Review** shows blocked attempts by site, marks days with no report, and compares with the previous week only when both weeks are fully covered. Name a profile in the extension popup so you can tell profiles apart. If a profile runs an older unpacked extension than the app ships, Settings and Today warn you to press **Reload** on Fix Myself in `chrome://extensions`.

## Child tasks

A task can have child tasks, up to 5 levels deep and 50 children per task. Open a task and use **Add child task**, or choose a **Parent task** to move it. The Tasks page shows children indented under their parent, with a button to collapse them. A parent can be completed or canceled only when everything beneath it is done, and reopening a child reopens its closed parents. A task page shows its parents, its children with their progress, and the focus time of the task and everything beneath it. A task with an open child task can be made strict without subtasks or criteria. If a sync leaves a parent missing or two devices move tasks into a loop, the app reads the broken link as top level and changes no data.

## Strict work blocks

A work block can be marked **Strict** when the task has subtasks, completion criteria or an open child task. When it starts, Fix Myself holds a focus session on that task: no Pause, End session or task change. If the task is still open at the end, the hold extends in 15-minute steps up to twice the block's length. **Emergency exit** asks for a 2-minute wait and a reason. Removing strict, shortening or moving a block later waits for the change delay in Settings. The weekly review lists how each strict block ended.

## Calendar

Open **Calendar** to see work blocks in a week grid (Monday first) or a day grid, with a "now" line, deadlines marked as "Due: ..." lines, and a tag on strict blocks and on blocks with a change waiting. On Windows and in the browser preview, drag a block to move it (across days in week view), drag its bottom edge to change its length, or drag over empty time (or click an empty slot for an hour) to add a block for a task. Times snap to 15 minutes, and Escape cancels a drag. Edits go through the same rules as the task page, so a strict block that is already running changes only after the change delay. Android shows the grid but cannot edit it. Deadlines never move.

## Block rules

**Settings → Block rules** keeps sites closed outside focus sessions. Name a rule, list its sites as domains (one per line, up to 30), and choose a schedule: **Always**, or **Scheduled** with time windows on the days you pick. Times follow the planning time zone, and a window that crosses midnight belongs to the day it starts. Under **When a listed site opens**, **Block it** sends the page straight to the intervention page, while **Pause, then allow a pass** counts down first and then opens a pass for a few minutes.

A weaker change — turning a rule off, removing sites, shortening a window, switching from Block to Pause, a longer pass, or changing the planning time zone while rules or strict blocks depend on it — waits for **Wait before a weaker change applies** (10 minutes by default, or up to the start of the next day). The saved rule keeps running, the edit shows under **Waiting to apply**, and **Cancel** drops it. Strengthening changes apply at once, and a longer wait applies immediately while a shorter one also waits.

The extension evaluates the schedules itself on a 30-second alarm, so a rule still applies when the desktop app is closed or Chrome starts without it. **Review** lists, per site, how many visits a rule blocked or paused and how many passes you took, with the busiest hours and the reasons you entered for passes. Those counts stay separate from focus-session attempts.

## App presets

**Settings → App presets** (Windows desktop app) names a list of apps for a kind of work, such as VS Code and Claude Desktop for a coding session. Refresh the open apps, add each one by name, and choose **Block** or **Pause** with its own countdown and pass. A preset holds up to 30 apps, up to 10 presets fit, and Windows' own shell — File Explorer, Settings, Task Manager and similar — is never part of a preset.

Starting focus from Today lets you pick a preset or **No app limit**, with your last choice preselected. **Preset for automatic sessions** chooses what a focus session started at sign-in uses, and stays **No app limit** until you set it. The app copies the preset when the session starts, so editing a preset only affects sessions that start later. Presets travel in sync files.

During a session with a preset, Fix Myself watches which window is in front. When an app outside the preset comes to the front, it is minimized (never closed) and Fix Myself explains why, with the allowed apps, the end time and your next action. With **Pause**, you can continue after the countdown and get a pass for that app; with **Block**, there is no way through until the session ends. File Explorer, Settings, Task Manager, sign-in and security prompts, accessibility tools and Fix Myself itself are always allowed. Fix Myself must be running; if it cannot limit a window (for example an app running as administrator), Today says so. The Review page lists apps that were stopped, paused or let through, with the reasons you gave. Only the app name, path and time are recorded on this PC, never window titles.

## Task workspace

A task keeps the websites, files, folders and Windows apps you use to work on it. Open a task and use **Workspace**: add a website by its link (http or https, up to 20 items in total), and in the Windows app add a file or folder with the system picker or an app from the list of open windows. **Open workspace** opens everything at once, without closing anything that is already open. It also sits on Today beside "Working on" while a task session runs. Nothing opens by itself.

Websites travel in sync files. Files, folders and apps stay on the computer that added them, and other devices do not list them. A site covered by the focus list or an active block rule is kept but not opened; the app names the list or rule and links to Settings. The apps of a task's workspace are allowed during that task's session on top of its app preset, and the app copies them when the session starts.

## Reminders and sync

Each task can remind you before its work blocks and its deadline. Set lead times, the planning time zone and which device receives reminders in **Settings → Planning and reminders**. Due reminders also appear on Today, where you can snooze or dismiss them.

- **Windows:** reminders appear while the app is running. Reminders missed while it was closed are grouped when it opens.
- **Android:** reminders are scheduled with the OS and arrive while the app is closed. Allow notifications in Settings. If Android reports approximate timing, choose **Allow exact timing**.
- **Browser preview:** reminders appear only while the page is open.

To move your plan between devices, choose **Download sync file** or **Copy sync data** in **Settings → Devices and sync**, then merge it on the other device. Merges go field by field. When both devices changed the same field, Settings asks which value to keep. Deleted tasks stay deleted. Workout photos stay on the device that added them.

## Account sync

**Settings → Account sync** keeps your plan in step across devices through your own Supabase project. Set the project up first; the steps are in [docs/SUPABASE.md](docs/SUPABASE.md). Then paste the project URL and the anon or publishable key (never the secret key), choose **Save connection**, enter your email and **Send code**, and type the code from the email under **Code**. If the project cannot edit its email templates, paste the sign-in link from the email instead of opening it.

If the account already has a plan, the app asks before replacing this device's plan and saves a copy first. The panel keeps the last 5 copies; **Restore** merges a copy into the current plan (it does not replace it) and **Download** saves it as a file. If you sign in to a different, empty account, the app offers to upload this device's plan to it. **Delete all my data** erases the account copy too while you are signed in. On Windows the session is stored encrypted; on Android it stays in the app's local storage for now. This has not yet been tried against a real Supabase project.

## Android pilot

Install Android Studio with the Android 36 SDK and JDK 21. Run `npm run android:open` to build the shared web assets and open the native project. Use Android Studio's **Run** action with a connected Android device, or build a debug APK from the command line.

```sh
npm run android:sync
cd android
./gradlew assembleDebug
```

On Windows use `gradlew.bat assembleDebug`. The APK is written to `android/app/build/outputs/apk/debug/app-debug.apk` from the repository root. The Android build includes the planner, timer and OS-scheduled reminders. Tasks are stored per device and move between devices with sync files.

## Verify

```sh
npm test
npm run build
npx playwright-core install chromium
npm run test:browser
```

The extension tests use Playwright’s Chromium. To use another extension-capable Chromium build, set `FIX_MYSELF_CHROMIUM` to its executable. The extension test uses the desktop bridge's port, so close the desktop app before running it.

The SRS tracks the next milestones for network device sync, Google Calendar, GitHub issue import, AI approvals, Android usage and app blocking, and distraction reporting. [Architecture](docs/ARCHITECTURE.md) lists the implementation status of each requirement.
