import assert from 'node:assert/strict';
import test from 'node:test';
import guardModule from '../desktop/app-guard.cjs';
import {
  appLimitSnapshot, appReview, focusSnapshot, readState, recordAppEvent, saveAppPreset, startFocus
} from '../app/model.js';

const { createAppGuard, decide, isSystemApp, validLimit } = guardModule;
const CODE = 'C:\\Apps\\Code.exe';
const SLACK = 'C:\\Apps\\Slack.exe';

const limitOf = (overrides = {}) => ({
  endAt: 2_000_000, presetId: 'p1', name: 'Coding', strength: 'block', countdownSeconds: 15, passMinutes: 10,
  nextAction: 'Write tests', apps: [{ path: CODE, name: 'VS Code' }], ...overrides
});

function fakeWatcher() {
  const sent = [];
  let handlers;
  return {
    sent,
    start: (callbacks) => {
      handlers = callbacks;
      return { send: (command) => sent.push(command), stop: () => sent.push('stop') };
    },
    emit: (event) => handlers.onEvent(event),
    exit: (code = 1) => handlers.onExit(code)
  };
}

function guardWith(clock = { now: 1_000_000 }) {
  const watcher = fakeWatcher();
  const interventions = [];
  const events = [];
  const coverage = [];
  const guard = createAppGuard({
    startWatcher: watcher.start,
    ownPids: () => new Set([7]),
    onIntervene: (view) => interventions.push(view),
    onEvent: (record) => events.push(record),
    onCoverage: (value) => coverage.push(value),
    now: () => clock.now
  });
  return { guard, watcher, interventions, events, coverage, clock };
}

test('APP-03, APP-04: only preset apps, Fix Myself and Windows controls stay in front', () => {
  const context = { ownPids: new Set([7]), passes: new Map(), now: 1_000_000 };
  const limit = limitOf();
  const at = (path, pid = 50) => decide(limit, { hwnd: 1, pid, path }, context);
  assert.equal(at('c:\\apps\\code.exe'), 'allow');
  assert.equal(at(SLACK), 'block');
  assert.equal(at('C:\\Windows\\explorer.exe'), 'allow');
  assert.equal(at('C:\\Windows\\System32\\Taskmgr.exe'), 'allow');
  assert.equal(at('C:\\Windows\\ImmersiveControlPanel\\SystemSettings.exe'), 'allow');
  assert.equal(at('C:\\Windows\\SystemApps\\Something\\Host.exe'), 'allow');
  assert.equal(at('C:\\Program Files\\Fix Myself\\Fix Myself.exe'), 'allow');
  assert.equal(at(SLACK, 7), 'allow');
  assert.equal(at(null, 50), 'unknown');
  assert.equal(decide(limitOf({ endAt: 999_999 }), { hwnd: 1, pid: 50, path: SLACK }, context), 'allow');
  assert.equal(decide(null, { hwnd: 1, pid: 50, path: SLACK }, context), 'allow');
  assert.equal(isSystemApp('C:\\Windows\\System32\\notepad.exe'), false);
});

test('APP-03: an app outside the preset is minimized once and explained, without closing it', () => {
  const { guard, watcher, interventions, events, clock } = guardWith();
  assert.equal(guard.setLimit(limitOf()), true);
  assert.equal(guard.coverage().state, 'running');
  watcher.emit({ type: 'foreground', hwnd: 11, pid: 50, path: CODE });
  watcher.emit({ type: 'foreground', hwnd: 22, pid: 51, path: SLACK });
  watcher.emit({ type: 'foreground', hwnd: 22, pid: 51, path: SLACK });
  assert.deepEqual(watcher.sent, ['min 22', 'min 22'], 'it minimizes every time but explains once');
  assert.equal(interventions.length, 1);
  assert.equal(interventions[0].app, 'Slack');
  assert.deepEqual(interventions[0].allowed, ['VS Code']);
  assert.equal(interventions[0].countdownSeconds, null);
  assert.equal(events[0].kind, 'block');
  clock.now += 3500;
  watcher.emit({ type: 'foreground', hwnd: 22, pid: 51, path: SLACK });
  assert.deepEqual(watcher.sent, ['min 22', 'min 22', 'min 22']);
  assert.equal(interventions.length, 2);
  clock.now += 60_000;
  assert.equal(guard.grantPass(SLACK, 'need it'), null, 'Block offers no pass (APP-05)');
  // A window Windows refuses to minimize is reported once, not retried (APP-07).
  watcher.emit({ type: 'minimized', hwnd: 22, ok: false });
  clock.now += 10_000;
  watcher.emit({ type: 'foreground', hwnd: 22, pid: 51, path: SLACK });
  assert.equal(interventions.length, 2);
  assert.deepEqual(guard.coverage().partial, ['Slack']);
});

test('APP-05: a Pause pass lets the app through until it expires and never past the session', () => {
  const { guard, watcher, interventions, events, clock } = guardWith();
  guard.setLimit(limitOf({ strength: 'pause', passMinutes: 5 }));
  watcher.emit({ type: 'foreground', hwnd: 22, pid: 51, path: SLACK });
  assert.equal(interventions[0].countdownSeconds, 15);
  assert.equal(guard.grantPass(SLACK, 'too early'), null, 'the countdown is enforced in the main process');
  clock.now += 15_000;
  assert.equal(guard.grantPass('C:\\Apps\\Other.exe', ''), null);
  const until = guard.grantPass(SLACK, '  reply to the team  ');
  assert.equal(until, 1_015_000 + 5 * 60_000);
  assert.equal(watcher.sent.at(-1), 'restore 22');
  assert.deepEqual(events.map((event) => event.kind), ['pause', 'pass']);
  assert.equal(events[1].reason, 'reply to the team');
  clock.now += 60_000;
  watcher.emit({ type: 'foreground', hwnd: 22, pid: 51, path: SLACK });
  assert.equal(interventions.length, 1);
  clock.now = until + 1;
  watcher.emit({ type: 'foreground', hwnd: 22, pid: 51, path: SLACK });
  assert.equal(interventions.length, 2);

  const short = guardWith({ now: 1_980_000 });
  short.guard.setLimit(limitOf({ strength: 'pause', passMinutes: 30 }));
  short.watcher.emit({ type: 'foreground', hwnd: 22, pid: 51, path: SLACK });
  short.clock.now += 15_000;
  assert.equal(short.guard.grantPass(SLACK, ''), 2_000_000);
});

test('APP-02: the same session keeps its passes; a new session or no session clears them', () => {
  const { guard, watcher, interventions, clock } = guardWith();
  guard.setLimit(limitOf({ strength: 'pause' }));
  watcher.emit({ type: 'foreground', hwnd: 22, pid: 51, path: SLACK });
  clock.now += 15_000;
  assert.notEqual(guard.grantPass(SLACK, ''), null);
  guard.setLimit({ ...limitOf({ strength: 'pause' }), nextAction: 'Other' });
  watcher.emit({ type: 'foreground', hwnd: 23, pid: 51, path: SLACK });
  assert.equal(interventions.length, 1);
  guard.setLimit(null);
  assert.equal(guard.coverage().state, 'off');
  assert.ok(watcher.sent.includes('stop'));
  guard.setLimit(limitOf({ strength: 'pause', endAt: 3_000_000 }));
  watcher.emit({ type: 'foreground', hwnd: 23, pid: 51, path: SLACK });
  assert.equal(interventions.length, 2);
});

test('APP-07: unreadable or unminimized windows show partial coverage; a failing helper becomes unavailable', () => {
  const { guard, watcher, coverage } = guardWith();
  guard.setLimit(limitOf());
  watcher.emit({ type: 'foreground', hwnd: 30, pid: 60, path: null });
  assert.deepEqual(guard.coverage().partial, ['?']);
  watcher.emit({ type: 'foreground', hwnd: 22, pid: 51, path: SLACK });
  watcher.emit({ type: 'minimized', hwnd: 22, ok: false });
  assert.deepEqual(guard.coverage().partial, ['?', 'Slack']);
  assert.ok(coverage.length >= 3);

  const broken = createAppGuard({ startWatcher: () => { throw new Error('no powershell'); }, now: () => 1_000_000 });
  broken.setLimit(limitOf());
  assert.equal(broken.coverage().state, 'unavailable');
});

test('APP-03: malformed limits from the renderer are refused', () => {
  assert.equal(validLimit(null), null);
  assert.equal(validLimit(limitOf({ strength: 'open' })), undefined);
  assert.equal(validLimit(limitOf({ apps: [] })), undefined);
  assert.equal(validLimit(limitOf({ apps: [{ path: 'C:\\Apps\\run.bat', name: 'Run' }] })), undefined);
  assert.equal(validLimit(limitOf({ countdownSeconds: 2 })), undefined);
  assert.equal(validLimit(limitOf({ endAt: 'soon' })), undefined);
  const { guard } = guardWith();
  assert.equal(guard.setLimit(limitOf({ passMinutes: 99 })), false);
  assert.equal(guard.coverage().state, 'off');
});

function stateWithPreset(strength = 'block') {
  const ctx = { now: new Date('2026-11-23T02:00:00Z'), device: 'pc' };
  let state = readState({ getItem: () => null });
  state = { ...state, settings: { ...state.settings, timeZone: 'Asia/Ho_Chi_Minh' } };
  state = saveAppPreset(state, null, { name: 'Coding', apps: [{ path: CODE, name: 'VS Code' }], strength }, ctx);
  return state;
}

test('APP-03: the limit snapshot follows the running session and stays out of the Chrome snapshot', () => {
  const now = new Date('2026-11-23T02:00:00Z');
  let state = stateWithPreset('pause');
  assert.equal(appLimitSnapshot(state, now), null);
  state = startFocus(state, now, { presetId: state.appPresets[0].id });
  const limit = appLimitSnapshot(state, now);
  assert.equal(limit.name, 'Coding');
  assert.equal(limit.strength, 'pause');
  assert.deepEqual(limit.apps, [{ path: CODE, name: 'VS Code' }]);
  assert.notEqual(validLimit(limit), undefined, 'the guard accepts what the model publishes');
  assert.equal('apps' in focusSnapshot(state, now), false);
  assert.equal(appLimitSnapshot(state, new Date(state.focus.endAt + 1)), null);
  assert.equal(appLimitSnapshot(startFocus(stateWithPreset(), now), now), null);
});

test('APP-09: app events are counted per day and hour in the planning time zone, with pass reasons', () => {
  let state = stateWithPreset();
  // 23:30 in Ho Chi Minh City on 23 Nov is 16:30 UTC.
  state = recordAppEvent(state, { kind: 'block', path: SLACK, name: 'Slack', at: '2026-11-23T16:30:00Z' });
  state = recordAppEvent(state, { kind: 'pause', path: 'c:\\apps\\slack.exe', name: 'Slack', at: '2026-11-23T16:40:00Z' });
  state = recordAppEvent(state, { kind: 'pass', path: SLACK, name: 'Slack', reason: ' reply ', at: '2026-11-23T16:41:00Z' });
  state = recordAppEvent(state, { kind: 'pass', path: SLACK, name: 'Slack', reason: '', at: '2026-11-23T17:10:00Z' });
  state = recordAppEvent(state, { kind: 'block', path: 'C:\\Games\\Game.exe', name: 'Game', at: '2026-11-25T03:00:00Z' });
  assert.equal(recordAppEvent(state, { kind: 'open', path: SLACK, at: '2026-11-23T16:30:00Z' }), state);
  assert.deepEqual(state.appActivity.days['2026-11-23']['c:\\apps\\slack.exe'].block, { 23: 1 });
  assert.deepEqual(state.appActivity.days['2026-11-24']['c:\\apps\\slack.exe'].pass, { 0: 1 });
  const week = appReview(state, '2026-11-23', '2026-11-29', '2026-11-24');
  assert.deepEqual(week.byApp, [{ path: 'c:\\apps\\slack.exe', name: 'Slack', block: 1, pause: 1, pass: 2 }]);
  assert.deepEqual(week.reasons, [{ day: '2026-11-23', hour: 23, name: 'Slack', reason: 'reply' }]);
  assert.equal(appReview(state, '2026-11-23', '2026-11-29', '2026-11-29').byApp[1].name, 'Game');
});
