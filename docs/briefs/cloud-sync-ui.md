# Task: Account sync UI and wiring (SYS-02, SYS-03, SYS-05, SYS-06), part 3 of 3

## Goal
Settings gets an "Account sync" panel: connect to the user's Supabase project, sign in with an emailed code, see the
sync status, answer the link, account-change and erase prompts, and sign out. The app creates the Supabase client and
runs the engine from part 1 (`app/cloud-sync.js`). On Windows, the session goes through the encrypted storage from
part 2. Erasing while signed in uses the engine's erase marker.

## Read first
- `AGENTS.md`, `docs/MULTI_AGENT.md` ("Quy tắc bắt buộc cho worker").
- `docs/briefs/cloud-sync.md` (part 1): the engine API, statuses, error codes, `eraseEverywhere`, `chooseLink` and
  `chooseErase`. `app/cloud-sync.js` and its tests are the source of truth for exact names.
- `docs/SUPABASE.md`, `SRS.md` SYS-02 to SYS-06.
- Code:
  - `app/main.js`:
    - `applyState`, `attempt`, `ctx` and `device`;
    - `loadDevice` and `registerDevice`;
    - the "Devices and sync" handlers and the `erase-data` handler with `confirmTwice`;
    - `boot`, the `visibilitychange` listener and `translateError`.
  - `index.html`: the CSP meta and the `#sync` panel.
  - `desktop/preload.cjs`: `secretGet`, `secretSet` and `secretRemove`.
  - `app/i18n.js`.

## Decisions already made

**Dependency and CSP**
- Add `@supabase/supabase-js` to `dependencies`, pinned to a 2.x release recent enough to accept publishable keys,
  including for Realtime. Use the latest 2.x on npm and pin it exactly.
- In `index.html`, add `connect-src 'self' https://*.supabase.co wss://*.supabase.co` to the CSP and change nothing
  else.

**New `app/cloud.js`.** It must not depend on the DOM.
- `readCloudConfig(storage)` and `saveCloudConfig(storage, { url, anonKey })`, using the `localStorage` key
  `fix-myself:cloud`, which is device-local and never exported.
  - The URL must match `^https://[a-z0-9]{20}\.supabase\.co$`.
  - The key may be in either form:
    - a legacy anon key: three base64url parts separated by dots, under 1000 characters;
    - a new publishable key matching `^sb_publishable_[A-Za-z0-9_-]{10,200}$`.

    Projects created since 2025 may show only the publishable key. A secret key (`sb_secret_…`) or a `service_role`
    JWT must be refused with `'Use the publishable or anon key, never the secret key.'`. To spot a `service_role`
    JWT, decode the payload and check `role`.
  - Otherwise throw `'Check the project URL and key from Supabase → Project Settings → API.'`
- `sessionStorageFor(desktop, storage)`:
  - On Windows, when `desktop?.secretGet` exists, return `{ getItem: secretGet, setItem: secretSet, removeItem:
    secretRemove }`.
  - Otherwise return `localStorage` (known limit on Android).
- `createCloudClient(config, authStorage)` calls `createClient(url, anonKey, { auth: { storage: authStorage,
  persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } })`.
- `engineStore(storage)` maps the engine's `get`/`set` to `localStorage` keys prefixed `fix-myself:cloud:`.

**Wiring** (`app/main.js`)
- `applyState(next, { fromSync = false } = {})`.
  - When `fromSync` is false, call `engine?.noteLocalChange()` only if a synced field changed by reference. Export
    `SYNCED_KEYS` from the model with the keys `exportSync` reads: `mission`, `nextActionId`, `settings`,
    `blockRules`, `pendingRuleChanges`, `appPresets`, `pendingBlockChanges`, `focusSegments`, `strictLog`, `stamps`,
    `supersedes`, `tasks`, `workouts`, `deleted`, `devices`. Compare `prev[k] !== next[k]` for each. The model is
    immutable, so this is exact.
  - App events, focus ticks, strict ticks, reminders and Chrome reports never mark the plan dirty. Otherwise the loop
    guard never trips, and the 3-second debounce keeps restarting while the user works.
  - The engine's `applyMerged(state)` calls `applyState(registerDevice(state, { ...device, platform }), { fromSync:
    true })`. A `fromSync` apply never calls `noteLocalChange`.
- **Auth events** (`client.auth.onAuthStateChange`):
  - `INITIAL_SESSION` with a session, or `SIGNED_IN`, calls `engine.start()`. `start()` must be idempotent:
    supabase-js can emit `SIGNED_IN` again when a tab becomes visible.
  - `TOKEN_REFRESHED` does nothing.
  - `SIGNED_OUT` calls `engine.stop()` and sets status `signed-out`.
- **At boot.** When a config exists, create the client and the engine and register the auth listener.
- **Sign-out sequence**, used by Sign out, by Cancel on a link prompt, and by Change connection: `await engine.stop()`,
  then `await client.auth.signOut({ scope: 'local' })`. Never use the default global scope, which would sign out every
  device. Then set status `signed-out`.
- **Change connection** follows the sign-out sequence, then `client.removeAllChannels()`, drops the client, saves the
  new config, and creates a new client and engine. Keep the binding: a different project gives a different user id,
  so `account-changed` and its default replace-with-backup apply.
- **Triggers.**
  - `window` `online` calls `engine.syncNow()`.
  - The existing `visibilitychange`, when it becomes visible, calls `engine.syncNow()`.
- **saveBackup(payload).**
  - Store the JSON in IndexedDB, in the same database module pattern as `app/photos.js`, as a single record
    `cloud-backup`. Keep only the latest, and never put it in `localStorage`, which risks the 5 MB quota next to the
    state.
  - The engine must `await saveBackup` and abort the replace if it rejects, showing the error. Replacing is only safe
    once the backup exists.
  - The panel shows "A copy of this device's plan was saved before replacing it" with a "Download backup" button that
    reads the stored copy.
  - Both erase paths delete the backup record (SYS-05).

**Panel** (a new `<section id="cloud">` above `#sync` in Settings)
- **Not configured.** Show:
  - a help line, "Set up a Supabase project first; see docs/SUPABASE.md";
  - Project URL and anon key fields;
  - a "Save connection" button.
- **Configured, signed out, but bound to an account.** The erase button is blocked with "Sign in to erase this plan
  everywhere." Otherwise the account copy would come back at the next sign-in.
- **Configured and signed out.** Show:
  - an email field and a "Send code" button, which calls `signInWithOtp({ email, options: { shouldCreateUser: true }
    })`;
  - a code field (`inputmode="numeric"`, 6 to 10 digits) and a "Sign in" button, which calls `verifyOtp({ email,
    token, type: 'email' })`;
  - a "Change connection" link.
- **Signed in.** Show "Signed in as {email}", the status line, a "Sync now" button and a "Sign out" button. "Sign out"
  runs the sign-out sequence and keeps local data and the binding.
- **Status lines**, under `cloud.status.*`:
  - `syncing`: "Syncing…"
  - `synced`: "Up to date, synced {time}"
  - `offline`: "Offline. Changes are kept on this device."
  - `error`, one line per code:
    - `bad-remote`: "The account copy could not be read: {message}"
    - `update-app`: "Another device uses a newer version. Update this app."
    - `busy`: "Another device kept writing; trying again soon."
    - `server`: "Sync failed: {message}"
    - `paused`: "The Supabase project may be paused. Open the Supabase dashboard to resume it."
    - `loop`: "Sync stopped repeating itself. Make any change to try again."
  - `clock-skew`, shown in addition to the status: "This device's clock is {minutes} minutes off. Fix the clock so edits
    merge in the right order."
- **Prompts** (`role="alert"`, inside the panel, never as browser dialogs):
  - `link-needed` and `account-changed`:
    - Text: "This account already has a plan. Replace this device's plan with it? A copy of this device's plan is saved
      first."
    - Buttons: "Replace with the account's plan" (primary, calls `chooseLink('replace')`) and "Cancel" (calls
      `chooseLink('cancel')`, then signs out).
  - `erased`:
    - Text: "The plan was erased on {device} at {time}."
    - Buttons: "Erase here too" (`chooseErase('erase-here')`) and "Upload this device's plan again"
      (`chooseErase('upload-again')`).
- **Erase.** The existing `erase-data` handler, after `confirmTwice`:
  - When the engine is bound and signed in, call `await engine.eraseEverywhere(state)`. The engine applies the state
    itself. Then clear photos as today. On error, show it and change nothing.
  - Otherwise, keep the plain erase. It now throws during a focus session; show the translated error.
- Update `settings.dataHelp` (English and Vietnamese) to say that the plan also syncs to the user's own Supabase
  project when they sign in.
- New strings go under `cloud.` in English and Vietnamese. Supabase errors go through `translateError` with a fallback
  to the raw message.
- Never log tokens, keys or the session. Never put a real URL, key or email in code, tests or commits.

## Steps
1. `app/cloud.js` with tests in a new `tests/cloud.test.js`, using a fake `createClient` injected or wrapped:
   - config validation, covering the JWT key, a publishable key, and secret and `service_role` keys refused;
   - the storage adapter on desktop and elsewhere;
   - `engineStore` key prefixing.
   Put the testable wiring helpers in `app/cloud.js` rather than in `main.js`:
   - `shouldNoteChange(prev, next)` using `SYNCED_KEYS`;
   - an auth-event handler factory;
   - the sign-out and change-connection sequences, written against a fake client and engine.

   Tests:
   - `recordAppEvent`, a focus tick and a strict tick do not count as changes; a task edit does.
   - Two `SIGNED_IN` events give one engine start and one channel.
   - Sign-out uses `scope: 'local'` and stops the engine first.
   - After a change of connection, no call reaches the old client.
   - Erase removes the backup.
2. Wiring, the panel, the prompts and the erase flow.
3. A browser test in `tests/browser.e2e.js` that makes no network calls:
   - Open Settings and enter a bad URL; see the error.
   - Enter a well-formed fake config; the signed-out form appears.
   - Do not press Send code.
   - Expose a test-only hook, active only when `location.search` includes `cloudtest`, that feeds a fake engine status.
     Check that the `link-needed` prompt renders with "Replace with the account's plan" as the primary button.
4. Docs:
   - README "Account sync" section, which points to `docs/SUPABASE.md`.
   - `docs/ARCHITECTURE.md`: fix the line saying the session is not in `localStorage`, so it reflects Windows
     encrypted storage and the Android `localStorage` limit. Add the SYS-06 status row with "not yet tried against a
     real project".

## Out of scope
- Changes to `app/cloud-sync.js` logic (report needed changes instead), Google sign-in, Android secure storage, and
  per-table sync.
- Testing against a real Supabase project; the orchestrator does that with the user.

## Tests that define "done"
- `tests/cloud.test.js` and the browser test above; existing suites pass.
- Commands: `npm test`, `npm run build`, `git diff --check`,
  `node --test --test-skip-pattern="Chromium blocks" tests/browser.e2e.js`.
- No network. Do not start Electron. Do not run the Chromium extension test.

## Commit
- Branch `agent/cloud-sync-ui`. Trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Commit before you finish. Do not push.

## Hard rules
Follow `docs/MULTI_AGENT.md` → "Quy tắc bắt buộc cho worker". Do not change `SRS.md`. If a decision seems wrong or the
engine API differs from this brief, follow the engine's actual API and report the difference.

## Finish with
Files, exact results, `git log --oneline -3`, open questions.
