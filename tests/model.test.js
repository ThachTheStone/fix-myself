import assert from 'node:assert/strict';
import test from 'node:test';
import {
  focusSnapshot, localDate, normalizeDomains, onLogin, readState, saveState,
  startFocus, todayTasks, toggleTask, updateTask
} from '../app/model.js';

function makeStorage() {
  let value = null;
  return { getItem: () => value, setItem: (_key, next) => { value = next; } };
}

test('tasks persist and the focus snapshot follows the next unfinished priority', () => {
  const storage = makeStorage();
  const now = new Date(2026, 10, 19, 8, 0);
  let state = readState(storage);
  const fields = { plannedDate: localDate(now), deadline: null, pinned: false };
  state = updateTask(state, { ...fields, title: 'Write an outline' }, now);
  state = updateTask(state, { ...fields, title: "Review today's plan", pinned: true }, now);
  state = updateTask(state, { ...fields, title: 'Later', plannedDate: '2026-11-20' }, now);
  state = startFocus(state, now);
  saveState(storage, state);

  let recovered = readState(storage);
  assert.equal(todayTasks(recovered, localDate(now)).length, 2);
  assert.equal(focusSnapshot(recovered, now).nextAction, "Review today's plan");
  recovered = toggleTask(recovered, recovered.tasks[1].id, now);
  assert.equal(focusSnapshot(recovered, now).nextAction, 'Write an outline');
});

test('the login session persists through restart and starts once per local day', () => {
  const storage = makeStorage();
  const initial = readState(storage);
  initial.preferences.focusAtLogin = true;
  initial.preferences.focusMinutes = 30;
  const morning = new Date(2026, 10, 19, 8, 0);
  saveState(storage, onLogin(initial, morning));

  const saved = readState(storage);
  assert.equal(saved.focus.endAt, morning.getTime() + 30 * 60_000);
  assert.equal(onLogin(saved, new Date(2026, 10, 19, 13, 0)), saved);
  assert.equal(focusSnapshot(saved, new Date(saved.focus.endAt)), null);
  const tomorrow = new Date(2026, 10, 20, 8, 0);
  assert.equal(onLogin(saved, tomorrow).focus.endAt, tomorrow.getTime() + 30 * 60_000);
});

test('starting focus again and changing future settings preserve the running session', () => {
  const now = new Date(2026, 10, 19, 23, 59);
  const state = startFocus(readState(makeStorage()), now);
  state.preferences.focusAtLogin = true;
  state.preferences.focusMinutes = 90;
  state.preferences.domains = ['example.org'];
  const afterMidnight = new Date(2026, 10, 20, 0, 1);
  const afterLogin = onLogin(state, afterMidnight);
  assert.equal(afterLogin.focus, state.focus);
  assert.deepEqual(focusSnapshot(afterLogin, afterMidnight).domains,
    ['youtube.com', 'facebook.com', 'instagram.com']);
});

test('domain rules accept distinct domains and reject URL paths', () => {
  assert.deepEqual(normalizeDomains('YouTube.com, example.org\nyoutube.com'), ['youtube.com', 'example.org']);
  assert.throws(() => normalizeDomains('https://youtube.com/shorts'));
});
