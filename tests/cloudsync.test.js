import assert from 'node:assert/strict';
import test from 'node:test';
import { canonical, createCloudSync, hasPlanData } from '../app/cloud-sync.js';
import {
  captureTask, clearSyncedData, exportSync, mergeSync, readState, registerDevice, saveBlockRule, saveTask, SYNC_SCHEMA,
  setMission, toggleTask
} from '../app/model.js';

// ---------------------------------------------------------------------------
// A fake Supabase server shared by simulated devices. It mirrors the call
// shapes the engine uses: auth.getSession, from().select().eq().maybeSingle(),
// rpc(), channel().on().subscribe() and removeChannel. No network is involved.

const T0 = Date.parse('2026-11-19T08:00:00Z');
const USER1 = { id: 'user-1', email: 'user-one@example.test' };
const USER2 = { id: 'user-2', email: 'user-two@example.test' };

function makeServer() {
  const server = {
    rows: new Map(), subs: [], rpcLog: [], reads: 0, pushes: 0, attempts: 0,
    nullPushes: 0, down: new Set(), httpStatus: null, gate: null, skewMs: 0, failPush: false,
    row: (uid = USER1.id) => server.rows.get(uid) ?? null
  };
  return server;
}

function makeClient(server, tag, session) {
  const guard = (op) => {
    if (server.down.has(tag)) {
      if (op === 'select') throw new TypeError('Failed to fetch');
      return { data: null, error: { message: 'TypeError: Failed to fetch' }, status: 0 };
    }
    if (server.httpStatus) return { data: null, error: { message: 'Service unavailable' }, status: server.httpStatus };
    return null;
  };
  return {
    auth: { getSession: async () => ({ data: { session: session.user ? { user: session.user } : null } }) },
    from: (table) => {
      assert.equal(table, 'sync_docs');
      return {
        select: (columns) => ({
          eq: (column, uid) => {
            assert.equal(column, 'user_id');
            return {
              maybeSingle: async () => {
                server.reads += 1;
                if (server.gate) await server.gate;
                const failed = guard('select');
                if (failed) return failed;
                const row = server.rows.get(uid);
                if (!row) return { data: null, error: null };
                const data = {};
                for (const name of columns.split(',').map((item) => item.trim())) data[name] = structuredClone(row[name]);
                return { data, error: null };
              }
            };
          }
        })
      };
    },
    rpc: async (name, args) => {
      server.rpcLog.push({ tag, name, args });
      const failed = guard('rpc');
      if (failed) return failed;
      if (name === 'server_now') return { data: new Date(T0 + server.skewMs).toISOString(), error: null };
      assert.equal(name, 'push_sync_doc');
      server.attempts += 1;
      if (server.pushGate) await server.pushGate;
      const uid = session.user.id;
      const row = server.rows.get(uid);
      if (server.failPush) return { data: null, error: { message: 'boom' }, status: 500 };
      if (server.nullPushes > 0) {
        server.nullPushes -= 1;
        return { data: null, error: null };
      }
      let rev = null;
      if (args.expected_rev === 0) {
        if (!row) {
          server.rows.set(uid, { payload: structuredClone(args.new_payload), rev: 1 });
          rev = 1;
        }
      } else if (row && row.rev === args.expected_rev) {
        row.payload = structuredClone(args.new_payload);
        row.rev += 1;
        rev = row.rev;
      }
      if (rev !== null) {
        server.pushes += 1;
        const event = rev === 1 ? 'INSERT' : 'UPDATE';
        for (const channel of server.subs) {
          for (const handler of channel.handlers) {
            if (handler.options.event === event && handler.options.filter === `user_id=eq.${uid}`) handler.callback({});
          }
        }
      }
      return { data: rev, error: null };
    },
    channel: () => {
      const channel = {
        handlers: [],
        on(type, options, callback) {
          assert.equal(type, 'postgres_changes');
          channel.handlers.push({ options, callback });
          return channel;
        },
        subscribe() {
          server.subs.push(channel);
          return channel;
        }
      };
      return channel;
    },
    removeChannel: async (channel) => {
      server.subs = server.subs.filter((item) => item !== channel);
    }
  };
}

function makeTimers() {
  const timers = { list: [], next: 1 };
  const add = (type) => (fn, ms) => {
    const id = timers.next;
    timers.next += 1;
    timers.list.push({ id, fn, ms, type, active: true });
    return id;
  };
  const remove = (id) => {
    const found = timers.list.find((item) => item.id === id);
    if (found) found.active = false;
  };
  Object.assign(timers, { setTimeout: add('timeout'), setInterval: add('interval'), clearTimeout: remove, clearInterval: remove });
  timers.fire = (type, ms) => {
    const found = timers.list.find((item) => item.active && item.type === type && item.ms === ms);
    assert.ok(found, `no active ${type} of ${ms} ms`);
    if (type === 'timeout') found.active = false;
    found.fn();
  };
  timers.active = (type, ms) => timers.list.some((item) => item.active && item.type === type && item.ms === ms);
  return timers;
}

function makeStorage() {
  let value = null;
  return { getItem: () => value, setItem: (_key, next) => { value = next; } };
}

function makeDevice(server, id, options = {}) {
  const dev = {
    id, name: `Device ${id}`, server, clock: { ms: T0 }, store: options.store ?? new Map(), statuses: [], backups: [], backupSources: [], applied: [],
    session: { user: options.user ?? USER1 }, timers: makeTimers(), merge: options.merge, online: true
  };
  const base = readState(makeStorage());
  dev.state = options.state ?? registerDevice({ ...base, settings: { ...base.settings, timeZone: 'UTC' } },
    { id, name: dev.name, platform: 'test' }, new Date(T0));
  dev.client = makeClient(server, id, dev.session);
  dev.now = () => new Date(dev.clock.ms);
  dev.ctx = () => ({ now: dev.now(), device: id });
  dev.make = () => createCloudSync({
    client: dev.client,
    store: { get: (key) => dev.store.get(key) ?? null, set: (key, value) => { dev.store.set(key, value); } },
    getState: () => dev.state,
    applyMerged: (state, info) => {
      dev.applied.push(info.reason);
      dev.state = info.reason === 'replace' ? registerDevice(state, { id, name: dev.name, platform: 'test' }, dev.now()) : state;
    },
    device: { id, name: dev.name },
    now: dev.now,
    onStatus: (status) => dev.statuses.push(status),
    saveBackup: (payload, source) => { dev.backups.push(payload); dev.backupSources.push(source); },
    timers: dev.timers,
    isOnline: () => dev.online,
    events: null,
    ...(dev.merge ? { merge: dev.merge } : {})
  });
  dev.engine = dev.make();
  dev.edit = (change) => {
    dev.state = change(dev.state, dev.ctx());
    dev.engine.noteLocalChange();
  };
  dev.last = () => dev.statuses.at(-1);
  dev.has = (status) => dev.statuses.some((item) => item.status === status);
  dev.export = () => exportSync(dev.state, { id, name: dev.name }, dev.now());
  return dev;
}

// Starts a device the way part 3 does: after a replace it registers the device and notes a change.
async function join(dev) {
  await dev.engine.start();
  if (dev.last()?.status === 'link-needed') await dev.engine.chooseLink('replace');
  dev.engine.noteLocalChange();
  await dev.engine.syncNow();
}

async function settle(devs, rounds = 8) {
  for (let round = 0; round < rounds; round += 1) {
    const before = devs.map((dev) => dev.server.pushes).join();
    for (const dev of devs) await dev.engine.syncNow();
    if (devs.map((dev) => dev.server.pushes).join() === before) return;
  }
  assert.fail('devices did not settle');
}

const converged = (a, b) => canonical(a.export().data) === canonical(b.export().data);
const titles = (dev) => dev.state.tasks.map((task) => task.title).sort();

async function pair() {
  const server = makeServer();
  const a = makeDevice(server, 'dev-a');
  const b = makeDevice(server, 'dev-b');
  a.edit((state, ctx) => captureTask(state, { title: 'First task' }, ctx));
  await join(a);
  await join(b);
  await settle([a, b]);
  return { server, a, b };
}

// ---------------------------------------------------------------------------

test('canonical ignores collection order and lastSeenAt but keeps user-ordered arrays', () => {
  const task = (id, extra = {}) => ({ id, title: id, events: [{ id: 'e2' }, { id: 'e1' }], subtasks: [{ id: 's2' }, { id: 's1' }], ...extra });
  const one = { tasks: [task('a'), task('b')], devices: { d: { name: 'x', lastSeenAt: '1' } }, mission: 'm' };
  const two = { mission: 'm', devices: { d: { lastSeenAt: '2', name: 'x' } }, tasks: [{ ...task('b'), events: [{ id: 'e1' }, { id: 'e2' }] }, task('a')] };
  assert.equal(canonical(one), canonical(two));
  const reordered = { ...one, tasks: [task('a', { subtasks: [{ id: 's1' }, { id: 's2' }] }), task('b')] };
  assert.notEqual(canonical(one), canonical(reordered), 'subtasks keep their order');
  assert.equal(canonical({ tasks: [] }), canonical({ tasks: [], workouts: [], strictLog: [] }), 'a missing collection equals an empty one');
  assert.equal(hasPlanData({ tasks: [], workouts: [], blockRules: [], appPresets: [] }), false);
  assert.equal(hasPlanData({ tasks: [], workouts: [], blockRules: [{}], appPresets: [] }), true);
});

test('fixed point: after an edit two devices converge within 2 pushes and then stay idle', async () => {
  const { server, a, b } = await pair();
  assert.equal(server.row().payload.schema, SYNC_SCHEMA);
  const before = server.pushes;
  a.edit((state, ctx) => captureTask(state, { title: 'Second task' }, ctx));
  await a.engine.syncNow();
  await b.engine.syncNow();
  await settle([a, b]);
  assert.ok(server.pushes - before <= 2, `pushed ${server.pushes - before} times`);
  assert.deepEqual(titles(b), ['First task', 'Second task']);
  assert.ok(converged(a, b));
  const settled = server.pushes;
  for (let index = 0; index < 5; index += 1) {
    await a.engine.syncNow();
    await b.engine.syncNow();
  }
  assert.equal(server.pushes, settled);
  assert.equal(a.last().status, 'synced');
});

test('an echo that arrives before the RPC result does not cause a second push', async () => {
  const server = makeServer();
  const a = makeDevice(server, 'dev-a');
  await a.engine.start();
  const before = server.pushes;
  a.edit((state, ctx) => captureTask(state, { title: 'Echoed' }, ctx));
  await a.engine.syncNow();
  assert.equal(server.pushes - before, 1);
  assert.ok(a.timers.active('interval', 5 * 60_000), 'polls every 5 minutes');
  const channel = server.subs[0];
  assert.deepEqual(channel.handlers.map((handler) => handler.options.event).sort(), ['INSERT', 'UPDATE']);
  assert.ok(channel.handlers.every((handler) => handler.options.filter === 'user_id=eq.user-1' && handler.options.table === 'sync_docs'));
});

test('a first link with no row binds and pushes at rev 0', async () => {
  const server = makeServer();
  const a = makeDevice(server, 'dev-a');
  a.edit((state, ctx) => captureTask(state, { title: 'Plan' }, ctx));
  await a.engine.start();
  const push = server.rpcLog.find((entry) => entry.name === 'push_sync_doc');
  assert.equal(push.args.expected_rev, 0);
  assert.equal(a.store.get('cloud.account'), 'user-1');
  assert.deepEqual(server.row().payload.data.tasks.map((task) => task.title), ['Plan']);
  assert.equal(server.row().payload.erasedAt, null);
  assert.equal(a.last().status, 'synced');
  assert.equal(a.has('link-needed'), false);
});

test('a first link onto an existing row asks, and replace gives the remote rules and takes a backup', async () => {
  const server = makeServer();
  const a = makeDevice(server, 'dev-a');
  a.edit((state, ctx) => saveBlockRule(captureTask(state, { title: 'Remote task' }, ctx), null, { name: 'Remote rule', domains: ['youtube.com'], enabled: true }, ctx));
  await a.engine.start();
  const b = makeDevice(server, 'dev-b');
  b.clock.ms = T0 + 3_600_000; // newer local stamps
  // The local rule is turned off: an enabled one would block the replace (see the next test).
  b.edit((state, ctx) => saveBlockRule(captureTask(state, { title: 'Local task' }, ctx), null, { name: 'Local rule', domains: ['facebook.com'], enabled: false }, ctx));
  const pushes = server.pushes;
  const stateBefore = b.state;
  await b.engine.start();
  assert.deepEqual(b.last(), { status: 'link-needed', email: USER1.email, serverHasData: true, localHasData: true });
  assert.equal(server.pushes, pushes, 'nothing is pushed while waiting');
  assert.equal(b.state, stateBefore);
  assert.equal(b.store.get('cloud.account') ?? null, null);
  await b.engine.chooseLink('replace');
  assert.equal(b.backups.length, 1);
  assert.deepEqual(b.backups[0].data.tasks.map((task) => task.title), ['Local task']);
  assert.deepEqual(b.state.blockRules, a.state.blockRules, 'the remote rules win even against a newer local stamp');
  assert.deepEqual(titles(b), ['Remote task']);
  assert.equal(b.store.get('cloud.account'), 'user-1');
  assert.equal(b.state.devices['dev-b'].name, b.name, 'the device registers itself after the apply');
  assert.equal(b.engine.status().status, 'synced');
});

test('BLK-06: replace waits while this device has an enabled rule, a waiting change or a strict block', async () => {
  const server = makeServer();
  const a = makeDevice(server, 'dev-a');
  a.edit((state, ctx) => captureTask(state, { title: 'Remote task' }, ctx)); // the other account copy has no rules
  await a.engine.start();
  const b = makeDevice(server, 'dev-b');
  b.edit((state, ctx) => saveBlockRule(captureTask(state, { title: 'Local task' }, ctx), null, { name: 'Local rule', domains: ['youtube.com'], enabled: true }, ctx));
  await b.engine.start();
  assert.equal(b.last().status, 'link-needed');
  const before = b.state;
  await b.engine.chooseLink('replace');
  assert.deepEqual([b.last().status, b.last().code], ['error', 'protected']);
  assert.equal(b.state, before, 'the rule is still there');
  assert.equal(b.store.get('cloud.account') ?? null, null);
  assert.equal(b.backups.length, 0);
  // Turning the rule off goes through the change delay; once applied, replace works.
  b.edit((state, ctx) => ({ ...state, blockRules: state.blockRules.map((rule) => ({ ...rule, enabled: false })) }));
  await b.engine.chooseLink('replace');
  assert.deepEqual(titles(b), ['Remote task']);
  assert.deepEqual(b.state.blockRules, []);
});

test('a plan edited while the backup is written is backed up again before it is replaced', async () => {
  const server = makeServer();
  const a = makeDevice(server, 'dev-a');
  a.edit((state, ctx) => captureTask(state, { title: 'Remote' }, ctx));
  await a.engine.start();
  const b = makeDevice(server, 'dev-b');
  b.edit((state, ctx) => captureTask(state, { title: 'Local' }, ctx));
  const backups = [];
  let edited = false;
  const engine = createCloudSync({
    client: b.client, store: { get: (key) => b.store.get(key) ?? null, set: (key, value) => { b.store.set(key, value); } },
    getState: () => b.state, applyMerged: (state) => { b.state = state; }, device: { id: 'dev-b', name: b.name }, now: b.now,
    onStatus: (status) => b.statuses.push(status), timers: b.timers, events: null,
    saveBackup: async (payload) => {
      backups.push(payload.data.tasks.map((task) => task.title));
      if (!edited) {
        edited = true;
        b.state = captureTask(b.state, { title: 'Typed during the backup' }, { now: new Date(b.now()), device: 'dev-b' });
        engine.noteLocalChange();
      }
    }
  });
  await engine.start();
  await engine.chooseLink('replace');
  assert.equal(backups.length, 2);
  assert.ok(backups[1].includes('Typed during the backup'), 'the last backup holds the edit that was cleared');
});

test('a backup that fails aborts the replace and leaves everything untouched', async () => {
  const server = makeServer();
  const a = makeDevice(server, 'dev-a');
  a.edit((state, ctx) => captureTask(state, { title: 'Remote' }, ctx));
  await a.engine.start();
  const b = makeDevice(server, 'dev-b');
  b.edit((state, ctx) => captureTask(state, { title: 'Local' }, ctx));
  await b.engine.start();
  const stateBefore = b.state;
  const row = structuredClone(server.row());
  const attempts = server.attempts;
  const make = b.make;
  const failing = createCloudSync({
    client: b.client, store: { get: (key) => b.store.get(key) ?? null, set: (key, value) => { b.store.set(key, value); } },
    getState: () => b.state, applyMerged: (state) => { b.state = state; }, device: { id: 'dev-b', name: b.name }, now: b.now,
    onStatus: (status) => b.statuses.push(status), saveBackup: () => Promise.reject(new Error('disk full')),
    timers: b.timers, events: null
  });
  await failing.start();
  await failing.chooseLink('replace');
  assert.deepEqual([b.last().status, b.last().code, b.last().message], ['error', 'backup', 'disk full']);
  assert.equal(b.state, stateBefore);
  assert.equal(b.store.get('cloud.account') ?? null, null);
  assert.equal(server.attempts, attempts);
  assert.deepEqual(server.row(), row);
  assert.ok(make);
});

test('cancelling the link choice keeps the engine paused and the server untouched', async () => {
  const server = makeServer();
  const a = makeDevice(server, 'dev-a');
  a.edit((state, ctx) => captureTask(state, { title: 'Remote' }, ctx));
  await a.engine.start();
  const b = makeDevice(server, 'dev-b');
  b.edit((state, ctx) => captureTask(state, { title: 'Local' }, ctx));
  await b.engine.start();
  await b.engine.chooseLink('cancel');
  const reads = server.reads;
  const pushes = server.pushes;
  await b.engine.syncNow();
  assert.equal(server.pushes, pushes);
  assert.equal(server.reads, reads, 'no further reads while cancelled');
  assert.deepEqual(titles(b), ['Local']);
  assert.equal(b.backups.length, 0);
});

test('a fresh device with no plan data links without asking', async () => {
  const server = makeServer();
  const a = makeDevice(server, 'dev-a');
  a.edit((state, ctx) => captureTask(state, { title: 'Remote' }, ctx));
  await a.engine.start();
  const b = makeDevice(server, 'dev-b');
  await b.engine.start();
  assert.equal(b.has('link-needed'), false);
  assert.deepEqual(titles(b), ['Remote']);
  assert.equal(b.backups.length, 0, 'nothing to back up');
});

test('another account: no server call happens before the choice, and replace resets peers', async () => {
  const { server, b } = await pair();
  assert.ok(Object.keys(b.state.peers).length > 0);
  b.session.user = USER2;
  const rpcs = server.rpcLog.length;
  await b.engine.start();
  assert.equal(b.last().status, 'account-changed');
  assert.equal(b.last().email, USER2.email);
  const reads = server.reads; // the prompt itself reads the new account once, to know whether it has a plan
  await b.engine.syncNow();
  b.engine.noteLocalChange();
  await b.engine.syncNow();
  assert.equal(server.rpcLog.length, rpcs, 'no rpc before the choice');
  assert.equal(server.reads, reads, 'no further read before the choice');
  await b.engine.chooseLink('replace');
  assert.equal(b.backups.length, 1);
  assert.equal(b.store.get('cloud.account'), 'user-2');
  assert.deepEqual(b.state.peers, {});
  assert.equal(b.state.tasks.length, 0, 'the other account plan does not leak into the new account');
  assert.deepEqual(server.row('user-2').payload.data.tasks, []);
  assert.deepEqual(server.row('user-1').payload.data.tasks.map((task) => task.title), ['First task']);
});

test('M6: a payload this device wrote is merged back, so nothing is lost after a crash', async () => {
  const { server, a } = await pair();
  a.edit((state, ctx) => captureTask(state, { title: 'Written just before the crash' }, ctx));
  await a.engine.syncNow();
  assert.ok(server.row().payload.data.tasks.some((task) => task.title === 'Written just before the crash'));
  // The state was replaced from outside and the revision was never recorded.
  a.state = registerDevice(clearSyncedData(a.state, a.now()), { id: 'dev-a', name: a.name, platform: 'test' }, a.now());
  a.store.set('cloud.lastSeenRev', 1);
  assert.deepEqual(titles(a), []);
  await a.engine.syncNow();
  assert.ok(titles(a).includes('Written just before the crash'));
  assert.ok(server.row().payload.data.tasks.some((task) => task.title === 'Written just before the crash'));
});

function runningFocus(extra = {}) {
  return {
    sessionId: 's1', taskId: null, startedAt: T0, endAt: T0 + 3_600_000, blockUntil: T0 + 3_600_000, domains: ['youtube.com'],
    apps: null, workspaceApps: [], segmentStart: T0, endedAt: null,
    strict: { blockId: 'b1', taskId: 'gone-task', blockStart: T0, blockEnd: T0 + 1_800_000, holdUntil: T0 + 1_800_000, limit: T0 + 3_600_000, exitRequestedAt: null },
    ...extra
  };
}

test('FOC-04: replace keeps a running session and the Chrome data, and refuses during a strict hold', async () => {
  const server = makeServer();
  const a = makeDevice(server, 'dev-a');
  a.edit((state, ctx) => captureTask(state, { title: 'Remote' }, ctx));
  await a.engine.start();
  const b = makeDevice(server, 'dev-b');
  b.edit((state, ctx) => captureTask(state, { title: 'Local' }, ctx));
  b.state = { ...b.state, focus: runningFocus(), chrome: { profiles: { p1: { id: 'p1', seenAt: 1 } } } };
  await b.engine.start();
  // WB-04: a hold ends only through the emergency exit, never through a replace.
  const held = b.state;
  await b.engine.chooseLink('replace');
  assert.deepEqual([b.last().status, b.last().code], ['error', 'protected']);
  assert.equal(b.state, held);
  b.state = { ...b.state, focus: runningFocus({ strict: null }) };
  const { focus, chrome } = b.state;
  await b.engine.chooseLink('replace');
  assert.deepEqual(b.state.focus, focus);
  assert.deepEqual(b.state.chrome, chrome);
  assert.deepEqual(titles(b), ['Remote']);
});

test('a running task session keeps its task when the account copy has it', async () => {
  const { a, b } = await pair();
  const taskId = b.state.tasks[0].id;
  // B forgets its binding (for example after a reinstall of the engine store) and links again.
  b.store.set('cloud.account', null);
  b.state = { ...b.state, focus: runningFocus({ strict: null, taskId }) };
  await b.engine.start();
  assert.equal(b.last().status, 'link-needed');
  await b.engine.chooseLink('replace');
  assert.equal(b.state.focus.taskId, taskId, 'the session stays on its task');
  assert.ok(titles(a).length > 0);
});

test('a new, empty account after an account change does not receive the old account plan', async () => {
  const { server, b } = await pair();
  b.session.user = USER2;
  await b.engine.start();
  assert.equal(b.last().status, 'account-changed');
  await b.engine.chooseLink('replace');
  assert.equal(b.backups.length, 1, 'the old plan is backed up on the device');
  assert.equal(server.row('user-2').payload.data.tasks.length, 0);
});

test('eraseEverywhere refuses while another account is waiting for a choice', async () => {
  const { server, b } = await pair();
  b.session.user = USER2;
  server.rows.set('user-2', structuredClone(server.row('user-1')));
  await b.engine.start();
  assert.equal(b.last().status, 'account-changed');
  const rpcs = server.rpcLog.length;
  await assert.rejects(() => b.engine.eraseEverywhere(b.state), /Finish linking this device/);
  assert.equal(server.rpcLog.length, rpcs);
  assert.ok(server.row('user-2').payload.data.tasks.length > 0, 'the other account copy is untouched');
});

test('a replace interrupted before the binding is recorded finishes on the next start', async () => {
  const { server, b } = await pair();
  b.session.user = USER2;
  server.rows.set('user-2', structuredClone(server.row('user-1')));
  // Simulate a crash after the account copy was saved (it carries cloudAccount) but before the binding was written.
  b.store.set('cloud.bindingPending', 'user-2');
  b.state = { ...b.state, cloudAccount: 'user-2' };
  await b.engine.start();
  assert.equal(b.store.get('cloud.account'), 'user-2');
  assert.notEqual(b.last().status, 'account-changed');
});

test('M3: a replace whose apply never reached storage never binds or uploads the old plan', async () => {
  const { server, b } = await pair();
  b.session.user = USER2;
  server.rows.set('user-2', structuredClone(server.row('user-1')));
  server.rows.get('user-2').payload.data.tasks = [];
  // Crash during the apply: the pending key is set but the saved state is still account 1's plan.
  b.store.set('cloud.bindingPending', 'user-2');
  const pushes = server.rpcLog.filter((call) => call.name === 'push_sync_doc').length;
  await b.engine.start();
  assert.equal(b.store.get('cloud.account'), 'user-1', 'still bound to the old account');
  assert.equal(b.last().status, 'account-changed');
  assert.equal(server.rpcLog.filter((call) => call.name === 'push_sync_doc').length, pushes);
  assert.equal(server.row('user-2').payload.data.tasks.length, 0, 'nothing from account 1 reached account 2');
});

test('an apply that throws during replace clears the pending binding and reports it', async () => {
  const server = makeServer();
  const a = makeDevice(server, 'dev-a');
  a.edit((state, ctx) => captureTask(state, { title: 'Remote' }, ctx));
  await a.engine.start();
  const b = makeDevice(server, 'dev-b');
  b.edit((state, ctx) => captureTask(state, { title: 'Local' }, ctx));
  const engine = createCloudSync({
    client: b.client, store: { get: (key) => b.store.get(key) ?? null, set: (key, value) => { b.store.set(key, value); } },
    getState: () => b.state, applyMerged: () => { throw new Error('quota exceeded'); }, device: { id: 'dev-b', name: b.name },
    now: b.now, onStatus: (status) => b.statuses.push(status), timers: b.timers, events: null, saveBackup: async () => {}
  });
  await engine.start();
  await engine.chooseLink('replace');
  assert.deepEqual([b.last().status, b.last().code], ['error', 'apply']);
  assert.equal(b.store.get('cloud.bindingPending') ?? null, null);
  assert.equal(b.store.get('cloud.account') ?? null, null);
  assert.deepEqual(titles(b), ['Local']);
});

test('erase here keeps a running session, and a plain erase during a session throws', async () => {
  const { server, a, b } = await pair();
  a.state = { ...a.state, focus: runningFocus(), chrome: { profiles: { p1: { id: 'p1' } } } };
  const { focus, chrome } = a.state;
  const rpcs = server.rpcLog.length;
  await assert.rejects(() => a.engine.eraseEverywhere(a.state), /Erase after the focus session ends\./);
  assert.equal(server.rpcLog.length, rpcs, 'refused before any call');
  assert.equal(titles(a).length, 1);
  // Another device erases; this one is told and clears its data while the session runs.
  await b.engine.eraseEverywhere(b.state);
  await a.engine.syncNow();
  assert.equal(a.last().status, 'erased');
  // A strict hold blocks erase-here; the prompt stays.
  const held = a.state;
  await a.engine.chooseErase('erase-here');
  assert.deepEqual([a.last().status, a.last().code], ['error', 'protected']);
  assert.equal(a.state, held);
  a.state = { ...a.state, focus: runningFocus({ strict: null }) };
  const running = a.state.focus;
  await a.engine.chooseErase('erase-here');
  assert.deepEqual(a.state.focus, running);
  assert.deepEqual(a.state.chrome, chrome);
  assert.deepEqual(a.state.tasks, []);
  assert.ok(focus);
});

test('erase durability: a later normal push keeps the marker, so an offline device still hears about it', async () => {
  const { server, a, b } = await pair();
  const c = makeDevice(server, 'dev-c');
  await join(c);
  await settle([a, b, c]);
  assert.deepEqual(titles(c), ['First task']);
  server.down.add('dev-c');
  await a.engine.eraseEverywhere(a.state);
  const marker = server.row().payload;
  assert.ok(marker.erasedAt);
  assert.deepEqual(marker.data.tasks, []);
  assert.equal(a.store.get('cloud.eraseSeen'), marker.erasedAt);
  // A keeps working: its next push is a normal one that carries the marker.
  a.edit((state, ctx) => captureTask(state, { title: 'After the erase' }, ctx));
  await a.engine.syncNow();
  assert.equal(server.row().payload.erasedAt, marker.erasedAt);
  assert.deepEqual(server.row().payload.data.tasks.map((task) => task.title), ['After the erase']);
  // C comes back after both writes.
  server.down.delete('dev-c');
  const pushes = server.pushes;
  const staleTasks = titles(c);
  await c.engine.syncNow();
  assert.equal(c.last().status, 'erased');
  assert.equal(c.last().erasedAt, marker.erasedAt);
  assert.equal(server.pushes, pushes, 'C does not push over the account');
  assert.deepEqual(titles(c), staleTasks, 'and keeps its data until the user chooses');
  c.engine.noteLocalChange();
  await c.engine.syncNow();
  assert.equal(server.pushes, pushes);
  // Erase here: clear and do not push.
  await c.engine.chooseErase('erase-here');
  assert.deepEqual(c.state.tasks, []);
  assert.equal(server.pushes, pushes);
  await c.engine.syncNow();
  assert.equal(server.pushes, pushes);
  assert.equal(c.store.get('cloud.eraseSeen'), marker.erasedAt);
});

test('upload again pushes this device over the marker', async () => {
  const { server, a, b } = await pair();
  await a.engine.eraseEverywhere(a.state);
  const marker = server.row().payload.erasedAt;
  await b.engine.syncNow();
  assert.equal(b.last().status, 'erased');
  assert.deepEqual(titles(b), ['First task']);
  await b.engine.chooseErase('upload-again');
  assert.deepEqual(server.row().payload.data.tasks.map((task) => task.title), ['First task']);
  assert.equal(server.row().payload.erasedAt, marker, 'the marker stays on later pushes');
  assert.equal(b.last().status, 'synced');
});

test('a first link onto an erase marker binds without asking and pushes the plan', async () => {
  const { server, a } = await pair();
  await a.engine.eraseEverywhere(a.state);
  const marker = server.row().payload.erasedAt;
  const d = makeDevice(server, 'dev-d');
  d.edit((state, ctx) => captureTask(state, { title: 'Brand new plan' }, ctx));
  await d.engine.start();
  assert.equal(d.has('link-needed'), false);
  assert.equal(d.has('erased'), false);
  assert.equal(d.store.get('cloud.account'), 'user-1');
  assert.equal(d.store.get('cloud.eraseSeen'), marker);
  assert.deepEqual(server.row().payload.data.tasks.map((task) => task.title), ['Brand new plan']);
  assert.deepEqual(d.backups, []);
});

test('eraseEverywhere: the marker goes up first and the next trigger does not push the old plan back', async () => {
  const { server, a } = await pair();
  a.edit((state, ctx) => setMission(state, 'Mission to wipe', ctx));
  await a.engine.syncNow();
  const rev = server.row().rev;
  const subscribed = server.subs.length;
  await a.engine.eraseEverywhere(a.state);
  assert.equal(server.row().rev, rev + 1);
  assert.deepEqual(server.row().payload.data.tasks, []);
  assert.equal(server.row().payload.data.mission, '');
  assert.deepEqual(a.state.tasks, []);
  assert.equal(a.store.get('cloud.dirty'), false);
  assert.equal(a.store.get('cloud.lastSeenRev'), rev + 1);
  const pushes = server.pushes;
  for (let index = 0; index < 3; index += 1) await a.engine.syncNow();
  assert.equal(server.pushes, pushes);
  assert.equal(server.subs.length, subscribed, 'the engine is running again');
});

test('eraseEverywhere failing leaves the local state and the server untouched', async () => {
  const { server, a } = await pair();
  const state = a.state;
  const row = structuredClone(server.row());
  const memory = [...a.store.entries()];
  server.failPush = true;
  await assert.rejects(() => a.engine.eraseEverywhere(a.state));
  assert.equal(a.state, state);
  assert.deepEqual(server.row(), row);
  assert.deepEqual([...a.store.entries()], memory);
  server.failPush = false;
  server.down.add('dev-a');
  await assert.rejects(() => a.engine.eraseEverywhere(a.state));
  assert.equal(a.state, state);
  assert.deepEqual([...a.store.entries()], memory);
  assert.equal(a.applied.includes('erase'), false);
  server.down.delete('dev-a');
  server.nullPushes = 5;
  await assert.rejects(() => a.engine.eraseEverywhere(a.state), /keeps changing/);
  assert.equal(a.state, state);
});

test('fixed point with ties: two devices complete the same task offline and converge within 2 pushes', async () => {
  const { server, a, b } = await pair();
  const id = a.state.tasks[0].id;
  server.down.add('dev-a');
  server.down.add('dev-b');
  a.clock.ms = T0 + 3_600_000;
  b.clock.ms = T0 + 7_200_000;
  a.edit((state, ctx) => toggleTask(state, id, ctx));
  b.edit((state, ctx) => toggleTask(state, id, ctx));
  await a.engine.syncNow();
  assert.equal(a.last().status, 'offline');
  server.down.clear();
  const before = server.pushes;
  await settle([a, b]);
  assert.ok(server.pushes - before <= 2, `pushed ${server.pushes - before} times`);
  assert.ok(converged(a, b));
  assert.equal(a.state.tasks[0].completedAt, b.state.tasks[0].completedAt);
  assert.equal(a.state.tasks[0].status, 'completed');
  const settled = server.pushes;
  for (let index = 0; index < 5; index += 1) {
    await a.engine.syncNow();
    await b.engine.syncNow();
  }
  assert.equal(server.pushes, settled);
});

test('the loop guard stops after 3 merge-only pushes when merges never converge', async () => {
  const server = makeServer();
  // A merge that always changes something: exactly the failure the guard is for.
  let wobble = 0;
  const wobbly = (state, payload, ctx) => {
    const result = mergeSync(state, payload, ctx);
    wobble += 1;
    return { ...result, state: { ...result.state, mission: `wobble ${wobble}` } };
  };
  const a = makeDevice(server, 'dev-a', { merge: wobbly });
  const b = makeDevice(server, 'dev-b', { merge: wobbly });
  a.edit((state, ctx) => captureTask(state, { title: 'Seed' }, ctx));
  await join(a);
  await join(b);
  for (let round = 0; round < 12; round += 1) {
    await a.engine.syncNow();
    await b.engine.syncNow();
  }
  const guarded = [a, b].filter((dev) => dev.statuses.some((status) => status.code === 'loop'));
  assert.ok(guarded.length > 0, 'a device reports the loop');
  const pushes = server.pushes;
  for (let round = 0; round < 6; round += 1) {
    await a.engine.syncNow();
    await b.engine.syncNow();
  }
  assert.ok(server.pushes - pushes <= 2, 'pushing is bounded once the guard trips');
  const tripped = guarded[0];
  assert.equal(tripped.store.get('cloud.mergePushes') <= 3, true);
});

test('dirty survives a restart: an offline edit is uploaded by the next engine', async () => {
  const { server, a } = await pair();
  server.down.add('dev-a');
  a.edit((state, ctx) => captureTask(state, { title: 'Written offline' }, ctx));
  await a.engine.syncNow();
  assert.equal(a.last().status, 'offline');
  assert.equal(a.store.get('cloud.dirty'), true);
  await a.engine.stop();
  server.down.clear();
  const restarted = a.make();
  await restarted.start();
  assert.ok(server.row().payload.data.tasks.some((task) => task.title === 'Written offline'));
  assert.equal(a.store.get('cloud.dirty'), false);
  await restarted.stop();
});

test('an edit made while a push is in flight stays dirty and is pushed next', async () => {
  const { server, a } = await pair();
  a.edit((state, ctx) => captureTask(state, { title: 'In flight' }, ctx));
  server.subs = []; // no echo, so only the pending flag can carry the edit
  let release;
  server.pushGate = new Promise((resolve) => { release = resolve; });
  const calls = server.rpcLog.length;
  const running = a.engine.syncNow();
  while (server.rpcLog.length === calls) await new Promise((resolve) => setImmediate(resolve));
  // The export is already taken; this edit is not in it.
  a.edit((state, ctx) => captureTask(state, { title: 'Typed meanwhile' }, ctx));
  server.pushGate = null;
  release();
  await running;
  assert.equal(a.store.get('cloud.dirty'), true, 'the new edit is still pending');
  assert.ok(server.row().payload.data.tasks.some((task) => task.title === 'In flight'));
  assert.equal(server.row().payload.data.tasks.some((task) => task.title === 'Typed meanwhile'), false);
  await a.engine.syncNow();
  assert.ok(server.row().payload.data.tasks.some((task) => task.title === 'Typed meanwhile'));
  assert.equal(a.store.get('cloud.dirty'), false);
});

test('the debounce waits 3 seconds after a local change', async () => {
  const { server, a } = await pair();
  const pushes = server.pushes;
  a.edit((state, ctx) => captureTask(state, { title: 'Debounced' }, ctx));
  a.edit((state, ctx) => captureTask(state, { title: 'Debounced again' }, ctx));
  assert.equal(server.pushes, pushes);
  assert.equal(a.timers.list.filter((item) => item.active && item.ms === 3000).length, 1, 'edits share one timer');
  a.timers.fire('timeout', 3000);
  await a.engine.syncNow();
  assert.equal(server.pushes - pushes, 1);
});

test('CAS conflict: a refused push is read, merged and retried; 3 refusals give busy', async () => {
  const { server, a } = await pair();
  server.nullPushes = 1;
  a.edit((state, ctx) => captureTask(state, { title: 'Retried' }, ctx));
  const attempts = server.attempts;
  await a.engine.syncNow();
  assert.equal(server.attempts - attempts, 2);
  assert.equal(a.last().status, 'synced');
  assert.ok(server.row().payload.data.tasks.some((task) => task.title === 'Retried'));
  server.nullPushes = 10;
  a.edit((state, ctx) => captureTask(state, { title: 'Never lands' }, ctx));
  const before = server.attempts;
  await a.engine.syncNow();
  assert.equal(server.attempts - before, 3);
  assert.equal(a.last().status, 'error');
  assert.equal(a.last().code, 'busy');
  assert.equal(server.row().payload.data.tasks.some((task) => task.title === 'Never lands'), false);
  assert.equal(a.store.get('cloud.dirty'), true);
});

test('a bad remote payload or a newer schema never causes a push', async () => {
  const { server, a } = await pair();
  const good = structuredClone(server.row().payload);
  a.edit((state, ctx) => captureTask(state, { title: 'Local only' }, ctx));
  server.row().payload = { ...good, data: { ...good.data, tasks: [{ id: 'x', title: 'y', status: 'weird' }] } };
  server.row().rev += 1;
  const pushes = server.attempts;
  await a.engine.syncNow();
  assert.equal(a.last().status, 'error');
  assert.equal(a.last().code, 'bad-remote');
  assert.match(a.last().message, /invalid task/);
  assert.equal(server.attempts, pushes);
  server.row().payload = { ...good, schema: SYNC_SCHEMA + 1 };
  server.row().rev += 1;
  await a.engine.syncNow();
  assert.equal(a.last().code, 'update-app');
  assert.equal(server.attempts, pushes);
  assert.deepEqual(titles(a).sort(), ['First task', 'Local only']);
});

test('an erase marker stops sync until the user chooses', async () => {
  const { server, a, b } = await pair();
  await b.engine.eraseEverywhere(b.state);
  const attempts = server.attempts;
  a.edit((state, ctx) => captureTask(state, { title: 'Unsent' }, ctx));
  await a.engine.syncNow();
  assert.equal(a.last().status, 'erased');
  assert.equal(a.last().deviceName, b.name);
  assert.equal(server.attempts, attempts);
  a.engine.noteLocalChange();
  a.timers.fire('timeout', 3000);
  await a.engine.syncNow();
  assert.equal(server.attempts, attempts);
});

test('concurrent syncNow calls are coalesced and stop waits for a running sync', async () => {
  const { server, a } = await pair();
  const reads = server.reads;
  await Promise.all([1, 2, 3, 4, 5].map(() => a.engine.syncNow()));
  const used = server.reads - reads;
  assert.ok(used >= 1 && used <= 2, `used ${used} reads`);
  let release;
  server.gate = new Promise((resolve) => { release = resolve; });
  const running = a.engine.syncNow();
  let stopped = false;
  const stopping = a.engine.stop().then(() => { stopped = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(stopped, false, 'stop waits for the running sync');
  release();
  await stopping;
  await running;
  assert.equal(stopped, true);
  const after = server.reads;
  await a.engine.syncNow();
  assert.equal(server.reads, after, 'a stopped engine does nothing');
});

test('offline and server errors are told apart, and a long outage becomes paused', async () => {
  const { server, a } = await pair();
  server.down.add('dev-a');
  await a.engine.syncNow();
  assert.equal(a.last().status, 'offline');
  server.down.clear();
  a.online = false;
  const reads = server.reads;
  await a.engine.syncNow();
  assert.equal(a.last().status, 'offline');
  assert.equal(server.reads, reads, 'no request while the browser says it is offline');
  a.online = true;
  server.httpStatus = 503;
  await a.engine.syncNow();
  assert.deepEqual([a.last().status, a.last().code], ['error', 'server']);
  a.clock.ms += 30 * 60_000;
  await a.engine.syncNow();
  assert.equal(a.last().code, 'server');
  a.clock.ms += 31 * 60_000;
  await a.engine.syncNow();
  assert.equal(a.last().code, 'paused');
  server.httpStatus = null;
  await a.engine.syncNow();
  assert.equal(a.last().status, 'synced');
  server.httpStatus = 503;
  await a.engine.syncNow();
  assert.equal(a.last().code, 'server', 'the outage clock restarts after a success');
});

test('clock skew above 2 minutes is reported once per start', async () => {
  const server = makeServer();
  server.skewMs = 10 * 60_000;
  const a = makeDevice(server, 'dev-a');
  await a.engine.start();
  const skew = a.statuses.filter((status) => status.status === 'clock-skew');
  assert.deepEqual(skew, [{ status: 'clock-skew', minutes: 10 }]);
  assert.equal(a.engine.status().clockSkew, 10);
  assert.equal(a.has('synced'), true);
  await a.engine.syncNow();
  assert.equal(server.rpcLog.filter((entry) => entry.name === 'server_now').length, 1);
  await a.engine.start();
  assert.equal(server.rpcLog.filter((entry) => entry.name === 'server_now').length, 2);

  const near = makeServer();
  near.skewMs = 60_000;
  const b = makeDevice(near, 'dev-b');
  await b.engine.start();
  assert.equal(b.has('clock-skew'), false);
});

test('signed out: nothing is read or written', async () => {
  const server = makeServer();
  const a = makeDevice(server, 'dev-a');
  a.session.user = null;
  a.edit((state, ctx) => captureTask(state, { title: 'Private' }, ctx));
  await a.engine.start();
  assert.equal(a.last().status, 'signed-out');
  assert.equal(server.reads + server.rpcLog.length, 0);
});

test('merging keeps conflicts surfaced and drops ones another device resolved', async () => {
  const { server, a, b } = await pair();
  const id = a.state.tasks[0].id;
  server.down.add('dev-a');
  server.down.add('dev-b');
  a.clock.ms = T0 + 3_600_000;
  b.clock.ms = T0 + 7_200_000;
  a.edit((state, ctx) => saveTask(state, id, { title: 'From A' }, ctx));
  b.edit((state, ctx) => saveTask(state, id, { title: 'From B' }, ctx));
  server.down.clear();
  await settle([a, b]);
  assert.ok(a.state.conflicts.length + b.state.conflicts.length > 0, 'a conflict is surfaced on at least one device');
  assert.ok(converged(a, b));
});

test('an empty new account reports serverHasData false, and upload binds it and pushes this plan without clearing', async () => {
  const { server, b } = await pair();
  b.session.user = USER2;
  await b.engine.start();
  assert.equal(b.last().status, 'account-changed');
  assert.equal(b.last().serverHasData, false);
  const before = titles(b);
  assert.ok(before.length > 0);
  await b.engine.chooseLink('upload');
  assert.equal(b.store.get('cloud.account'), 'user-2');
  assert.deepEqual(titles(b), before, 'nothing was cleared');
  assert.equal(b.backups.length, 0, 'no replace, so no backup');
  assert.equal(server.row('user-2').payload.data.tasks.length, before.length);
  assert.equal(b.last().status, 'synced');
});

test('an account with a plan reports serverHasData true and refuses upload', async () => {
  const { server, b } = await pair();
  b.session.user = USER2;
  server.rows.set('user-2', structuredClone(server.row('user-1')));
  await b.engine.start();
  assert.equal(b.last().serverHasData, true);
  await assert.rejects(() => b.engine.chooseLink('upload'), /only for an account with no plan/);
});

test('data that appears between the prompt and the upload choice turns it into the replace prompt, and nothing is pushed', async () => {
  const { server, b } = await pair();
  b.session.user = USER2;
  await b.engine.start();
  assert.equal(b.last().serverHasData, false);
  server.rows.set('user-2', structuredClone(server.row('user-1')));
  const pushes = server.rpcLog.filter((call) => call.name === 'push_sync_doc').length;
  await b.engine.chooseLink('upload');
  assert.equal(b.last().status, 'account-changed');
  assert.equal(b.last().serverHasData, true);
  assert.equal(b.store.get('cloud.account'), 'user-1', 'still not bound to the new account');
  assert.equal(server.rpcLog.filter((call) => call.name === 'push_sync_doc').length, pushes);
});

test('upload into an account that holds only an erase marker keeps the marker for its other devices', async () => {
  const { server, b } = await pair();
  b.session.user = USER2;
  const erasedAt = '2026-11-19T07:00:00.000Z';
  const now = new Date(T0);
  const empty = exportSync(clearSyncedData(b.state, now), 'dev-x', now);
  server.rows.set('user-2', { payload: { ...empty, erasedAt }, rev: 3 });
  await b.engine.start();
  assert.equal(b.last().serverHasData, false, 'a marker counts as empty');
  await b.engine.chooseLink('upload');
  assert.equal(b.store.get('cloud.account'), 'user-2');
  assert.equal(server.row('user-2').payload.erasedAt, erasedAt, 'the marker stays on the uploaded plan');
  assert.equal(b.store.get('cloud.eraseSeen'), erasedAt, 'this device does not ask about that erase');
  assert.ok(server.row('user-2').payload.data.tasks.length > 0);
});

test('upload pushes once against the revision it read, and a conflict leaves the device unbound with the replace prompt', async () => {
  const { server, b } = await pair();
  b.session.user = USER2;
  await b.engine.start();
  assert.equal(b.last().serverHasData, false);
  server.nullPushes = 1;
  const pushes = server.rpcLog.filter((call) => call.name === 'push_sync_doc').length;
  await b.engine.chooseLink('upload');
  const calls = server.rpcLog.filter((call) => call.name === 'push_sync_doc');
  assert.equal(calls.length, pushes + 1, 'one push only');
  assert.equal(calls.at(-1).args.expected_rev, 0);
  assert.equal(b.last().status, 'account-changed');
  assert.equal(b.last().serverHasData, true);
  assert.equal(b.store.get('cloud.account'), 'user-1', 'not rebound after a conflict');
});

test('a backup records the account whose plan it holds, or null for an unbound device', async () => {
  const { server, b } = await pair();
  b.session.user = USER2;
  server.rows.set('user-2', structuredClone(server.row('user-1')));
  await b.engine.start();
  await b.engine.chooseLink('replace');
  assert.deepEqual(b.backupSources, [{ uid: 'user-1' }]);
  const server2 = makeServer();
  const c = makeDevice(server2, 'dev-c');
  c.edit((state, ctx) => captureTask(state, { title: 'Local only' }, ctx));
  server2.rows.set('user-1', structuredClone((await pair()).server.row('user-1')));
  await c.engine.start();
  assert.equal(c.last().status, 'link-needed');
  await c.engine.chooseLink('replace');
  assert.deepEqual(c.backupSources, [{ uid: null }]);
});
