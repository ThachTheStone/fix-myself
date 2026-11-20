import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addToToday, captureTask, carryovers, deleteTask, deliveryReview, dueReminders, exportSync,
  focusSnapshot, inboxTasks, localDate, markDelivered, mergeSync, normalizeDomains, onLogin,
  parseLeadTimes, pendingDelivery, readState, resolveConflict, saveState, saveTask, saveWorkout,
  setNextAction, snoozeReminder, startFocus, STORAGE_KEY, todayTasks, todayView, toggleTask,
  updateSettings, weekRange, workoutLabel
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

test('tasks persist and the focus snapshot follows the chosen next action', () => {
  const storage = makeStorage();
  const now = at('2026-11-19T08:00:00Z');
  let state = fresh();
  const day = localDate(now, 'UTC');
  state = captureTask(state, { title: 'Write an outline', plannedDate: day }, ctx(now));
  state = captureTask(state, { title: "Review today's plan", plannedDate: day, pinned: true }, ctx(now));
  state = captureTask(state, { title: 'Later', plannedDate: '2026-11-20' }, ctx(now));
  state = startFocus(state, now);
  saveState(storage, state);

  let recovered = readState(storage);
  assert.equal(todayTasks(recovered, day).length, 2);
  assert.equal(focusSnapshot(recovered, now).nextAction, "Review today's plan");
  recovered = setNextAction(recovered, recovered.tasks[0].id, ctx(now));
  assert.equal(focusSnapshot(recovered, now).nextAction, 'Write an outline');
  recovered = toggleTask(recovered, recovered.tasks[0].id, ctx(now));
  assert.equal(recovered.nextActionId, null);
  assert.equal(focusSnapshot(recovered, now).nextAction, "Review today's plan");
});

test('a version 1 plan migrates with its tasks, mission and focus session', () => {
  const v1 = {
    version: 1,
    mission: 'Ship it',
    tasks: [
      { id: 'a', title: 'Done', plannedDate: null, deadline: null, pinned: false, createdAt: '2026-11-18T08:00:00.000Z', completedAt: '2026-11-18T09:00:00.000Z' },
      { id: 'b', title: 'Open', plannedDate: '2026-11-19', deadline: '2026-11-21T10:00:00.000Z', pinned: true, createdAt: '2026-11-18T08:00:00.000Z', completedAt: null }
    ],
    focus: { endAt: 5, domains: ['youtube.com'] },
    lastLoginDay: '2026-11-19',
    preferences: { focusAtLogin: true, focusMinutes: 30, domains: ['youtube.com'] }
  };
  const state = readState(makeStorage(JSON.stringify(v1)));
  assert.equal(state.version, 2);
  assert.equal(state.mission, 'Ship it');
  assert.deepEqual(state.tasks.map((task) => task.status), ['completed', 'open']);
  assert.equal(state.tasks[1].originalDeadline, '2026-11-21T10:00:00.000Z');
  assert.equal(state.preferences.focusMinutes, 30);
  assert.throws(() => readState(makeStorage(JSON.stringify({ version: 9 }))));
  assert.equal(STORAGE_KEY, 'fix-myself:v1');
});

test('the login session persists through restart and starts once per planning day', () => {
  const storage = makeStorage();
  const initial = fresh('Asia/Ho_Chi_Minh');
  initial.preferences.focusAtLogin = true;
  initial.preferences.focusMinutes = 30;
  const morning = at('2026-11-19T01:00:00Z');
  saveState(storage, onLogin(initial, morning));

  const saved = readState(storage);
  assert.equal(saved.focus.endAt, morning.getTime() + 30 * 60_000);
  assert.equal(saved.lastLoginDay, '2026-11-19');
  assert.equal(onLogin(saved, at('2026-11-19T06:00:00Z')), saved);
  assert.equal(focusSnapshot(saved, new Date(saved.focus.endAt)), null);
  // 17:30 UTC is already the next day in Ho Chi Minh City.
  const nextDay = at('2026-11-19T17:30:00Z');
  assert.equal(onLogin(saved, nextDay).focus.endAt, nextDay.getTime() + 30 * 60_000);
});

test('starting focus again and changing future settings preserve the running session', () => {
  const now = at('2026-11-19T23:59:00Z');
  const state = startFocus(fresh(), now);
  state.preferences.focusAtLogin = true;
  state.preferences.focusMinutes = 90;
  state.preferences.domains = ['example.org'];
  const afterMidnight = at('2026-11-20T00:01:00Z');
  const afterLogin = onLogin(state, afterMidnight);
  assert.equal(afterLogin.focus.endAt, state.focus.endAt);
  assert.deepEqual(focusSnapshot(afterLogin, afterMidnight).domains,
    ['youtube.com', 'facebook.com', 'instagram.com']);
});

test('domain and lead time rules reject invalid input', () => {
  assert.deepEqual(normalizeDomains('YouTube.com, example.org\nyoutube.com'), ['youtube.com', 'example.org']);
  assert.throws(() => normalizeDomains('https://youtube.com/shorts'));
  assert.deepEqual(parseLeadTimes('10, 60 10'), [60, 10]);
  assert.throws(() => parseLeadTimes('-5'));
});

test('quick capture lands in the inbox and priorities are limited to three', () => {
  let state = fresh();
  const c = ctx('2026-11-19T08:00:00Z');
  state = captureTask(state, { title: 'Captured idea' }, c);
  assert.deepEqual(inboxTasks(state).map((task) => task.title), ['Captured idea']);
  assert.equal(state.tasks[0].status, 'open');
  for (const title of ['One', 'Two', 'Three']) state = captureTask(state, { title, pinned: true }, c);
  assert.throws(() => captureTask(state, { title: 'Four', pinned: true }, c), /Unpin/);
  state = saveTask(state, state.tasks[0].id, { commitment: { outcome: 'Idea written up', committedAt: c.now } }, c);
  assert.equal(inboxTasks(state).length, 0);
  assert.throws(() => saveTask(state, state.tasks[0].id, { status: 'paused' }, c));
});

test('carryovers keep their deadline when added to today', () => {
  let state = fresh();
  const yesterday = ctx('2026-11-18T09:00:00Z');
  state = captureTask(state, { title: 'Draft report', plannedDate: '2026-11-18', deadline: '2026-11-21T17:00:00Z' }, yesterday);
  const today = ctx('2026-11-19T08:00:00Z');
  assert.deepEqual(carryovers(state, '2026-11-19').map((task) => task.title), ['Draft report']);
  state = addToToday(state, state.tasks[0].id, today);
  assert.equal(state.tasks[0].plannedDate, '2026-11-19');
  assert.equal(state.tasks[0].deadline, '2026-11-21T17:00:00.000Z');
  assert.equal(carryovers(state, '2026-11-19').length, 0);
  assert.equal(todayView(state, today.now).next.title, 'Draft report');
});

test('the timeline records commitments, rescheduled blocks, revised deadlines and reopening', () => {
  let state = fresh();
  const c = ctx('2026-11-19T08:00:00Z');
  state = captureTask(state, { title: 'Proposal', deadline: '2026-11-21T17:00:00Z' }, c);
  const id = state.tasks[0].id;
  state = saveTask(state, id, { commitment: { outcome: 'Proposal sent', committedAt: c.now } }, c);
  state = saveTask(state, id, { workBlocks: [{ id: 'b1', start: '2026-11-21T09:00:00Z', end: '2026-11-21T11:00:00Z' }] }, c);
  state = saveTask(state, id, { workBlocks: [{ id: 'b1', start: '2026-11-20T09:00:00Z', end: '2026-11-20T11:00:00Z' }] }, c);
  assert.equal(state.tasks[0].deadline, '2026-11-21T17:00:00.000Z', 'moving a block keeps the deadline');
  state = saveTask(state, id, { deadline: '2026-11-24T17:00:00Z' }, c);
  state = toggleTask(state, id, c);
  state = toggleTask(state, id, c);
  const task = state.tasks[0];
  assert.equal(task.originalDeadline, '2026-11-21T17:00:00.000Z');
  assert.deepEqual(task.events.map((event) => event.type), [
    'created', 'deadline_set', 'committed', 'block_scheduled', 'block_rescheduled',
    'deadline_revised', 'completed', 'reopened'
  ]);
});

test('A-07: reminders follow their triggers and are canceled on completion', () => {
  let state = fresh();
  const c = ctx('2026-11-19T08:00:00Z');
  state = updateSettings(state, { reminderLeads: { start: [10], deadline: [60] } }, c);
  state = captureTask(state, {
    title: 'Proposal',
    deadline: '2026-11-21T17:00:00Z',
    workBlocks: [{ id: 'b1', start: '2026-11-20T09:00:00Z', end: '2026-11-20T10:00:00Z' }]
  }, c);
  const id = state.tasks[0].id;
  const reminders = () => Object.values(state.reminders).filter((item) => item.status === 'pending');
  assert.deepEqual(reminders().map((item) => item.fireAt).sort(),
    ['2026-11-20T08:50:00.000Z', '2026-11-21T16:00:00.000Z']);

  state = saveTask(state, id, { workBlocks: [{ id: 'b1', start: '2026-11-20T13:00:00Z', end: '2026-11-20T14:00:00Z' }] }, c);
  assert.equal(state.tasks[0].deadline, '2026-11-21T17:00:00.000Z');
  assert.deepEqual(reminders().map((item) => item.fireAt).sort(),
    ['2026-11-20T12:50:00.000Z', '2026-11-21T16:00:00.000Z']);

  state = saveTask(state, id, { deadline: '2026-11-22T17:00:00Z' }, c);
  assert.deepEqual(reminders().filter((item) => item.kind === 'deadline').map((item) => item.fireAt),
    ['2026-11-22T16:00:00.000Z']);

  state = toggleTask(state, id, c);
  assert.equal(reminders().length, 0);
});

test('reminders can be snoozed, are grouped when missed, and respect the notification device', () => {
  let state = fresh();
  const c = ctx('2026-11-19T08:00:00Z');
  state = updateSettings(state, { reminderLeads: { start: [], deadline: [30] } }, c);
  state = captureTask(state, { title: 'A', deadline: '2026-11-19T10:00:00Z' }, c);
  state = captureTask(state, { title: 'B', deadline: '2026-11-19T11:00:00Z' }, c);
  const later = at('2026-11-19T12:00:00Z');
  const { missed, single } = pendingDelivery(state, later, 'pc');
  assert.equal(missed.length, 2);
  assert.equal(single.length, 0);
  state = markDelivered(state, missed.map((item) => item.id), later);
  assert.equal(pendingDelivery(state, later, 'pc').missed.length, 0);
  state = snoozeReminder(state, missed[0].id, 10, later);
  assert.equal(dueReminders(state, later).length, 1);
  assert.equal(dueReminders(state, at('2026-11-19T12:11:00Z')).length, 2);
  state = updateSettings(state, { notifyDevice: 'phone' }, c);
  assert.equal(dueReminders(state, later, 'pc').length, 0);
  assert.equal(dueReminders(state, later, 'phone').length, 1);
});

test('A-10: conflicting offline edits surface both values and deletions are not restored', () => {
  let pc = fresh();
  pc = captureTask(pc, { title: 'Shared task' }, ctx('2026-11-19T08:00:00Z', 'pc'));
  pc = captureTask(pc, { title: 'Doomed task' }, ctx('2026-11-19T08:00:00Z', 'pc'));
  let phone = fresh();
  phone = mergeSync(phone, exportSync(pc, { id: 'pc', name: 'PC' }, at('2026-11-19T08:01:00Z')), ctx('2026-11-19T08:02:00Z', 'phone')).state;
  pc = mergeSync(pc, exportSync(phone, { id: 'phone', name: 'Phone' }, at('2026-11-19T08:03:00Z')), ctx('2026-11-19T08:04:00Z', 'pc')).state;
  const [shared, doomed] = pc.tasks.map((task) => task.id);

  // Both devices edit offline.
  pc = saveTask(pc, shared, { title: 'Shared task (PC)' }, ctx('2026-11-19T09:00:00Z', 'pc'));
  pc = deleteTask(pc, doomed, ctx('2026-11-19T09:00:00Z', 'pc'));
  phone = saveTask(phone, shared, { title: 'Shared task (phone)', nextStep: 'Call Lan' }, ctx('2026-11-19T09:05:00Z', 'phone'));
  phone = saveTask(phone, doomed, { title: 'Doomed but edited' }, ctx('2026-11-19T09:05:00Z', 'phone'));

  const result = mergeSync(pc, exportSync(phone, { id: 'phone', name: 'Phone' }, at('2026-11-19T10:00:00Z')), ctx('2026-11-19T10:01:00Z', 'pc'));
  pc = result.state;
  assert.equal(result.summary.conflicts, 1);
  assert.equal(pc.tasks.length, 1, 'the deleted task stays deleted');
  assert.equal(pc.tasks[0].title, 'Shared task (PC)');
  assert.equal(pc.tasks[0].nextStep, 'Call Lan', 'non-conflicting fields merge');
  assert.deepEqual([pc.conflicts[0].local, pc.conflicts[0].remote], ['Shared task (PC)', 'Shared task (phone)']);

  pc = resolveConflict(pc, pc.conflicts[0].id, 'remote', ctx('2026-11-19T10:02:00Z', 'pc'));
  assert.equal(pc.tasks[0].title, 'Shared task (phone)');
  assert.equal(pc.conflicts.length, 0);

  // The phone receives the resolution without a second conflict and drops the deleted task.
  const back = mergeSync(phone, exportSync(pc, { id: 'pc', name: 'PC' }, at('2026-11-19T10:03:00Z')), ctx('2026-11-19T10:04:00Z', 'phone'));
  assert.equal(back.summary.conflicts, 0);
  assert.deepEqual(back.state.tasks.map((task) => task.title), ['Shared task (phone)']);

  // Importing the same file twice does not duplicate anything.
  const again = mergeSync(back.state, exportSync(pc, { id: 'pc', name: 'PC' }, at('2026-11-19T10:03:00Z')), ctx('2026-11-19T10:05:00Z', 'phone'));
  assert.equal(again.state.tasks.length, 1);
  assert.throws(() => mergeSync(pc, { format: 'other' }, ctx('2026-11-19T10:05:00Z', 'pc')));
});

test('REV-01: on-time rate counts commitments due in the period, excluding cancellations', () => {
  let state = fresh();
  const c = ctx('2026-11-16T08:00:00Z');
  const commit = { outcome: 'Delivered', committedAt: c.now };
  state = captureTask(state, { title: 'On time', deadline: '2026-11-18T17:00:00Z', commitment: commit }, c);
  state = captureTask(state, { title: 'Late', deadline: '2026-11-18T17:00:00Z', commitment: commit }, c);
  state = captureTask(state, { title: 'Open', deadline: '2026-11-19T17:00:00Z', commitment: commit }, c);
  state = captureTask(state, { title: 'Canceled', deadline: '2026-11-19T17:00:00Z', commitment: commit }, c);
  state = captureTask(state, { title: 'Undated', commitment: commit }, c);
  const [onTime, late, , canceled] = state.tasks.map((task) => task.id);
  state = toggleTask(state, onTime, ctx('2026-11-18T16:00:00Z'));
  state = toggleTask(state, late, ctx('2026-11-19T09:00:00Z'));
  state = saveTask(state, canceled, { status: 'canceled' }, c);
  const { start, end } = weekRange('2026-11-19');
  assert.deepEqual([start, end], ['2026-11-16', '2026-11-22']);
  const review = deliveryReview(state, start, end);
  assert.equal(review.due.length, 3);
  assert.equal(review.completed.length, 2);
  assert.equal(review.onTime.length, 1);
  assert.equal(review.carryovers.length, 1);
  assert.equal(review.undated.length, 1);
  assert.equal(review.onTimeRate, 1 / 3);
  assert.equal(deliveryReview(state, '2026-12-01', '2026-12-07').onTimeRate, null);
});

test('workouts sync without their photo', () => {
  let pc = fresh();
  pc = saveWorkout(pc, { date: '2026-11-19', type: 'Run', minutes: 30, photoId: 'local-photo' }, ctx('2026-11-19T08:00:00Z'));
  assert.equal(workoutLabel(pc.workouts[0]), 'Photo attached');
  const payload = exportSync(pc, { id: 'pc', name: 'PC' }, at('2026-11-19T08:01:00Z'));
  assert.equal(JSON.stringify(payload).includes('local-photo'), false);
  const phone = mergeSync(fresh(), payload, ctx('2026-11-19T08:02:00Z', 'phone')).state;
  assert.equal(workoutLabel(phone.workouts[0]), 'Photo on another device');
});
