// Account sync engine (SYS-02, SYS-05, SYS-06). It keeps this device's plan and
// the account's copy on the server in step. It has no DOM dependency: the
// Supabase client, the engine's own memory (`store`) and the way a merged state
// is installed all come from the caller. mergeSync stays the only place where
// values are decided; this file decides only when to read, merge and push.
import {
  clearSyncedData, eraseUserData, exportSync, mergeSync, protectionsActive, settleFocusTask, SYNC_SCHEMA
} from './model.js';

const TABLE = 'sync_docs';
const DEBOUNCE_MS = 3000;
const POLL_MS = 5 * 60_000;
const MAX_ATTEMPTS = 3;
const MAX_MERGE_PUSHES = 3;
const PAUSED_AFTER_MS = 60 * 60_000;
const SKEW_MINUTES = 2;

const KEY = {
  account: 'cloud.account',
  rev: 'cloud.lastSeenRev',
  dirty: 'cloud.dirty',
  eraseSeen: 'cloud.eraseSeen',
  mergePushes: 'cloud.mergePushes',
  changeGen: 'cloud.changeGen',
  bindingPending: 'cloud.bindingPending'
};

const PROTECTED_MESSAGE = 'Turn off block rules and strict blocks on this device first; the change delay applies.';

const LISTS = ['tasks', 'workouts', 'focusSegments', 'strictLog', 'blockRules', 'appPresets',
  'pendingRuleChanges', 'pendingBlockChanges'];

function stable(value) {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().filter((key) => value[key] !== undefined)
      .map((key) => JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}';
  }
  return JSON.stringify(value) ?? 'null';
}

const byId = (list) => [...list].sort((a, b) => (String(a?.id) < String(b?.id) ? -1 : String(a?.id) > String(b?.id) ? 1 : 0));

// A string that is equal for two payloads that hold the same data. Collections
// of records are sorted by id and keys are sorted; arrays inside a record keep
// their order (subtasks, work blocks and links are ordered by the user).
// devices[*].lastSeenAt is left out because it changes on every launch.
export function canonical(data) {
  const copy = { ...data };
  for (const key of LISTS) copy[key] = byId(Array.isArray(data?.[key]) ? data[key] : []);
  copy.tasks = copy.tasks.map((task) => ({ ...task, events: byId(Array.isArray(task.events) ? task.events : []) }));
  copy.devices = Object.fromEntries(Object.entries(data?.devices ?? {}).map(([id, device]) => {
    const { lastSeenAt, ...rest } = device ?? {};
    return [id, rest];
  }));
  return stable(copy);
}

export function hasPlanData(source) {
  const data = source ?? {};
  return ['tasks', 'workouts', 'blockRules', 'appPresets'].some((key) => (data[key]?.length ?? 0) > 0);
}

const isMarker = (payload) => payload?.erasedAt != null && !hasPlanData(payload.data);

function failure(message, extra = {}) {
  return Object.assign(new Error(message), extra);
}

function isNetworkError(error) {
  if (!error) return false;
  if (error instanceof TypeError || error.name === 'TypeError') return true;
  return /failed to fetch|networkerror|network request failed|load failed|fetch failed/i.test(String(error.message ?? ''));
}

// Compares states ignoring when peers were last merged, which changes on every merge.
function comparable(state) {
  const peers = Object.fromEntries(Object.entries(state.peers ?? {}).map(([id, peer]) => {
    const { mergedAt, ...rest } = peer ?? {};
    return [id, rest];
  }));
  return stable({ ...state, peers });
}

export function createCloudSync({
  client, store, getState, applyMerged, device, now = () => new Date(), onStatus = () => {}, saveBackup = () => {},
  // Injection points for tests; the app uses the defaults.
  merge = mergeSync,
  timers = { setTimeout: globalThis.setTimeout.bind(globalThis), clearTimeout: globalThis.clearTimeout.bind(globalThis),
    setInterval: globalThis.setInterval.bind(globalThis), clearInterval: globalThis.clearInterval.bind(globalThis) },
  isOnline = () => globalThis.navigator?.onLine !== false,
  events = globalThis
}) {
  let started = false;
  let running = null;
  let again = false;
  let last = { status: 'signed-out' };
  let clockSkew = null;
  let skewPending = false;
  let gate = null; // { type: 'link-needed' | 'account-changed' | 'cancelled', uid, email, row }
  let pendingErase = null; // { payload, rev }
  let loopHalted = false;
  let serverSince = null;
  let debounce = null;
  let poll = null;
  let channel = null;

  const nowDate = () => new Date(+now());
  const nowMs = () => +now();
  const mergeContext = () => ({ now: nowDate(), device: device.id });

  function emit(status, detail = {}) {
    last = { status, ...detail };
    onStatus(last);
  }

  const getKey = (key) => store.get(key);
  const dirty = () => getKey(KEY.dirty) === true;
  const generation = () => Number(getKey(KEY.changeGen)) || 0;
  const lastSeenRev = () => (getKey(KEY.rev) == null ? null : Number(getKey(KEY.rev)));

  function rebind(uid) {
    store.set(KEY.account, uid);
    store.set(KEY.rev, null);
    store.set(KEY.dirty, false);
    store.set(KEY.eraseSeen, null);
    store.set(KEY.mergePushes, 0);
  }

  function exportNow() {
    return { ...exportSync(getState(), device, nowDate()), erasedAt: getKey(KEY.eraseSeen) ?? null };
  }

  async function check(result) {
    const { error } = result;
    if (error) {
      throw Object.assign(new Error(error.message ?? 'Request failed.'), {
        name: error.name, status: result.status ?? error.status ?? error.statusCode ?? null
      });
    }
    return result;
  }

  const rowQuery = (columns, uid) => client.from(TABLE).select(columns).eq('user_id', uid).maybeSingle();

  async function readRow(columns, uid) {
    const { data } = await check(await rowQuery(columns, uid));
    if (!data) return null;
    return { ...data, rev: Number(data.rev) };
  }

  async function pushRpc(expectedRev, payload) {
    const { data } = await check(await client.rpc('push_sync_doc', { expected_rev: expectedRev, new_payload: payload }));
    return data == null ? null : Number(data);
  }

  async function sessionUser() {
    const { data } = await client.auth.getSession();
    const user = data?.session?.user;
    return user?.id ? { uid: user.id, email: user.email ?? null } : null;
  }

  // ---- account binding ----------------------------------------------------

  // Returns the user id when sync may run, or null when it must stay paused.
  async function checkBinding() {
    const user = await sessionUser();
    if (!user) {
      emit('signed-out');
      return null;
    }
    // A replace that stopped after installing the account copy but before
    // recording the binding: finish it only when the saved state itself carries
    // the new account (`cloudAccount` is written with the data in one apply).
    // If the apply never reached storage, the old plan is still local and must
    // not be bound to, or uploaded into, the new account.
    const pending = getKey(KEY.bindingPending);
    if (pending) {
      if (pending === user.uid && getState().cloudAccount === user.uid) {
        rebind(user.uid);
        store.set(KEY.dirty, true);
      }
      store.set(KEY.bindingPending, null);
    }
    const bound = getKey(KEY.account);
    if (bound === user.uid) {
      gate = null;
      return user.uid;
    }
    if (gate && gate.uid === user.uid) return null;
    const localHasData = hasPlanData(getState());
    if (bound) {
      gate = { type: 'account-changed', uid: user.uid, email: user.email };
      emit('account-changed', { email: user.email, serverHasData: null, localHasData });
      return null;
    }
    const row = await readRow('payload, rev', user.uid);
    if (!row || isMarker(row.payload)) {
      rebind(user.uid);
      if (row) store.set(KEY.eraseSeen, row.payload.erasedAt);
      store.set(KEY.dirty, true);
      return user.uid;
    }
    if (!localHasData) {
      gate = { type: 'link-needed', uid: user.uid, email: user.email, row };
      return (await replaceWith(user.uid, row)) ? user.uid : null;
    }
    gate = { type: 'link-needed', uid: user.uid, email: user.email, row };
    emit('link-needed', { email: user.email, serverHasData: true, localHasData });
    return null;
  }

  function newerSchema(payload) {
    return Number.isInteger(payload?.schema) && payload.schema > SYNC_SCHEMA;
  }

  function updateApp() {
    emit('error', { code: 'update-app', message: 'Update the app to read the account copy.' });
  }

  // Replaces this device's synced data with the account's copy. Device-local
  // fields, including a running focus session and its strict hold, survive.
  async function replaceWith(uid, row) {
    if (row && newerSchema(row.payload)) {
      updateApp();
      return false;
    }
    // Replacing would drop this device's rules, waiting changes and strict
    // blocks at once, so it waits until they are turned off the normal way.
    if (protectionsActive(getState(), nowDate())) {
      emit('error', { code: 'protected', message: PROTECTED_MESSAGE });
      return false;
    }
    // The backup must hold exactly what is about to be cleared: retry when the
    // plan changed while the backup was being written.
    let backedUp = false;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS && !backedUp; attempt += 1) {
      const snapshot = getState();
      if (!hasPlanData(snapshot)) {
        backedUp = true;
        break;
      }
      const gen = generation();
      try {
        await saveBackup(exportSync(snapshot, device, nowDate()));
      } catch (error) {
        emit('error', { code: 'backup', message: error?.message ?? 'The backup could not be saved.' });
        return false;
      }
      backedUp = generation() === gen;
    }
    if (!backedUp) {
      emit('error', { code: 'backup', message: 'The plan kept changing while it was being backed up. Try again.' });
      return false;
    }
    if (protectionsActive(getState(), nowDate())) {
      emit('error', { code: 'protected', message: PROTECTED_MESSAGE });
      return false;
    }
    // From here to applyMerged there is no await, so the backup matches what is cleared.
    const base = clearSyncedData(getState(), nowDate());
    let next = base;
    let summary = null;
    if (row) {
      try {
        ({ state: next, summary } = merge(base, row.payload, { ...mergeContext(), allowOwn: true, preferRemoteRoot: true }));
      } catch (error) {
        emit('error', { code: 'bad-remote', message: error.message });
        return false;
      }
    }
    store.set(KEY.bindingPending, uid);
    try {
      // cloudAccount is device-local (never exported) and is saved together with the replaced plan.
      await applyMerged({ ...settleFocusTask(next), cloudAccount: uid }, { reason: 'replace', summary });
    } catch (error) {
      store.set(KEY.bindingPending, null);
      emit('error', { code: 'apply', message: error?.message ?? 'The account copy could not be saved on this device.' });
      return false;
    }
    rebind(uid);
    store.set(KEY.bindingPending, null);
    if (row) {
      store.set(KEY.rev, row.rev);
      store.set(KEY.eraseSeen, row.payload.erasedAt ?? null);
    }
    gate = null;
    return true;
  }

  async function chooseLink(choice = 'replace') {
    const current = gate;
    if (!current || (current.type !== 'link-needed' && current.type !== 'account-changed')) return;
    if (choice === 'cancel') {
      gate = { type: 'cancelled', uid: current.uid };
      return;
    }
    if (choice !== 'replace') throw new Error('Unknown choice.');
    let row = current.row ?? null;
    if (current.type === 'account-changed') row = await readRow('payload, rev', current.uid);
    if (await replaceWith(current.uid, row)) await syncNow();
  }

  // ---- one sync pass ------------------------------------------------------

  function synced() {
    serverSince = null;
    emit('synced', { at: nowDate().toISOString() });
  }

  async function checkSkew() {
    if (!skewPending) return;
    skewPending = false;
    try {
      const { data } = await check(await client.rpc('server_now'));
      const minutes = Math.round(Math.abs(Date.parse(data) - nowMs()) / 60_000);
      clockSkew = minutes > SKEW_MINUTES ? minutes : null;
      if (clockSkew !== null) onStatus({ status: 'clock-skew', minutes: clockSkew });
    } catch {
      // The check is advisory; try again on the next start.
    }
  }

  // Dirty is cleared only when no edit arrived since the export was taken.
  const commit = (rev, seenGeneration) => {
    store.set(KEY.rev, rev);
    if (generation() === seenGeneration) store.set(KEY.dirty, false);
  };

  async function cycle(uid) {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      if (attempt === 1) {
        const head = await readRow('rev', uid);
        if (head && head.rev === lastSeenRev() && !dirty()) {
          synced();
          await checkSkew();
          return;
        }
      }
      emit('syncing');
      const row = await readRow('payload, rev', uid);
      if (!row) {
        const seenChanges = generation();
        const rev = await pushRpc(0, exportNow());
        if (rev === null) continue;
        commit(rev, seenChanges);
        synced();
        await checkSkew();
        return;
      }
      const { payload, rev } = row;
      const seen = getKey(KEY.eraseSeen) ?? null;
      if (payload?.erasedAt != null && payload.erasedAt !== seen) {
        pendingErase = { payload, rev };
        emit('erased', { deviceName: payload.deviceName ?? null, erasedAt: payload.erasedAt });
        return;
      }
      if (newerSchema(payload)) {
        updateApp();
        return;
      }
      const local = getState();
      let merged;
      try {
        merged = merge(local, payload, { ...mergeContext(), allowOwn: true });
      } catch (error) {
        emit('error', { code: 'bad-remote', message: error.message });
        return;
      }
      if (comparable(merged.state) !== comparable(local)) {
        await applyMerged(merged.state, { reason: 'merge', summary: merged.summary });
      }
      const seenChanges = generation();
      const outgoing = exportNow();
      const sameAsRemote = canonical(outgoing.data) === canonical(payload.data)
        && (outgoing.erasedAt ?? null) === (payload.erasedAt ?? null);
      if (sameAsRemote) {
        commit(rev, seenChanges);
        store.set(KEY.mergePushes, 0);
        synced();
        await checkSkew();
        return;
      }
      const mergeOnly = !dirty();
      const count = mergeOnly ? (Number(getKey(KEY.mergePushes)) || 0) + 1 : 0;
      if (loopHalted || count > MAX_MERGE_PUSHES) {
        loopHalted = true;
        emit('error', { code: 'loop', message: 'Sync stopped because this device and the account keep changing each other.' });
        return;
      }
      const next = await pushRpc(rev, outgoing);
      if (next === null) continue;
      store.set(KEY.mergePushes, count);
      commit(next, seenChanges);
      synced();
      await checkSkew();
      return;
    }
    emit('error', { code: 'busy', message: 'The account copy keeps changing. Try again shortly.' });
  }

  function report(error) {
    if (isNetworkError(error) || !isOnline()) {
      serverSince = null;
      emit('offline');
      return;
    }
    const status = Number(error?.status);
    const message = error?.message ?? 'Sync failed.';
    if (status >= 500) {
      serverSince ??= nowMs();
      const long = nowMs() - serverSince > PAUSED_AFTER_MS;
      emit('error', { code: long ? 'paused' : 'server', message });
      return;
    }
    serverSince = null;
    emit('error', { code: 'server', message });
  }

  async function syncOnce() {
    if (!started) return;
    if (!isOnline()) {
      emit('offline');
      return;
    }
    try {
      const uid = await checkBinding();
      if (!uid || pendingErase) return;
      await cycle(uid);
    } catch (error) {
      report(error);
    }
  }

  function syncNow() {
    if (!started) return Promise.resolve();
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      try {
        do {
          again = false;
          await syncOnce();
        } while (again && started);
      } finally {
        running = null;
      }
    })();
    return running;
  }

  async function chooseErase(choice) {
    const marker = pendingErase;
    if (!marker) return;
    if (choice === 'erase-here') {
      if (protectionsActive(getState(), nowDate())) {
        emit('error', { code: 'protected', message: PROTECTED_MESSAGE });
        return;
      }
      await applyMerged(settleFocusTask(clearSyncedData(getState(), nowDate())), { reason: 'erase', summary: null });
      pendingErase = null;
      store.set(KEY.eraseSeen, marker.payload.erasedAt);
      store.set(KEY.rev, marker.rev);
      store.set(KEY.dirty, false);
      store.set(KEY.mergePushes, 0);
      return;
    }
    if (choice !== 'upload-again') throw new Error('Unknown choice.');
    pendingErase = null;
    store.set(KEY.eraseSeen, marker.payload.erasedAt);
    store.set(KEY.dirty, true);
    store.set(KEY.changeGen, generation() + 1);
    await syncNow();
  }

  // ---- triggers -----------------------------------------------------------

  function noteLocalChange() {
    store.set(KEY.changeGen, generation() + 1);
    loopHalted = false;
    store.set(KEY.dirty, true);
    if (!started) return;
    timers.clearTimeout(debounce);
    debounce = timers.setTimeout(() => { debounce = null; syncNow(); }, DEBOUNCE_MS);
  }

  const onNetwork = () => { syncNow(); };

  function subscribe(uid) {
    if (typeof client.channel !== 'function') return;
    const filter = `user_id=eq.${uid}`;
    const handler = () => { syncNow(); };
    try {
      channel = client.channel(`sync-docs-${uid}`);
      for (const event of ['INSERT', 'UPDATE']) {
        channel = channel.on('postgres_changes', { event, schema: 'public', table: TABLE, filter }, handler);
      }
      channel.subscribe();
    } catch {
      channel = null; // Realtime is an accelerator; the poll still runs.
    }
  }

  async function stop() {
    started = false;
    timers.clearTimeout(debounce);
    debounce = null;
    if (poll !== null) timers.clearInterval(poll);
    poll = null;
    events?.removeEventListener?.('online', onNetwork);
    if (channel) {
      const old = channel;
      channel = null;
      try { await client.removeChannel?.(old); } catch { /* already gone */ }
    }
    if (running) await running.catch(() => {});
  }

  async function start() {
    await stop();
    started = true;
    gate = null;
    pendingErase = null;
    skewPending = true;
    events?.addEventListener?.('online', onNetwork);
    poll = timers.setInterval(() => { syncNow(); }, POLL_MS);
    try {
      const user = await sessionUser();
      if (!user) {
        emit('signed-out');
        return;
      }
      subscribe(user.uid);
    } catch (error) {
      report(error);
      return;
    }
    await syncNow();
  }

  // Erases this account's copy and this device (SYS-05). The marker goes up
  // first; the local data is cleared only after it is stored.
  async function eraseEverywhere(state = getState()) {
    eraseUserData(state, nowMs()); // Refuses during a focus session or strict hold.
    if (protectionsActive(state, nowDate())) throw failure(PROTECTED_MESSAGE, { code: 'protected' });
    const wasStarted = started;
    await stop();
    try {
      const user = await sessionUser();
      if (!user) throw failure('Sign in to erase the account copy.');
      // Only the account this device is bound to; never another account's copy
      // while a link or account-change choice is pending.
      if (getKey(KEY.account) !== user.uid) throw failure('Finish linking this device to the account first.', { code: 'not-bound' });
      const erasedAt = nowDate().toISOString();
      const marker = { ...exportSync(clearSyncedData(state, nowDate()), device, nowDate()), erasedAt };
      let rev = null;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS && rev === null; attempt += 1) {
        const row = await readRow('rev', user.uid);
        rev = await pushRpc(row ? row.rev : 0, marker);
      }
      if (rev === null) throw failure('The account copy keeps changing. Try again shortly.', { code: 'busy' });
      // Recomputed after the awaits so device-local changes made meanwhile (a
      // session that started, for example) are kept.
      await applyMerged(settleFocusTask(clearSyncedData(getState(), nowDate())), { reason: 'erase', summary: null });
      rebind(user.uid);
      store.set(KEY.eraseSeen, erasedAt);
      store.set(KEY.rev, rev);
      store.set(KEY.dirty, false);
    } catch (error) {
      if (wasStarted) await start();
      throw error;
    }
    await start();
  }

  return {
    start, stop, syncNow, noteLocalChange, chooseLink, chooseErase, eraseEverywhere,
    status: () => ({ ...last, clockSkew })
  };
}
