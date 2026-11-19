# Fix Myself

A local-first planner and focus timer for Windows 11 and Android. The first working slice lets you set a mission, capture and prioritize tasks, and bring your next action into view when a focus session blocks a site in Chrome. See the [software requirements](SRS.md) for the full product scope.

## Project context

- [Agent guide](AGENTS.md)
- [Current architecture and proposed stack](docs/ARCHITECTURE.md)
- [Development and handoff workflow](docs/WORKFLOW.md)

## Run the planner

Use Node.js 22.12 or later in the Node 22 series, or Node 24.

```sh
npm ci
npm run dev
```

The browser preview supports the planner and a local timer. For the Windows sign-in controls and Chrome pairing, run `npm run desktop` on Windows. Run `npm run desktop:package` on Windows to create the installer in `release/`.

## Windows and Chrome setup

1. In the desktop app, add a task to Today and open **Settings**. Choose your duration and domains. To start focus automatically, enable both **Open Today when I sign in to Windows** and **Start focus on the first sign-in each day**.
2. In the Chrome profile you use, open `chrome://extensions`, enable **Developer mode**, and choose **Load unpacked**. Select the repository's `extension/` folder.
3. From **Settings → Pair Chrome** in the desktop app, copy the pairing code. Open the **Fix Myself Focus** extension and paste the code. The extension uses website permissions to find open tabs and redirect the selected sites in this profile.
4. Start focus from Today. Chrome checks for new sessions every 30 seconds. Choose **Check connection** in the extension to refresh immediately. During focus, blocked pages show your next action. After expiry, reload or follow **Open site** to return to the site.

Pairing uses an authenticated loopback connection. The desktop app shares the active session's end time, domain list, and the next task title. An already received session remains usable if the desktop app closes.

## Android pilot

Install Android Studio with the Android 36 SDK and JDK 21. Run `npm run android:open` to build the shared web assets and open the native project. Use Android Studio's **Run** action with a connected Android device, or build a debug APK from the command line.

```sh
npm run android:sync
cd android
./gradlew assembleDebug
```

On Windows use `gradlew.bat assembleDebug`. The APK is written to `android/app/build/outputs/apk/debug/app-debug.apk` from the repository root. The Android build includes the local planner and timer. Tasks are stored per device.

## Verify

```sh
npm test
npm run build
npx playwright-core install chromium
npm run test:browser
```

The extension tests use Playwright’s Chromium. To use another extension-capable Chromium build, set `FIX_MYSELF_CHROMIUM` to its executable. The extension test uses the desktop bridge's port, so close the desktop app before running it.

The SRS tracks the next milestones for reminders, Google Calendar, GitHub issue import, AI approvals, device sync, Android usage and app blocking, and the weekly dashboard.
