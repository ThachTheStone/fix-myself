import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addBackup, restoreBackup, restoreNeedsConfirm, changeConnection, CLOUD_KEY, createAuthHandler, createCloudClient, eraseAll, engineStore, parseSignInInput,
  readCloudConfig, saveCloudConfig, sessionStorageFor, shouldNoteChange, signOutSequence, validateCloudConfig
} from '../app/cloud.js';
import {
  captureTask, clearSyncedData, exportSync, mergeSync, readState, recordAppEvent, registerDevice, saveBlockRule, saveTask,
  setMission, settleFocus, startFocus, tickStrict
} from '../app/model.js';

const URL = 'https://abcdefghijklmnopqrst.supabase.co';
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const jwt = (role) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ role, iss: 'supabase' })}.c2lnbmF0dXJl`;
const PUBLISHABLE = 'sb_publishable_AbCdEfGhIjKlMnOp_1234';

function memory() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); },
    keys: () => [...map.keys()]
  };
}

test('a project URL with a legacy anon key or a publishable key is accepted', () => {
  assert.deepEqual(validateCloudConfig({ url: URL + '/', anonKey: jwt('anon') }), { url: URL, anonKey: jwt('anon') });
  assert.deepEqual(validateCloudConfig({ url: URL, anonKey: ` ${PUBLISHABLE} ` }), { url: URL, anonKey: PUBLISHABLE });
});

test('secret keys and service_role tokens are refused with their own message', () => {
  const secret = /never the secret key/;
  assert.throws(() => validateCloudConfig({ url: URL, anonKey: 'sb_secret_AbCdEfGhIjKlMnOp_1234' }), secret);
  assert.throws(() => validateCloudConfig({ url: URL, anonKey: jwt('service_role') }), secret);
});

test('a bad URL or key gives the check-your-settings message', () => {
  const check = /Check the project URL and key/;
  assert.throws(() => validateCloudConfig({ url: 'http://abcdefghijklmnopqrst.supabase.co', anonKey: PUBLISHABLE }), check);
  assert.throws(() => validateCloudConfig({ url: 'https://example.com', anonKey: PUBLISHABLE }), check);
  assert.throws(() => validateCloudConfig({ url: 'https://short.supabase.co', anonKey: PUBLISHABLE }), check);
  assert.throws(() => validateCloudConfig({ url: URL, anonKey: 'not a key' }), check);
  assert.throws(() => validateCloudConfig({ url: URL, anonKey: 'a.b.' + 'c'.repeat(1000) }), check);
  assert.throws(() => validateCloudConfig({ url: URL, anonKey: '' }), check);
});

test('the connection is saved under one device-local key and read back, or null when missing or damaged', () => {
  const storage = memory();
  assert.equal(readCloudConfig(storage), null);
  saveCloudConfig(storage, { url: URL, anonKey: PUBLISHABLE });
  assert.equal(CLOUD_KEY, 'fix-myself:cloud');
  assert.deepEqual(readCloudConfig(storage), { url: URL, anonKey: PUBLISHABLE });
  assert.throws(() => saveCloudConfig(storage, { url: 'nope', anonKey: PUBLISHABLE }));
  assert.deepEqual(readCloudConfig(storage), { url: URL, anonKey: PUBLISHABLE });
  storage.setItem(CLOUD_KEY, '{broken');
  assert.equal(readCloudConfig(storage), null);
});

test('the session goes through encrypted storage on Windows and localStorage elsewhere', async () => {
  const storage = memory();
  assert.equal(sessionStorageFor(undefined, storage), storage);
  assert.equal(sessionStorageFor({ platform: 'win32' }, storage), storage);
  const calls = [];
  const desktop = {
    secretGet: async (key) => { calls.push(['get', key]); return 'v'; },
    secretSet: async (key, value) => { calls.push(['set', key, value]); },
    secretRemove: async (key) => { calls.push(['remove', key]); }
  };
  const adapter = sessionStorageFor(desktop, storage);
  assert.equal(await adapter.getItem('k'), 'v');
  await adapter.setItem('k', 'x');
  await adapter.removeItem('k');
  assert.deepEqual(calls, [['get', 'k'], ['set', 'k', 'x'], ['remove', 'k']]);
});

test('the client is created with the auth options the app needs', () => {
  const seen = [];
  const authStorage = memory();
  const client = createCloudClient({ url: URL, anonKey: PUBLISHABLE }, authStorage, (...args) => { seen.push(args); return 'client'; });
  assert.equal(client, 'client');
  assert.deepEqual(seen[0], [URL, PUBLISHABLE, {
    auth: { storage: authStorage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
  }]);
});

test('the engine memory uses its own prefix and keeps value types', () => {
  const storage = memory();
  const store = engineStore(storage);
  assert.equal(store.get('cloud.dirty'), null);
  store.set('cloud.dirty', true);
  store.set('cloud.lastSeenRev', 7);
  store.set('cloud.account', null);
  assert.equal(store.get('cloud.dirty'), true);
  assert.equal(store.get('cloud.lastSeenRev'), 7);
  assert.equal(store.get('cloud.account'), null);
  assert.ok(storage.keys().every((key) => key.startsWith('fix-myself:cloud:')));
});

test('the sign-in field takes a code, or a link from this project', () => {
  assert.deepEqual(parseSignInInput(' 123456 ', URL), { kind: 'code', token: '123456' });
  assert.deepEqual(parseSignInInput('12345678', URL), { kind: 'code', token: '12345678' });
  assert.deepEqual(parseSignInInput(`${URL}/auth/v1/verify?token=abc123&type=magiclink&redirect_to=http://localhost`, URL),
    { kind: 'link', token_hash: 'abc123', type: 'magiclink' });
  assert.deepEqual(parseSignInInput(`${URL}/auth/v1/verify?token=abc123&type=signup`, URL),
    { kind: 'link', token_hash: 'abc123', type: 'signup' });
  assert.deepEqual(parseSignInInput(`${URL}/auth/v1/verify?token=abc123&type=recovery`, URL),
    { kind: 'link', token_hash: 'abc123', type: 'magiclink' });
  const message = /Enter the code from the email, or paste the sign-in link without opening it\./;
  assert.throws(() => parseSignInInput('https://qrstuvwxyzabcdefghij.supabase.co/auth/v1/verify?token=abc&type=magiclink', URL), message);
  assert.throws(() => parseSignInInput('12345', URL), message);
  assert.throws(() => parseSignInInput('hello there', URL), message);
  assert.throws(() => parseSignInInput(`${URL}/auth/v1/verify?type=magiclink`, URL), message);
  assert.throws(() => parseSignInInput('', URL), message);
});

const ctx = (iso = '2026-11-19T09:00:00Z') => ({ now: new Date(iso), device: 'pc' });

test('only changes to synced fields count as local changes', () => {
  const base = readState(memory());
  const withTask = captureTask(base, { title: 'Write', plannedDate: '2026-11-19' }, ctx());
  assert.equal(shouldNoteChange(base, withTask), true);
  assert.equal(shouldNoteChange(withTask, withTask), false);
  const id = withTask.tasks[0].id;
  assert.equal(shouldNoteChange(withTask, saveTask(withTask, id, { title: 'Write more' }, ctx())), true);

  const event = recordAppEvent(withTask, { kind: 'block', path: 'c:\\apps\\x.exe', name: 'X', at: '2026-11-19T09:00:00Z' });
  assert.notEqual(event, withTask);
  assert.equal(shouldNoteChange(withTask, event), false);

  const focused = startFocus(withTask, new Date('2026-11-19T09:00:00Z'));
  const ticked = settleFocus(focused, ctx('2026-11-19T09:05:00Z'));
  assert.equal(shouldNoteChange(focused, ticked), false);
  const strict = tickStrict(withTask, { ...ctx('2026-11-19T09:05:00Z'), workspaceApps: () => [] });
  assert.equal(shouldNoteChange(withTask, strict), false);
});

function fakeEngine(log = []) {
  return {
    start: async () => { log.push('engine.start'); },
    stop: async () => { log.push('engine.stop'); },
    eraseEverywhere: async () => { log.push('engine.erase'); },
    log
  };
}

function fakeClient(log = []) {
  return {
    auth: { signOut: async (options) => { log.push(['signOut', options]); } },
    removeAllChannels: async () => { log.push('removeAllChannels'); },
    log
  };
}

test('two SIGNED_IN events start the engine once; sign-out allows a new start', () => {
  const engine = fakeEngine();
  const statuses = [];
  const handler = createAuthHandler({ engine, setStatus: (s) => statuses.push(s.status), defer: (fn) => fn() });
  handler('INITIAL_SESSION', { user: {} });
  handler('SIGNED_IN', { user: {} });
  handler('SIGNED_IN', { user: {} });
  handler('TOKEN_REFRESHED', { user: {} });
  assert.deepEqual(engine.log, ['engine.start']);
  handler('SIGNED_OUT', null);
  handler('SIGNED_IN', { user: {} });
  assert.deepEqual(engine.log, ['engine.start', 'engine.stop', 'engine.start']);
});

test('INITIAL_SESSION without a session reports signed-out and starts nothing', () => {
  const engine = fakeEngine();
  const statuses = [];
  const handler = createAuthHandler({ engine, setStatus: (s) => statuses.push(s.status), defer: (fn) => fn() });
  handler('INITIAL_SESSION', null);
  assert.deepEqual(engine.log, []);
  assert.deepEqual(statuses, ['signed-out']);
});

test('sign-out stops the engine first and signs out locally only', async () => {
  const log = [];
  const engine = fakeEngine(log);
  const client = fakeClient(log);
  await signOutSequence({ client, engine, setStatus: (s) => log.push(['status', s.status]) });
  assert.deepEqual(log, ['engine.stop', ['signOut', { scope: 'local' }], ['status', 'signed-out']]);
});

test('after a change of connection no call reaches the old client', async () => {
  const log = [];
  const oldClient = fakeClient(log);
  const oldEngine = fakeEngine(log);
  const storage = memory();
  const newClient = fakeClient([]);
  const newEngine = fakeEngine([]);
  let unsubscribed = 0;
  const built = await changeConnection({
    client: oldClient, engine: oldEngine, setStatus: () => {}, unsubscribe: () => { unsubscribed += 1; }, storage,
    config: { url: 'https://zyxwvutsrqponmlkjihg.supabase.co', anonKey: PUBLISHABLE },
    build: (config) => ({ client: newClient, engine: newEngine, config })
  });
  assert.equal(built.client, newClient);
  assert.equal(unsubscribed, 1);
  assert.deepEqual(readCloudConfig(storage), { url: 'https://zyxwvutsrqponmlkjihg.supabase.co', anonKey: PUBLISHABLE });
  assert.deepEqual(log, ['engine.stop', ['signOut', { scope: 'local' }], 'removeAllChannels']);
  const before = log.length;
  newEngine.start();
  assert.equal(log.length, before);
});

test('an invalid new connection changes nothing and signs nobody out', async () => {
  const log = [];
  await assert.rejects(() => changeConnection({
    client: fakeClient(log), engine: fakeEngine(log), setStatus: () => {}, storage: memory(),
    config: { url: 'nope', anonKey: PUBLISHABLE }, build: () => assert.fail('must not build')
  }), /Check the project URL/);
  assert.deepEqual(log, []);
});

test('erasing removes the stored backup and photos, through the engine when signed in', async () => {
  const log = [];
  const engine = fakeEngine(log);
  const deps = { deleteBackup: async () => { log.push('deleteBackup'); }, clearPhotos: async () => { log.push('clearPhotos'); } };
  await eraseAll({ state: {}, engine, everywhere: true, plainErase: () => log.push('plain'), ...deps });
  assert.deepEqual(log, ['engine.erase', 'deleteBackup', 'clearPhotos']);
  log.length = 0;
  await eraseAll({ state: {}, engine, everywhere: false, plainErase: () => log.push('plain'), ...deps });
  assert.deepEqual(log, ['plain', 'deleteBackup', 'clearPhotos']);
});

test('a failed erase leaves the backup and photos alone', async () => {
  const log = [];
  const engine = { eraseEverywhere: async () => { throw new Error('Erase after the focus session ends.'); } };
  await assert.rejects(() => eraseAll({
    state: {}, engine, everywhere: true, plainErase: () => {}, deleteBackup: async () => log.push('deleteBackup'),
    clearPhotos: async () => log.push('clearPhotos')
  }), /focus session/);
  assert.deepEqual(log, []);
  await assert.rejects(() => eraseAll({
    state: {}, engine, everywhere: false, plainErase: () => { throw new Error('Erase after the focus session ends.'); },
    deleteBackup: async () => log.push('deleteBackup'), clearPhotos: async () => log.push('clearPhotos')
  }), /focus session/);
  assert.deepEqual(log, []);
});

test('a sign-out that is still stopping does not overwrite a newer sign-in', async () => {
  const log = [];
  let releaseStop;
  const engine = {
    start: async () => { log.push('start'); },
    stop: () => new Promise((resolve) => { releaseStop = () => { log.push('stopped'); resolve(); }; })
  };
  const statuses = [];
  const sessions = [];
  const handler = createAuthHandler({
    engine, setStatus: (s) => statuses.push(s.status), onSession: (s) => sessions.push(Boolean(s)), defer: (fn) => fn()
  });
  handler('SIGNED_IN', { user: {} });
  handler('SIGNED_OUT', null);
  handler('SIGNED_IN', { user: {} });
  releaseStop();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(statuses, [], 'the late sign-out reports nothing');
  assert.equal(sessions.at(-1), true);
  assert.deepEqual(log, ['start', 'start', 'stopped']);
});

test('a deferred step from before a change of connection is ignored', async () => {
  const queue = [];
  const engine = fakeEngine();
  const statuses = [];
  const sessions = [];
  const handler = createAuthHandler({
    engine, setStatus: (s) => statuses.push(s.status), onSession: (s) => sessions.push(s), defer: (fn) => queue.push(fn)
  });
  handler('SIGNED_IN', { user: {} });
  await queue.shift()();
  const client = fakeClient();
  client.auth.signOut = async () => { handler('SIGNED_OUT', null); };
  await changeConnection({
    client, engine, setStatus: (s) => statuses.push(s.status), auth: handler, storage: memory(),
    config: { url: URL, anonKey: PUBLISHABLE }, build: () => 'built'
  });
  const before = statuses.length;
  while (queue.length) await queue.shift()();
  assert.equal(statuses.length, before, 'the old SIGNED_OUT adds no status for the new connection');
  assert.deepEqual(sessions.filter((s) => s === null), []);
  // After the change, the guard is reset so a new sign-in starts its engine again.
  const next = fakeEngine();
  const second = createAuthHandler({ engine: next, setStatus: () => {}, defer: (fn) => fn() });
  second('SIGNED_IN', { user: {} });
  assert.deepEqual(next.log, ['engine.start']);
});

test('sign-out resets the start guard so the next sign-in starts the engine', async () => {
  const engine = fakeEngine();
  const handler = createAuthHandler({ engine, setStatus: () => {}, defer: (fn) => fn() });
  handler('SIGNED_IN', { user: {} });
  await signOutSequence({ client: fakeClient(), engine, setStatus: () => {}, auth: handler });
  handler('SIGNED_IN', { user: {} });
  assert.deepEqual(engine.log, ['engine.start', 'engine.stop', 'engine.start']);
});

test('backups keep the newest five, newest first', () => {
  let list = null;
  for (let n = 1; n <= 7; n += 1) list = addBackup(list, { n }, new Date(Date.UTC(2026, 10, n)), `id-${n}`);
  assert.equal(list.length, 5);
  assert.deepEqual(list.map((item) => item.id), ['id-7', 'id-6', 'id-5', 'id-4', 'id-3']);
  assert.deepEqual(list[0], { id: 'id-7', savedAt: '2026-11-07T00:00:00.000Z', payload: { n: 7 }, source: null });
});

test('a failed backup or photo cleanup after a successful erase is reported, not thrown', async () => {
  const log = [];
  const errors = [];
  await eraseAll({
    state: {}, engine: fakeEngine(log), everywhere: true, plainErase: () => {},
    deleteBackup: async () => { throw new Error('db'); }, clearPhotos: async () => { log.push('clearPhotos'); },
    onCleanupError: (error) => errors.push(error.message)
  });
  assert.deepEqual(errors, ['db']);
  assert.deepEqual(log, ['engine.erase', 'clearPhotos']);
});

test('a backup remembers its source account, and restoring into another account needs a second confirmation', () => {
  const list = addBackup(null, {}, new Date(Date.UTC(2026, 10, 1)), 'a', { uid: 'user-1', email: 'one@example.test' });
  assert.deepEqual(list[0].source, { uid: 'user-1', email: 'one@example.test' });
  assert.equal(addBackup(null, {}, new Date(), 'b')[0].source, null);
  assert.equal(restoreNeedsConfirm(list[0], 'user-1'), false);
  assert.equal(restoreNeedsConfirm(list[0], 'user-2'), true);
  assert.equal(restoreNeedsConfirm(list[0], null), true);
  assert.equal(restoreNeedsConfirm({ source: { uid: null, email: null } }, 'user-2'), false);
  assert.equal(restoreNeedsConfirm({ source: null }, 'user-2'), false);
});

const rule = (name) => ({ name, domains: name + '.example', schedule: { type: 'always' }, strength: 'block' });

test('restoring a backup is refused while a rule is enabled, so an older enabled rule cannot be revived', () => {
  const early = ctx('2026-11-19T08:00:00Z');
  const recent = ctx('2026-11-19T10:00:00Z');
  // The device backed up [R1] with a recent stamp, then took the account copy [R1, R2], where R2 is older and enabled.
  const backedUp = saveBlockRule(readState(memory()), null, rule('r1'), recent);
  const backup = exportSync(backedUp, { id: 'pc', name: 'PC' }, new Date('2026-11-19T10:05:00Z'));
  let replaced = saveBlockRule(readState(memory()), null, rule('r2'), early);
  replaced = { ...replaced, blockRules: [...backup.data.blockRules.map((item) => ({ ...item, id: 'r1' })), ...replaced.blockRules] };
  assert.equal(replaced.blockRules.length, 2);
  assert.ok(replaced.blockRules.some((item) => item.enabled));
  const before = replaced;
  assert.throws(() => restoreBackup(replaced, backup, ctx('2026-11-19T10:10:00Z')),
    /Turn off block rules and strict blocks on this device first; the change delay applies./);
  assert.equal(replaced, before);
  assert.equal(replaced.blockRules.length, 2, 'R2 stays');
});

test('restoring after a replace is a clean merge with no conflicts', () => {
  const pc = (iso) => ctx(iso);
  let mine = setMission(readState(memory()), 'Finish the report', pc('2026-11-19T08:00:00Z'));
  mine = captureTask(mine, { title: 'Mine' }, pc('2026-11-19T08:01:00Z'));
  mine = registerDevice(mine, { id: 'pc', name: 'PC', platform: 'windows' }, new Date('2026-11-19T08:02:00Z'));
  const backup = exportSync(mine, { id: 'pc', name: 'PC' }, new Date('2026-11-19T08:05:00Z'));
  // The account copy came from another device, with a later mission and its own task.
  let theirs = setMission(readState(memory()), 'Launch the app', ctx('2026-11-19T09:00:00Z', 'phone'));
  theirs = captureTask(theirs, { title: 'Theirs' }, ctx('2026-11-19T09:01:00Z', 'phone'));
  const account = exportSync(theirs, { id: 'phone', name: 'Phone' }, new Date('2026-11-19T09:05:00Z'));
  const replaced = mergeSync(clearSyncedData(mine, new Date('2026-11-19T09:10:00Z')), account,
    { ...ctx('2026-11-19T09:10:00Z'), allowOwn: true, preferRemoteRoot: true }).state;
  assert.deepEqual(replaced.tasks.map((task) => task.title), ['Theirs']);
  const { state: restored, summary } = restoreBackup(replaced, backup, ctx('2026-11-19T09:20:00Z'));
  assert.equal(summary.conflicts, 0, 'restoring is not a conflict storm');
  assert.deepEqual(restored.conflicts, []);
  assert.deepEqual(restored.tasks.map((task) => task.title).sort(), ['Mine', 'Theirs']);
  assert.equal(restored.mission, 'Launch the app', 'the newer mission stays');
});
