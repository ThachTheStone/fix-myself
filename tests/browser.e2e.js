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

test('tasks leave the inbox when they get a deadline, keep their deadline when blocks move, and sync to another profile', { timeout: 60_000 }, async (t) => {
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
  await detail.getByLabel('New criterion').fill('Sent to the client');
  await detail.getByRole('button', { name: 'Add', exact: true }).click();
  await detail.locator('#criteria-list').getByText('Sent to the client').waitFor();
  await detail.getByLabel('Deadline', { exact: true }).fill(localInput(deadline));
  await page.getByRole('button', { name: 'Save details' }).click();
  await page.getByText('Saved.').waitFor();

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
  await page.locator('#review-stats').getByText('Tasks due').waitFor();

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

test('new tasks open straight to their details from the dialog, quick capture and the title', { timeout: 25_000 }, async (t) => {
  const app = await preview({ preview: { host: '127.0.0.1', port: 0 } });
  t.after(() => app.httpServer.close());
  const page = await (await launch(t)).newPage();
  await page.goto(`http://127.0.0.1:${app.httpServer.address().port}`);
  const detail = page.locator('#task');

  await page.locator('#today').getByRole('button', { name: '+ Add task' }).click();
  await page.getByRole('dialog').getByLabel('Task title').fill('Draft the budget');
  await page.getByRole('button', { name: 'Save and add details' }).click();
  await page.locator('#detail-title').getByText('Draft the budget').waitFor();
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'detail-input-next');

  await page.getByRole('link', { name: 'Today', exact: true }).click();
  await page.locator('#today').getByRole('button', { name: '+ Add task' }).click();
  await page.getByRole('dialog').getByLabel('Task title').fill('Quick one');
  await page.getByRole('dialog').getByLabel('Task title').press('Enter');
  await page.locator('#today-list').getByText('Quick one').waitFor();
  assert.equal(await detail.isHidden(), true);

  await page.locator('#today-list').getByRole('link', { name: 'Quick one', exact: true }).click();
  await page.locator('#detail-title').getByText('Quick one').waitFor();

  await page.getByRole('link', { name: 'Tasks', exact: true }).click();
  await page.getByLabel('Quick capture').fill('Call the bank');
  await page.getByRole('button', { name: 'Capture' }).click();
  await page.getByRole('link', { name: 'Add details →' }).click();
  await page.locator('#detail-title').getByText('Call the bank').waitFor();
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'detail-input-next');
});

test('the interface switches between English and Vietnamese and keeps the choice', { timeout: 25_000 }, async (t) => {
  const app = await preview({ preview: { host: '127.0.0.1', port: 0 } });
  t.after(() => app.httpServer.close());
  const page = await (await launch(t)).newPage();
  await page.goto(`http://127.0.0.1:${app.httpServer.address().port}/#settings`);
  await page.getByLabel('Display language').selectOption('vi');
  await page.getByRole('link', { name: 'Hôm nay' }).waitFor();
  assert.equal(await page.locator('html').getAttribute('lang'), 'vi');

  await page.reload();
  await page.getByRole('link', { name: 'Hôm nay' }).click();
  await page.getByRole('button', { name: 'Bắt đầu tập trung' }).waitFor();
  await page.locator('#today').getByRole('button', { name: '+ Thêm công việc' }).click();
  await page.getByRole('dialog').getByLabel('Tên công việc').fill('Viết đề cương');
  await page.getByRole('button', { name: 'Lưu công việc' }).click();
  await page.getByText('Đã xong 0/1').waitFor();
  await page.getByRole('link', { name: 'Mở Viết đề cương' }).waitFor();

  await page.getByRole('link', { name: 'Cài đặt' }).click();
  await page.getByLabel('Ngôn ngữ hiển thị').selectOption('en');
  await page.getByRole('link', { name: 'Today' }).click();
  await page.getByText('0 of 1 complete').waitFor();
});

test('a block rule is created in Settings, keeps a weaker edit waiting, and survives a reload', { timeout: 30_000 }, async (t) => {
  const app = await preview({ preview: { host: '127.0.0.1', port: 0 } });
  t.after(() => app.httpServer.close());
  const page = await (await launch(t)).newPage();
  await page.goto(`http://127.0.0.1:${app.httpServer.address().port}/#settings`);

  await page.getByLabel('Rule name').fill('Late evening');
  // BLK-01 validates domain names as in FOC-03, so a link with a path is
  // rejected (see tests/blockrules.test.js); the field takes plain domains.
  await page.getByLabel('Sites to block, one domain per line').fill('youtube.com\ninstagram.com');
  await page.getByRole('radio', { name: 'Scheduled' }).check();
  await page.getByRole('button', { name: 'Add a time window' }).click();
  const windows = page.locator('#rule-windows');
  await windows.getByLabel('Start', { exact: true }).fill('22:00');
  await windows.getByLabel('End', { exact: true }).fill('02:00');
  await page.getByLabel('When a listed site opens').selectOption('pause');
  await page.locator('#block-rules').getByLabel('Countdown (seconds)').fill('20');
  await page.locator('#block-rules').getByLabel('Pass (minutes)').fill('5');
  await page.getByRole('button', { name: 'Save rule' }).click();
  await page.getByText('Rule saved.').waitFor();

  const list = page.locator('#rule-list');
  await list.getByText('Late evening').waitFor();
  await list.getByText('20-second pause, 5-minute pass', { exact: false }).waitFor();
  await list.getByText('2 sites').waitFor();
  await list.getByText('Mon, Tue, Wed, Thu, Fri 22:00', { exact: false }).waitFor();

  await page.reload();
  await page.locator('#rule-list').getByText('Late evening').waitFor();

  // A shorter countdown protects less, so the edit waits for the change delay (BLK-06).
  await page.locator('#rule-list').getByRole('button', { name: 'Edit', exact: true }).click();
  await page.locator('#block-rules').getByLabel('Countdown (seconds)').fill('10');
  await page.getByRole('button', { name: 'Save rule' }).click();
  await page.getByText('Saved. This weaker change applies after the delay.').waitFor();
  await page.locator('#pending-rule-list').getByText('Weaker version of Late evening').waitFor();
  await page.locator('#rule-list').getByText('20-second pause', { exact: false }).waitFor();

  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByText('Change cancelled.').waitFor();
  await page.locator('#pending-rules-empty').waitFor();
});

test('the Review page shows block rule activity and pass reasons apart from focus attempts (BLK-10)', { timeout: 30_000 }, async (t) => {
  const app = await preview({ preview: { host: '127.0.0.1', port: 0 } });
  t.after(() => app.httpServer.close());
  const url = `http://127.0.0.1:${app.httpServer.address().port}`;
  const page = await (await launch(t)).newPage();
  await page.goto(url);
  const today = localDay(new Date());
  // Build the state the extension would have reported, in the app's own shape.
  await page.evaluate((day) => {
    const key = 'fix-myself:v1';
    const state = JSON.parse(localStorage.getItem(key));
    state.chrome = {
      profiles: {
        '00000000-0000-4000-8000-000000000001': {
          name: 'Work',
          lastSeenAt: new Date().toISOString(),
          activeDays: [day],
          attempts: {},
          ruleEvents: {
            [day]: {
              'youtube.com': { block: { 21: 3, 9: 1 }, pause: { 21: 2 }, pass: { 21: 1 } },
              'facebook.com': { block: { 8: 1 } }
            }
          },
          passReasons: { [day]: [{ host: 'youtube.com', hour: 21, reason: 'Watching a lecture' }] }
        }
      }
    };
    localStorage.setItem(key, JSON.stringify(state));
  }, today);
  await page.goto(url + '/#review');
  // A hash-only change keeps the running page and its stale state, so reload to read the seeded plan.
  await page.reload();

  await page.getByRole('heading', { name: 'Block rules' }).waitFor();
  const list = page.locator('#rule-review-list');
  await list.getByText('youtube.com', { exact: true }).waitFor();
  await list.getByText('4 blocked · 2 paused · 1 pass').waitFor();
  await list.getByText('Busiest hours: 21:00 (6), 09:00 (1)').waitFor();
  await list.getByText('1 blocked · 0 paused · 0 passes').waitFor();
  await page.locator('#rule-reason-list').getByText('Watching a lecture', { exact: false }).waitFor();
  await page.locator('#rule-reason-list').getByText(':00 · youtube.com:', { exact: false }).waitFor();
  await page.locator('#rule-review-empty').waitFor({ state: 'hidden' });
});

// Worker runs (scripts/dispatch-cline.sh) skip this test: it needs the fixed bridge port, which the user's desktop
// app may hold, and a worker must never stop that app to free it.
const workerRun = process.env.FIX_MYSELF_WORKER ? 'worker runs leave port 127.0.0.1:42631 to the desktop app' : false;

test('Chromium blocks existing and new tabs, retains the cached session, and releases it on expiry', { timeout: 35_000, skip: workerRun }, async (t) => {
  const token = 'a'.repeat(64);
  let focus = null;
  const reports = [];
  const server = bridge.createFocusBridge(token, () => ({ focus, plan: bridge.EMPTY_PLAN }), (report) => reports.push(report));
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

test('Windows app presets shape the next focus session from Settings and Today (APP-01, APP-02)', { timeout: 40_000 }, async (t) => {
  const app = await preview({ preview: { host: '127.0.0.1', port: 0 } });
  t.after(() => app.httpServer.close());
  const url = `http://127.0.0.1:${app.httpServer.address().port}`;
  const context = await launch(t);
  const page = await context.newPage();
  await page.addInitScript(() => {
    const apps = [
      { path: 'C:\\Program Files\\Microsoft VS Code\\Code.exe', name: 'Visual Studio Code' },
      { path: 'C:\\Windows\\explorer.exe', name: 'Windows Explorer' },
      { path: 'C:\\Program Files\\Slack\\slack.exe', name: 'Slack' }
    ];
    const nothing = async () => {};
    window.fixMyselfDesktop = {
      platform: 'win32',
      loginLaunch: false,
      status: async () => ({ startup: false, pairingCode: 'f'.repeat(64) }),
      setStartup: nothing,
      publishPlan: nothing,
      chromeReports: async () => [],
      setBackground: nothing,
      listApps: async () => apps,
      show: nothing
    };
  });
  await page.goto(url + '/#settings');
  const panel = page.locator('#app-presets');

  await panel.getByLabel('Preset name').fill('Writing');
  await panel.getByRole('button', { name: 'Refresh open apps' }).click();
  const choices = panel.getByLabel('Apps with an open window');
  await choices.selectOption({ label: 'Visual Studio Code' });
  await panel.getByRole('button', { name: 'Add app', exact: true }).click();
  await page.locator('#preset-apps').getByText('Visual Studio Code').waitFor();
  // The shell is never limited and a chosen app leaves the list (APP-01).
  assert.deepEqual(await choices.locator('option').allTextContents(), ['Slack']);

  await panel.getByLabel('When an app outside the preset comes to the front').selectOption('pause');
  await panel.getByLabel('Countdown (seconds)').fill('20');
  await panel.getByLabel('Pass (minutes)').fill('5');
  await panel.getByRole('button', { name: 'Save preset' }).click();
  await page.getByText('Preset saved.').waitFor();
  const list = page.locator('#preset-list');
  await list.getByText('Writing').waitFor();
  assert.equal(await list.locator('li .muted').first().textContent(), '20-second pause, 5-minute pass · 1 app');

  await panel.getByLabel('Preset for automatic sessions').selectOption({ label: 'Writing' });
  await page.getByText('Automatic session preset saved.').waitFor();

  await page.getByRole('link', { name: 'Today', exact: true }).click();
  const session = page.getByLabel('Apps for this session');
  await session.selectOption({ label: 'Writing' });
  await page.getByRole('button', { name: 'Start focus' }).click();
  await page.getByText('Apps: Visual Studio Code', { exact: false }).waitFor();
  assert.equal(await session.isVisible(), false);

  await page.reload();
  await page.getByText('Apps: Visual Studio Code', { exact: false }).waitFor();
  assert.equal(await page.getByLabel('Apps for this session').isVisible(), false);

  // Without the desktop bridge the panel stays hidden in the browser (APP-01).
  const plain = await context.newPage();
  await plain.goto(url + '/#settings');
  assert.equal(await plain.locator('#app-presets').isVisible(), false);
});

test('an app outside the preset shows the intervention, a pause pass is requested, and Review counts it (APP-03, APP-05, APP-09)', { timeout: 40_000 }, async (t) => {
  const app = await preview({ preview: { host: '127.0.0.1', port: 0 } });
  t.after(() => app.httpServer.close());
  const url = `http://127.0.0.1:${app.httpServer.address().port}`;
  const context = await launch(t);
  const page = await context.newPage();
  await page.addInitScript(() => {
    const nothing = async () => {};
    const handlers = {};
    window.appTest = { limits: [], passes: [], handlers };
    window.fixMyselfDesktop = {
      platform: 'win32',
      loginLaunch: false,
      status: async () => ({ startup: false, pairingCode: 'f'.repeat(64) }),
      setStartup: nothing,
      publishPlan: nothing,
      chromeReports: async () => [],
      setBackground: nothing,
      show: nothing,
      listApps: async () => [{ path: 'C:\Apps\Code.exe', name: 'VS Code' }],
      setAppLimit: async (limit) => { window.appTest.limits.push(limit); },
      takeAppPass: async (path, reason) => { window.appTest.passes.push({ path, reason }); return Date.now() + 60_000; },
      appCoverage: async () => ({ state: 'running', partial: [] }),
      onAppIntervention: (callback) => { handlers.intervene = callback; },
      onAppEvent: (callback) => { handlers.event = callback; },
      onAppCoverage: (callback) => { handlers.coverage = callback; }
    };
  });
  await page.goto(url + '/#settings');
  const panel = page.locator('#app-presets');
  await panel.getByLabel('Preset name').fill('Coding');
  await panel.getByRole('button', { name: 'Add app', exact: true }).click();
  await panel.getByLabel('When an app outside the preset comes to the front').selectOption('pause');
  await panel.getByLabel('Countdown (seconds)').fill('5');
  await panel.getByRole('button', { name: 'Save preset' }).click();
  await page.getByText('Preset saved.').waitFor();

  await page.getByRole('link', { name: 'Today', exact: true }).click();
  await page.getByLabel('Apps for this session').selectOption({ label: 'Coding' });
  await page.getByRole('button', { name: 'Start focus' }).click();
  await page.getByText('Apps: VS Code', { exact: false }).waitFor();
  // The running session's preset reaches the desktop guard (APP-03).
  await page.waitForFunction(() => window.appTest.limits.some((limit) => limit?.name === 'Coding'));
  const limit = await page.evaluate(() => window.appTest.limits.findLast((item) => item));
  assert.equal(limit.strength, 'pause');
  assert.deepEqual(limit.apps, [{ path: 'C:\Apps\Code.exe', name: 'VS Code' }]);

  await page.evaluate((endAt) => {
    window.appTest.handlers.event({ kind: 'pause', path: 'C:\Apps\Slack.exe', name: 'Slack', at: new Date().toISOString() });
    window.appTest.handlers.intervene({
      mode: 'pause', app: 'Slack', path: 'C:\Apps\Slack.exe', preset: 'Coding', endAt,
      allowed: ['VS Code'], nextAction: null, countdownSeconds: 2, passMinutes: 10
    });
  }, limit.endAt);
  const dialog = page.locator('#app-dialog');
  await dialog.getByText('Slack was minimized.').waitFor();
  await dialog.getByText('Allowed apps: VS Code').waitFor();
  const proceed = dialog.getByRole('button', { name: 'Continue for 10 min' });
  assert.equal(await proceed.isDisabled(), true, 'the countdown comes first (APP-05)');
  await dialog.getByLabel('Why do you need it? (optional)').fill('Reply to the team');
  await page.waitForFunction(() => !document.getElementById('app-dialog-continue').disabled, null, { timeout: 5000 });
  await proceed.click();
  await dialog.waitFor({ state: 'hidden' });
  assert.deepEqual(await page.evaluate(() => window.appTest.passes),
    [{ path: 'C:\Apps\Slack.exe', reason: 'Reply to the team' }]);
  await page.evaluate(() => window.appTest.handlers.event({
    kind: 'pass', path: 'C:\Apps\Slack.exe', name: 'Slack', reason: 'Reply to the team', at: new Date().toISOString()
  }));

  // A Block preset offers no continue (APP-05).
  await page.evaluate((endAt) => window.appTest.handlers.intervene({
    mode: 'block', app: 'Game', path: 'C:\Games\Game.exe', preset: 'Coding', endAt,
    allowed: ['VS Code'], nextAction: 'Write the report', countdownSeconds: null, passMinutes: null
  }), limit.endAt);
  await dialog.getByText('Next: Write the report').waitFor();
  assert.equal(await dialog.getByRole('button', { name: /Continue/ }).isVisible(), false);
  await dialog.getByRole('button', { name: 'Back to Today' }).click();
  await dialog.waitFor({ state: 'hidden' });

  // Coverage problems are shown on Today (APP-07).
  await page.evaluate(() => window.appTest.handlers.coverage({ state: 'running', partial: ['?'] }));
  await page.getByText('Some windows could not be limited', { exact: false }).waitFor();

  await page.getByRole('link', { name: 'Review', exact: true }).click();
  const review = page.locator('#app-review');
  await review.getByText('Slack').first().waitFor();
  await review.getByText('0 blocked · 1 paused · 1 passes').waitFor();
  await review.getByText('Slack: Reply to the team', { exact: false }).waitFor();
});

test('a focus session works on a chosen task, pauses, ends with sites still blocked, and shows focus time (FOC-09 to FOC-11)', { timeout: 30_000 }, async (t) => {
  const app = await preview({ preview: { host: '127.0.0.1', port: 0 } });
  t.after(() => app.httpServer.close());
  const page = await (await launch(t)).newPage();
  await page.goto(`http://127.0.0.1:${app.httpServer.address().port}`);

  await page.locator('#today').getByRole('button', { name: '+ Add task' }).click();
  await page.getByRole('dialog').getByLabel('Task title').fill('Write the report');
  await page.getByRole('dialog').getByLabel('Task title').press('Enter');
  await page.locator('#today-list').getByText('Write the report').waitFor();

  await page.getByLabel('Task for this session').selectOption({ label: 'Write the report' });
  await page.getByRole('button', { name: 'Start focus' }).click();
  await page.getByText('Working on: Write the report').waitFor();
  await page.getByRole('button', { name: 'Pause' }).click();
  await page.getByRole('button', { name: 'Resume' }).click();
  await page.getByRole('button', { name: 'Pause' }).waitFor();
  await page.getByRole('button', { name: 'End session' }).click();
  await page.getByText('Session ended. Sites stay blocked until', { exact: false }).waitFor();
  await page.getByRole('button', { name: 'Start focus' }).waitFor();

  await page.locator('#today-list').getByRole('link', { name: 'Write the report', exact: true }).click();
  await page.getByText('Focus time:', { exact: false }).waitFor();
});

test('a strict work block holds the session, refuses completion with unticked criteria, and offers an emergency exit (WB-01 to WB-04)', { timeout: 40_000 }, async (t) => {
  const app = await preview({ preview: { host: '127.0.0.1', port: 0 } });
  t.after(() => app.httpServer.close());
  const page = await (await launch(t)).newPage();
  await page.goto(`http://127.0.0.1:${app.httpServer.address().port}`);

  await page.locator('#today').getByRole('button', { name: '+ Add task' }).click();
  await page.getByRole('dialog').getByLabel('Task title').fill('Write the report');
  await page.getByRole('dialog').getByLabel('Task title').press('Enter');
  await page.locator('#today-list').getByRole('link', { name: 'Write the report', exact: true }).click();

  const detail = page.locator('#task');
  await detail.getByLabel('New criterion').fill('Draft the summary');
  await detail.getByRole('button', { name: 'Add', exact: true }).click();
  await detail.locator('#criteria-list').getByText('Draft the summary').waitFor();

  const now = new Date();
  await detail.getByLabel('Start', { exact: true }).fill(localInput(new Date(now.getTime() - 60_000)));
  await detail.getByLabel('End', { exact: true }).fill(localInput(new Date(now.getTime() + 30 * 60_000)));
  await detail.getByLabel('Strict: hold me on this task until it is done').check();
  await page.getByRole('button', { name: 'Add work block' }).click();
  await page.getByText('Work block added.').waitFor();
  await page.reload();

  await page.goto(page.url().split('#')[0] + '#today');
  await page.getByText('Strict block: Write the report', { exact: false }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Pause' }).isVisible(), false);
  assert.equal(await page.getByRole('button', { name: 'End session' }).isVisible(), false);

  await page.getByRole('checkbox', { name: 'Complete Write the report' }).click();
  await page.getByText('Tick every completion criterion before completing this task.').waitFor();

  await page.getByRole('button', { name: 'Emergency exit' }).click();
  await page.getByText('You can exit in', { exact: false }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Exit strict block' }).isDisabled(), true);
});

test('a task keeps websites, reports one blocked by focus, and offers Open workspace on Today (WS-01, WS-03)', { timeout: 30_000 }, async (t) => {
  const app = await preview({ preview: { host: '127.0.0.1', port: 0 } });
  t.after(() => app.httpServer.close());
  const page = await (await launch(t)).newPage();
  await page.goto(`http://127.0.0.1:${app.httpServer.address().port}`);

  await page.locator('#today').getByRole('button', { name: '+ Add task' }).click();
  await page.getByRole('dialog').getByLabel('Task title').fill('Write the report');
  await page.getByRole('dialog').getByLabel('Task title').press('Enter');
  await page.locator('#today-list').getByText('Write the report').waitFor();
  await page.getByLabel('Task for this session').selectOption({ label: 'Write the report' });
  await page.getByRole('button', { name: 'Start focus' }).click();
  await page.getByText('Working on: Write the report').waitFor();
  await page.getByRole('button', { name: 'Open workspace' }).waitFor();
  await page.locator('#today-list').getByRole('link', { name: 'Write the report', exact: true }).click();

  const workspace = page.locator('#task');
  await workspace.getByLabel('Website address').fill('https://docs.example.org/brief');
  await workspace.getByLabel('Name (optional)').fill('Brief');
  await workspace.getByRole('button', { name: 'Add website' }).click();
  const link = workspace.locator('#workspace-list').getByRole('link', { name: 'Brief' });
  await link.waitFor();
  assert.equal(await link.getAttribute('target'), '_blank');
  assert.equal(await link.getAttribute('rel'), 'noopener noreferrer');

  await workspace.getByLabel('Website address').fill('javascript:alert(1)');
  await workspace.getByRole('button', { name: 'Add website' }).click();
  await page.getByText('Add websites as http or https links.').waitFor();

  await workspace.getByLabel('Website address').fill('https://www.youtube.com/watch?v=1');
  await workspace.getByRole('button', { name: 'Add website' }).click();
  await page.getByText('www.youtube.com is blocked by the focus list.').waitFor();
  assert.equal(await workspace.locator('#workspace-feedback').getByRole('link', { name: 'Change it in Settings.' }).getAttribute('href'), '#settings');
  await workspace.locator('#workspace-list li').filter({ hasText: 'www.youtube.com' }).waitFor();

  await workspace.getByRole('button', { name: 'Remove www.youtube.com' }).click();
  await workspace.getByRole('button', { name: 'Remove Brief' }).click();
  await workspace.getByText('Nothing added yet.').waitFor();
});

test('the Calendar moves a block by dragging, keeps the deadline, and creates a block from an empty range (PLAN-01, PLAN-02)', { timeout: 60_000 }, async (t) => {
  const app = await preview({ preview: { host: '127.0.0.1', port: 0 } });
  t.after(() => app.httpServer.close());
  const url = `http://127.0.0.1:${app.httpServer.address().port}`;
  const context = await launch(t);
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 1400 });
  await page.goto(url + '/#tasks');

  await page.getByLabel('Quick capture').fill('Plan the report');
  await page.getByRole('button', { name: 'Capture' }).click();
  await page.locator('#inbox-list').getByRole('link', { name: 'Open Plan the report' }).click();
  const detail = page.locator('#task');
  const deadline = new Date(Date.now() + 3 * 86_400_000);
  deadline.setHours(17, 0, 0, 0);
  await detail.getByLabel('New criterion').fill('Report sent');
  await detail.getByRole('button', { name: 'Add', exact: true }).click();
  await detail.locator('#criteria-list').getByText('Report sent').waitFor();
  await detail.getByLabel('Deadline', { exact: true }).fill(localInput(deadline));
  await page.getByRole('button', { name: 'Save details' }).click();
  await page.getByText('Saved.').waitFor();
  const tomorrow = new Date(Date.now() + 86_400_000);
  tomorrow.setHours(10, 0, 0, 0);
  await detail.getByLabel('Start', { exact: true }).fill(localInput(tomorrow));
  await detail.getByLabel('End', { exact: true }).fill(localInput(new Date(tomorrow.getTime() + 3_600_000)));
  await page.getByRole('button', { name: 'Add work block' }).click();
  await page.getByText('Work block added.').waitFor();

  await page.getByRole('link', { name: 'Calendar' }).click();
  const column = page.locator(`.cal-day[data-day="${localDay(tomorrow)}"]`);
  // Wait for the grid before deciding whether tomorrow is off screen (today can be the last day shown).
  await page.locator('.cal-day').first().waitFor();
  if (await column.count() === 0) await page.getByRole('button', { name: 'Next' }).click();
  await column.waitFor();
  const block = page.locator('.cal-block', { hasText: 'Plan the report' });
  await block.waitFor();
  const box = await block.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 12);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + 12 + 48, { steps: 5 });
  await page.mouse.move(box.x + box.width / 2, box.y + 12 + 96, { steps: 5 });
  await page.mouse.up();
  await page.getByText('Block moved.').waitFor();

  await page.locator('.cal-block', { hasText: 'Plan the report' }).click();
  // The task page renders on hashchange, after the click returns.
  await page.locator('#detail-title', { hasText: 'Plan the report' }).waitFor();
  const shifted = new Date(tomorrow.getTime() + 2 * 3_600_000);
  assert.equal(await page.getByLabel('Block 1 start').inputValue(), localInput(shifted));
  assert.equal(await page.getByLabel('Block 1 end').inputValue(), localInput(new Date(shifted.getTime() + 3_600_000)));
  assert.equal(await detail.getByLabel('Deadline', { exact: true }).inputValue(), localInput(deadline));

  await page.getByRole('link', { name: 'Calendar' }).click();
  await page.locator('.cal-day').first().waitFor();
  if (await column.count() === 0) await page.getByRole('button', { name: 'Next' }).click();
  await column.waitFor();
  const empty = await column.boundingBox();
  const at = (hour) => empty.y + hour * 48;
  await page.mouse.move(empty.x + empty.width / 2, at(15));
  await page.mouse.down();
  await page.mouse.move(empty.x + empty.width / 2, at(16.5), { steps: 8 });
  await page.mouse.up();
  const dialog = page.locator('#calendar-dialog');
  await dialog.getByLabel('Task').selectOption({ label: 'Plan the report' });
  await dialog.getByRole('button', { name: 'Create' }).click();
  await page.getByText('Block added.').waitFor();
  await page.locator('.cal-block', { hasText: 'Plan the report' }).nth(1).waitFor();
  assert.equal(await page.locator('.cal-block').count(), 2);
});

test('child tasks nest in the Tasks view, show their ancestors and keep a parent open (TASK-03 to TASK-05)', { timeout: 60_000 }, async (t) => {
  const app = await preview({ preview: { host: '127.0.0.1', port: 0 } });
  t.after(() => app.httpServer.close());
  const context = await launch(t);
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 1400 });
  await page.goto(`http://127.0.0.1:${app.httpServer.address().port}/#tasks`);

  await page.getByLabel('Quick capture').fill('Payment module');
  await page.getByRole('button', { name: 'Capture' }).click();
  await page.locator('#inbox-list').getByRole('link', { name: 'Open Payment module' }).click();
  const detail = page.locator('#task');
  await detail.getByLabel('New child task').fill('Query database');
  await detail.getByRole('button', { name: 'Add child task' }).click();
  await detail.locator('#child-list').getByRole('link', { name: 'Query database' }).click();
  await detail.getByLabel('New child task').fill('Read variables');
  await detail.getByRole('button', { name: 'Add child task' }).click();
  await detail.locator('#child-list').getByRole('link', { name: 'Read variables' }).waitFor();

  await page.getByRole('link', { name: 'Tasks', exact: true }).click();
  const list = page.locator('#inbox-list');
  assert.equal(await list.locator('li.task').count(), 3);
  assert.equal(await list.locator(':scope > li').count(), 1);
  const left = async (title) => (await list.locator('li.task').filter({ has: page.getByRole('link', { name: title, exact: true }) }).last().boundingBox()).x;
  const [top, middle, bottom] = [await left('Payment module'), await left('Query database'), await left('Read variables')];
  assert.ok(top < middle && middle < bottom, `${top} < ${middle} < ${bottom}`);
  await list.getByText('0/1 child tasks').first().waitFor();
  const toggle = list.getByRole('button', { name: 'Collapse child tasks of Payment module' });
  assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
  await toggle.click();
  assert.equal(await list.locator('li.task').count(), 1);
  await list.getByRole('button', { name: 'Expand child tasks of Payment module' }).click();
  assert.equal(await list.locator('li.task').count(), 3);

  await list.getByRole('link', { name: 'Open Read variables' }).click();
  await detail.locator('#detail-breadcrumb', { hasText: 'Query database' }).waitFor();
  assert.equal(await detail.locator('#detail-breadcrumb').textContent(), 'Payment module › Query database');
  await detail.locator('#detail-breadcrumb').getByRole('link', { name: 'Payment module' }).click();
  await page.locator('#detail-title', { hasText: /^Payment module$/ }).waitFor();
  await detail.locator('#detail-input-status').selectOption('completed');
  await page.getByRole('button', { name: 'Save details' }).click();
  await page.getByText('Complete or cancel its child tasks first.').waitFor();
  await detail.getByText('0 of 1 child tasks done').waitFor();
});

test('Account sync takes a connection, shows the signed-out form and renders the link prompt without any network call', { timeout: 30_000 }, async (t) => {
  const app = await preview({ preview: { host: '127.0.0.1', port: 0 } });
  t.after(() => app.httpServer.close());
  const page = await (await launch(t)).newPage();
  const outside = [];
  await page.route('**/*', (route) => {
    const { hostname } = new URL(route.request().url());
    if (hostname === '127.0.0.1') return route.continue();
    outside.push(route.request().url());
    return route.abort();
  });
  await page.goto(`http://127.0.0.1:${app.httpServer.address().port}/?cloudtest#settings`);
  const panel = page.locator('#cloud');
  await panel.getByRole('heading', { name: 'Account sync' }).waitFor();
  await panel.getByText('Set up a Supabase project first; see docs/SUPABASE.md').waitFor();

  await panel.getByLabel('Project URL').fill('https://example.com');
  await panel.getByLabel('Anon or publishable key').fill('sb_publishable_AbCdEfGhIjKlMnOp_1234');
  await panel.getByRole('button', { name: 'Save connection' }).click();
  await panel.getByText('Check the project URL and key from Supabase', { exact: false }).waitFor();
  assert.equal(await panel.getByRole('button', { name: 'Send code' }).isVisible(), false);

  await panel.getByLabel('Project URL').fill('https://abcdefghijklmnopqrst.supabase.co');
  await panel.getByLabel('Anon or publishable key').fill('sb_secret_AbCdEfGhIjKlMnOp_1234');
  await panel.getByRole('button', { name: 'Save connection' }).click();
  await panel.getByText('Use the publishable or anon key, never the secret key.').waitFor();

  await panel.getByLabel('Anon or publishable key').fill('sb_publishable_AbCdEfGhIjKlMnOp_1234');
  await panel.getByRole('button', { name: 'Save connection' }).click();
  await panel.getByRole('button', { name: 'Send code' }).waitFor();
  await panel.getByLabel('Code', { exact: true }).waitFor();
  await panel.getByRole('button', { name: 'Change connection' }).waitFor();

  await page.evaluate(() => window.__cloudTest.status({ status: 'link-needed', email: 'someone@example.test', serverHasData: true, localHasData: true }));
  const prompt = panel.getByRole('alert');
  await prompt.getByText("This account already has a plan. Replace this device's plan with it?", { exact: false }).waitFor();
  const replace = prompt.getByRole('button', { name: "Replace with the account's plan" });
  assert.match(await replace.getAttribute('class'), /\bprimary\b/);
  await prompt.getByRole('button', { name: 'Cancel' }).waitFor();

  await page.evaluate(() => window.__cloudTest.status({ status: 'error', code: 'protected', message: 'x' }));
  await panel.getByText('Turn off block rules and strict blocks on this device first', { exact: false }).waitFor();
  assert.equal(await replace.isVisible(), true);
  assert.deepEqual(outside, []);
});
