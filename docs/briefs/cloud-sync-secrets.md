# Task: Protected storage for the Supabase session on Windows (SYS-03), part 2 of 3

## Goal
The desktop app keeps the Supabase session tokens encrypted with Windows user protection (Electron `safeStorage`), not
in `localStorage`. Part 3 will pass this as supabase-js `auth.storage` on Windows.

## Read first
- `AGENTS.md`, `docs/MULTI_AGENT.md` ("Quy tắc bắt buộc cho worker").
- `SRS.md`: SYS-03.
- `desktop/main.cjs` (`registerHandlers`, `fromApp`), `desktop/preload.cjs`, and `desktop/workspaces.cjs` as an example
  of an injectable module with its tests in `tests/workspaces.test.js`.

## Decisions already made
- New `desktop/secrets.cjs`, a factory `createSecrets({ safeStorage, fs, filePath })` with async `get(key)`,
  `set(key, value)` and `remove(key)`.
  - **Keys** must match `^sb-[A-Za-z0-9._-]{1,124}$`. **Values** are strings of at most 65,536 characters. Anything
    else throws `'Invalid secret request.'`
  - **File.** `filePath` is `join(userData, 'secrets.json')` and holds a JSON object mapping each key to its base64
    `safeStorage.encryptString(value)`. A missing file reads as `{}`. A corrupt file, or an entry that fails to
    decrypt, reads as missing for that key. Never throw on a bad file.
  - **Writes.** Write to `secrets.json.tmp`, then rename. Serialise every operation through one promise chain, so a
    `set` racing a `remove` cannot lose data.
  - **Encryption unavailable.** When `safeStorage.isEncryptionAvailable()` is false, `set` throws
    `'Protected storage is unavailable on this computer.'`, while `get` and `remove` still work. Never write plain text.
  - At most 50 keys.
- **IPC.** Register `desktop:secret-get`, `desktop:secret-set` and `desktop:secret-remove` in `registerHandlers`,
  Windows only, behind `fromApp`, each validating its arguments.
- **Preload.** Expose `secretGet(key)`, `secretSet(key, value)` and `secretRemove(key)`, which return promises. This
  matches the async storage adapter shape supabase-js accepts.
- No UI and no renderer wiring in this task.

## Steps
1. `desktop/secrets.cjs`, with tests in a new `tests/secrets.test.js` using a fake `safeStorage` (reversible encoding)
   and an in-memory fs. Cover:
   - round trip and remove;
   - key and value validation;
   - the 50-key limit;
   - a corrupt file and an undecryptable entry;
   - encryption unavailable;
   - a concurrent `set` and `remove` serialised;
   - a temp file followed by a rename.
2. IPC handlers and preload.
3. `docs/ARCHITECTURE.md`: the desktop row mentions `secrets.json` (encrypted session, `sb-` keys only).

## Out of scope
Renderer code, supabase-js, Android, and any other secret such as the Chrome pairing code.

## Tests that define "done"
- `tests/secrets.test.js`; existing suites pass.
- Commands: `npm test`, `npm run build`, `git diff --check`.
- Do not start Electron.

## Commit
- Branch `agent/cloud-sync-secrets`. Trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Commit before you finish. Do not push.

## Hard rules
Follow `docs/MULTI_AGENT.md` → "Quy tắc bắt buộc cho worker". Do not change `SRS.md`. If a decision seems wrong, stop
and say so.

## Finish with
Files, exact results, `git log --oneline -3`, open questions.
