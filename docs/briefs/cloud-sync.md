# Task: Account sync engine for Supabase (SYS-02, SYS-05, SYS-06), part 1 of 3

Part 1 is this engine. Part 2 is desktop session storage, in `cloud-sync-secrets.md`. Part 3, the UI and wiring, comes
after part 1 merges. This brief was revised after a critique (M1 to M9); every decision below is final.

## Goal
`app/cloud-sync.js` keeps a device's plan and the account's server copy in step. It does not depend on the DOM and is
fully tested with a fake Supabase client. `mergeSync` stays the only place values are decided.

## Read first
- `AGENTS.md`, `docs/MULTI_AGENT.md` ("Quy tắc bắt buộc cho worker").
- `SRS.md`: SYS-01 to SYS-06, A-10. `docs/SUPABASE.md`. `docs/ARCHITECTURE.md` "Đồng bộ qua Supabase".
- `supabase/migrations/001_sync_docs.sql`:
  - The table `sync_docs(user_id, payload, rev, updated_at)`.
  - The RPC `push_sync_doc(expected_rev, new_payload)`. It returns the new rev, or `null` when another device wrote
    first.
  - The RPC `server_now()`.
- `app/model.js`: `exportSync`, `validatePayload`, `mergeSync` (including the "came from this device" throw, `peers`,
  `conflicts`), `resolveConflict`, `eraseUserData`, `SYNC_FORMAT`, `ROOT_FIELDS`.

## Decisions already made

**Model changes allowed** (the only `mergeSync` changes in this task)
- `export const SYNC_SCHEMA = 2;`. `exportSync` adds `schema: SYNC_SCHEMA` to the payload. `validatePayload` accepts
  a missing `schema` (old files) or an integer. It does not reject a higher schema; the engine handles that.
- `mergeSync(state, payload, ctx)` gains two opt-in flags:
  - `ctx.allowOwn === true` skips the "This sync file came from this device." throw and leaves `peers` unchanged.
  - `ctx.preferRemoteRoot === true` treats every local root stamp as empty for this merge, so the remote copy wins
    every `ROOT_FIELDS` value. Tasks and workouts merge as usual.
- After any merge, drop local `conflicts` entries whose two stamps both appear in the merged record's `supersedes` for
  that field. That means another device already resolved them.
- **Deterministic ties.** `mergeSync` breaks these ties the same way on every device, so two devices reach the same
  data:
  - `completedAt` takes the earliest non-null value;
  - `originalDeadline` takes the earliest non-null value;
  - a workout present on both sides with equal `updatedAt` takes the copy whose canonical JSON is greater.

  This is needed for a fixed point.
- **New `export function clearSyncedData(state)`.**
  - It resets exactly the fields `exportSync` writes: mission, next action, settings except the device-local ones
    already kept by `eraseUserData`, block rules, pending rule changes, app presets, pending block changes, tasks,
    workouts, focus segments, strict log, stamps, supersedes, deleted, devices and peers. It also resets `conflicts`.
  - It keeps every device-local field unchanged: `focus`, `chrome`, `appActivity`, `lastLoginDay`, `reminders` (then
    run `reconcileReminders`), `preferences`, and anything else not exported.
  - If `focus.taskId` no longer exists, set it to `null`. A strict hold on a removed task is cleared by `tickStrict`'s
    existing missing-task path.
- **Plain erase.** `eraseUserData` (the existing local erase, SYS-05) throws `'Erase after the focus session ends.'`
  while `isFocused(state.focus)` or a strict hold is active. That is the existing hole of ending a session early. Add
  it to `ERRORS_VI`.

**Engine API.** `createCloudSync({ client, store, getState, applyMerged, device, now, onStatus, saveBackup })`:
- `client` is a supabase-js client. Tests pass a fake with the same call shapes:
  - `auth.getSession()`;
  - `from('sync_docs').select(cols).eq('user_id', uid).maybeSingle()`;
  - `rpc(name, args)`;
  - `channel(...).on('postgres_changes', ...).subscribe()`, plus `removeChannel`.
- `store` holds device-local engine memory with `get(key)` and `set(key, value)`, backed by `localStorage` in part 3.
  Keys:
  - `cloud.account`: the bound user id;
  - `cloud.lastSeenRev`;
  - `cloud.dirty`: `true` from `noteLocalChange` until a successful push or an equal compare;
  - `cloud.eraseSeen`: the `erasedAt` of the last erase marker acknowledged;
  - `cloud.mergePushes`: a counter for the loop guard.
- **Every export the engine pushes** is `exportSync(...)` plus `erasedAt: eraseSeen ?? null`. A marker is never lost
  just because a later normal push overwrote it.
- `applyMerged(state, info)` installs a merged state. Part 3 must install it without re-arming the change debounce.
  The engine only promises to call it.
- `saveBackup(payload)` stores a copy of the local export before a replace. Part 3 writes it as a downloadable sync
  file.
- Returned object:
  - `start()`, `stop()` (returns a promise that waits for any running sync), `syncNow()`;
  - `noteLocalChange()`, which part 3 calls after a user edit and which debounces 3 s;
  - `chooseLink(choice)` and `chooseErase(choice)`, for the prompts below;
  - `status()`.

**Account binding** (M3, M4)
- On `start()` and after sign-in, read the session user id.
- **Same account.** If the bound id equals it, sync normally.
- **No bound id**, a fresh device or the first link:
  - If the server row does not exist, bind and push this device's plan with `expected_rev: 0`.
  - If the row exists, the default is replace. Emit status `link-needed` with
    `{ email, serverHasData: true, localHasData }`, where `localHasData` means any task, rule, preset or workout
    exists. Sync stays paused until `chooseLink`:
    - `'replace'` (default): `saveBackup(exportSync(local))`, then build the new state by
      `mergeSync(clearSyncedData(local), remotePayload, { ...ctx, allowOwn: true, preferRemoteRoot: true })`.
      Device-local fields, including a running focus session and its strict hold, survive (FOC-04). Then
      `applyMerged`, bind, record `lastSeenRev`, and set `eraseSeen = payload.erasedAt ?? null`. Part 3 calls
      `registerDevice` after the apply.
  - A row whose payload is an erase marker counts as an empty account: bind without asking, set `eraseSeen`, and push
    this device's plan.
    - `'cancel'`: sign-out is left to the UI. The engine stays paused.
  - If `localHasData` is false, apply `'replace'` without asking.
- **Bound to a different id.** Sync never runs and nothing is read or written for the new account until the user
  chooses. The status is `account-changed` with the same choices, and `'replace'` is again the default. A test
  asserts that no `rpc` call happens before the choice.
- Rebinding resets `peers` for the account, and resets the `lastSeenRev`, `dirty`, `eraseSeen` and `mergePushes`
  keys.

**`syncOnce()`.** It runs only when bound and signed in. Only one run happens at a time; a call during a run sets a
"run again" flag.
1. **Cheap read** (M2): select `rev` only. If `rev === lastSeenRev` and `dirty` is false, stop with status `synced`.
   `dirty` is stored, so an offline edit followed by a restart is still uploaded.
2. **Full read**: select `payload, rev`.
3. **Erase marker** (M5): the payload has a non-null `erasedAt` and `erasedAt !== eraseSeen`. Emit status `erased`
   with `{ deviceName, erasedAt }`, stop, and never push until `chooseErase`. This also catches a device that was
   offline while the marker was later overwritten by normal pushes, because those pushes carry `erasedAt` too.
   - `'erase-here'`: `applyMerged(clearSyncedData(state))`, keeping device-local fields. Set `eraseSeen`. Do not push.
   - `'upload-again'`: set `eraseSeen`, then push this device's export with the current rev as `expected_rev`.
4. **Newer schema**: when `payload.schema > SYNC_SCHEMA`, set status `error` with code `update-app`. Never push.
5. **Merge**, always, including a payload this device wrote (M6): call
   `mergeSync(getState(), payload, { ...ctx, allowOwn: true })` and hand the result to `applyMerged` when it differs.
   Merging is idempotent, so a crash or an outside state replacement can never push older data over newer.
   - A payload that fails `validatePayload` sets status `error` with code `bad-remote`, keeps the message, and never
     pushes.
6. **Push only on difference** (M1). Compare `canonical(export.data)` with `canonical(payload.data)`, plus
   `erasedAt`:
   - Sort the top-level collections (`tasks`, `workouts`, `focusSegments`, `strictLog`, `blockRules`, `appPresets`,
     `pendingRuleChanges`, `pendingBlockChanges`) and each task's `events` by `id`.
   - Never reorder arrays inside a field such as `subtasks`, `workBlocks` or `links`. Their order is user data.
   - Sort object keys recursively, and leave out `devices[*].lastSeenAt`.

   If they are equal, record `lastSeenRev = rev`, clear `dirty`, reset `mergePushes`, set status `synced`, and do not
   push. Otherwise call `rpc('push_sync_doc', { expected_rev: rev, new_payload: export })`.
   - A `null` result goes back to step 2. Allow at most 3 attempts, then status `error` with code `busy`.
   - On success, set `lastSeenRev = newRev` and clear `dirty`.
   - **Loop guard.** A push while `dirty` was false is a merge-only push and increments `mergePushes`; a push while
     dirty resets it. Above 3, set status `error` with code `loop` and stop pushing until the next local change.
7. **No row** (a deleted account copy) while bound: push with `expected_rev: 0`.

**Triggers**
- `start()`;
- `noteLocalChange()`, debounced 3 s;
- `online`;
- `visibilitychange` to visible, and app resume (part 3 forwards these to `syncNow`);
- every 5 minutes;
- any Realtime event on `sync_docs` with the filter `user_id=eq.<uid>`, for INSERT and UPDATE only.

There is no rev-based echo suppression. The cheap read in step 1 makes an echo cost one small query.

**Erase here** (`eraseEverywhere(state)`, called by part 3 instead of a plain erase while signed in)
1. `await stop()`.
2. Push the marker `{ format, version: 1, schema, deviceId, deviceName, exportedAt, erasedAt: now, data:
   emptyData }` through `push_sync_doc`, retrying the CAS like step 6. `emptyData` is the export of
   `clearSyncedData(state)`.
3. Only after success, in this order:
   - the engine calls `applyMerged(clearSyncedData(state))` itself;
   - it sets `eraseSeen = erasedAt`, `lastSeenRev` to the marker's rev, and `dirty = false`;
   - then it calls `start()`.

   This keeps the old plan from going back up over the marker.
4. On failure, throw and change nothing locally.
5. Refuse with `'Erase after the focus session ends.'` while a session or strict hold is active, as in the plain
   erase.

**Statuses** passed to `onStatus`:
- `signed-out`
- `link-needed`
- `account-changed`
- `syncing`
- `synced` (`{ at }`)
- `offline`, when a fetch `TypeError` happens or `navigator.onLine === false`
- `error` (`{ code, message }`). The codes are `bad-remote`, `update-app`, `busy`, `server` and `paused`. Use
  `paused` when HTTP 5xx or 540 errors last for more than 1 hour while online.
- `erased`
- `clock-skew` (`{ minutes }`): a warning that comes with `synced`, raised when `server_now()` differs from
  `now()` by more than 2 minutes. Check it once per `start()`.

## Steps
1. Model flags, `SYNC_SCHEMA`, and conflict cleanup, with tests in `tests/model.test.js`.
2. `app/cloud-sync.js` with `canonical()` exported for tests.
3. `tests/cloudsync.test.js` uses a fake client and two simulated devices that share one fake server. Cover:
   - The fixed point: after an edit on A, A and B converge within 2 pushes in total and then stay idle across 5 more
     triggers each.
   - An echo arriving before the RPC result does not push.
   - A first link with no row binds and pushes at rev 0.
   - A first link with a row: `link-needed`; `replace` gives the remote `blockRules` even when the local stamp is newer
     (the M4 regression), and `saveBackup` is called.
   - Account change: no `rpc` before the choice, and `peers` resets.
   - Own payload holding a task missing locally, for example after a crash or an outside state replacement: after sync
     the task is local and on the server (M6).
   - Replace or erase-here while a focus session and a strict hold run: `focus` and `chrome` are unchanged afterwards.
     A plain erase during a session throws.
   - Erase durability: a marker, then a normal push from A carrying `erasedAt`, then a device C that was offline the
     whole time. C gets `erased` and does not push. A first link onto a marker row binds without asking.
   - `eraseEverywhere`: after it resolves, the next trigger does not push the old plan.
   - Fixed point with ties: two devices complete the same task offline at different times and converge within 2
     pushes. The loop guard trips after 3 merge-only pushes when a non-converging fake merge is injected.
   - `dirty` survives a restart: an offline edit, a new engine instance, then `start()` pushes.
   - CAS conflict: retried and succeeding; 3 failures give `busy`.
   - A bad remote payload or a newer schema: no push.
   - An erase marker: `erased`, no push until a choice. `erase-here` and `upload-again` behave as above.
     `eraseEverywhere` failing leaves the local state untouched.
   - Concurrent `syncNow` calls are coalesced. `stop()` waits for a running sync.
   - Offline versus server error statuses, and the paused detection with a fake clock.
   - The clock-skew warning.
4. `docs/ARCHITECTURE.md`: replace the Supabase section's flow with this one, including binding, push-on-difference,
   the erase marker and `SYNC_SCHEMA`.

## Out of scope
UI, supabase-js installation, CSP, and secrets IPC (part 2, already merged). No `mergeSync` change beyond the two
flags, the conflict cleanup and the deterministic ties.

## Tests that define "done"
- The tests in steps 1 and 3; existing suites pass.
- Commands: `npm test`, `npm run build`, `git diff --check`.
- No network. Do not start Electron.

## Commit
- Branch `agent/cloud-sync-engine`. Trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Commit before you finish. Do not push.

## Hard rules
Follow `docs/MULTI_AGENT.md` → "Quy tắc bắt buộc cho worker". Do not change `SRS.md`. Never put a real project URL, key
or email anywhere. If a decision seems wrong or two decisions conflict, stop and say so.

## Finish with
Files, exact results, `git log --oneline -3`, open questions.
