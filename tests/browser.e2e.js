import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
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
  await page.getByRole('dialog').getByLabel('Task title').fill('Write the outline');
  await page.getByRole('dialog').getByLabel('Pin as a priority').check();
  await page.getByRole('button', { name: 'Save task' }).click();
  await page.reload();
  await page.getByText('Finish the proposal', { exact: true }).waitFor();
  await page.getByText('Next action · Priority', { exact: false }).waitFor();
  await page.getByRole('checkbox', { name: 'Complete Write the outline' }).check();
  await page.getByText('1 of 1 complete').waitFor();
  await page.getByRole('button', { name: 'Start focus' }).click();
  await page.getByText('Focus timer is running on this device.').waitFor();
});

function localInput(date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function localDay(date) {
  return localInput(date).slice(0, 10);
}

test('tasks move from the inbox to a commitment, keep their deadline when blocks move, and sync to another profile', { timeout: 60_000 }, async (t) => {
  const app = await preview({ preview: { host: '127.0.0.1', port: 0 } });
  t.after(() => app.httpServer.close());
  const url = `http://127.0.0.1:${app.httpServer.address().port}`;
  const context = await launch(t);
  const page = await context.newPage();
  await page.goto(url + '/#tasks');

  await page.getByLabel('Quick capture').fill('Prepare the proposal');
  await page.getByRole('button', { name: 'Capture' }).click();
  const inbox = page.locator('#inbox-list');
  await inbox.getByText('Prepare the proposal').waitFor();
  await inbox.getByRole('link', { name: 'Open Prepare the proposal' }).click();

  const detail = page.locator('#task');
  const now = new Date();
  const deadline = new Date(now.getTime() + 3 * 86_400_000);
  deadline.setHours(17, 0, 0, 0);
  await detail.getByLabel('Deadline', { exact: true }).fill(localInput(deadline));
  await detail.getByLabel('Completion criteria').fill('Sent to the client');
  await page.getByRole('button', { name: 'Save details' }).click();
  await page.getByText('Saved.').waitFor();

  await page.getByLabel('Outcome you commit to deliver').fill('Proposal sent');
  await page.getByRole('button', { name: 'Commit', exact: true }).click();
  await page.getByText('Proposal sent', { exact: true }).waitFor();

  const blockStart = new Date(deadline.getTime() - 86_400_000);
  blockStart.setHours(9, 0, 0, 0);
  await detail.getByLabel('Start', { exact: true }).fill(localInput(blockStart));
  await detail.getByLabel('End', { exact: true }).fill(localInput(new Date(blockStart.getTime() + 2 * 3_600_000)));
  await page.getByRole('button', { name: 'Add work block' }).click();
  await page.getByText('Work block added.').waitFor();
  const moved = new Date(blockStart.getTime() - 86_400_000);
  await page.getByLabel('Block 1 start').fill(localInput(moved));
  await page.getByLabel('Block 1 end').fill(localInput(new Date(moved.getTime() + 3_600_000)));
  await page.getByRole('button', { name: 'Reschedule' }).click();
  await page.getByText('Work block rescheduled. The deadline is unchanged.').waitFor();
  assert.equal(await detail.getByLabel('Deadline', { exact: true }).inputValue(), localInput(deadline));
  await page.locator('#timeline-list').getByText('Work block moved from', { exact: false }).waitFor();
  await page.locator('#timeline-list').getByText('Committed to “Proposal sent”', { exact: false }).waitFor();

  await page.getByRole('link', { name: '← All tasks' }).click();
  await page.locator('#inbox-empty').waitFor();
  await page.locator('#planned-list').getByText('Prepare the proposal').waitFor();

  await page.getByRole('link', { name: 'Today' }).click();
  await page.locator('#today').getByRole('button', { name: '+ Add task' }).click();
  await page.getByLabel('Task title').fill('Leftover from yesterday');
  await page.getByRole('dialog').getByLabel('Planned date').fill(localDay(new Date(now.getTime() - 86_400_000)));
  await page.getByRole('button', { name: 'Save task' }).click();
  await page.locator('#carryover-list').getByText('Leftover from yesterday').waitFor();
  await page.getByRole('button', { name: 'Add Leftover from yesterday to today' }).click();
  await page.locator('#today-list').getByText('Leftover from yesterday').waitFor();
  await page.getByLabel('Choose the next action').selectOption({ label: 'Prepare the proposal' });
  await page.locator('#next-title').getByText('Prepare the proposal').waitFor();

  await page.getByRole('link', { name: 'Review' }).click();
  await page.locator('#review-stats').getByText('Commitments due').waitFor();

  await page.getByRole('link', { name: 'Settings' }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download sync file' }).click()
  ]);
  const syncFile = await download.path();
  assert.match(await readFile(syncFile, 'utf8'), /fix-myself-sync/);

  const other = await (await launch(t)).newPage();
  await other.goto(url + '/#settings');
  await other.getByLabel('Merge a sync file from another device').setInputFiles(syncFile);
  await other.getByRole('button', { name: 'Merge into this device' }).click();
  await other.getByText('2 added', { exact: false }).waitFor();
  await other.getByRole('link', { name: 'Tasks' }).click();
  await other.locator('#planned-list').getByText('Prepare the proposal').waitFor();
});

test('Chromium blocks existing and new tabs, retains the cached session, and releases it on expiry', { timeout: 35_000 }, async (t) => {
  const token = 'a'.repeat(64);
  let focus = null;
  const reports = [];
  const server = bridge.createFocusBridge(token, () => focus, (report) => reports.push(report));
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

  focus = { endAt: Date.now() + 12_000, nextAction: 'Write the outline', domains: ['blocked.test'] };
  await popup.getByRole('button', { name: 'Check connection' }).click();
  await existing.getByText('Write the outline').waitFor();
  assert.equal(existing.url(), origin + '/blocked.html?from=start#blocked.test');

  // A new visit counts as a blocked attempt; the tab redirected at session start does not.
  const attempt = await context.newPage();
  await attempt.goto(website);
  await attempt.getByText('Write the outline').waitFor();
  await attempt.reload();
  await attempt.getByText('Write the outline').waitFor();
  await popup.getByRole('button', { name: 'Check connection' }).click();
  await popup.getByText('Focus is active.').waitFor();
  const latest = reports.at(-1);
  assert.equal(Object.values(latest.attempts).reduce((sum, day) => sum + (day['blocked.test'] ?? 0), 0), 1);
  assert.equal(latest.activeDays.length, 1);
  await attempt.close();

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
