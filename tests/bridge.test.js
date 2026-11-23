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
  assert.equal((await fetch(url, { method: 'POST', body: 'x'.repeat(70_000), headers: json }).catch(() => ({ status: 413 }))).status, 413);
  assert.equal(reports.length, 1);
  assert.deepEqual(reports[0].attempts, valid.attempts);
  assert.equal(reports[0].profileName, 'Work');
});

test('block rule activity is validated before the desktop app stores it (BLK-10)', async (t) => {
  const reports = [];
  const { base, headers } = await open(t, () => null, (report) => reports.push(report));
  const json = { ...headers, 'Content-Type': 'application/json' };
  const url = base + '/v1/report';
  const baseReport = {
    profileId: '00000000-0000-4000-8000-000000000001',
    profileName: 'Work',
    activeDays: ['2026-11-19'],
    attempts: { '2026-11-19': { 'youtube.com': 3 } }
  };
  const ruleEvents = {
    '2026-11-19': { 'youtube.com': { block: { '9': 2, '21': 3 }, pause: { '21': 1 }, pass: { '21': 1 } } }
  };
  const passReasons = { '2026-11-19': [{ host: 'youtube.com', hour: 21, reason: 'Watching a lecture' }] };
  assert.deepEqual(bridge.validReport({ ...baseReport, ruleEvents, passReasons }),
    { ...baseReport, ruleEvents, passReasons });
  // An older extension that does not report block rule activity still passes.
  assert.deepEqual(bridge.validReport(baseReport).ruleEvents, {});
  assert.deepEqual(bridge.validReport(baseReport).passReasons, {});

  const days = (count) => Array.from({ length: count }, (_, index) =>
    new Date(Date.UTC(2026, 0, 1 + index)).toISOString().slice(0, 10));
  const day = (value) => ({ '2026-11-19': value });
  const site = (kinds) => ({ 'youtube.com': kinds });
  const hosts = (count) => Object.fromEntries(Array.from({ length: count }, (_, index) =>
    [`site-${index}.example.com`, { block: { 9: 1 } }]));
  const invalid = (fields) => bridge.validReport({ ...baseReport, ...fields });
  const reason = { host: 'youtube.com', hour: 21, reason: 'Checking a course' };

  assert.equal(invalid({ ruleEvents: Object.fromEntries(days(41).map((date) => [date, {}])) }), null);
  assert.equal(invalid({ ruleEvents: { '19-11-2026': site({ block: { 9: 1 } }) } }), null);
  assert.equal(invalid({ ruleEvents: day(hosts(101)) }), null);
  assert.equal(invalid({ ruleEvents: day({ 'https://youtube.com/watch': { block: { 9: 1 } } }) }), null);
  assert.equal(invalid({ ruleEvents: day(site({ focus: { 9: 1 } })) }), null);
  assert.equal(invalid({ ruleEvents: day(site({ block: { 24: 1 } })) }), null);
  assert.equal(invalid({ ruleEvents: day(site({ block: { '09': 1 } })) }), null);
  assert.equal(invalid({ ruleEvents: day(site({ block: { 9: 1.5 } })) }), null);
  assert.equal(invalid({ ruleEvents: day(site({ block: { 9: -1 } })) }), null);
  assert.equal(invalid({ ruleEvents: day(site({ block: { 9: 100_001 } })) }), null);
  assert.equal(invalid({ ruleEvents: day(site({ block: { 9: '1' } })) }), null);
  assert.equal(invalid({ passReasons: day(Array.from({ length: 21 }, () => reason)) }), null);
  assert.equal(invalid({ passReasons: { '19-11-2026': [reason] } }), null);
  assert.equal(invalid({ passReasons: day([{ ...reason, host: 'https://youtube.com' }]) }), null);
  assert.equal(invalid({ passReasons: day([{ ...reason, hour: 24 }]) }), null);
  assert.equal(invalid({ passReasons: day([{ ...reason, hour: '21' }]) }), null);
  assert.equal(invalid({ passReasons: day([{ ...reason, reason: '' }]) }), null);
  assert.equal(invalid({ passReasons: day([{ ...reason, reason: 'x'.repeat(201) }]) }), null);

  // The cap was raised for this data, so a large but valid report still fits.
  const bigEvents = Object.fromEntries(days(10).map((date) => [date, Object.fromEntries(
    Array.from({ length: 40 }, (_, index) => [`site-${index}.example.com`, {
      block: { 9: 1, 10: 2, 11: 3, 21: 4 },
      pause: { 9: 1, 10: 2, 11: 3, 21: 4 },
      pass: { 9: 1, 10: 2, 11: 3, 21: 4 }
    }])
  )]));
  const big = JSON.stringify({ ...baseReport, ruleEvents: bigEvents });
  assert.ok(big.length > 16_384 && big.length < bridge.MAX_REPORT_BYTES, `report size ${big.length}`);
  assert.equal((await fetch(url, { method: 'POST', body: big, headers: json })).status, 204);
  assert.equal(reports.at(-1).ruleEvents['2026-01-01']['site-0.example.com'].block['21'], 4);
  // A whole report that breaks a rule is refused, so nothing partial is stored.
  assert.equal((await fetch(url, {
    method: 'POST',
    body: JSON.stringify({ ...baseReport, passReasons: day([{ ...reason, hour: 24 }]) }),
    headers: json
  })).status, 400);
});
