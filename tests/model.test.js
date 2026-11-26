import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addToToday, captureTask, carryovers, deleteTask, deliveryReview, dueReminders, exportSync,
  appLimitSnapshot, endFocus, focusTimeReview, pauseFocus, resumeFocus, settleFocus, taskFocusMinutes,
  focusSnapshot, inboxTasks, localDate, markDelivered, mergeSync, normalizeDomains, onLogin,
  parseLeadTimes, pendingDelivery, readState, resolveConflict, saveState, saveTask, saveWorkout,
  setNextAction, snoozeReminder, startFocus, STORAGE_KEY, todayTasks, todayView, toggleTask,
  updateSettings, weekRange, workoutLabel, recordChromeReports, distractionReview, chromeCoverage, compareVersions,
  miniTimerView, setMiniTimer
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
  assert.equal(state.version, 3);
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
  state = saveTask(state, state.tasks[0].id, { deadline: '2026-11-21T17:00:00Z' }, c);
  assert.equal(inboxTasks(state).length, 0, 'a deadline takes a task out of the inbox');
  state = saveTask(state, state.tasks[0].id, { deadline: null }, c);
  assert.deepEqual(inboxTasks(state).map((task) => task.title), ['Captured idea'], 'without a deadline it returns');
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

test('the timeline records rescheduled blocks, revised deadlines and reopening', () => {
  let state = fresh();
  const c = ctx('2026-11-19T08:00:00Z');
  state = captureTask(state, { title: 'Proposal', deadline: '2026-11-21T17:00:00Z' }, c);
  const id = state.tasks[0].id;
  state = saveTask(state, id, { workBlocks: [{ id: 'b1', start: '2026-11-21T09:00:00Z', end: '2026-11-21T11:00:00Z' }] }, c);
  state = saveTask(state, id, { workBlocks: [{ id: 'b1', start: '2026-11-20T09:00:00Z', end: '2026-11-20T11:00:00Z' }] }, c);
  assert.equal(state.tasks[0].deadline, '2026-11-21T17:00:00.000Z', 'moving a block keeps the deadline');
  state = saveTask(state, id, { deadline: '2026-11-24T17:00:00Z' }, c);
  state = toggleTask(state, id, c);
  state = toggleTask(state, id, c);
  const task = state.tasks[0];
  assert.equal(task.originalDeadline, '2026-11-21T17:00:00.000Z');
  assert.deepEqual(task.events.map((event) => event.type), [
    'created', 'deadline_set', 'block_scheduled', 'block_rescheduled',
    'deadline_revised', 'completed', 'reopened'
  ]);
  const old = { ...state, tasks: [{ ...task, events: [...task.events, { id: 'old', type: 'committed', at: '2026-11-19T08:00:00.000Z', outcome: 'Old' }] }] };
  const kept = saveTask(old, id, { title: 'Proposal v2' }, c);
  assert.equal(kept.tasks[0].events.some((event) => event.type === 'committed'), true, 'an old committed event stays');
  assert.equal(kept.tasks[0].events.some((event) => event.type === 'commitment_removed'), false);
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

test('REV-01: on-time rate counts tasks with a deadline in the period, excluding cancellations', () => {
  let state = fresh();
  const c = ctx('2026-11-16T08:00:00Z');
  state = captureTask(state, { title: 'On time', deadline: '2026-11-18T17:00:00Z' }, c);
  state = captureTask(state, { title: 'Late', deadline: '2026-11-18T17:00:00Z' }, c);
  state = captureTask(state, { title: 'Open', deadline: '2026-11-19T17:00:00Z' }, c);
  state = captureTask(state, { title: 'Canceled', deadline: '2026-11-19T17:00:00Z' }, c);
  state = captureTask(state, { title: 'Undated' }, c);
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
  assert.equal('undated' in review, false);
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

test('REV-03: blocked attempts by site show gaps and compare only fully covered weeks', () => {
  let state = fresh();
  const profileId = '00000000-0000-4000-8000-000000000001';
  const activeDays = [];
  for (let day = '2026-11-09'; day <= '2026-11-18'; day = new Date(Date.parse(day) + 86_400_000).toISOString().slice(0, 10)) {
    activeDays.push(day);
  }
  state = recordChromeReports(state, [{
    profileId, profileName: 'Work', receivedAt: Date.parse('2026-11-18T10:00:00Z'), activeDays,
    attempts: { '2026-11-10': { 'youtube.com': 4 }, '2026-11-17': { 'youtube.com': 2, 'facebook.com': 1 } }
  }]);
  // Monday 16th to Wednesday 18th: covered in both weeks, so the totals compare.
  let review = distractionReview(state, '2026-11-16', '2026-11-22', '2026-11-18');
  assert.equal(review.comparable, true);
  assert.equal(review.total, 3);
  assert.equal(review.previousTotal, 4);
  assert.deepEqual(review.bySite[0], { domain: 'youtube.com', count: 2, previous: 4 });
  // Thursday has no report yet, so it is a gap and the comparison is withheld.
  review = distractionReview(state, '2026-11-16', '2026-11-22', '2026-11-19');
  assert.deepEqual(review.gaps, ['2026-11-19']);
  assert.equal(review.comparable, false);
  assert.equal(review.previousTotal, null);

  const coverage = chromeCoverage(state, Date.parse('2026-11-18T10:01:00Z'));
  assert.deepEqual(coverage.map(({ name, current }) => [name, current]), [['Work', true]]);
  assert.equal(chromeCoverage(state, Date.parse('2026-11-18T11:00:00Z'))[0].current, false);
  assert.equal(JSON.stringify(exportSync(state, { id: 'pc', name: 'PC' })).includes('youtube.com'), false);
});

test('Chrome profiles running an older extension are flagged (FOC-05)', () => {
  assert.equal(compareVersions('0.4.0', '0.5.0'), -1);
  assert.equal(compareVersions('0.5', '0.5.0'), 0);
  assert.equal(compareVersions('1.10', '1.9'), 1);
  const at = Date.parse('2026-11-18T10:00:00Z');
  const outdated = (version) => {
    const state = recordChromeReports(
      { chrome: { profiles: {} } },
      [{ profileId: 'p', profileName: 'Work', version, attempts: {}, activeDays: [], receivedAt: at }]
    );
    return chromeCoverage(state, at, '0.5.0')[0];
  };
  assert.equal(outdated(undefined).outdated, true);
  assert.equal(outdated(undefined).version, null);
  assert.equal(outdated('0.4.0').outdated, true);
  assert.equal(outdated('0.5.0').outdated, false);
  assert.equal(outdated('0.6.0').outdated, false);
  const state = recordChromeReports({ chrome: { profiles: {} } },
    [{ profileId: 'p', profileName: 'Work', version: null, attempts: {}, activeDays: [], receivedAt: at }]);
  assert.equal(chromeCoverage(state, at)[0].outdated, false);
});

// ---- Focus sessions linked to tasks (FOC-09 to FOC-11)

function withTask(timeZone = 'UTC') {
  let state = fresh(timeZone);
  state = captureTask(state, { title: 'Write' }, ctx('2026-11-19T08:00:00Z'));
  return { state, id: state.tasks[0].id };
}

test('a version 2 plan migrates to version 3 and a version 3 plan round-trips', () => {
  const v2 = { ...fresh(), version: 2, focus: { endAt: 9000, domains: ['a.com'], apps: null } };
  delete v2.focusSegments;
  const migrated = readState(makeStorage(JSON.stringify(v2)));
  assert.equal(migrated.version, 3);
  assert.deepEqual(migrated.focusSegments, []);
  assert.equal(migrated.focus.taskId, null);
  assert.equal(migrated.focus.startedAt, 9000);
  assert.equal(migrated.focus.blockUntil, 9000);
  assert.equal(migrated.focus.segmentStart, null);
  assert.equal(migrated.focus.endedAt, null);
  assert.equal(typeof migrated.focus.sessionId, 'string');
  const again = readState(makeStorage(JSON.stringify(migrated)));
  assert.deepEqual(again, migrated);
});

test('pause, resume and settle record segments and stop at the end time', () => {
  const { state, id } = withTask();
  const start = at('2026-11-19T09:00:00Z');
  let s = startFocus(state, start, { taskId: id });
  assert.equal(s.focus.taskId, id);
  s = pauseFocus(s, ctx('2026-11-19T09:10:00Z'));
  assert.equal(s.focus.segmentStart, null);
  assert.equal(s.focusSegments.length, 1);
  s = resumeFocus(s, ctx('2026-11-19T09:20:00Z'));
  s = settleFocus(s, ctx('2026-11-19T11:00:00Z'));
  assert.equal(s.focusSegments.length, 2);
  assert.equal(taskFocusMinutes(s, id, at('2026-11-19T11:00:00Z')), 35);
  assert.equal(s.focusSegments[1].end, '2026-11-19T09:45:00.000Z');
  assert.equal(s.focusSegments[0].deviceId, 'pc');
});

test('starting needs an open task, or none for a wandering session', () => {
  const { state, id } = withTask();
  const done = toggleTask(state, id, ctx('2026-11-19T08:30:00Z'));
  assert.throws(() => startFocus(done, at('2026-11-19T09:00:00Z'), { taskId: id }), /Choose an open task/);
  assert.throws(() => startFocus(state, at('2026-11-19T09:00:00Z'), { taskId: 'missing' }), /Choose an open task/);
  assert.equal(startFocus(state, at('2026-11-19T09:00:00Z')).focus.taskId, null);
});

test('ending a session stops time and app limits but keeps sites blocked', () => {
  const { state, id } = withTask();
  const base = { ...state, appPresets: [{ id: 'p', name: 'Work', apps: [{ path: 'C:\\x\\a.exe', name: 'a' }], strength: 'block', countdownSeconds: 15, passMinutes: 10 }] };
  let s = startFocus(base, at('2026-11-19T09:00:00Z'), { taskId: id, presetId: 'p' });
  const blockUntil = s.focus.blockUntil;
  assert.ok(appLimitSnapshot(s, at('2026-11-19T09:05:00Z')));
  s = endFocus(s, ctx('2026-11-19T09:15:00Z'));
  assert.equal(s.focusSegments.length, 1);
  assert.equal(s.focusSegments[0].end, '2026-11-19T09:15:00.000Z');
  assert.equal(appLimitSnapshot(s, at('2026-11-19T09:16:00Z')), null);
  const snap = focusSnapshot(s, at('2026-11-19T09:16:00Z'));
  assert.equal(snap.endAt, blockUntil);
  assert.deepEqual(Object.keys(snap).sort(), ['domains', 'endAt', 'nextAction']);
  s.preferences = { ...s.preferences, focusMinutes: 120, domains: ['news.com'] };
  const second = startFocus(s, at('2026-11-19T09:20:00Z'));
  assert.equal(second.focus.blockUntil, at('2026-11-19T11:20:00Z').getTime());
  s.preferences = { ...s.preferences, focusMinutes: 5 };
  const third = startFocus(s, at('2026-11-19T09:20:00Z'));
  assert.equal(third.focus.blockUntil, blockUntil);
  assert.ok(third.focus.domains.includes('news.com') && third.focus.domains.includes('youtube.com'));
});

test('focus actions return the same state when there is nothing to do', () => {
  const { state } = withTask();
  const n = ctx('2026-11-19T09:05:00Z');
  assert.equal(pauseFocus(state, n), state);
  assert.equal(resumeFocus(state, n), state);
  assert.equal(endFocus(state, n), state);
  assert.equal(settleFocus(state, n), state);
  const running = startFocus(state, at('2026-11-19T09:00:00Z'));
  assert.equal(resumeFocus(running, n), running);
  assert.equal(settleFocus(running, n), running);
  const paused = pauseFocus(running, n);
  assert.equal(pauseFocus(paused, n), paused);
  const ended = endFocus(paused, n);
  assert.equal(endFocus(ended, n), ended);
  assert.equal(pauseFocus(ended, n), ended);
});

test('deleting the session task drops its segments and makes the session wandering', () => {
  const { state, id } = withTask();
  let s = startFocus(state, at('2026-11-19T09:00:00Z'), { taskId: id });
  s = pauseFocus(s, ctx('2026-11-19T09:10:00Z'));
  s = resumeFocus(s, ctx('2026-11-19T09:12:00Z'));
  s = deleteTask(s, id, ctx('2026-11-19T09:13:00Z'));
  assert.deepEqual(s.focusSegments, []);
  assert.equal(s.focus.taskId, null);
});

test('task focus minutes include the open segment and the review groups by planning day', () => {
  let { state, id } = withTask('Asia/Ho_Chi_Minh');
  state = captureTask(state, { title: 'Other' }, ctx('2026-11-19T08:00:00Z'));
  state = captureTask(state, { title: 'Gone' }, ctx('2026-11-19T08:00:00Z'));
  const other = state.tasks[1].id;
  const gone = state.tasks[2].id;
  const seg = (taskId, start, end) => ({ id: `${taskId}${start}`, sessionId: 's', taskId, start, end, deviceId: 'pc' });
  state = {
    ...state,
    focusSegments: [
      seg(id, '2026-11-19T10:00:00.000Z', '2026-11-19T10:30:00.000Z'),
      seg(other, '2026-11-19T10:00:00.000Z', '2026-11-19T10:40:00.000Z'),
      seg(null, '2026-11-19T11:00:00.000Z', '2026-11-19T11:15:00.000Z'),
      // 2026-11-19T18:00Z is already 20 November in Ho Chi Minh City.
      seg(id, '2026-11-19T18:00:00.000Z', '2026-11-19T18:20:00.000Z'),
      seg('ghost', '2026-11-19T10:00:00.000Z', '2026-11-19T10:50:00.000Z'),
      seg(gone, '2026-11-19T12:00:00.000Z', '2026-11-19T12:00:10.000Z')
    ]
  };
  state = startFocus(state, at('2026-11-19T12:30:00Z'), { taskId: id });
  const now = at('2026-11-19T12:40:00Z');
  assert.equal(taskFocusMinutes(state, id, now), 30 + 20 + 10);
  const review = focusTimeReview(state, '2026-11-19', '2026-11-19', now);
  assert.deepEqual(review.byTask, [
    { taskId: other, title: 'Other', minutes: 40 },
    { taskId: id, title: 'Write', minutes: 40 }
  ]);
  assert.equal(review.wanderingMinutes, 15);
  assert.equal(review.totalMinutes, 95);
  const next = focusTimeReview(state, '2026-11-20', '2026-11-20', now);
  assert.deepEqual(next.byTask.map((item) => item.minutes), [20]);
  assert.equal(focusTimeReview(state, '2026-12-01', '2026-12-02', now).totalMinutes, 0);
});

test('focus segments sync by id and respect deleted tasks', () => {
  const { state, id } = withTask();
  const seg = (name, taskId) => ({ id: name, sessionId: 's', taskId, start: '2026-11-19T10:00:00.000Z', end: '2026-11-19T10:10:00.000Z', deviceId: 'x' });
  const pc = { ...state, focusSegments: [seg('a', id), seg('dup', null)] };
  let phone = mergeSync(fresh(), exportSync(pc, { id: 'pc', name: 'PC' }, at('2026-11-19T11:00:00Z')), ctx('2026-11-19T11:01:00Z', 'phone')).state;
  phone = { ...phone, focusSegments: [...phone.focusSegments, seg('b', id)] };
  const back = mergeSync(pc, exportSync(phone, { id: 'phone', name: 'Phone' }, at('2026-11-19T12:00:00Z')), ctx('2026-11-19T12:01:00Z', 'pc')).state;
  assert.deepEqual(back.focusSegments.map((item) => item.id).sort(), ['a', 'b', 'dup']);

  const deletedOnPhone = deleteTask(phone, id, ctx('2026-11-19T12:30:00Z', 'phone'));
  const merged = mergeSync(back, exportSync(deletedOnPhone, { id: 'phone', name: 'Phone' }, at('2026-11-19T13:00:00Z')), ctx('2026-11-19T13:01:00Z', 'pc')).state;
  assert.deepEqual(merged.focusSegments.map((item) => item.id), ['dup']);

  const old = exportSync(pc, { id: 'pc', name: 'PC' }, at('2026-11-19T11:00:00Z'));
  delete old.data.focusSegments;
  assert.doesNotThrow(() => mergeSync(fresh(), old, ctx('2026-11-19T11:01:00Z', 'phone')));
  old.data.focusSegments = [{ id: 'x', sessionId: 's', taskId: 5, start: 'a', end: 'b', deviceId: 'd' }];
  assert.throws(() => mergeSync(fresh(), old, ctx('2026-11-19T11:01:00Z', 'phone')), /invalid focus record/);
  // Dates that do not parse, or a segment that ends before it starts, would break the review.
  const segment = { id: 'x', sessionId: 's', taskId: null, deviceId: 'd' };
  for (const [start, end] of [['garbage', 'zzz'], ['2026-11-19T10:00:00Z', '2026-11-19T09:00:00Z'],
    ['2026-11-19T10:00:00Z', '2026-11-19T10:00:00Z']]) {
    old.data.focusSegments = [{ ...segment, start, end }];
    assert.throws(() => mergeSync(fresh(), old, ctx('2026-11-19T11:01:00Z', 'phone')), /invalid focus record/);
  }
});

// ---------------------------------------------------------------------------
// Strict work blocks (WB-01 to WB-04)
import {
  applyPendingBlockChanges, cancelPendingBlockChange, cancelStrictExit, exitStrictHold, requestStrictExit,
  strictReview, tickStrict, STRICT_OUTCOMES
} from '../app/model.js';

const T0 = '2026-11-19T09:00:00Z';
const BLOCK = { id: 'blk', start: '2026-11-19T10:00:00.000Z', end: '2026-11-19T10:30:00.000Z', strict: true };

function strictTask(extra = {}, state = fresh()) {
  const made = captureTask(state, {
    title: 'Write report', subtasks: [{ id: 's1', title: 'Draft', done: false }], workBlocks: [BLOCK], ...extra
  }, ctx(T0));
  return { state: made, id: made.tasks[0].id };
}

const blockOf = (state) => state.tasks[0].workBlocks[0];
const tickedDone = [{ id: 's1', title: 'Draft', done: true }];

test('WB-01: strict needs subtasks or criteria and an upcoming block', () => {
  assert.throws(() => captureTask(fresh(), { title: 'x', workBlocks: [BLOCK] }, ctx(T0)),
    /Add completion criteria or a child task/);
  const ok = captureTask(fresh(), { title: 'x', criteria: 'Done when sent', workBlocks: [BLOCK] }, ctx(T0));
  assert.equal(ok.tasks[0].workBlocks[0].strict, true);
  const { state, id } = strictTask();
  assert.throws(() => saveTask(state, id, { subtasks: [] }, ctx(T0)), /Add completion criteria or a child task/);
  assert.throws(() => captureTask(fresh(), { title: 'x', criteria: 'c', workBlocks: [BLOCK] }, ctx('2026-11-19T11:00:00Z')),
    /Only upcoming work blocks can be strict/);
  const plain = captureTask(fresh(), { title: 'y', criteria: 'c', workBlocks: [{ ...BLOCK, strict: false }] }, ctx(T0));
  assert.throws(() => saveTask(plain, plain.tasks[0].id, { workBlocks: [BLOCK] }, ctx('2026-11-19T11:00:00Z')),
    /Only upcoming work blocks can be strict/);
});

test('WB-01: loosening a strict block waits for the change delay', () => {
  const { state, id } = strictTask();
  const edits = {
    unmark: [{ ...BLOCK, strict: false }],
    shorten: [{ ...BLOCK, end: '2026-11-19T10:20:00Z' }],
    later: [{ ...BLOCK, start: '2026-11-19T10:05:00Z', end: '2026-11-19T10:35:00Z' }],
    remove: []
  };
  for (const [name, workBlocks] of Object.entries(edits)) {
    const next = saveTask(state, id, { workBlocks }, ctx(T0));
    assert.deepEqual(blockOf(next), BLOCK, name);
    assert.equal(next.pendingBlockChanges.length, 1, name);
    assert.equal(next.pendingBlockChanges[0].effectiveAt, '2026-11-19T09:10:00.000Z', name);
    assert.equal(next.pendingBlockChanges[0].blockId, 'blk', name);
    assert.equal(next.pendingBlockChanges[0].block?.end ?? null, workBlocks[0] ? new Date(workBlocks[0].end).toISOString() : null, name);
  }
  // Starting earlier while keeping the end still covers the block, so it applies at once.
  const earlier = saveTask(state, id, { workBlocks: [{ ...BLOCK, start: '2026-11-19T09:50:00Z' }] }, ctx(T0));
  assert.equal(blockOf(earlier).start, '2026-11-19T09:50:00.000Z');
  assert.equal(earlier.pendingBlockChanges.length, 0);
  // Moving earlier at the same length ends the hold earlier; moving it into the past would skip it. Both wait.
  for (const moved of [{ start: '2026-11-19T09:50:00Z', end: '2026-11-19T10:20:00Z' },
    { start: '2026-11-19T05:00:00Z', end: '2026-11-19T05:30:00Z' }]) {
    const next = saveTask(state, id, { workBlocks: [{ ...BLOCK, ...moved }] }, ctx(T0));
    assert.deepEqual(blockOf(next), BLOCK);
    assert.equal(next.pendingBlockChanges.length, 1);
  }
  const longer = saveTask(state, id, { workBlocks: [{ ...BLOCK, end: '2026-11-19T10:45:00Z' }] }, ctx(T0));
  assert.equal(blockOf(longer).end, '2026-11-19T10:45:00.000Z');
  assert.equal(longer.pendingBlockChanges.length, 0);

  const instant = { ...state, settings: { ...state.settings, changeDelay: 0 } };
  const gone = saveTask(instant, id, { workBlocks: [] }, ctx(T0));
  assert.equal(gone.tasks[0].workBlocks.length, 0);
  assert.equal(gone.pendingBlockChanges.length, 0);

  const mixed = saveTask(state, id, { title: 'Renamed', workBlocks: [{ ...BLOCK, strict: false }] }, ctx(T0));
  assert.equal(mixed.tasks[0].title, 'Renamed');
  assert.equal(blockOf(mixed).strict, true);
  assert.equal(mixed.pendingBlockChanges.length, 1);
  // A newer weakening replaces the earlier one for the same block.
  const again = saveTask(mixed, id, { workBlocks: [] }, ctx('2026-11-19T09:02:00Z'));
  assert.equal(again.pendingBlockChanges.length, 1);
  assert.equal(again.pendingBlockChanges[0].block, null);
});

test('WB-01: pending block changes apply when due, drop with the task, and can be canceled', () => {
  const { state, id } = strictTask();
  const queued = saveTask(state, id, { workBlocks: [{ ...BLOCK, strict: false }] }, ctx(T0));
  assert.equal(applyPendingBlockChanges(queued, ctx('2026-11-19T09:05:00Z')), queued);
  const applied = applyPendingBlockChanges(queued, ctx('2026-11-19T09:10:00Z'));
  assert.equal(blockOf(applied).strict, false);
  assert.equal(applied.pendingBlockChanges.length, 0);

  const removal = saveTask(state, id, { workBlocks: [] }, ctx(T0));
  assert.equal(applyPendingBlockChanges(removal, ctx('2026-11-19T09:11:00Z')).tasks[0].workBlocks.length, 0);

  const orphan = { ...queued, tasks: [] };
  assert.equal(applyPendingBlockChanges(orphan, ctx('2026-11-19T09:11:00Z')).pendingBlockChanges.length, 0);

  const canceled = cancelPendingBlockChange(queued, queued.pendingBlockChanges[0].id, ctx(T0));
  assert.equal(canceled.pendingBlockChanges.length, 0);
  assert.equal(cancelPendingBlockChange(canceled, 'nope', ctx(T0)), canceled);

  // A later edit to the same block replaces the waiting change, so the change cannot undo it.
  const shortened = saveTask(state, id, { workBlocks: [{ ...BLOCK, end: '2026-11-19T10:10:00Z' }] }, ctx(T0));
  const extended = saveTask(shortened, id, { workBlocks: [{ ...BLOCK, end: '2026-11-19T11:00:00Z' }] }, ctx('2026-11-19T09:01:00Z'));
  assert.equal(extended.pendingBlockChanges.length, 0);
  const later = applyPendingBlockChanges(extended, ctx('2026-11-19T09:20:00Z'));
  assert.equal(blockOf(later).end, '2026-11-19T11:00:00.000Z');
  // An edit elsewhere in the task keeps the waiting change.
  const renamed = saveTask(shortened, id, { title: 'Renamed' }, ctx('2026-11-19T09:01:00Z'));
  assert.equal(renamed.pendingBlockChanges.length, 1);
});

test('WB-01: a new block cannot reuse the id of a logged strict block', () => {
  const { state, id } = strictTask();
  const logged = { ...state, strictLog: [{ id: 'e1', blockId: 'reused', taskId: id, outcome: 'missed', reason: '', at: T0 }] };
  const next = saveTask(logged, id, { workBlocks: [BLOCK, { ...BLOCK, id: 'reused', start: '2026-11-19T12:00:00Z', end: '2026-11-19T13:00:00Z' }] }, ctx(T0));
  assert.equal(next.tasks[0].workBlocks.length, 2);
  assert.ok(next.tasks[0].workBlocks.every((block) => block.id !== 'reused'));
});

test('WB-01: a task with an open strict block cannot be deleted or canceled', () => {
  const { state, id } = strictTask();
  assert.throws(() => deleteTask(state, id, ctx(T0)), /Remove strict from this task/);
  assert.throws(() => saveTask(state, id, { status: 'canceled' }, ctx(T0)), /Remove strict from this task/);
  assert.equal(deleteTask(state, id, ctx('2026-11-19T11:00:00Z')).tasks.length, 0);
});

test('WB-02: the hold starts a task session, moves a wandering one, and is stable', () => {
  const { state, id } = strictTask();
  const now = ctx('2026-11-19T10:00:00Z');
  assert.equal(tickStrict(state, ctx('2026-11-19T09:30:00Z')), state);
  const held = tickStrict(state, now);
  assert.equal(held.focus.taskId, id);
  assert.equal(held.focus.strict.blockId, 'blk');
  assert.equal(held.focus.strict.holdUntil, Date.parse(BLOCK.end));
  assert.equal(held.focus.strict.limit, Date.parse('2026-11-19T11:00:00Z'));
  assert.equal(held.focus.strict.exitRequestedAt, null);
  assert.ok(held.focus.endAt >= Date.parse(BLOCK.end) && held.focus.blockUntil >= held.focus.endAt);
  assert.equal(tickStrict(held, now), held);
  assert.throws(() => pauseFocus(held, now), /strict block is holding/);
  assert.throws(() => endFocus(held, now), /strict block is holding/);

  const wandering = startFocus(state, at('2026-11-19T09:56:00Z'));
  const moved = tickStrict(wandering, now);
  assert.equal(moved.focusSegments.length, 1);
  assert.equal(moved.focusSegments[0].taskId, null);
  assert.equal(moved.focusSegments[0].end, '2026-11-19T10:00:00.000Z');
  assert.equal(moved.focus.taskId, id);
  assert.equal(moved.focus.segmentStart, now.now.getTime());
  assert.equal(moved.focus.sessionId, wandering.focus.sessionId);
});

test('WB-02: completing during the hold needs every subtask and logs on_time', () => {
  const { state, id } = strictTask();
  const held = tickStrict(state, ctx('2026-11-19T10:00:00Z'));
  assert.throws(() => saveTask(held, id, { status: 'completed' }, ctx('2026-11-19T10:10:00Z')),
    /Tick every completion criterion/);
  // Text criteria fold into the checklist; deleting the unticked items must not open a way out.
  const withCriteria = saveTask(held, id, { criteria: 'Sent' }, ctx('2026-11-19T10:05:00Z'));
  assert.throws(() => saveTask(withCriteria, id, { subtasks: [] }, ctx('2026-11-19T10:06:00Z')),
    /Unticked criteria cannot be removed/);
  const added = saveTask(held, id, { subtasks: [...held.tasks[0].subtasks, { id: 's2', title: 'Check', done: false }] },
    ctx('2026-11-19T10:06:00Z'));
  assert.equal(added.tasks[0].subtasks.length, 2);
  let done = saveTask(held, id, { subtasks: tickedDone }, ctx('2026-11-19T10:10:00Z'));
  done = saveTask(done, id, { status: 'completed' }, ctx('2026-11-19T10:11:00Z'));
  const ticked = tickStrict(done, ctx('2026-11-19T10:12:00Z'));
  assert.deepEqual(ticked.strictLog.map((entry) => entry.outcome), ['on_time']);
  assert.equal(ticked.focus.strict, null);
  assert.equal(ticked.focus.endedAt, null);
  assert.equal(tickStrict(ticked, ctx('2026-11-19T10:13:00Z')), ticked);
});

test('WB-03: the hold extends in 15 minute steps up to the limit', () => {
  const { state, id } = strictTask();
  const held = tickStrict(state, ctx('2026-11-19T10:00:00Z'));
  const extended = tickStrict(held, ctx('2026-11-19T10:31:00Z'));
  assert.equal(extended.focus.strict.holdUntil, Date.parse('2026-11-19T10:45:00Z'));
  assert.equal(extended.focus.endAt, Date.parse('2026-11-19T10:45:00Z'));
  assert.ok(extended.focus.blockUntil >= extended.focus.endAt);
  let done = saveTask(extended, id, { subtasks: tickedDone }, ctx('2026-11-19T10:40:00Z'));
  done = saveTask(done, id, { status: 'completed' }, ctx('2026-11-19T10:41:00Z'));
  assert.deepEqual(tickStrict(done, ctx('2026-11-19T10:42:00Z')).strictLog.map((entry) => entry.outcome), ['extended']);

  const far = tickStrict(held, ctx('2026-11-19T15:00:00Z'));
  assert.deepEqual(far.strictLog.map((entry) => entry.outcome), ['limit_reached']);
  assert.equal(far.focus.strict, null);
  assert.equal(far.focus.sessionId, held.focus.sessionId);
  assert.equal(far.focus.taskId, id);
  assert.equal(tickStrict(far, ctx('2026-11-19T15:01:00Z')), far);
});

test('WB-04: emergency exit needs the countdown and a reason', () => {
  const { state } = strictTask();
  const held = tickStrict(state, ctx('2026-11-19T10:00:00Z'));
  const asked = requestStrictExit(held, ctx('2026-11-19T10:05:00Z'));
  assert.equal(asked.focus.strict.exitRequestedAt, Date.parse('2026-11-19T10:05:00Z'));
  assert.equal(requestStrictExit(asked, ctx('2026-11-19T10:06:00Z')), asked);
  assert.throws(() => exitStrictHold(held, 'x', ctx('2026-11-19T10:08:00Z')), /Wait for the countdown/);
  assert.throws(() => exitStrictHold(asked, 'x', ctx('2026-11-19T10:06:00Z')), /Wait for the countdown/);
  assert.throws(() => exitStrictHold(asked, '   ', ctx('2026-11-19T10:07:00Z')), /Enter a reason/);
  assert.throws(() => exitStrictHold(asked, 'a'.repeat(201), ctx('2026-11-19T10:07:00Z')), /Enter a reason/);
  assert.equal(cancelStrictExit(asked).focus.strict.exitRequestedAt, null);
  const out = exitStrictHold(asked, '  Family call  ', ctx('2026-11-19T10:07:00Z'));
  assert.equal(out.focus.strict, null);
  assert.equal(out.focus.blockUntil, held.focus.blockUntil);
  assert.equal(out.strictLog[0].outcome, 'exited');
  assert.equal(out.strictLog[0].reason, 'Family call');
  assert.equal(tickStrict(out, ctx('2026-11-19T10:08:00Z')), out);
});

test('WB-03: a task canceled on another device logs canceled', () => {
  const { state, id } = strictTask();
  const held = tickStrict(state, ctx('2026-11-19T10:00:00Z'));
  const phone = { ...state, settings: { ...state.settings, changeDelay: 0 } };
  let remote = saveTask(phone, id, { workBlocks: [] }, ctx('2026-11-19T10:02:00Z', 'phone'));
  remote = saveTask(remote, id, { status: 'canceled' }, ctx('2026-11-19T10:03:00Z', 'phone'));
  const merged = mergeSync(held, exportSync(remote, { id: 'phone', name: 'Phone' }, at('2026-11-19T10:04:00Z')),
    ctx('2026-11-19T10:05:00Z', 'pc')).state;
  const ticked = tickStrict(merged, ctx('2026-11-19T10:06:00Z'));
  assert.deepEqual(ticked.strictLog.map((entry) => entry.outcome), ['canceled']);
  assert.equal(ticked.focus.strict, null);
});

test('WB-03: strict blocks that passed while no tick ran are logged once', () => {
  const { state, id } = strictTask();
  const late = tickStrict(state, ctx('2026-11-19T12:00:00Z'));
  assert.equal(late.strictLog.length, 1);
  assert.equal(late.strictLog[0].outcome, 'missed');
  assert.equal(late.strictLog[0].at, BLOCK.end);
  assert.equal(late.focus, null);
  assert.equal(tickStrict(late, ctx('2026-11-19T12:01:00Z')), late);

  let done = saveTask(state, id, { subtasks: tickedDone }, ctx('2026-11-19T09:30:00Z'));
  done = saveTask(done, id, { status: 'completed' }, ctx('2026-11-19T09:40:00Z'));
  assert.equal(tickStrict(done, ctx('2026-11-19T12:00:00Z')).strictLog[0].outcome, 'on_time');
});

test('WB sync: strictLog unions by id, pendingBlockChanges is a root field, bad records throw', () => {
  const { state, id } = strictTask();
  const entry = (name, taskId, outcome = 'missed') => ({ id: name, blockId: 'blk', taskId, outcome, reason: '', at: '2026-11-19T10:30:00.000Z' });
  const pc = { ...state, strictLog: [entry('a', id), entry('dup', id)] };
  const phone0 = { ...state, strictLog: [{ ...entry('dup', id), outcome: 'exited', reason: 'remote' }, entry('b', id)] };
  const back = mergeSync(pc, exportSync(phone0, { id: 'phone', name: 'Phone' }, at('2026-11-19T11:00:00Z')), ctx('2026-11-19T11:01:00Z', 'pc')).state;
  assert.deepEqual(back.strictLog.map((item) => item.id).sort(), ['a', 'b', 'dup']);
  assert.equal(back.strictLog.find((item) => item.id === 'dup').outcome, 'missed');

  const phone = { ...state, settings: { ...state.settings, changeDelay: 0 }, strictLog: [entry('b', id)] };
  const deletedOnPhone = deleteTask(saveTask(phone, id, { workBlocks: [] }, ctx('2026-11-19T10:40:00Z', 'phone')), id, ctx('2026-11-19T10:41:00Z', 'phone'));
  const merged = mergeSync(back, exportSync(deletedOnPhone, { id: 'phone', name: 'Phone' }, at('2026-11-19T12:00:00Z')), ctx('2026-11-19T12:01:00Z', 'pc')).state;
  assert.equal(merged.strictLog.length, 0);

  const queued = saveTask(state, id, { workBlocks: [] }, ctx('2026-11-19T09:01:00Z', 'pc'));
  const received = mergeSync(fresh(), exportSync(queued, { id: 'pc', name: 'PC' }, at('2026-11-19T09:02:00Z')), ctx('2026-11-19T09:03:00Z', 'phone')).state;
  assert.equal(received.pendingBlockChanges.length, 1);

  const payload = () => exportSync(queued, { id: 'pc', name: 'PC' }, at('2026-11-19T09:02:00Z'));
  const old = payload();
  delete old.data.pendingBlockChanges;
  delete old.data.strictLog;
  assert.doesNotThrow(() => mergeSync(fresh(), old, ctx('2026-11-19T09:03:00Z', 'phone')));
  const change = queued.pendingBlockChanges[0];
  const badChanges = [
    { ...change, id: 5 }, { ...change, effectiveAt: 'soon' }, { ...change, createdAt: undefined },
    { ...change, block: { id: 'blk', start: 'a', end: 'b', strict: true } },
    { ...change, block: { ...BLOCK, start: BLOCK.end, end: BLOCK.start } }
  ];
  for (const bad of badChanges) {
    const file = payload();
    file.data.pendingBlockChanges = [bad];
    assert.throws(() => mergeSync(fresh(), file, ctx('2026-11-19T09:03:00Z', 'phone')), /invalid strict block record/);
  }
  const badLogs = [
    { ...entry('x', id), outcome: 'won' }, { ...entry('x', id), reason: 'r'.repeat(201) },
    { ...entry('x', id), at: 'never' }, { ...entry('x', id), taskId: 3 }
  ];
  for (const bad of badLogs) {
    const file = payload();
    file.data.strictLog = [bad];
    assert.throws(() => mergeSync(fresh(), file, ctx('2026-11-19T09:03:00Z', 'phone')), /invalid strict block record/);
  }
});

test('WB-04: strictReview counts outcomes by planning day and lists exits newest first', () => {
  const { state, id } = strictTask();
  const entry = (name, outcome, atTime, reason = '') => ({ id: name, blockId: name, taskId: id, outcome, reason, at: atTime });
  const log = [
    entry('1', 'on_time', '2026-11-18T10:00:00.000Z'), entry('2', 'exited', '2026-11-19T10:00:00.000Z', 'first'),
    entry('3', 'exited', '2026-11-19T12:00:00.000Z', 'second'), entry('4', 'missed', '2026-11-20T10:00:00.000Z'),
    entry('5', 'limit_reached', '2026-11-19T13:00:00.000Z')
  ];
  const review = strictReview({ ...state, strictLog: log }, '2026-11-19', '2026-11-19');
  assert.deepEqual(Object.keys(review.counts), STRICT_OUTCOMES);
  assert.deepEqual(review.counts, { on_time: 0, extended: 0, limit_reached: 1, exited: 2, canceled: 0, missed: 0 });
  assert.deepEqual(review.exits.map((item) => item.reason), ['second', 'first']);
  assert.equal(review.exits[0].title, 'Write report');
});

// ---- Floating timer (FOC-12)

test('FOC-12: miniTimerView is null without a running session and after End', () => {
  const { state } = withTask();
  const n = ctx('2026-11-19T09:05:00Z');
  assert.equal(miniTimerView(state, n.now), null);
  const running = startFocus(state, at('2026-11-19T09:00:00Z'));
  assert.notEqual(miniTimerView(running, n.now), null);
  assert.equal(miniTimerView(endFocus(running, n), n.now), null);
});

test('FOC-12: miniTimerView reports the task, wandering, pause and strict hold', () => {
  const { state, id } = withTask();
  const n = ctx('2026-11-19T09:05:00Z');
  const withId = startFocus(state, at('2026-11-19T09:00:00Z'), { taskId: id });
  const view = miniTimerView(withId, n.now);
  assert.equal(view.taskTitle, 'Write');
  assert.equal(view.endAt, withId.focus.endAt);
  assert.equal(view.paused, false);
  assert.equal(view.strict, false);
  assert.equal(miniTimerView(pauseFocus(withId, n), n.now).paused, true);
  const wandering = startFocus(state, at('2026-11-19T09:00:00Z'));
  assert.equal(miniTimerView(wandering, n.now).taskTitle, null);
  const gone = { ...withId, tasks: [] };
  assert.equal(miniTimerView(gone, n.now).taskTitle, null);
  const held = tickStrict(strictTask().state, ctx('2026-11-19T10:00:00Z'));
  assert.equal(miniTimerView(held, at('2026-11-19T10:01:00Z')).strict, true);
});

test('FOC-12: setMiniTimer merges booleans and keeps the object when unchanged', () => {
  const state = fresh();
  assert.deepEqual(state.preferences.miniTimer, { enabled: false, clickThrough: false });
  assert.equal(setMiniTimer(state, {}), state);
  assert.equal(setMiniTimer(state, { enabled: false }), state);
  const on = setMiniTimer(state, { enabled: 1 });
  assert.deepEqual(on.preferences.miniTimer, { enabled: true, clickThrough: false });
  assert.equal(setMiniTimer(on, { enabled: true }), on);
  assert.deepEqual(setMiniTimer(on, { clickThrough: true }).preferences.miniTimer, { enabled: true, clickThrough: true });
});

test('FOC-12: a v3 state saved without miniTimer loads with the defaults', () => {
  const saved = fresh();
  delete saved.preferences.miniTimer;
  const loaded = readState(makeStorage(JSON.stringify(saved)));
  assert.deepEqual(loaded.preferences.miniTimer, { enabled: false, clickThrough: false });
});

// ---------------------------------------------------------------------------
// Task workspaces (WS-01 to WS-04)
import { linkBlock, saveAppPreset, saveBlockRule } from '../app/model.js';

const WS_NOW = '2026-11-19T09:00:00Z';

function workspaceTask(links) {
  let state = captureTask(fresh(), { title: 'Write the report' }, ctx(WS_NOW));
  const id = state.tasks[0].id;
  if (links) state = saveTask(state, id, { links }, ctx(WS_NOW));
  return { state, id };
}

test('WS-01: links are validated, trimmed and labelled by host', () => {
  const { state, id } = workspaceTask([{ url: '  https://docs.example.com/a?b=1 ', label: '  ' }, { url: 'http://x.org', label: ' Home ' }]);
  const links = state.tasks.find((task) => task.id === id).links;
  assert.equal(links[0].url, 'https://docs.example.com/a?b=1');
  assert.equal(links[0].label, 'docs.example.com');
  assert.equal(links[1].label, 'Home');
  assert.ok(links[0].id && links[0].id !== links[1].id);
  for (const url of ['javascript:alert(1)', 'file:///C:/a.txt', 'not a url', '', `https://a.example/${'x'.repeat(2048)}`]) {
    assert.throws(() => saveTask(state, id, { links: [{ url }] }, ctx(WS_NOW)), /Add websites as http or https links\./);
  }
  assert.throws(() => saveTask(state, id, { links: [{ url: 'https://a.example', label: 'x'.repeat(81) }] }, ctx(WS_NOW)), /80 characters/);
  const many = Array.from({ length: 21 }, () => ({ url: 'https://a.example' }));
  assert.throws(() => saveTask(state, id, { links: many }, ctx(WS_NOW)), /Add up to 20 items to a workspace\./);
  assert.throws(() => saveTask(state, id, { links: 'https://a.example' }, ctx(WS_NOW)), /Add up to 20 items/);
});

test('WS-01: links sync as a task field and old tasks read as no links', () => {
  const { state, id } = workspaceTask([{ url: 'https://a.example', label: 'A' }]);
  assert.ok(state.tasks[0].stamps.links);
  const payload = exportSync(state, { id: 'pc', name: 'PC' }, at(WS_NOW));
  const merged = mergeSync(fresh(), payload, ctx(WS_NOW, 'phone'));
  assert.equal(merged.state.tasks.find((task) => task.id === id).links[0].url, 'https://a.example');
  const old = { ...state, tasks: state.tasks.map(({ links, ...rest }) => rest) };
  assert.equal(old.tasks[0].links, undefined);
  const edited = saveTask(old, id, { title: 'Renamed' }, ctx(WS_NOW));
  assert.equal(edited.tasks[0].title, 'Renamed');
});

test('WS-03: linkBlock reports the focus list and active rules by host', () => {
  const now = at(WS_NOW);
  let state = fresh();
  assert.equal(linkBlock(state, 'https://www.youtube.com/watch', now), null);
  state = saveBlockRule(state, null, { name: 'Evening news', domains: 'news.example', schedule: { type: 'always' }, strength: 'block' }, ctx(WS_NOW));
  assert.deepEqual(linkBlock(state, 'https://m.news.example/x', now), { source: 'rule', name: 'Evening news' });
  assert.equal(linkBlock(state, 'https://notnews.example/', now), null);
  state = { ...state, preferences: { ...state.preferences, domains: ['youtube.com'] } };
  assert.equal(linkBlock(state, 'https://www.youtube.com/', now), null);
  state = startFocus(state, now);
  assert.deepEqual(linkBlock(state, 'https://www.youtube.com/', now), { source: 'focus' });
  assert.deepEqual(linkBlock(state, 'https://youtube.com/', now), { source: 'focus' });
  assert.equal(linkBlock(state, 'https://myyoutube.com/', now), null);
  assert.equal(linkBlock(state, 'garbage', now), null);
});

test('WS-04: a session copies the workspace apps and merges them into the app limit', () => {
  const now = at(WS_NOW);
  const CODE = 'C:\Apps\Code.exe';
  const NOTES = 'C:\Apps\Notes.exe';
  let { state, id } = workspaceTask();
  state = saveAppPreset(state, null, { name: 'Coding', apps: [{ path: CODE, name: 'VS Code' }], strength: 'block' }, ctx(WS_NOW));
  const presetId = state.appPresets[0].id;
  const apps = [{ path: NOTES, name: 'Notes' }, { path: CODE.toLowerCase(), name: 'code again' }];
  const withPreset = startFocus(state, now, { taskId: id, presetId, workspaceApps: apps });
  assert.deepEqual(withPreset.focus.workspaceApps, apps);
  const snapshot = appLimitSnapshot(withPreset, now);
  assert.deepEqual(snapshot.apps, [{ path: CODE, name: 'VS Code' }, { path: NOTES, name: 'Notes' }]);
  const noPreset = startFocus(state, now, { taskId: id, workspaceApps: apps });
  assert.equal(appLimitSnapshot(noPreset, now), null);
  const capped = startFocus(state, now, { workspaceApps: Array.from({ length: 30 }, (_, index) => ({ path: `C:\a${index}.exe`, name: 'a' })) });
  assert.equal(capped.focus.workspaceApps.length, 20);
  assert.deepEqual(startFocus(state, now).focus.workspaceApps, []);
});

test('WS-04: a strict hold starts with the apps of the workspace', () => {
  const { state, id } = strictTask();
  const held = tickStrict(state, { ...ctx('2026-11-19T10:00:00Z'), workspaceApps: (taskId) => (taskId === id ? [{ path: 'C:\Apps\Notes.exe', name: 'Notes' }] : []) });
  assert.deepEqual(held.focus.workspaceApps, [{ path: 'C:\Apps\Notes.exe', name: 'Notes' }]);
  assert.deepEqual(tickStrict(state, ctx('2026-11-19T10:00:00Z')).focus.workspaceApps, []);
});

test('WS-01: synced links are validated before they merge', () => {
  const { state } = workspaceTask([{ url: 'https://a.example', label: 'A' }]);
  const payload = () => JSON.parse(JSON.stringify(exportSync(state, { id: 'pc', name: 'PC' }, at(WS_NOW))));
  const withLinks = (links) => { const copy = payload(); copy.data.tasks[0].links = links; return copy; };
  const good = { id: 'l1', url: 'https://b.example/x', label: 'B' };
  assert.equal(mergeSync(fresh(), withLinks([good]), ctx(WS_NOW, 'phone')).state.tasks[0].links[0].url, good.url);
  for (const links of [[{ ...good, url: 'javascript:alert(1)' }], 'x', [null], [{ ...good, id: '' }], [{ ...good, label: 'x'.repeat(81) }],
    Array.from({ length: 21 }, (_, index) => ({ ...good, id: 'l' + index }))]) {
    assert.throws(() => mergeSync(fresh(), withLinks(links), ctx(WS_NOW, 'phone')), /invalid task/);
  }
});

test('WS-03: linkBlock ignores one trailing dot in the host', () => {
  const now = at(WS_NOW);
  const base = fresh();
  const state = startFocus({ ...base, preferences: { ...base.preferences, domains: ['youtube.com'] } }, now);
  assert.deepEqual(linkBlock(state, 'https://youtube.com./x', now), { source: 'focus' });
});

test('WS-04: workspace apps with a path over 260 characters are dropped', () => {
  const now = at(WS_NOW);
  const { state } = workspaceTask();
  const long = 'C:\\' + 'a'.repeat(300) + '.exe';
  const started = startFocus(state, now, { workspaceApps: [{ path: long, name: 'Long' }, { path: 'C:\\Apps\\Ok.exe', name: 'Ok' }] });
  assert.deepEqual(started.focus.workspaceApps, [{ path: 'C:\\Apps\\Ok.exe', name: 'Ok' }]);
});

// ---------------------------------------------------------------------------
// Task tree (TASK-03 to TASK-06)
import {
  addChildTask, ancestorsOf, childProgress, effectiveParents, nestedChildren, parentChoices, childrenOf, deadlineAfterParent, subtreeFocusMinutes, subtreeIds,
  MAX_CHILDREN
} from '../app/model.js';

const TT = '2026-11-19T09:00:00Z';
const byTitle = (state, title) => state.tasks.find((task) => task.title === title);

function chain(depth, state = fresh()) {
  let parent = null;
  for (let level = 1; level <= depth; level += 1) {
    state = parent
      ? addChildTask(state, parent, { title: `L${level}` }, ctx(TT))
      : captureTask(state, { title: `L${level}` }, ctx(TT));
    parent = byTitle(state, `L${level}`).id;
  }
  return state;
}

test('TASK-03: children nest three levels deep and the selectors follow', () => {
  const state = chain(3);
  const [l1, l2, l3] = ['L1', 'L2', 'L3'].map((title) => byTitle(state, title));
  assert.equal(l1.parentId, null);
  assert.equal(l3.parentId, l2.id);
  assert.deepEqual(childrenOf(state, l1.id).map((task) => task.title), ['L2']);
  assert.deepEqual(ancestorsOf(state, l3.id).map((task) => task.title), ['L2', 'L1']);
  assert.deepEqual(subtreeIds(state, l1.id), [l2.id, l3.id]);
  assert.throws(() => addChildTask(state, 'ghost', { title: 'x' }, ctx(TT)), /no longer exists/);
});

test('TASK-03: moves are refused under itself, a descendant, past 5 levels, the 51st child and a closed parent', () => {
  const state = chain(3);
  const [l1, l2, l3] = ['L1', 'L2', 'L3'].map((title) => byTitle(state, title).id);
  assert.throws(() => saveTask(state, l1, { parentId: l1 }, ctx(TT)), /under itself or its own child/);
  assert.throws(() => saveTask(state, l1, { parentId: l3 }, ctx(TT)), /under itself or its own child/);
  assert.throws(() => saveTask(state, l2, { parentId: l3 }, ctx(TT)), /under itself or its own child/);

  // A depth-4 task and a loose 2-level subtree: 4 + 2 = 6 levels.
  let deep = chain(4);
  deep = captureTask(deep, { title: 'Top' }, ctx(TT));
  const top = byTitle(deep, 'Top').id;
  deep = addChildTask(deep, top, { title: 'Leaf' }, ctx(TT));
  const l4 = byTitle(deep, 'L4').id;
  assert.throws(() => saveTask(deep, top, { parentId: l4 }, ctx(TT)), /at most 5 levels/);
  const five = chain(5);
  assert.throws(() => addChildTask(five, byTitle(five, 'L5').id, { title: 'x' }, ctx(TT)), /at most 5 levels/);
  const fits = saveTask(deep, byTitle(deep, 'Leaf').id, { parentId: l4 }, ctx(TT));
  assert.equal(byTitle(fits, 'Leaf').parentId, l4);

  let wide = captureTask(fresh(), { title: 'Parent' }, ctx(TT));
  const parent = wide.tasks[0].id;
  for (let index = 0; index < MAX_CHILDREN; index += 1) wide = addChildTask(wide, parent, { title: `c${index}` }, ctx(TT));
  assert.throws(() => addChildTask(wide, parent, { title: 'one more' }, ctx(TT)), /at most 50 child tasks/);

  let closed = captureTask(fresh(), { title: 'Done parent' }, ctx(TT));
  closed = captureTask(closed, { title: 'Loose' }, ctx(TT));
  closed = toggleTask(closed, closed.tasks[0].id, ctx(TT));
  assert.throws(() => saveTask(closed, closed.tasks[1].id, { parentId: closed.tasks[0].id }, ctx(TT)), /Reopen the parent/);
  assert.throws(() => addChildTask(closed, closed.tasks[0].id, { title: 'x' }, ctx(TT)), /Reopen the parent/);
  const parked = saveTask(closed, closed.tasks[1].id, { status: 'completed', parentId: closed.tasks[0].id }, ctx(TT));
  assert.equal(parked.tasks[1].parentId, closed.tasks[0].id);
});

test('TASK-04: a parent closes only after its children and reopens with them', () => {
  const state = chain(3);
  const [l1, l2, l3] = ['L1', 'L2', 'L3'].map((title) => byTitle(state, title).id);
  assert.throws(() => toggleTask(state, l1, ctx(TT)), /Complete or cancel its child tasks first/);
  assert.throws(() => saveTask(state, l2, { status: 'canceled' }, ctx(TT)), /Complete or cancel its child tasks first/);
  let done = toggleTask(state, l3, ctx('2026-11-19T10:00:00Z'));
  done = toggleTask(done, l2, ctx('2026-11-19T10:01:00Z'));
  done = toggleTask(done, l1, ctx('2026-11-19T10:02:00Z'));
  assert.equal(done.tasks.find((task) => task.id === l1).status, 'completed');

  const reopened = toggleTask(done, l3, ctx('2026-11-19T11:00:00Z'));
  for (const id of [l1, l2, l3]) assert.equal(reopened.tasks.find((task) => task.id === id).status, 'open');
  for (const id of [l1, l2]) {
    assert.equal(reopened.tasks.find((task) => task.id === id).events.at(-1).type, 'reopened');
  }
  assert.deepEqual(childProgress(reopened, l2), { done: 0, total: 1 });
});

test('TASK-04: a parent with children cannot be deleted', () => {
  const state = chain(2);
  assert.throws(() => deleteTask(state, byTitle(state, 'L1').id, ctx(TT)), /Delete or move its child tasks first/);
  const lone = deleteTask(state, byTitle(state, 'L2').id, ctx(TT));
  assert.equal(deleteTask(lone, byTitle(lone, 'L1').id, ctx(TT)).tasks.length, 0);
});

test('WB-02: during a hold on a parent its open children stay in place', () => {
  const made = strictTask({ title: 'Held parent' });
  let state = addChildTask(made.state, made.id, { title: 'Open child' }, ctx(T0));
  state = addChildTask(state, made.id, { title: 'Other child' }, ctx(T0));
  state = captureTask(state, { title: 'Elsewhere' }, ctx(T0));
  const child = byTitle(state, 'Open child').id;
  const other = byTitle(state, 'Other child').id;
  const elsewhere = byTitle(state, 'Elsewhere').id;
  state = tickStrict(state, ctx('2026-11-19T10:00:00Z'));
  const now = ctx('2026-11-19T10:05:00Z');
  assert.throws(() => deleteTask(state, child, now), /Open child tasks cannot be removed/);
  assert.throws(() => saveTask(state, child, { status: 'canceled' }, now), /Open child tasks cannot be removed/);
  assert.throws(() => saveTask(state, child, { parentId: null }, now), /Open child tasks cannot be removed/);
  assert.throws(() => saveTask(state, child, { parentId: elsewhere }, now), /Open child tasks cannot be removed/);
  assert.equal(saveTask(state, child, { parentId: other }, now).tasks.find((task) => task.id === child).parentId, other);
  state = toggleTask(state, child, now);
  state = toggleTask(state, other, now);
  assert.equal(state.tasks.find((task) => task.id === child).status, 'completed');
  const held = saveTask(state, made.id, { subtasks: tickedDone }, now);
  assert.equal(saveTask(held, made.id, { status: 'completed' }, now).tasks[0].status, 'completed');
});

const syncPayload = (state, id, when) => exportSync(state, { id, name: id }, at(when));

test('TASK-06: a missing or deleted parent reads as top level and nothing is written', () => {
  const pc = chain(2);
  const child = byTitle(pc, 'L2');
  const phone = mergeSync(fresh(), syncPayload(pc, 'pc', '2026-11-19T10:00:00Z'), ctx('2026-11-19T10:01:00Z', 'phone')).state;
  assert.equal(effectiveParents(phone).get(child.id), child.parentId);
  const stale = JSON.parse(JSON.stringify(syncPayload(pc, 'pc', '2026-11-19T10:04:00Z')));
  stale.data.tasks.find((task) => task.id === child.id).parentId = 'missing';
  stale.data.tasks.find((task) => task.id === child.id).stamps.parentId = '2026-11-19T10:03:00.000Z|pc';
  const result = mergeSync(phone, stale, ctx('2026-11-19T10:05:00Z', 'phone'));
  const stored = result.state.tasks.find((task) => task.id === child.id);
  assert.equal(stored.parentId, 'missing');
  assert.equal(stored.stamps.parentId, '2026-11-19T10:03:00.000Z|pc');
  assert.equal(effectiveParents(result.state).get(child.id), null);
  assert.equal(result.summary.repaired, 1);
  assert.equal(result.state.conflicts.length, 0);
  assert.deepEqual(childrenOf(result.state, child.parentId), []);

  const tombstoned = { ...phone, deleted: { ...phone.deleted, [child.parentId]: '2026-11-19T10:00:00.000Z' } };
  assert.equal(effectiveParents(tombstoned).get(child.id), null);
  assert.equal(effectiveParents(phone).get(child.id), child.parentId);
});

test('TASK-06: a cycle reads as broken at the task whose parent was set last', () => {
  const state = chain(3);
  const [l1, l2, l3] = ['L1', 'L2', 'L3'].map((title) => byTitle(state, title).id);
  const stamp = (id, value, when) => ({ id, value, when });
  const damaged = {
    ...state,
    tasks: state.tasks.map((task) => {
      const edit = [stamp(l1, l3, 'z'), stamp(l2, l1, 'a'), stamp(l3, l2, 'm')].find((item) => item.id === task.id);
      return { ...task, parentId: edit.value, stamps: { ...task.stamps, parentId: edit.when } };
    })
  };
  const parents = effectiveParents(damaged);
  assert.equal(parents.get(l1), null);
  assert.equal(parents.get(l2), l1);
  assert.equal(parents.get(l3), l2);
  assert.deepEqual(ancestorsOf(damaged, l3).map((task) => task.title), ['L2', 'L1']);
  // The tie goes to the lower id.
  const tied = { ...damaged, tasks: damaged.tasks.map((task) => ({ ...task, stamps: { ...task.stamps, parentId: 'same' } })) };
  const lowest = [l1, l2, l3].sort()[0];
  assert.equal(effectiveParents(tied).get(lowest), null);
});

test('TASK-06: two devices merging a move cycle in opposite orders read the same tree with no conflicts', () => {
  let pc = captureTask(fresh(), { title: 'A' }, ctx('2026-11-19T08:00:00Z', 'pc'));
  pc = captureTask(pc, { title: 'B' }, ctx('2026-11-19T08:00:01Z', 'pc'));
  const [a, b] = pc.tasks.map((task) => task.id);
  let phone = mergeSync(fresh(), syncPayload(pc, 'pc', '2026-11-19T08:01:00Z'), ctx('2026-11-19T08:02:00Z', 'phone')).state;
  pc = saveTask(pc, a, { parentId: b }, ctx('2026-11-19T09:00:00Z', 'pc'));
  phone = saveTask(phone, b, { parentId: a }, ctx('2026-11-19T09:30:00Z', 'phone'));
  const onPc = mergeSync(pc, syncPayload(phone, 'phone', '2026-11-19T10:00:00Z'), ctx('2026-11-19T10:01:00Z', 'pc'));
  const onPhone = mergeSync(phone, syncPayload(pc, 'pc', '2026-11-19T10:00:00Z'), ctx('2026-11-19T10:01:00Z', 'phone'));
  for (const merged of [onPc, onPhone]) {
    assert.equal(merged.state.conflicts.length, 0);
    assert.equal(merged.summary.repaired, 1);
    assert.deepEqual([...effectiveParents(merged.state)].sort(), [[a, b], [b, null]].sort());
    assert.equal(merged.state.tasks.find((task) => task.id === b).parentId, a, 'the stored value is untouched');
  }
  // A clean merge repairs nothing.
  assert.equal(mergeSync(fresh(), syncPayload(chain(3), 'x', '2026-11-19T10:00:00Z'), ctx('2026-11-19T10:01:00Z', 'pc')).summary.repaired, 0);
});

test('TASK-06: resolving a conflict toward a cycle still reads as a tree', () => {
  let pc = fresh();
  for (const title of ['X', 'Y', 'Z']) pc = captureTask(pc, { title }, ctx('2026-11-19T08:00:00Z', 'pc'));
  let phone = mergeSync(fresh(), syncPayload(pc, 'pc', '2026-11-19T08:01:00Z'), ctx('2026-11-19T08:02:00Z', 'phone')).state;
  pc = mergeSync(pc, syncPayload(phone, 'phone', '2026-11-19T08:03:00Z'), ctx('2026-11-19T08:04:00Z', 'pc')).state;
  const [x, y, z] = ['X', 'Y', 'Z'].map((title) => byTitle(pc, title).id);
  pc = saveTask(pc, x, { parentId: y }, ctx('2026-11-19T09:00:00Z', 'pc'));
  phone = saveTask(phone, x, { parentId: z }, ctx('2026-11-19T09:05:00Z', 'phone'));
  phone = saveTask(phone, y, { parentId: x }, ctx('2026-11-19T09:06:00Z', 'phone'));
  pc = mergeSync(pc, syncPayload(phone, 'phone', '2026-11-19T10:00:00Z'), ctx('2026-11-19T10:01:00Z', 'pc')).state;
  assert.equal(pc.conflicts.length, 1);
  assert.equal(pc.conflicts[0].field, 'parentId');
  const resolved = resolveConflict(pc, pc.conflicts[0].id, 'local', ctx('2026-11-19T10:02:00Z', 'pc'));
  assert.equal(resolved.tasks.find((task) => task.id === x).parentId, y);
  assert.equal(resolved.tasks.find((task) => task.id === y).parentId, x);
  assert.equal(effectiveParents(resolved).get(x), null);
  assert.equal(effectiveParents(resolved).get(y), x);
  assert.deepEqual(ancestorsOf(resolved, y).map((task) => task.id), [x]);
});

test('TASK-06: a sync file with a bad parentId is refused', () => {
  const payload = () => JSON.parse(JSON.stringify(syncPayload(chain(2), 'pc', '2026-11-19T10:00:00Z')));
  for (const parentId of [5, {}, '', 'x'.repeat(65), true]) {
    const bad = payload();
    bad.data.tasks[0].parentId = parentId;
    assert.throws(() => mergeSync(fresh(), bad, ctx('2026-11-19T10:01:00Z', 'phone')), /invalid task/);
  }
  const old = payload();
  delete old.data.tasks[0].parentId;
  assert.doesNotThrow(() => mergeSync(fresh(), old, ctx('2026-11-19T10:01:00Z', 'phone')));
});

test('TASK-04: a closed parent that sync left with an open child can still be edited', () => {
  const state = chain(2);
  const l1 = byTitle(state, 'L1');
  const damaged = { ...state, tasks: state.tasks.map((task) => (task.id === l1.id ? { ...task, status: 'completed', completedAt: TT } : task)) };
  const renamed = saveTask(damaged, l1.id, { title: 'Renamed' }, ctx(TT));
  assert.equal(byTitle(renamed, 'Renamed').status, 'completed');
  assert.throws(() => saveTask(damaged, l1.id, { status: 'canceled' }, ctx(TT)), /Complete or cancel its child tasks first/);
  // The open grandchild must come with a reopened chain, top down.
  const deep = chain(3);
  const closed = { ...deep, tasks: deep.tasks.map((task) => (task.title === 'L3' ? task : { ...task, status: 'completed', completedAt: TT })) };
  const reopened = saveTask(closed, byTitle(closed, 'L3').id, { title: 'L3 again' }, ctx(TT));
  assert.equal(byTitle(reopened, 'L1').status, 'completed', 'editing does not reopen');
});

test('WB-02: a hold on a parent also guards a closed child that has an open grandchild', () => {
  const made = strictTask({ title: 'Held parent' });
  let state = addChildTask(made.state, made.id, { title: 'Mid' }, ctx(T0));
  state = addChildTask(state, byTitle(state, 'Mid').id, { title: 'Deep' }, ctx(T0));
  const mid = byTitle(state, 'Mid').id;
  state = { ...state, tasks: state.tasks.map((task) => (task.id === mid ? { ...task, status: 'completed', completedAt: T0 } : task)) };
  state = tickStrict(state, ctx('2026-11-19T10:00:00Z'));
  const now = ctx('2026-11-19T10:05:00Z');
  const ticked = saveTask(state, made.id, { subtasks: tickedDone }, now);
  assert.throws(() => saveTask(ticked, made.id, { status: 'completed' }, now), /Complete or cancel its child tasks first/);
  assert.throws(() => saveTask(state, mid, { parentId: null }, now), /Open child tasks cannot be removed/);
});

test('TASK-05: children stay out of the inbox and the automatic next task skips a parent with open children', () => {
  let state = captureTask(fresh(), { title: 'Parent', plannedDate: '2026-11-19', pinned: true }, ctx(TT));
  const parent = state.tasks[0].id;
  state = addChildTask(state, parent, { title: 'Child', plannedDate: '2026-11-19' }, ctx(TT));
  state = captureTask(state, { title: 'Loose' }, ctx(TT));
  assert.deepEqual(inboxTasks(state).map((task) => task.title), ['Loose']);
  assert.equal(todayView(state, at(TT)).next.title, 'Child');
  const chosen = setNextAction(state, parent, ctx(TT));
  assert.equal(todayView(chosen, at(TT)).next.title, 'Parent');
});

test('TASK-05: child progress, focus rolled up over the subtree and a deadline later than the parent', () => {
  let state = chain(3);
  const [l1, l2, l3] = ['L1', 'L2', 'L3'].map((title) => byTitle(state, title).id);
  assert.deepEqual(childProgress(state, l1), { done: 0, total: 1 });
  const seg = (taskId, start, end) => ({ id: `${taskId}${start}`, sessionId: 's', taskId, start, end, deviceId: 'pc' });
  state = { ...state, focusSegments: [
    seg(l1, '2026-11-19T10:00:00.000Z', '2026-11-19T10:10:00.000Z'),
    seg(l2, '2026-11-19T11:00:00.000Z', '2026-11-19T11:20:00.000Z')
  ] };
  state = startFocus(state, at('2026-11-19T12:00:00Z'), { taskId: l3 });
  const now = at('2026-11-19T12:05:00Z');
  assert.equal(taskFocusMinutes(state, l1, now), 10);
  assert.equal(subtreeFocusMinutes(state, l1, now), 35);
  assert.equal(subtreeFocusMinutes(state, l2, now), 25);
  assert.equal(focusTimeReview(state, '2026-11-19', '2026-11-19', now).byTask.find((item) => item.taskId === l1).minutes, 10);

  state = saveTask(state, l1, { deadline: '2026-11-25T10:00:00.000Z' }, ctx(TT));
  state = saveTask(state, l2, { deadline: '2026-11-26T10:00:00.000Z' }, ctx(TT));
  state = toggleTask(state, l3, ctx(TT));
  assert.deepEqual(childProgress(state, l2), { done: 1, total: 1 });
  const task = (id) => state.tasks.find((item) => item.id === id);
  assert.equal(deadlineAfterParent(state, task(l2)), true);
  assert.equal(deadlineAfterParent(state, task(l3)), false);
  assert.equal(deadlineAfterParent(state, task(l1)), false);
});

test('TASK-03: parentChoices lists only the parents a move would allow', () => {
  let state = chain(3);
  state = captureTask(state, { title: 'Other' }, ctx(TT));
  state = captureTask(state, { title: 'Closed' }, ctx(TT));
  state = toggleTask(state, byTitle(state, 'Closed').id, ctx(TT));
  const titles = (title) => parentChoices(state, byTitle(state, title).id).map((task) => task.title).sort();
  assert.deepEqual(titles('L1'), ['Other']);
  assert.deepEqual(titles('L3'), ['L1', 'L2', 'Other']);
  assert.deepEqual(titles('Other'), ['L1', 'L2', 'L3']);
  assert.deepEqual(parentChoices(state, 'ghost'), []);
});

test('TASK-05: the next action descends to a leaf of a pinned parent and an explicit choice is kept', () => {
  let state = captureTask(fresh(), { title: 'Parent', plannedDate: '2026-11-19', pinned: true }, ctx(TT));
  const parent = state.tasks[0].id;
  state = addChildTask(state, parent, { title: 'First child' }, ctx(TT));
  state = addChildTask(state, byTitle(state, 'First child').id, { title: 'Leaf' }, ctx(TT));
  state = addChildTask(state, parent, { title: 'Second child' }, ctx(TT));
  assert.equal(todayView(state, at(TT)).next.title, 'Leaf');
  state = toggleTask(state, byTitle(state, 'Leaf').id, ctx(TT));
  assert.equal(todayView(state, at(TT)).next.title, 'First child');
  assert.equal(todayView(setNextAction(state, parent, ctx(TT)), at(TT)).next.title, 'Parent');
});

test('WB-01: an active child task makes a block eligible for strict', () => {
  const made = captureTask(fresh(), { title: 'Plain' }, ctx(T0));
  const id = made.tasks[0].id;
  assert.throws(() => saveTask(made, id, { workBlocks: [BLOCK] }, ctx(T0)), /Add completion criteria or a child task/);
  const withChild = addChildTask(made, id, { title: 'Step' }, ctx(T0));
  assert.equal(saveTask(withChild, id, { workBlocks: [BLOCK] }, ctx(T0)).tasks[0].workBlocks[0].strict, true);
  const done = toggleTask(withChild, byTitle(withChild, 'Step').id, ctx(T0));
  assert.throws(() => saveTask(done, id, { workBlocks: [BLOCK] }, ctx(T0)), /Add completion criteria or a child task/);
});

// A parent made strict only because it has one open child.
function strictOnChild(blockOverride = {}) {
  let state = captureTask(fresh(), { title: 'P' }, ctx(T0));
  const parent = state.tasks[0].id;
  state = addChildTask(state, parent, { title: 'K' }, ctx(T0));
  state = saveTask(state, parent, { workBlocks: [{ ...BLOCK, ...blockOverride }] }, ctx(T0));
  return { state, parent, kid: byTitle(state, 'K').id };
}

test('WB-01: a strict parent whose last child was completed can still be edited and completed', () => {
  const { state, parent, kid } = strictOnChild();
  const done = toggleTask(state, kid, ctx(T0));
  const renamed = saveTask(done, parent, { title: 'P renamed' }, ctx(T0));
  assert.equal(byTitle(renamed, 'P renamed').status, 'open');
  assert.equal(toggleTask(done, parent, ctx(T0)).tasks[0].status, 'completed');
  // Making a block strict on an ineligible task still throws.
  const second = { id: 'blk2', start: '2026-11-19T12:00:00.000Z', end: '2026-11-19T12:30:00.000Z', strict: true };
  assert.throws(() => saveTask(done, parent, { workBlocks: [BLOCK, second] }, ctx(T0)), /Add completion criteria or a child task/);
});

test('WB-01: the same holds during a live hold and the hold logs on_time', () => {
  const { state, parent, kid } = strictOnChild();
  let held = tickStrict(state, ctx('2026-11-19T10:00:00Z'));
  const now = ctx('2026-11-19T10:05:00Z');
  held = toggleTask(held, kid, now);
  held = toggleTask(held, parent, ctx('2026-11-19T10:06:00Z'));
  const ticked = tickStrict(held, ctx('2026-11-19T10:07:00Z'));
  assert.deepEqual(ticked.strictLog.map((entry) => entry.outcome), ['on_time']);
});

test('WB-01: before the block starts, taking the only child away from a strict parent is refused', () => {
  const { state, parent, kid } = strictOnChild();
  const other = captureTask(state, { title: 'Elsewhere' }, ctx(T0));
  const message = /strict block on its parent task needs it/;
  assert.throws(() => saveTask(state, kid, { parentId: null }, ctx(T0)), message);
  assert.throws(() => saveTask(other, kid, { parentId: byTitle(other, 'Elsewhere').id }, ctx(T0)), message);
  assert.throws(() => saveTask(state, kid, { status: 'canceled' }, ctx(T0)), message);
  assert.throws(() => deleteTask(state, kid, ctx(T0)), message);
  assert.equal(toggleTask(state, kid, ctx(T0)).tasks.find((task) => task.id === kid).status, 'completed');
  // A second open child keeps the parent eligible.
  const two = addChildTask(state, parent, { title: 'K2' }, ctx(T0));
  assert.equal(saveTask(two, kid, { parentId: null }, ctx(T0)).tasks.find((task) => task.id === kid).parentId, null);
  // Subtasks also keep it eligible.
  const withSubtask = saveTask(state, parent, { subtasks: [{ title: 'Step' }] }, ctx(T0));
  assert.equal(deleteTask(withSubtask, kid, ctx(T0)).tasks.length, 1);
});

test('WB-01: removing the last subtask of a strict task with no children still throws', () => {
  const { state, id } = strictTask();
  assert.throws(() => saveTask(state, id, { subtasks: [] }, ctx(T0)), /Add completion criteria or a child task/);
});

test('TASK-03: an active child of a closed parent is not nested under it', () => {
  const state = chain(3);
  const [l1, l2, l3] = ['L1', 'L2', 'L3'].map((title) => byTitle(state, title));
  const closedMid = { ...state, tasks: state.tasks.map((task) => (task.id === l2.id ? { ...task, status: 'completed', completedAt: TT } : task)) };
  assert.deepEqual(nestedChildren(closedMid, byTitle(closedMid, 'L1')).map((task) => task.title), ['L2']);
  assert.deepEqual(nestedChildren(closedMid, byTitle(closedMid, 'L2')), []);
  assert.deepEqual(nestedChildren(closedMid, byTitle(closedMid, 'L3')), []);
  assert.ok(l1 && l3);
});

// ---------------------------------------------------------------------------
// Account sync support (SYS-02, SYS-05): schema, own payloads, remote-first root, ties, clear.
import { clearSyncedData, eraseUserData, protectionsActive, settleFocusTask, SYNC_SCHEMA } from '../app/model.js';

const PC = { id: 'pc', name: 'PC' };
const PHONE = { id: 'phone', name: 'Phone' };

test('SYS-02: exports carry the sync schema and old files without one are accepted', () => {
  const payload = exportSync(fresh(), PC, at('2026-11-19T08:00:00Z'));
  assert.equal(payload.schema, SYNC_SCHEMA);
  const { schema, ...old } = payload;
  assert.doesNotThrow(() => mergeSync(fresh(), old, ctx('2026-11-19T08:01:00Z', 'phone')));
  assert.doesNotThrow(() => mergeSync(fresh(), { ...payload, schema: SYNC_SCHEMA + 5 }, ctx('2026-11-19T08:01:00Z', 'phone')));
  assert.throws(() => mergeSync(fresh(), { ...payload, schema: '2' }, ctx('2026-11-19T08:01:00Z', 'phone')), /not a Fix Myself sync file/);
  assert.throws(() => mergeSync(fresh(), { ...payload, schema: 1.5 }, ctx('2026-11-19T08:01:00Z', 'phone')), /not a Fix Myself sync file/);
});

test('SYS-02: allowOwn merges a payload this device wrote and leaves peers alone', () => {
  const pc = captureTask(fresh(), { title: 'Mine' }, ctx('2026-11-19T08:00:00Z', 'pc'));
  const payload = exportSync(pc, PC, at('2026-11-19T08:01:00Z'));
  assert.throws(() => mergeSync(fresh(), payload, ctx('2026-11-19T08:02:00Z', 'pc')), /came from this device/);
  const merged = mergeSync(fresh(), payload, { ...ctx('2026-11-19T08:02:00Z', 'pc'), allowOwn: true });
  assert.deepEqual(merged.state.tasks.map((task) => task.title), ['Mine']);
  assert.deepEqual(merged.state.peers, {});
  const other = mergeSync(fresh(), payload, { ...ctx('2026-11-19T08:02:00Z', 'phone'), allowOwn: true });
  assert.equal(other.state.peers.pc.seenUntil, payload.exportedAt, 'a payload from another device still records the peer');
});

test('SYS-02: preferRemoteRoot gives the remote copy every root value, even against a newer local stamp', () => {
  const rule = { name: 'Social', domains: ['youtube.com'], enabled: true };
  const remote = saveBlockRule(fresh(), null, rule, ctx('2026-11-19T08:00:00Z', 'phone'));
  const payload = exportSync(remote, PHONE, at('2026-11-19T08:01:00Z'));
  let local = saveBlockRule(fresh(), null, { ...rule, name: 'Local only' }, ctx('2026-11-19T09:00:00Z', 'pc'));
  local = captureTask(local, { title: 'Local task' }, ctx('2026-11-19T09:00:00Z', 'pc'));
  const normal = mergeSync(local, payload, ctx('2026-11-19T09:01:00Z', 'pc')).state;
  assert.equal(normal.blockRules[0].name, 'Local only', 'normal merge keeps the newer local rules');
  const forced = mergeSync(local, payload, { ...ctx('2026-11-19T09:01:00Z', 'pc'), preferRemoteRoot: true }).state;
  assert.deepEqual(forced.blockRules, remote.blockRules);
  assert.deepEqual(forced.tasks.map((task) => task.title), ['Local task'], 'tasks still merge as usual');
});

test('A-10: a conflict another device already resolved is dropped on merge', () => {
  let pc = captureTask(fresh(), { title: 'Shared' }, ctx('2026-11-19T08:00:00Z', 'pc'));
  let phone = mergeSync(fresh(), exportSync(pc, PC, at('2026-11-19T08:01:00Z')), ctx('2026-11-19T08:02:00Z', 'phone')).state;
  pc = mergeSync(pc, exportSync(phone, PHONE, at('2026-11-19T08:03:00Z')), ctx('2026-11-19T08:04:00Z', 'pc')).state;
  const id = pc.tasks[0].id;
  pc = saveTask(pc, id, { title: 'From PC' }, ctx('2026-11-19T09:00:00Z', 'pc'));
  phone = saveTask(phone, id, { title: 'From phone' }, ctx('2026-11-19T09:05:00Z', 'phone'));
  pc = mergeSync(pc, exportSync(phone, PHONE, at('2026-11-19T10:00:00Z')), ctx('2026-11-19T10:01:00Z', 'pc')).state;
  phone = mergeSync(phone, exportSync(pc, PC, at('2026-11-19T10:02:00Z')), ctx('2026-11-19T10:03:00Z', 'phone')).state;
  assert.equal(pc.conflicts.length, 1);
  assert.equal(phone.conflicts.length, 1);
  phone = resolveConflict(phone, phone.conflicts[0].id, 'local', ctx('2026-11-19T10:04:00Z', 'phone'));
  pc = mergeSync(pc, exportSync(phone, PHONE, at('2026-11-19T10:05:00Z')), ctx('2026-11-19T10:06:00Z', 'pc')).state;
  assert.equal(pc.conflicts.length, 0, 'resolved on the phone, so resolved here');
  assert.equal(pc.tasks[0].title, 'From phone');
});

test('SYS-02: ties break the same way on every device', () => {
  let pc = captureTask(fresh(), { title: 'Same task', deadline: '2026-11-25T10:00:00Z' }, ctx('2026-11-19T08:00:00Z', 'pc'));
  let phone = mergeSync(fresh(), exportSync(pc, PC, at('2026-11-19T08:01:00Z')), ctx('2026-11-19T08:02:00Z', 'phone')).state;
  const id = pc.tasks[0].id;
  pc = toggleTask(pc, id, ctx('2026-11-19T09:00:00Z', 'pc'));
  phone = toggleTask(phone, id, ctx('2026-11-19T09:30:00Z', 'phone'));
  const a = mergeSync(pc, exportSync(phone, PHONE, at('2026-11-19T10:00:00Z')), ctx('2026-11-19T10:01:00Z', 'pc')).state;
  const b = mergeSync(phone, exportSync(pc, PC, at('2026-11-19T10:00:00Z')), ctx('2026-11-19T10:02:00Z', 'phone')).state;
  assert.equal(a.tasks[0].completedAt, b.tasks[0].completedAt);
  assert.equal(a.tasks[0].completedAt, pc.tasks[0].completedAt, 'the earliest completion wins');
  // originalDeadline takes the earliest non-null value.
  const early = { ...pc, tasks: pc.tasks.map((task) => ({ ...task, originalDeadline: '2026-11-20T00:00:00.000Z' })) };
  const late = { ...phone, tasks: phone.tasks.map((task) => ({ ...task, originalDeadline: '2026-11-22T00:00:00.000Z' })) };
  const x = mergeSync(early, exportSync(late, PHONE, at('2026-11-19T11:00:00Z')), ctx('2026-11-19T11:01:00Z', 'pc')).state;
  const y = mergeSync(late, exportSync(early, PC, at('2026-11-19T11:00:00Z')), ctx('2026-11-19T11:02:00Z', 'phone')).state;
  assert.equal(x.tasks[0].originalDeadline, '2026-11-20T00:00:00.000Z');
  assert.equal(y.tasks[0].originalDeadline, '2026-11-20T00:00:00.000Z');
  // Workouts with equal updatedAt take the copy whose canonical JSON is greater.
  let w1 = saveWorkout(fresh(), { date: '2026-11-19', type: 'Run', minutes: 30 }, ctx('2026-11-19T08:00:00Z', 'pc'));
  const workoutId = w1.workouts[0].id;
  let w2 = mergeSync(fresh(), exportSync(w1, PC, at('2026-11-19T08:01:00Z')), ctx('2026-11-19T08:02:00Z', 'phone')).state;
  w1 = { ...w1, workouts: w1.workouts.map((item) => ({ ...item, minutes: 31 })) };
  w2 = { ...w2, workouts: w2.workouts.map((item) => ({ ...item, minutes: 45 })) };
  const m1 = mergeSync(w1, exportSync(w2, PHONE, at('2026-11-19T09:00:00Z')), ctx('2026-11-19T09:01:00Z', 'pc')).state;
  const m2 = mergeSync(w2, exportSync(w1, PC, at('2026-11-19T09:00:00Z')), ctx('2026-11-19T09:02:00Z', 'phone')).state;
  assert.equal(m1.workouts.find((item) => item.id === workoutId).minutes, 45);
  assert.equal(m2.workouts.find((item) => item.id === workoutId).minutes, 45);
});

test('SYS-05: clearSyncedData resets synced fields and keeps device-local ones', () => {
  const T = '2026-11-19T10:05:00Z';
  let state = captureTask(fresh(), {
    title: 'Write', subtasks: [{ id: 's1', title: 'Draft', done: false }], workBlocks: [BLOCK], remind: { start: true, deadline: false }
  }, ctx(T0));
  state = saveWorkout(state, { date: '2026-11-19', type: 'Run', minutes: 30 }, ctx(T0));
  state = saveBlockRule(state, null, { name: 'Social', domains: ['youtube.com'], enabled: true }, ctx(T0));
  state = setNextAction(state, state.tasks[0].id, ctx(T0));
  state = tickStrict(state, ctx(T));
  state = { ...state, lastLoginDay: '2026-11-19', chrome: { profiles: { p: { id: 'p' } } }, peers: { x: { name: 'X' } },
    conflicts: [{ id: 'c' }], appActivity: { days: { d: 1 }, reasons: [] } };
  const focus = state.focus;
  assert.ok(focus?.strict, 'a strict hold is running');
  const cleared = clearSyncedData(state, at(T));
  for (const field of ['tasks', 'workouts', 'blockRules', 'pendingRuleChanges', 'appPresets', 'pendingBlockChanges', 'focusSegments', 'strictLog', 'conflicts']) {
    assert.deepEqual(cleared[field], [], field);
  }
  for (const field of ['deleted', 'stamps', 'supersedes', 'devices', 'peers', 'reminders']) assert.deepEqual(cleared[field], {}, field);
  assert.equal(cleared.mission, '');
  assert.equal(cleared.nextActionId, null);
  // focus is untouched; settleFocusTask decides after a merge whether the task still exists.
  assert.deepEqual(cleared.focus, focus);
  assert.equal(settleFocusTask(cleared).focus.taskId, null);
  assert.equal(settleFocusTask(state), state);
  assert.deepEqual(cleared.chrome, state.chrome);
  assert.deepEqual(cleared.appActivity, state.appActivity);
  assert.equal(cleared.lastLoginDay, '2026-11-19');
  assert.deepEqual(cleared.preferences, state.preferences);
  assert.deepEqual(cleared.settings, state.settings);
  // The engine never clears a device in this state: rules, a strict block and a hold are active.
  assert.equal(protectionsActive(state, at(T)), true);
});

test('protectionsActive covers rules, waiting changes, strict blocks and holds (BLK-06, WB-01)', () => {
  const T = '2026-11-19T09:00:00Z';
  assert.equal(protectionsActive(fresh(), at(T)), false);
  const ruled = saveBlockRule(fresh(), null, { name: 'Social', domains: ['youtube.com'], enabled: true }, ctx(T0));
  assert.equal(protectionsActive(ruled, at(T)), true);
  const off = saveBlockRule(fresh(), null, { name: 'Social', domains: ['youtube.com'], enabled: false }, ctx(T0));
  assert.equal(protectionsActive(off, at(T)), false);
  assert.equal(protectionsActive({ ...fresh(), pendingRuleChanges: [{ id: 'p' }] }, at(T)), true);
  assert.equal(protectionsActive({ ...fresh(), pendingBlockChanges: [{ id: 'p' }] }, at(T)), true);
  const strict = captureTask(fresh(), { title: 'Write', subtasks: [{ id: 's1', title: 'Draft', done: false }], workBlocks: [BLOCK] }, ctx(T0));
  assert.equal(protectionsActive(strict, at(T)), true, 'an upcoming strict block');
  assert.equal(protectionsActive(strict, at('2026-11-19T12:00:00Z')), false, 'a strict block that has ended');
  assert.equal(protectionsActive({ ...fresh(), focus: { strict: { blockId: 'b' } } }, at(T)), true);
});

test('SYS-05: a plain erase refuses during a focus session or strict hold', () => {
  const T = '2026-11-19T10:05:00Z';
  const idle = fresh();
  assert.doesNotThrow(() => eraseUserData(idle, at(T).getTime()));
  const running = startFocus(captureTask(idle, { title: 'x' }, ctx(T0)), at(T));
  assert.throws(() => eraseUserData(running, at(T).getTime()), /Erase after the focus session ends\./);
  const ended = endFocus(running, ctx(T));
  assert.throws(() => eraseUserData(ended, at(T).getTime() + 1000), /Erase after the focus session ends\./, 'blocking outlasts an ended session');
  assert.doesNotThrow(() => eraseUserData(running, at(T).getTime() + 24 * 3_600_000));
  const held = { ...idle, focus: { sessionId: 's', taskId: null, endAt: 1, blockUntil: 1, endedAt: 1, strict: { blockId: 'b', taskId: 't' } } };
  assert.throws(() => eraseUserData(held, at(T).getTime()), /Erase after the focus session ends\./);
});

test('SYS-05: a plain erase refuses while block rules or waiting rule changes are active', () => {
  const T = '2026-11-19T10:05:00Z';
  const withRule = saveBlockRule(fresh(), null,
    { name: 'Evening news', domains: 'news.example', schedule: { type: 'always' }, strength: 'block' }, ctx(T));
  assert.throws(() => eraseUserData(withRule, at(T).getTime()), /Turn off block rules and strict blocks on this device first/);
  const off = { ...withRule, blockRules: withRule.blockRules.map((rule) => ({ ...rule, enabled: false })) };
  if (!protectionsActive(off, at(T))) assert.doesNotThrow(() => eraseUserData(off, at(T).getTime()));
});

// ---------------------------------------------------------------------------
// Completion criteria checklist (TASK-01, WB-01, REV-02, SRS 0.8)
import { criteriaItems, foldAllCriteria, foldTaskCriteria, strictEligible } from '../app/model.js';

const titles = (task) => task.subtasks.map((item) => item.title);
const fold = (task, text) => ({ id: 't', status: 'open', subtasks: [], stamps: {}, supersedes: {}, events: [], ...task, criteria: text });
const foldCtx = { at: '2026-11-19T09:00:00.000Z', device: 'pc' };

test('SRS 0.8: criteriaItems splits lines, strips bullets and drops blanks', () => {
  const items = criteriaItems('- Draft sent\n\n* Reviewed  \n• Filed\n1. First\n2) Second\n   \n+ Plus', [], false);
  assert.deepEqual(items.map((item) => item.title), ['Draft sent', 'Reviewed', 'Filed', 'First', 'Second', 'Plus']);
  assert.ok(items.every((item) => item.done === false && /^crit-[0-9a-f]{8}-1$/.test(item.id)));
});

test('SRS 0.8: a long line splits at spaces and never past 160 characters', () => {
  const words = Array.from({ length: 80 }, (_, i) => `w${i}`).join(' ');
  const long = `${words} ${words} ${words}`.slice(0, 400);
  const items = criteriaItems(long, [], false);
  assert.ok(items.length >= 3);
  assert.ok(items.every((item) => item.title.length <= 160 && item.title === item.title.trim()));
  assert.equal(items.map((item) => item.title).join(' '), long.replace(/\s+/g, ' ').trim());
  const solid = criteriaItems('a'.repeat(160) + 'b'.repeat(160) + 'c'.repeat(80), [], false);
  assert.deepEqual(solid.map((item) => item.title.length), [160, 160, 80]);
});

test('SRS 0.8: duplicate lines differing in case or spacing give one item, and existing titles are skipped', () => {
  const items = criteriaItems('Send report\nsend   REPORT\n  Send report ', [], false);
  assert.equal(items.length, 1);
  const more = criteriaItems('Send report\nNew one', [{ id: 'a', title: 'send report', done: true }], false);
  assert.deepEqual(more.map((item) => item.title), ['New one']);
});

test('SRS 0.8: the same text gives the same ids on copies, and a reused id gets the next occurrence number', () => {
  assert.deepEqual(criteriaItems('a\nb', [], false), criteriaItems('a\nb', [], false));
  const [first] = criteriaItems('x', [], false);
  const renamed = [{ ...first, title: 'x renamed' }];
  const [again] = criteriaItems('x', renamed, false);
  assert.notEqual(again.id, first.id);
  assert.match(again.id, /-2$/);
  const ids = [...renamed, again].map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('SRS 0.8: foldTaskCriteria appends after existing items, marks completed tasks done and folds once', () => {
  const task = fold({ subtasks: [{ id: 's1', title: 'Old', done: false }], status: 'completed' }, 'New\nOld');
  const folded = foldTaskCriteria(task, foldCtx);
  assert.deepEqual(titles(folded), ['Old', 'New']);
  assert.equal(folded.subtasks[1].done, true);
  assert.equal(folded.criteria, '');
  assert.equal(foldTaskCriteria(folded, foldCtx), folded, 'fold twice is fold once');
  const open = foldTaskCriteria(fold({}, 'a'), foldCtx);
  assert.equal(open.subtasks[0].done, false);
});

test('SRS 0.8: empty criteria return the same object and overflow past 50 is dropped', () => {
  const blank = fold({}, '  \n ');
  assert.equal(foldTaskCriteria(blank, foldCtx), blank);
  const many = fold({ subtasks: Array.from({ length: 48 }, (_, i) => ({ id: `s${i}`, title: `S${i}`, done: false })) }, 'a\nb\nc\nd');
  assert.equal(foldTaskCriteria(many, foldCtx).subtasks.length, 50);
});

test('SRS 0.8: the fold is a stamped edit with no timeline event', () => {
  const task = fold({ stamps: { subtasks: '2026-11-01T00:00:00.000Z|pc', criteria: '2026-11-01T00:00:00.000Z|pc' },
    supersedes: { subtasks: ['x'], criteria: ['y'], title: ['z'] } }, 'a');
  const folded = foldTaskCriteria(task, foldCtx);
  assert.equal(folded.stamps.subtasks, '2026-11-19T09:00:00.000Z|pc');
  assert.equal(folded.stamps.criteria, '2026-11-19T09:00:00.000Z|pc');
  assert.deepEqual(folded.supersedes, { title: ['z'] });
  assert.equal(folded.events, task.events);
  const state = { tasks: [task, fold({ id: 'u' }, '')] };
  const all = foldAllCriteria(state, { now: at('2026-11-19T09:00:00Z'), device: 'pc' });
  assert.equal(all.tasks[1], state.tasks[1]);
  assert.equal(foldAllCriteria(all, { now: at('2026-11-19T09:00:00Z'), device: 'pc' }), all);
});

test('SRS 0.8: saveTask folds text criteria into the checklist', () => {
  let state = captureTask(fresh(), { title: 'Report' }, ctx(T0));
  const id = state.tasks[0].id;
  state = saveTask(state, id, { criteria: 'a\nb' }, ctx(T0));
  assert.deepEqual(titles(state.tasks[0]), ['a', 'b']);
  assert.equal(state.tasks[0].criteria, '');
  state = saveTask(state, id, { criteria: 'c' }, ctx(T0));
  assert.deepEqual(titles(state.tasks[0]), ['a', 'b', 'c']);
  const kept = saveTask(state, id, { subtasks: [{ title: 'only' }], criteria: 'd' }, ctx(T0));
  assert.deepEqual(titles(kept.tasks[0]), ['only', 'd']);
  assert.equal(saveTask(kept, id, { criteria: 'D' }, ctx(T0)), kept, 'a duplicate line is skipped without error');
  const many = saveTask(state, id, { subtasks: Array.from({ length: 50 }, (_, i) => ({ title: `S${i}` })) }, ctx(T0));
  assert.throws(() => saveTask(many, id, { criteria: 'one more' }, ctx(T0)), /Add up to 50 completion criteria/);
});

test('WB-01: a task whose only criteria came from folded text is strict-eligible; an empty checklist is not', () => {
  const made = captureTask(fresh(), { title: 'x', criteria: 'Sent' }, ctx(T0));
  assert.equal(strictEligible(made, made.tasks[0]), true);
  const empty = captureTask(fresh(), { title: 'y' }, ctx(T0));
  assert.equal(strictEligible(empty, empty.tasks[0]), false);
});

// Two devices share one task whose criteria are still old text.
function oldTextPair(text) {
  const made = captureTask(fresh(), { title: 'Report' }, ctx('2026-11-19T08:00:00Z', 'a'));
  const id = made.tasks[0].id;
  const old = { ...made, tasks: [{ ...made.tasks[0], criteria: text }] };
  return { id, a: old, b: structuredClone(old) };
}
const exportOf = (state, device, time) => exportSync(state, { id: device, name: device }, at(time));

test('SRS 0.8: two devices folding the same text independently merge without a conflict', () => {
  const { id, a: a0, b: b0 } = oldTextPair('x\ny');
  const a = foldAllCriteria(a0, ctx('2026-11-19T09:00:00Z', 'a'));
  const b = foldAllCriteria(b0, ctx('2026-11-19T09:05:00Z', 'b'));
  assert.deepEqual(a.tasks[0].subtasks, b.tasks[0].subtasks);
  const intoA = mergeSync(a, exportOf(b, 'b', '2026-11-19T09:06:00Z'), ctx('2026-11-19T09:07:00Z', 'a'));
  const intoB = mergeSync(b, exportOf(a, 'a', '2026-11-19T09:06:00Z'), ctx('2026-11-19T09:07:00Z', 'b'));
  assert.deepEqual(intoA.state.conflicts, []);
  assert.deepEqual(intoB.state.conflicts, []);
  assert.deepEqual(titles(intoA.state.tasks[0]), ['x', 'y']);
  assert.deepEqual(intoA.state.tasks[0].subtasks, intoB.state.tasks[0].subtasks);
  assert.equal(intoA.state.tasks[0].stamps.subtasks, '2026-11-19T09:05:00.000Z|b', 'the higher stamp is kept');
  assert.equal(intoA.state.tasks.find((task) => task.id === id).criteria, '');
});

test('SRS 0.8: an older device adding a criterion after merging the fold loses nothing', () => {
  const { id, a: a0, b: b0 } = oldTextPair('x\ny');
  const a = foldAllCriteria(a0, ctx('2026-11-19T09:00:00Z', 'a'));
  let b = mergeSync(b0, exportOf(a, 'a', '2026-11-19T09:01:00Z'), ctx('2026-11-19T09:02:00Z', 'b')).state;
  assert.deepEqual(titles(b.tasks[0]), ['x', 'y']);
  b = saveTask(b, id, { subtasks: [...b.tasks[0].subtasks, { title: 'z' }] }, ctx('2026-11-19T09:10:00Z', 'b'));
  const back = mergeSync(a, exportOf(b, 'b', '2026-11-19T09:11:00Z'), ctx('2026-11-19T09:12:00Z', 'a')).state;
  assert.deepEqual(titles(back.tasks[0]), ['x', 'y', 'z']);
});

test('SRS 0.8: concurrent edits since the last merge raise a conflict instead of dropping the folded items', () => {
  const { id, a: a0, b: b0 } = oldTextPair('x\ny');
  const seen = { seenUntil: '2026-11-19T08:30:00.000Z', name: 'peer', mergedAt: '2026-11-19T08:30:00.000Z' };
  const a = { ...foldAllCriteria(a0, ctx('2026-11-19T09:00:00Z', 'a')), peers: { b: seen } };
  const b = { ...saveTask(b0, id, { subtasks: [{ title: 'z' }] }, ctx('2026-11-19T09:10:00Z', 'b')), peers: { a: seen } };
  const merged = mergeSync(a, exportOf(b, 'b', '2026-11-19T09:11:00Z'), ctx('2026-11-19T09:12:00Z', 'a')).state;
  assert.deepEqual(merged.conflicts.map((conflict) => conflict.field), ['subtasks']);
  assert.deepEqual(titles(merged.tasks[0]), ['x', 'y'], 'the local list stays until the user chooses');
  const chosen = resolveConflict(merged, merged.conflicts[0].id, 'local', ctx('2026-11-19T09:13:00Z', 'a'));
  assert.deepEqual(titles(chosen.tasks[0]), ['x', 'y']);
});

test('SRS 0.8: repeated merges with no new edits reach a fixed point', () => {
  const { id, a: a0, b: b0 } = oldTextPair('x\ny');
  let a = foldAllCriteria(a0, ctx('2026-11-19T09:00:00Z', 'a'));
  let b = saveTask(b0, id, { subtasks: [{ title: 'z' }] }, ctx('2026-11-19T09:10:00Z', 'b'));
  for (let round = 0; round < 2; round += 1) {
    const minute = 20 + round * 10;
    a = mergeSync(a, exportOf(b, 'b', `2026-11-19T09:${minute}:00Z`), ctx(`2026-11-19T09:${minute + 1}:00Z`, 'a')).state;
    b = mergeSync(b, exportOf(a, 'a', `2026-11-19T09:${minute + 2}:00Z`), ctx(`2026-11-19T09:${minute + 3}:00Z`, 'b')).state;
  }
  const dataA = exportOf(a, 'a', '2026-11-19T10:00:00Z').data.tasks;
  const dataB = exportOf(b, 'b', '2026-11-19T10:00:00Z').data.tasks;
  assert.deepEqual(dataA, dataB);
  const again = mergeSync(a, exportOf(b, 'b', '2026-11-19T10:01:00Z'), ctx('2026-11-19T10:02:00Z', 'a')).state;
  assert.deepEqual(exportOf(again, 'a', '2026-11-19T10:03:00Z').data.tasks, dataA);
});

test('SRS 0.8: an old device editing the text after a fold adds only the new line', () => {
  const { id, a: a0, b: b0 } = oldTextPair('x\ny');
  const a = foldAllCriteria(a0, ctx('2026-11-19T09:00:00Z', 'a'));
  const edited = { ...b0, tasks: [{ ...b0.tasks[0], criteria: 'w\nx\ny',
    stamps: { ...b0.tasks[0].stamps, criteria: '2026-11-19T09:10:00.000Z|b' } }] };
  const merged = mergeSync(a, exportOf(edited, 'b', '2026-11-19T09:11:00Z'), ctx('2026-11-19T09:12:00Z', 'a')).state;
  const task = merged.tasks.find((item) => item.id === id);
  assert.deepEqual(titles(task), ['x', 'y', 'w']);
  assert.equal(task.criteria, '');
});

test('WB-01: during a hold, a merge that would remove unticked criteria raises a conflict and completion still fails', () => {
  const { state, id } = strictTask();
  const held = tickStrict(state, ctx('2026-11-19T10:00:00Z'));
  const seen = { seenUntil: '2026-11-19T10:01:00.000Z', name: 'Phone', mergedAt: '2026-11-19T10:01:00.000Z' };
  const local = saveTask({ ...held, peers: { phone: seen } }, id,
    { subtasks: [...held.tasks[0].subtasks, { id: 's2', title: 'Check', done: false }] }, ctx('2026-11-19T10:05:00Z', 'pc'));
  const payload = exportOf(held, 'phone', '2026-11-19T10:07:00Z');
  payload.data.tasks[0].subtasks = [];
  payload.data.tasks[0].stamps.subtasks = '2026-11-19T10:06:00.000Z|phone';
  const merged = mergeSync(local, payload, ctx('2026-11-19T10:08:00Z', 'pc')).state;
  assert.deepEqual(merged.conflicts.map((conflict) => conflict.field), ['subtasks']);
  assert.deepEqual(merged.tasks[0].subtasks.map((item) => item.id), ['s1', 's2']);
  assert.throws(() => saveTask(merged, id, { status: 'completed' }, ctx('2026-11-19T10:09:00Z')),
    /Tick every completion criterion/);
});

test('SRS 0.8: resolving a conflict that writes text criteria leaves the task folded', () => {
  const made = captureTask(fresh(), { title: 'Report' }, ctx(T0));
  const id = made.tasks[0].id;
  const state = { ...made, conflicts: [{ id: `${id}:criteria`, ref: id, field: 'criteria', local: '', remote: 'a\nb',
    localStamp: '2026-11-19T09:00:00.000Z|pc', remoteStamp: '2026-11-19T09:01:00.000Z|phone' }] };
  const resolved = resolveConflict(state, `${id}:criteria`, 'remote', ctx('2026-11-19T09:05:00Z'));
  assert.deepEqual(titles(resolved.tasks[0]), ['a', 'b']);
  assert.equal(resolved.tasks[0].criteria, '');
  assert.deepEqual(resolved.conflicts, []);
});

// Commitments are gone (SRS 0.9): an old outcome folds into the criteria checklist.
const withCommitment = (extra, outcome = 'Proposal sent') => fold({ commitment: { outcome, committedAt: '2026-11-18T09:00:00.000Z' }, ...extra }, '');

test('SRS 0.9: a commitment outcome becomes one criterion and the commitment is cleared', () => {
  const task = withCommitment({ stamps: { commitment: '2026-11-01T00:00:00.000Z|pc' }, supersedes: { commitment: ['x'], title: ['z'] } });
  const folded = foldTaskCriteria(task, foldCtx);
  assert.deepEqual(titles(folded), ['Proposal sent']);
  assert.equal(folded.subtasks[0].done, false);
  assert.equal(folded.commitment, null);
  assert.equal(folded.stamps.subtasks, '2026-11-19T09:00:00.000Z|pc');
  assert.equal(folded.stamps.commitment, '2026-11-19T09:00:00.000Z|pc');
  assert.deepEqual(folded.supersedes, { title: ['z'] });
  assert.equal(folded.events, task.events, 'no timeline event');
  assert.equal(foldTaskCriteria(folded, foldCtx), folded, 'fold twice is fold once');
});

test('SRS 0.9: the outcome follows text criteria, skips duplicates and ticks on a completed task', () => {
  const dup = foldTaskCriteria({ ...withCommitment({}), criteria: 'proposal  sent' }, foldCtx);
  assert.deepEqual(titles(dup), ['proposal  sent'], 'the outcome is not added twice');
  const both = foldTaskCriteria({ ...withCommitment({ subtasks: [{ id: 's', title: 'First', done: false }] }), criteria: 'Second' }, foldCtx);
  assert.deepEqual(titles(both), ['First', 'Second', 'Proposal sent']);
  const done = foldTaskCriteria(withCommitment({ status: 'completed' }), foldCtx);
  assert.equal(done.subtasks[0].done, true);
  const cleared = foldTaskCriteria(withCommitment({}, ''), foldCtx);
  assert.equal(cleared.commitment, null);
  assert.deepEqual(cleared.subtasks, []);
  assert.equal(cleared.stamps.commitment, '2026-11-19T09:00:00.000Z|pc');
});

test('SRS 0.9: a long outcome may split into two criteria and the cap of 50 drops the outcome', () => {
  const long = Array.from({ length: 40 }, () => 'word').join(' ');
  assert.equal(foldTaskCriteria(withCommitment({}, long), foldCtx).subtasks.length, 2);
  const items = (n) => Array.from({ length: n }, (_, i) => ({ id: `s${i}`, title: `S${i}`, done: false }));
  assert.equal(foldTaskCriteria(withCommitment({ subtasks: items(49) }), foldCtx).subtasks.length, 50);
  const full = foldTaskCriteria(withCommitment({ subtasks: items(50) }), foldCtx);
  assert.equal(full.subtasks.length, 50);
  assert.equal(full.commitment, null);
});

test('SRS 0.9: two devices folding the same commitment converge without a conflict', () => {
  const made = captureTask(fresh(), { title: 'Report' }, ctx('2026-11-19T08:00:00Z', 'a'));
  const id = made.tasks[0].id;
  const old = { ...made, tasks: [{ ...made.tasks[0], commitment: { outcome: 'Report filed', committedAt: '2026-11-18T09:00:00.000Z' } }] };
  const a = foldAllCriteria(old, ctx('2026-11-19T09:00:00Z', 'a'));
  const b = foldAllCriteria(structuredClone(old), ctx('2026-11-19T09:05:00Z', 'b'));
  const intoA = mergeSync(a, exportOf(b, 'b', '2026-11-19T09:06:00Z'), ctx('2026-11-19T09:07:00Z', 'a'));
  const intoB = mergeSync(b, exportOf(a, 'a', '2026-11-19T09:06:00Z'), ctx('2026-11-19T09:07:00Z', 'b'));
  assert.deepEqual(intoA.state.conflicts, []);
  assert.deepEqual(intoB.state.conflicts, []);
  assert.deepEqual(titles(intoA.state.tasks.find((task) => task.id === id)), ['Report filed']);
  assert.deepEqual(intoA.state.tasks[0].subtasks, intoB.state.tasks[0].subtasks);
  const dataA = exportOf(intoA.state, 'a', '2026-11-19T10:00:00Z').data.tasks;
  const again = mergeSync(intoA.state, exportOf(intoB.state, 'b', '2026-11-19T10:01:00Z'), ctx('2026-11-19T10:02:00Z', 'a')).state;
  assert.deepEqual(exportOf(again, 'a', '2026-11-19T10:03:00Z').data.tasks, dataA, 'fixed point');
});

test('SRS 0.9: an older device sending a newer commitment after the fold adds its outcome once and raises no conflict', () => {
  const made = captureTask(fresh(), { title: 'Report' }, ctx('2026-11-19T08:00:00Z', 'a'));
  const id = made.tasks[0].id;
  const seen = { seenUntil: '2026-11-19T08:30:00.000Z', name: 'peer', mergedAt: '2026-11-19T08:30:00.000Z' };
  const oldTask = { ...made.tasks[0], commitment: { outcome: 'Report filed', committedAt: '2026-11-18T09:00:00.000Z' } };
  const a = { ...foldAllCriteria({ ...made, tasks: [oldTask] }, ctx('2026-11-19T09:00:00Z', 'a')), peers: { b: seen } };
  const remote = { ...made, tasks: [{ ...oldTask, commitment: { outcome: 'Report sent', committedAt: '2026-11-19T09:10:00.000Z' },
    stamps: { ...oldTask.stamps, commitment: '2026-11-19T09:10:00.000Z|b' } }] };
  const merged = mergeSync(a, exportOf(remote, 'b', '2026-11-19T09:11:00Z'), ctx('2026-11-19T09:12:00Z', 'a')).state;
  assert.deepEqual(merged.conflicts, []);
  const task = merged.tasks.find((item) => item.id === id);
  assert.deepEqual(titles(task), ['Report filed', 'Report sent']);
  assert.equal(task.commitment, null);
  const again = mergeSync(merged, exportOf(remote, 'b', '2026-11-19T09:11:00Z'), ctx('2026-11-19T09:13:00Z', 'a')).state;
  assert.deepEqual(titles(again.tasks.find((item) => item.id === id)), ['Report filed', 'Report sent'], 'no duplicate');
});

test('SRS 0.9: saveTask with a commitment appends its outcome as a criterion and keeps commitment null', () => {
  let state = captureTask(fresh(), { title: 'Report', criteria: 'First' }, ctx(T0));
  const id = state.tasks[0].id;
  state = saveTask(state, id, { commitment: { outcome: 'x' } }, ctx(T0));
  assert.deepEqual(titles(state.tasks[0]), ['First', 'x']);
  assert.equal(state.tasks[0].commitment, null);
  assert.equal(saveTask(state, id, { commitment: null }, ctx(T0)), state, 'null changes nothing');
  assert.equal(saveTask(state, id, { commitment: { outcome: '   ' } }, ctx(T0)), state, 'a blank outcome is a no-op');
  assert.equal(saveTask(state, id, { commitment: { outcome: 'X' } }, ctx(T0)), state, 'a duplicate is skipped');
  const items = (n) => Array.from({ length: n }, (_, i) => ({ id: `s${i}`, title: `S${i}`, done: false }));
  const forty9 = saveTask(state, id, { subtasks: items(49) }, ctx(T0));
  assert.equal(saveTask(forty9, id, { commitment: { outcome: 'last' } }, ctx(T0)).tasks[0].subtasks.length, 50);
  const fifty = saveTask(state, id, { subtasks: items(50) }, ctx(T0));
  assert.throws(() => saveTask(fifty, id, { commitment: { outcome: 'one more' } }, ctx(T0)), /Add up to 50 completion criteria/);
});
