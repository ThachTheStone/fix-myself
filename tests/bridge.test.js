import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import bridge from '../desktop/focus-bridge.cjs';

test('the local bridge requires its pairing code and clears expired snapshots', async (t) => {
  const token = 'a'.repeat(64);
  let focus;
  const server = bridge.createFocusBridge(token, () => focus);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}/v1/focus`;
  const headers = { Authorization: 'Bearer ' + token };
  assert.equal((await fetch(url)).status, 401);
  assert.equal((await fetch(url, { headers, method: 'POST' })).status, 404);
  assert.equal((await fetch(url, { headers })).status, 503);
  focus = { endAt: Date.now() + 1000, nextAction: 'Outline the work', domains: ['youtube.com'] };
  assert.deepEqual(await (await fetch(url, { headers })).json(), { focus });
  focus = { ...focus, endAt: Date.now() - 1000 };
  assert.deepEqual(await (await fetch(url, { headers })).json(), { focus: null });
});
