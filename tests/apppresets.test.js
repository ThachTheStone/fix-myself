import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deleteAppPreset, exportSync, focusSnapshot, mergeSync, migrateState, onLogin, readState,
  saveAppPreset, saveState, setAutoAppPreset, startFocus, validateAppPreset
} from '../app/model.js';

function makeStorage(initial = null) {
  let value = initial;
  return { getItem: () => value, setItem: (_key, next) => { value = next; } };
}

function fresh(timeZone = 'UTC') {
  const state = readState(makeStorage());
  return { ...state, settings: { ...state.settings, timeZone } };
}

const at = (text) => new Date(text);
const ctx = (text, device = 'pc') => ({ now: at(text), device });
const code = (label) => `C:\\Apps\\${label}\\${label}.exe`;
const slack = () => [{ path: code('Slack'), name: 'Slack' }];

const draft = (overrides = {}) => ({
  name: 'Deep work',
  apps: [{ path: code('Code'), name: 'Visual Studio Code' }],
  strength: 'block',
  ...overrides
});

function withPreset(state, changes = {}, when = '2026-05-04T09:00:00Z') {
  const saved = saveAppPreset(state, null, draft(changes), ctx(when));
  return { state: saved, preset: saved.appPresets.at(-1) };
}

test('presets keep cleaned app labels, drop duplicates and never limit the shell (APP-01)', () => {
  const preset = validateAppPreset({
    name: '  Deep work  ',
    apps: [
      { path: 'C:\\Apps\\Code\\Code.exe', name: '  Visual Studio Code ' },
      { path: 'c:\\apps\\code\\code.exe', name: 'Duplicate' },
      { path: 'C:\\Windows\\explorer.exe' },
      { path: 'C:\\Windows\\System32\\taskmgr.exe' },
      { path: 'C:\\Apps\\Slack\\slack.exe' }
    ],
    strength: 'pause',
    countdownSeconds: '20',
    passMinutes: '5'
  });
  assert.equal(preset.name, 'Deep work');
  assert.deepEqual(preset.apps, [
    { path: 'C:\\Apps\\Code\\Code.exe', name: 'Visual Studio Code' },
    { path: 'C:\\Apps\\Slack\\slack.exe', name: 'slack' }
  ]);
  assert.equal(preset.strength, 'pause');
  assert.equal(preset.countdownSeconds, 20);
  assert.equal(preset.passMinutes, 5);
  assert.equal(validateAppPreset(draft({ strength: undefined })).strength, 'block');
});

test('presets reject missing names, empty app lists, non-executables and oversized fields (APP-01)', () => {
  assert.throws(() => validateAppPreset({ name: '  ', apps: [{ path: code('Code') }] }), /Enter a preset name/);
  assert.throws(() => validateAppPreset({ name: 'x'.repeat(61), apps: [{ path: code('Code') }] }), /60 characters/);
  assert.throws(() => validateAppPreset({ name: 'Work', apps: [] }), /at least one app/);
  assert.throws(() => validateAppPreset({ name: 'Work', apps: [{ path: 'C:\\Apps\\Code\\code.txt' }] }), /Choose apps/);
  assert.throws(() => validateAppPreset({ name: 'Work', apps: [{ path: 'explorer.exe' }] }), /at least one app/);
  const many = Array.from({ length: 31 }, (_item, index) => ({ path: code(`App${index}`) }));
  assert.throws(() => validateAppPreset({ name: 'Work', apps: many }), /30 apps/);
  assert.throws(() => validateAppPreset(draft({ countdownSeconds: 2 })), /5 to 60/);
});

test('saving a preset stamps the plan, limits the list to ten and clears stale choices on delete (APP-01)', () => {
  let { state, preset } = withPreset(fresh());
  assert.equal(state.appPresets.length, 1);
  assert.equal(state.stamps.appPresets, '2026-05-04T09:00:00.000Z|pc');
  assert.ok(preset.id);

  const renamed = saveAppPreset(state, preset.id, { name: 'Focus' }, ctx('2026-05-04T09:05:00Z'));
  assert.equal(renamed.appPresets[0].name, 'Focus');
  assert.equal(renamed.appPresets[0].apps[0].name, 'Visual Studio Code', 'untouched fields stay');
  assert.equal(saveAppPreset(renamed, preset.id, { name: 'Focus' }, ctx('2026-05-04T09:06:00Z')), renamed);
  assert.throws(() => saveAppPreset(renamed, 'missing', { name: 'Nope' }, ctx('2026-05-04T09:07:00Z')), /no longer exists/);

  state = renamed;
  for (let index = 1; index < 10; index += 1) {
    state = saveAppPreset(state, null, draft({ name: `Preset ${index}` }), ctx('2026-05-04T09:10:00Z'));
  }
  assert.equal(state.appPresets.length, 10);
  assert.throws(() => saveAppPreset(state, null, draft({ name: 'Eleven' }), ctx('2026-05-04T09:11:00Z')), /10 presets/);

  state = setAutoAppPreset(state, preset.id);
  state = { ...state, preferences: { ...state.preferences, lastAppPreset: preset.id } };
  const removed = deleteAppPreset(state, preset.id, ctx('2026-05-04T09:12:00Z'));
  assert.equal(removed.appPresets.some((item) => item.id === preset.id), false);
  assert.equal(removed.preferences.autoAppPreset, null);
  assert.equal(removed.preferences.lastAppPreset, null);
  assert.equal(deleteAppPreset(removed, preset.id, ctx('2026-05-04T09:13:00Z')), removed);
  assert.throws(() => setAutoAppPreset(removed, preset.id), /no longer exists/);
});

test('a started session copies its preset so later edits wait for the next session (APP-02)', () => {
  const { state, preset } = withPreset(fresh());
  const running = startFocus(state, at('2026-05-04T09:20:00Z'), { presetId: preset.id });
  assert.equal(running.preferences.lastAppPreset, preset.id);
  assert.deepEqual(running.focus.apps, {
    presetId: preset.id,
    name: 'Deep work',
    strength: 'block',
    countdownSeconds: preset.countdownSeconds,
    passMinutes: preset.passMinutes,
    apps: [{ path: code('Code'), name: 'Visual Studio Code' }]
  });

  const edited = saveAppPreset(running, preset.id, { apps: slack() }, ctx('2026-05-04T09:25:00Z'));
  assert.deepEqual(edited.focus.apps.apps, [{ path: code('Code'), name: 'Visual Studio Code' }]);

  const stored = makeStorage();
  saveState(stored, edited);
  const restarted = readState(stored);
  assert.deepEqual(restarted.focus.apps.apps, [{ path: code('Code'), name: 'Visual Studio Code' }]);
  assert.equal(restarted.preferences.lastAppPreset, preset.id);

  const next = startFocus({ ...edited, focus: null }, at('2026-05-05T09:00:00Z'), { presetId: preset.id });
  assert.deepEqual(next.focus.apps.apps, slack());
  assert.throws(
    () => startFocus({ ...edited, focus: null }, at('2026-05-05T09:00:00Z'), { presetId: 'gone' }),
    /no longer exists/
  );
});

test('choosing no app limit clears the remembered preset, while automatic sessions keep it (APP-02)', () => {
  const { state, preset } = withPreset(fresh());
  const manual = startFocus(state, at('2026-05-04T09:20:00Z'), { presetId: preset.id });
  const cleared = startFocus({ ...manual, focus: null }, at('2026-05-04T10:00:00Z'), { presetId: null });
  assert.equal(cleared.focus.apps, null);
  assert.equal(cleared.preferences.lastAppPreset, null);

  const untouched = startFocus({ ...cleared, focus: null }, at('2026-05-04T10:30:00Z'));
  assert.equal(untouched.preferences.lastAppPreset, null);
  assert.equal(untouched.focus.apps, null);

  const auto = setAutoAppPreset(state, preset.id);
  const waking = { ...auto, preferences: { ...auto.preferences, focusAtLogin: true } };
  const login = onLogin(waking, at('2026-05-05T08:00:00Z'));
  assert.equal(login.focus.apps.name, 'Deep work');
  assert.equal(login.preferences.lastAppPreset, preset.id);
  assert.equal(onLogin(login, at('2026-05-05T09:00:00Z')), login, 'one session per day');

  const stale = { ...waking, preferences: { ...waking.preferences, autoAppPreset: 'gone' } };
  const noPreset = onLogin(stale, at('2026-05-05T08:00:00Z'));
  assert.equal(noPreset.focus.apps, null);
  assert.equal(noPreset.focus.endAt > 0, true);
});

test('the Chrome snapshot keeps app paths on this device (APP-08)', () => {
  const { state, preset } = withPreset(fresh());
  const running = startFocus(state, at('2026-05-04T09:20:00Z'), { presetId: preset.id });
  const snapshot = focusSnapshot(running, at('2026-05-04T09:25:00Z'));
  assert.equal(snapshot.apps, undefined);
  assert.equal(JSON.stringify(snapshot).includes('Code.exe'), false);
});

test('presets travel in sync files, reject broken entries and take newer remote edits (APP-08)', () => {
  const { state } = withPreset(fresh());
  const exported = exportSync(state, { id: 'pc', name: 'PC' }, at('2026-05-04T09:00:00Z'));
  assert.equal(exported.data.appPresets.length, 1);

  const merged = mergeSync(fresh(), exported, ctx('2026-05-04T09:10:00Z', 'laptop'));
  assert.equal(merged.state.appPresets.length, 1);
  assert.equal(merged.state.appPresets[0].name, 'Deep work');

  const id = merged.state.appPresets[0].id;
  const remote = saveAppPreset(merged.state, id, { apps: slack() }, ctx('2026-05-04T09:20:00Z', 'laptop'));
  const later = exportSync(remote, { id: 'laptop', name: 'Laptop' }, at('2026-05-04T09:20:00Z'));
  const adopted = mergeSync(fresh(), later, ctx('2026-05-04T09:30:00Z', 'pc'));
  assert.deepEqual(adopted.state.appPresets[0].apps.map((app) => app.name), ['Slack']);

  const broken = { ...exported, data: { ...exported.data, appPresets: [{ id: 1 }] } };
  assert.throws(() => mergeSync(fresh(), broken, ctx('2026-05-04T09:40:00Z', 'laptop')), /invalid app preset/);
});

test('older files without presets migrate to an empty list and keep the rest of the plan', () => {
  const legacy = JSON.parse(JSON.stringify(fresh()));
  delete legacy.appPresets;
  const migrated = migrateState(legacy);
  assert.deepEqual(migrated.appPresets, []);
  assert.deepEqual(migrateState({ ...legacy, appPresets: 'nope' }).appPresets, []);
});
