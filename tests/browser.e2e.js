import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { preview } from 'vite';
import bridge from '../desktop/focus-bridge.cjs';

async function launch(t, args = []) {
  const profile = await mkdtemp(join(tmpdir(), 'fix-myself-chrome-'));
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    executablePath: process.env.FIX_MYSELF_CHROMIUM,
    args,
    ignoreDefaultArgs: args.length ? ['--disable-extensions'] : undefined,
    env: { ...process.env, XDG_CONFIG_HOME: profile, XDG_CACHE_HOME: profile }
  });
  t.after(async () => {
    await context.close();
    await rm(profile, { recursive: true, force: true });
  });
  return context;
}

test('the planner captures and reloads a mission and a dated task on a narrow screen', { timeout: 25_000 }, async (t) => {
  const app = await preview({ preview: { host: '127.0.0.1', port: 0 } });
  t.after(() => app.httpServer.close());
  const context = await launch(t);
  const page = await context.newPage();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`http://127.0.0.1:${app.httpServer.address().port}`);
  await page.getByRole('button', { name: 'Edit mission' }).click();
  await page.getByLabel('What do you want to keep in mind?').fill('Finish the proposal');
  await page.getByRole('button', { name: 'Save mission' }).click();
  await page.getByRole('button', { name: '+ Add task' }).click();
  await page.getByLabel('Task title').fill('Write the outline');
  await page.getByLabel('Pin as a priority').check();
  await page.getByRole('button', { name: 'Save task' }).click();
  await page.reload();
  await page.getByText('Finish the proposal', { exact: true }).waitFor();
  await page.getByText('Next action · Priority', { exact: false }).waitFor();
  await page.getByRole('checkbox', { name: 'Complete Write the outline' }).check();
  await page.getByText('1 of 1 complete').waitFor();
  await page.getByRole('button', { name: 'Start focus' }).click();
  await page.getByText('Focus timer is running on this device.').waitFor();
});

test('Chromium blocks existing and new tabs, retains the cached session, and releases it on expiry', { timeout: 35_000 }, async (t) => {
  const token = 'a'.repeat(64);
  let focus = null;
  const server = bridge.createFocusBridge(token, () => focus);
  server.listen(bridge.PORT, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const site = createServer((_request, response) => response.end('Test site'));
  site.listen(0, '127.0.0.1');
  await once(site, 'listening');
  t.after(() => site.close());
  const website = `http://blocked.test:${site.address().port}`;
  const otherWebsite = `http://allowed.test:${site.address().port}`;
  const extensionPath = resolve('extension');
  const context = await launch(t, [
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
    '--host-resolver-rules=MAP blocked.test 127.0.0.1, MAP allowed.test 127.0.0.1',
    '--no-proxy-server'
  ]);
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const workerUrl = new URL(worker.url());
  const origin = workerUrl.protocol + '//' + workerUrl.host;
  const popup = await context.newPage();
  await popup.goto(origin + '/popup.html');
  await popup.getByLabel('Desktop pairing code').fill(token);
  await popup.getByRole('button', { name: 'Pair Chrome' }).click();
  await popup.getByText('Paired. No active focus session.').waitFor();

  const existing = await context.newPage();
  await existing.goto(website);
  await existing.getByText('Test site').waitFor();

  focus = { endAt: Date.now() + 8500, nextAction: 'Write the outline', domains: ['blocked.test'] };
  await popup.getByRole('button', { name: 'Check connection' }).click();
  await existing.getByText('Write the outline').waitFor();
  assert.equal(existing.url(), origin + '/blocked.html#blocked.test');

  await new Promise((resolveClose) => server.close(resolveClose));
  await popup.getByRole('button', { name: 'Check connection' }).click();
  await popup.getByText('Using the saved focus session.').waitFor();
  const next = await context.newPage();
  await next.goto(website);
  await next.getByText('Write the outline').waitFor();
  const allowed = await context.newPage();
  await allowed.goto(otherWebsite);
  await allowed.getByText('Test site').waitFor();
  await existing.getByRole('link', { name: 'Open site' }).waitFor({ timeout: 15_000 });
  await next.goto(website);
  await next.getByText('Test site').waitFor();
});
