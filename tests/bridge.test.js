import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import bridge from '../desktop/focus-bridge.cjs';

async function open(t, focus, onReport) {
  const token = 'a'.repeat(64);
  const server = bridge.createFocusBridge(token, focus, onReport);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  return { base: `http://127.0.0.1:${server.address().port}`, headers: { Authorization: 'Bearer ' + token } };
}

test('the local bridge requires its pairing code and clears expired snapshots', async (t) => {
  let focus;
  const { base, headers } = await open(t, () => focus);
  const url = base + '/v1/focus';
  assert.equal((await fetch(url)).status, 401);
  assert.equal((await fetch(url, { headers, method: 'POST' })).status, 404);
  assert.equal((await fetch(url, { headers })).status, 503);
  focus = { endAt: Date.now() + 1000, nextAction: 'Outline the work', domains: ['youtube.com'] };
  assert.deepEqual(await (await fetch(url, { headers })).json(), { focus });
  focus = { ...focus, endAt: Date.now() - 1000 };
  assert.deepEqual(await (await fetch(url, { headers })).json(), { focus: null });
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
