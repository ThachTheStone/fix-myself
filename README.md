# Fix Myself

A local-first planner and focus timer for Windows 11 and Android. Set a mission, capture tasks into an inbox, commit to outcomes, schedule work blocks around deadlines, get reminders, and bring your next action into view when a focus session blocks a site in Chrome. A weekly review shows delivered commitments and workouts. See the [software requirements](SRS.md) for the full product scope.

## Project context

- [Agent guide](AGENTS.md)
- [Current architecture and proposed stack](docs/ARCHITECTURE.md)
- [Development and handoff workflow](docs/WORKFLOW.md)
- [Device acceptance checklist](docs/ACCEPTANCE.md)

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
4. Start focus from Today. Chrome checks for new sessions every 30 seconds. Choose **Check connection** in the extension to refresh immediately. During focus, blocked pages show your next action. After expiry, reload or follow **Open site** to return to the site.

Pairing uses an authenticated loopback connection. The desktop app shares the active session's end time, domain list, and the next task title. An already received session remains usable if the desktop app closes.

Each paired profile reports back the days it was running and a daily count of blocked visits per domain. It sends no URLs, page content or browsing history. **Settings → Pair Chrome** lists each profile as covered or unavailable, and **Review** shows blocked attempts by site, marks days with no report, and compares with the previous week only when both weeks are fully covered. Name a profile in the extension popup so you can tell profiles apart.

## Reminders and sync

Each task can remind you before its work blocks and its deadline. Set lead times, the planning time zone and which device receives reminders in **Settings → Planning and reminders**. Due reminders also appear on Today, where you can snooze or dismiss them.

- **Windows:** reminders appear while the app is running. Reminders missed while it was closed are grouped when it opens.
- **Android:** reminders are scheduled with the OS and arrive while the app is closed. Allow notifications in Settings. If Android reports approximate timing, choose **Allow exact timing**.
- **Browser preview:** reminders appear only while the page is open.

To move your plan between devices, choose **Download sync file** or **Copy sync data** in **Settings → Devices and sync**, then merge it on the other device. Merges go field by field. When both devices changed the same field, Settings asks which value to keep. Deleted tasks stay deleted. Workout photos stay on the device that added them.

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
