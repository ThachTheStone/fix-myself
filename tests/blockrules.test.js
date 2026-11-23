import assert from 'node:assert/strict';
import test from 'node:test';
import {
  activeBlockRules, applyPendingRuleChanges, cancelPendingRuleChange, classifyRuleChange,
  DEFAULT_CHANGE_DELAY, deleteBlockRule, exportSync, MAX_BLOCK_RULES, mergeSync, migrateState,
  planSnapshot, readState, saveBlockRule, setBlockRuleEnabled, setChangeDelay,
  updateSettings, validateBlockRule
} from '../app/model.js';
import { activeRules, effectiveRules, scheduleIntervals } from '../extension/block-schedule.js';

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

const draft = (overrides = {}) => ({
  name: 'Evening news',
  domains: 'youtube.com',
  schedule: { type: 'always' },
  strength: 'block',
  ...overrides
});

const scheduled = (windows, overrides = {}) => validateBlockRule({
  id: 'rule',
  name: 'Scheduled',
  domains: ['youtube.com'],
  strength: 'block',
  schedule: { type: 'scheduled', windows },
  ...overrides
});

// A UTC instant for a weekday (0 is Sunday) near May 2026.
function weekday(dayOfWeek, time, base = '2026-05-03') {
  const [year, month, day] = base.split('-').map(Number);
  const start = Date.UTC(year, month - 1, day);
  const offset = ((dayOfWeek - new Date(start).getUTCDay()) + 7) % 7;
  const [hours, minutes] = time.split(':').map(Number);
  return new Date(start + offset * 86_400_000 + hours * 3_600_000 + minutes * 60_000);
}

test('a window that crosses midnight belongs to the day it starts (BLK-02)', () => {
  const utc = (day, time, base) => weekday(day, time, base);
  const late = scheduled([{ days: [0], start: '23:00', end: '01:00' }]);
  assert.equal(activeRules([late], utc(0, '23:30'), 'UTC').length, 1);
  const [active] = activeRules([late], utc(1, '00:30'), 'UTC');
  assert.ok(active, 'Sunday night still covers Monday morning');
  assert.equal(new Date(active.until).toISOString(), utc(1, '01:00').toISOString());
  assert.equal(activeRules([late], utc(1, '01:00'), 'UTC').length, 0);
  assert.equal(activeRules([late], utc(1, '23:30'), 'UTC').length, 0, 'Monday night is not Sunday night');

  const saturday = scheduled([{ days: [6], start: '23:00', end: '01:00' }]);
  const spill = activeRules([saturday], utc(0, '00:30', '2026-05-10'), 'UTC');
  assert.equal(spill.length, 1, 'Saturday night spills into the next week');
  assert.equal(new Date(spill[0].until).toISOString(), utc(0, '01:00', '2026-05-10').toISOString());

  const weekdays = scheduled([{ days: [1, 2, 3, 4, 5], start: '09:00', end: '12:00' }]);
  const at3 = (time) => activeRules([weekdays], utc(3, time), 'UTC').length;
  assert.equal(at3('09:00'), 1);
  assert.equal(at3('12:00'), 0);
  assert.equal(at3('11:59'), 1);
  assert.equal(activeRules([weekdays], utc(0, '10:00'), 'UTC').length, 0);
  assert.deepEqual(scheduleIntervals({ type: 'always' }), [[0, 7 * 1440]]);
  assert.equal(activeRules([{ ...weekdays, enabled: false }], utc(3, '10:00'), 'UTC').length, 0);
});

test('schedules follow the planning time zone (BLK-05)', () => {
  const monday = scheduled([{ days: [1], start: '09:00', end: '10:00' }]);
  const instant = at('2026-05-04T02:30:00Z'); // 09:30 in Asia/Ho_Chi_Minh
  const [inZone] = activeRules([monday], instant, 'Asia/Ho_Chi_Minh');
  assert.ok(inZone);
  assert.equal(new Date(inZone.until).toISOString(), '2026-05-04T03:00:00.000Z');
  assert.equal(activeRules([monday], instant, 'UTC').length, 0);
  assert.equal(activeRules([monday], instant, 'America/New_York').length, 0);

  const state = { ...fresh('Asia/Ho_Chi_Minh'), blockRules: [monday] };
  assert.equal(activeBlockRules(state, instant).length, 1);
  const utc = { ...state, settings: { ...state.settings, timeZone: 'UTC' } };
  assert.equal(activeBlockRules(utc, instant).length, 0);

  // Rules stay inside the synced plan and keep the reason for the block.
  const payload = planSnapshot({ ...state, mission: 'Ship the report' }, instant);
  assert.equal(payload.rules.length, 1);
  assert.equal(payload.timeZone, 'Asia/Ho_Chi_Minh');
  assert.equal(payload.mission, 'Ship the report');
  assert.equal(payload.nextAction, '');
});

test('weakening changes wait for the change delay (BLK-06)', () => {
  const start = '2026-05-04T08:00:00Z';
  let state = fresh();
  assert.equal(state.settings.changeDelay, DEFAULT_CHANGE_DELAY);
  state = saveBlockRule(state, null, draft(), ctx(start));
  const id = state.blockRules[0].id;
  assert.equal(state.blockRules[0].enabled, true);
  assert.deepEqual(state.pendingRuleChanges, [], 'a new rule applies at once');

  state = setBlockRuleEnabled(state, id, false, ctx(start));
  assert.equal(state.blockRules[0].enabled, true, 'the old rule stays in force');
  const [pending] = state.pendingRuleChanges;
  assert.equal(pending.change.type, 'update');
  assert.equal(pending.effectiveAt, new Date(at(start).getTime() + 10 * 60_000).toISOString());
  assert.equal(activeBlockRules(state, at('2026-05-04T08:05:00Z')).length, 1);

  // Nothing happens one second early.
  assert.equal(applyPendingRuleChanges(state, new Date(at(pending.effectiveAt).getTime() - 1000)), state);
  const due = applyPendingRuleChanges(state, at(pending.effectiveAt));
  assert.equal(due.blockRules[0].enabled, false);
  assert.deepEqual(due.pendingRuleChanges, []);
  assert.equal(activeBlockRules(due, at('2026-05-04T08:20:00Z')).length, 0);

  // Deleting a rule waits too and can be canceled.
  const deleting = deleteBlockRule(state, id, ctx(start));
  assert.equal(deleting.blockRules.length, 1);
  assert.equal(deleting.pendingRuleChanges[0].change.type, 'delete');
  const canceled = cancelPendingRuleChange(deleting, deleting.pendingRuleChanges[0].id, ctx(start));
  assert.deepEqual(canceled.pendingRuleChanges, []);
  assert.equal(canceled.blockRules.length, 1);

  // Strengthening edits apply at once and clear the waiting change.
  const stronger = saveBlockRule(state, id, { domains: 'youtube.com\nx.com' }, ctx(start));
  assert.equal(stronger.blockRules[0].domains.length, 2);
  assert.deepEqual(stronger.pendingRuleChanges, []);
});

test('the change delay can be raised at once but lowered only after waiting (BLK-06)', () => {
  const start = '2026-05-04T08:00:00Z';
  let state = fresh();
  state = saveBlockRule(state, null, draft(), ctx(start));
  const id = state.blockRules[0].id;

  const raised = setChangeDelay(state, 'next-day', ctx(start));
  assert.equal(raised.settings.changeDelay, 'next-day');

  const lowered = setChangeDelay(raised, 0, ctx(start));
  assert.equal(lowered.settings.changeDelay, 'next-day', 'a shorter wait does not apply yet');
  const delayChange = lowered.pendingRuleChanges.find((change) => change.change.type === 'delay');
  assert.ok(delayChange);
  const now = at(delayChange.effectiveAt);
  assert.equal(applyPendingRuleChanges(lowered, new Date(now.getTime() - 1000)), lowered);
  const applied = applyPendingRuleChanges(lowered, now);
  assert.equal(applied.settings.changeDelay, 0);
  assert.deepEqual(applied.pendingRuleChanges, []);

  // With no delay, weakening changes are immediate.
  const weak = setBlockRuleEnabled(applied, id, false, ctx(start));
  assert.equal(weak.blockRules[0].enabled, false);
  assert.deepEqual(weak.pendingRuleChanges, []);
  // The settings form cannot lower the delay behind the rule's back.
  assert.equal(updateSettings(weak, { changeDelay: 'next-day' }, ctx(start)).settings.changeDelay, 0);
  assert.throws(() => setChangeDelay(weak, 5, ctx(start)), /how long weaker changes wait/);
});

test('classification tells stronger from weaker edits (BLK-06)', () => {
  const base = scheduled([{ days: [1, 2, 3, 4, 5], start: '09:00', end: '12:00' }]);
  const wider = scheduled([{ days: [1, 2, 3, 4, 5], start: '08:00', end: '12:00' }]);
  const narrower = scheduled([{ days: [1, 2, 3, 4, 5], start: '10:00', end: '12:00' }]);
  const moved = scheduled([{ days: [1, 2, 3, 4, 5], start: '09:00', end: '11:00' }, { days: [1, 2, 3, 4, 5], start: '11:00', end: '12:00' }]);
  assert.equal(classifyRuleChange(base, base), 'same');
  assert.equal(classifyRuleChange(null, base), 'strengthen');
  assert.equal(classifyRuleChange(base, { ...base, enabled: false }), 'weaken');
  assert.equal(classifyRuleChange(base, { ...base, strength: 'pause' }), 'weaken');
  assert.equal(classifyRuleChange({ ...base, enabled: false }, base), 'strengthen');
  assert.equal(classifyRuleChange(base, { ...base, domains: ['youtube.com', 'x.com'] }), 'strengthen');
  assert.equal(classifyRuleChange(base, { ...base, domains: [] }), 'weaken');
  assert.equal(classifyRuleChange({ ...base, domains: ['youtube.com', 'x.com'] }, base), 'weaken');
  assert.equal(classifyRuleChange(base, { ...base, schedule: { type: 'always' } }), 'strengthen');
  assert.equal(classifyRuleChange({ ...base, schedule: { type: 'always' } }, base), 'weaken');
  assert.equal(classifyRuleChange(base, wider), 'strengthen');
  assert.equal(classifyRuleChange(base, narrower), 'weaken');
  assert.equal(classifyRuleChange(base, moved), 'same');
  assert.equal(classifyRuleChange(base, { ...base, strength: 'pause' }), 'weaken');
  const pause = { ...base, strength: 'pause', countdownSeconds: 20, passMinutes: 5 };
  assert.equal(classifyRuleChange(pause, { ...pause, passMinutes: 15 }), 'weaken');
  assert.equal(classifyRuleChange(pause, { ...pause, name: 'Other name' }), 'same');
});

test('rules validate limits and defaults before they reach Chrome (BLK-01)', () => {
  const rule = validateBlockRule({ name: '  News  ', domains: ['YouTube.com', 'facebook.com'], schedule: { type: 'always' } });
  assert.equal(rule.name, 'News');
  assert.deepEqual(rule.domains, ['youtube.com', 'facebook.com']);
  assert.equal(rule.enabled, true);
  assert.equal(rule.strength, 'block');
  assert.equal(rule.countdownSeconds, 15);
  assert.equal(rule.passMinutes, 10);

  const fail = (changes, pattern) => assert.throws(
    () => validateBlockRule({ name: 'x', domains: 'a.com', schedule: { type: 'always' }, ...changes }),
    pattern
  );
  fail({ name: '  ' }, /Enter a rule name/);
  fail({ name: 'x'.repeat(61) }, /60 characters or fewer/);
  fail({ domains: 'https://a.com/path' }, /domain names/);
  fail({ domains: '' }, /at least one site/);
  fail({ strength: 'hide' }, /Block or Pause/);
  fail({ countdownSeconds: 3 }, /countdown/);
  fail({ countdownSeconds: 61 }, /countdown/);
  fail({ passMinutes: 0 }, /pass/);
  fail({ passMinutes: 31 }, /pass/);
  fail({ schedule: { type: 'later' } }, /Always or Scheduled/);
  fail({ schedule: { type: 'scheduled' } }, /at least one time window/);
  fail({ schedule: { type: 'scheduled', windows: [{ days: [], start: '09:00', end: '10:00' }] } }, /at least one day/);
  fail({ schedule: { type: 'scheduled', windows: [{ days: [7], start: '09:00', end: '10:00' }] } }, /days of the week/);
  fail({ schedule: { type: 'scheduled', windows: [{ days: [1], start: '9:00', end: '10:00' }] } }, /start and end time/);
  fail({ schedule: { type: 'scheduled', windows: [{ days: [1], start: '01:00', end: '01:00' }] } }, /different time/);
  fail({
    schedule: {
      type: 'scheduled',
      windows: Array.from({ length: 11 }, () => ({ days: [1], start: '09:00', end: '10:00' }))
    }
  }, /up to 10 time windows/);
  fail({ domains: Array.from({ length: 31 }, (_, index) => `site${index}.com`).join(' ') }, /up to 30 domains/);

  let state = fresh();
  for (let index = 0; index < MAX_BLOCK_RULES; index += 1) {
    state = saveBlockRule(state, null, draft({ name: `Rule ${index}`, domains: `site${index}.com` }), ctx('2026-05-04T08:00:00Z'));
  }
  assert.equal(state.blockRules.length, MAX_BLOCK_RULES);
  assert.throws(
    () => saveBlockRule(state, null, draft({ name: 'One more', domains: 'extra.com' }), ctx('2026-05-04T08:00:00Z')),
    /up to 20 rules/
  );
  assert.throws(() => saveBlockRule(state, 'missing', draft(), ctx('2026-05-04T08:00:00Z')), /no longer exists/);
});

test('rules travel with sync files and survive a merge (BLK-05)', () => {
  let source = fresh();
  source = saveBlockRule(source, null, draft(), ctx('2026-05-04T08:00:00Z'));
  const payload = exportSync(source, { id: 'pc', name: 'PC' }, at('2026-05-04T09:00:00Z'));
  assert.equal(payload.data.blockRules.length, 1);
  assert.deepEqual(payload.data.pendingRuleChanges, []);

  const result = mergeSync(fresh(), payload, ctx('2026-05-04T10:00:00Z', 'laptop'));
  assert.equal(result.state.blockRules.length, 1);
  assert.equal(result.state.blockRules[0].name, 'Evening news');

  const broken = { ...payload, data: { ...payload.data, blockRules: [{ id: 1 }] } };
  assert.throws(() => mergeSync(fresh(), broken, ctx('2026-05-04T10:00:00Z', 'laptop')), /invalid rule/);

  const migrated = migrateState({
    ...JSON.parse(JSON.stringify(result.state)),
    blockRules: undefined,
    settings: { ...source.settings, changeDelay: 'soon' }
  });
  assert.deepEqual(migrated.blockRules, []);
  assert.equal(migrated.settings.changeDelay, DEFAULT_CHANGE_DELAY);
});

test('the planner and the extension share one schedule (BLK-07)', () => {
  const rule = scheduled([{ days: [0], start: '23:00', end: '01:00' }]);
  const state = { ...fresh(), blockRules: [rule] };
  const plan = JSON.parse(JSON.stringify(planSnapshot(state, at('2026-05-03T23:30:00Z'))));
  assert.deepEqual(plan.rules, state.blockRules);

  const moment = at('2026-05-04T00:30:00Z');
  const app = activeBlockRules(state, moment).map((entry) => entry.until);
  const chrome = activeRules(plan.rules, moment, plan.timeZone).map((entry) => entry.until);
  assert.deepEqual(chrome, app);
  assert.equal(app.length, 1);

  // A waiting change does not unlock the site early in either place.
  const waiting = {
    ...state,
    pendingRuleChanges: [{
      id: 'c1',
      ruleId: rule.id,
      change: { type: 'update', rule: { ...rule, enabled: false } },
      effectiveAt: '2026-05-04T00:40:00Z',
      createdAt: '2026-05-03T23:35:00Z'
    }]
  };
  const published = planSnapshot(waiting, moment);
  const early = effectiveRules(published.rules, published.pendingChanges, moment);
  assert.equal(early.pendingChanges.length, 1);
  assert.equal(activeRules(early.rules, moment, published.timeZone).length, 1);
  assert.equal(activeBlockRules(waiting, moment).length, 1);

  const later = at('2026-05-04T00:40:00Z');
  const due = effectiveRules(published.rules, published.pendingChanges, later);
  assert.deepEqual(due.pendingChanges, []);
  assert.equal(activeRules(due.rules, later, published.timeZone).length, 0);
  assert.equal(activeBlockRules(waiting, later).length, 0);
});
