import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import bridge from '../desktop/focus-bridge.cjs';

async function open(t, readPlan, onReport, onShow) {
  const token = 'a'.repeat(64);
  const server = bridge.createFocusBridge(token, readPlan, onReport, onShow);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  return { base: `http://127.0.0.1:${server.address().port}`, headers: { Authorization: 'Bearer ' + token } };
}

const RULE = {
  id: '00000000-0000-4000-8000-0000000000aa',
  name: 'Evening',
  enabled: true,
  domains: ['youtube.com'],
  schedule: { type: 'scheduled', windows: [{ days: [1, 2, 3], start: '19:00', end: '22:00' }] },
  strength: 'pause',
  countdownSeconds: 15,
  passMinutes: 10
};

test('the local bridge requires its pairing code and clears expired sessions', async (t) => {
  let snapshot;
  const { base, headers } = await open(t, () => snapshot);
  const url = base + '/v1/focus';
  assert.equal((await fetch(url)).status, 401);
  assert.equal((await fetch(url, { headers, method: 'POST' })).status, 404);
  assert.equal((await fetch(url, { headers })).status, 503);
  const focus = { endAt: Date.now() + 60_000, nextAction: 'Outline the work', domains: ['youtube.com'] };
  snapshot = { focus, plan: bridge.EMPTY_PLAN };
  assert.deepEqual(await (await fetch(url, { headers })).json(), { focus, plan: bridge.EMPTY_PLAN });
  snapshot = { focus: { ...focus, endAt: Date.now() - 1000 }, plan: bridge.EMPTY_PLAN };
  assert.deepEqual(await (await fetch(url, { headers })).json(), { focus: null, plan: bridge.EMPTY_PLAN });
});

test('rules and waiting changes reach Chrome, but broken ones are refused', async (t) => {
  const plan = {
    rules: [RULE],
    pendingChanges: [{
      id: 'change-1',
      ruleId: RULE.id,
      effectiveAt: new Date(Date.now() + 600_000).toISOString(),
      change: { type: 'delete' }
    }],
    timeZone: 'Asia/Ho_Chi_Minh',
    mission: 'Ship the draft',
    nextAction: 'Outline the work'
  };
  const { base, headers } = await open(t, () => ({ focus: null, plan }));
  const returned = await (await fetch(base + '/v1/focus', { headers })).json();
  assert.deepEqual(returned.plan.rules, [RULE]);
  assert.deepEqual(returned.plan.pendingChanges, plan.pendingChanges);
  assert.equal(returned.plan.timeZone, 'Asia/Ho_Chi_Minh');

  assert.equal(bridge.validPlan(plan).rules.length, 1);
  assert.equal(bridge.validPlan({ ...plan, rules: [{ ...RULE, domains: ['https://youtube.com/watch'] }] }), null);
  assert.equal(bridge.validPlan({ ...plan, rules: [{ ...RULE, countdownSeconds: 1 }] }), null);
  assert.equal(bridge.validPlan({ ...plan, pendingChanges: [{ id: 'c', change: { type: 'delete' } }] }), null);
  assert.equal(bridge.validPlan({ ...plan, rules: new Array(21).fill(RULE) }), null);
  assert.equal(bridge.validSnapshot({ focus: null, plan: 'nope' }), null);
});

test('a plan beyond the size cap is withheld instead of truncated', async (t) => {
  const domains = Array.from({ length: 30 }, (_, index) => `site-${'x'.repeat(24)}-${index}.example.com`);
  const rules = Array.from({ length: 20 }, (_, index) => ({ ...RULE, id: `rule-${index}-${'0'.repeat(24)}`, domains }));
  const { base, headers } = await open(t, () => ({ focus: null, plan: { ...bridge.EMPTY_PLAN, rules } }));
  assert.equal((await fetch(base + '/v1/focus', { headers })).status, 503);
});

test('Chrome can ask the desktop app to show itself', async (t) => {
  let shown = 0;
  const { base, headers } = await open(t, () => null, () => {}, () => { shown += 1; });
  assert.equal((await fetch(base + '/v1/show', { method: 'POST' })).status, 401);
  assert.equal((await fetch(base + '/v1/show', { headers })).status, 404);
  assert.equal((await fetch(base + '/v1/show', { headers, method: 'POST' })).status, 204);
  assert.equal(shown, 1);
});

test('profiles report only validated daily totals', async (t) => {
  const reports = [];
  const { base, headers } = await open(t, () => null, (report) => reports.push(report));
  const url = base + '/v1/report';
  const json = { ...headers, 'Content-Type': 'application/json' };
  const valid = {
    profileId: '00000000-0000-4000-8000-000000000001',
    profileName: 'Work',
    activeDays: ['2026-11-19'],
    attempts: { '2026-11-19': { 'youtube.com': 3 } }
  };
  assert.equal((await fetch(url, { method: 'POST', body: JSON.stringify(valid), headers: { 'Content-Type': 'application/json' } })).status, 401);
  assert.equal((await fetch(url, { method: 'POST', body: JSON.stringify(valid), headers })).status, 415);
  assert.equal((await fetch(url, { method: 'POST', body: JSON.stringify(valid), headers: json })).status, 204);
  const withUrl = { ...valid, attempts: { '2026-11-19': { 'https://youtube.com/watch?v=1': 1 } } };
  assert.equal((await fetch(url, { method: 'POST', body: JSON.stringify(withUrl), headers: json })).status, 400);
  assert.equal((await fetch(url, { method: 'POST', body: 'x'.repeat(20_000), headers: json }).catch(() => ({ status: 413 }))).status, 413);
  assert.equal(reports.length, 1);
  assert.deepEqual(reports[0].attempts, valid.attempts);
  assert.equal(reports[0].profileName, 'Work');
});
