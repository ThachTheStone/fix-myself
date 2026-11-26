import assert from 'node:assert/strict';
import test from 'node:test';
import workspaceModule from '../desktop/workspaces.cjs';

const { createWorkspaces, parseRegistry } = workspaceModule;

function setup(overrides = {}) {
  const saved = [];
  const opened = [];
  const spawned = [];
  const present = new Set(overrides.present ?? []);
  const picks = overrides.picks ?? [];
  const deps = {
    registryText: overrides.registryText ?? '',
    save: (text) => saved.push(text),
    exists: (path) => present.has(path),
    dialog: { showOpenDialog: async () => picks.shift() ?? { canceled: true, filePaths: [] } },
    shell: {
      openExternal: async (url) => { opened.push(url); if (overrides.failUrl === url) throw new Error('no'); },
      openPath: async (path) => { opened.push(path); return overrides.openPathError?.[path] ?? ''; }
    },
    spawn: (path, args, options) => { spawned.push({ path, args, options }); return { unref: () => spawned.push('unref') }; },
    listOpenApps: async () => overrides.apps ?? [{ path: 'C:\\Apps\\Code.exe', name: 'VS Code' }],
    window: () => null
  };
  return { ws: createWorkspaces(deps), saved, opened, spawned, present };
}

const pickFile = (path) => ({ canceled: false, filePaths: [path] });

test('WS-02: a broken or hostile registry file becomes an empty registry', () => {
  assert.deepEqual(parseRegistry('{not json'), {});
  assert.deepEqual(parseRegistry('[]'), {});
  assert.deepEqual(parseRegistry(JSON.stringify({ a: { taskId: 't', kind: 'script', path: 'x', label: 'x' } })), {});
  const { ws } = setup({ registryText: '\u0000garbage' });
  assert.deepEqual(ws.list('t1'), []);
});

test('WS-02: files are registered, runnable extensions are refused, cancel returns null', async () => {
  const { ws, saved } = setup({
    picks: [pickFile('C:\\Docs\\Plan.PDF'), pickFile('C:\\Tools\\Setup.EXE'), pickFile('C:\\x\\run.Ps1'), { canceled: true, filePaths: [] }],
    present: ['C:\\Docs\\Plan.PDF']
  });
  const item = await ws.pick({ taskId: 't1', kind: 'file', linkCount: 0 });
  assert.deepEqual({ kind: item.kind, label: item.label }, { kind: 'file', label: 'Plan.PDF' });
  await assert.rejects(ws.pick({ taskId: 't1', kind: 'file', linkCount: 0 }), /Add apps from the app list instead\./);
  await assert.rejects(ws.pick({ taskId: 't1', kind: 'file', linkCount: 0 }), /Add apps from the app list instead\./);
  assert.equal(await ws.pick({ taskId: 't1', kind: 'file', linkCount: 0 }), null);
  assert.equal(saved.length, 1);
  assert.deepEqual(ws.list('t1'), [{ id: item.id, kind: 'file', label: 'Plan.PDF', missing: false }]);
  assert.equal(JSON.parse(saved[0])[item.id].path, 'C:\\Docs\\Plan.PDF');
});

test('WS-02: folders may be picked; a missing path is flagged', async () => {
  const { ws } = setup({ picks: [pickFile('C:\\Work\\Notes')] });
  await ws.pick({ taskId: 't1', kind: 'folder', linkCount: 0 });
  assert.equal(ws.list('t1')[0].missing, true);
});

test('WS-02: an app path must be in the fresh open-app list', async () => {
  const { ws } = setup();
  const app = await ws.addApp({ taskId: 't1', path: 'c:\\apps\\code.exe', linkCount: 0 });
  assert.deepEqual({ kind: app.kind, label: app.label }, { kind: 'app', label: 'VS Code' });
  await assert.rejects(ws.addApp({ taskId: 't1', path: 'C:\\Windows\\evil.exe', linkCount: 0 }), /Choose an app from the list\./);
  assert.deepEqual(ws.apps('t1'), [{ path: 'C:\\Apps\\Code.exe', name: 'VS Code' }]);
  assert.deepEqual(ws.apps('other'), []);
});

test('WS-01: a workspace holds at most 20 items, links included', async () => {
  const picks = Array.from({ length: 25 }, (_, index) => pickFile(`C:\\Docs\\f${index}.txt`));
  const { ws } = setup({ picks });
  for (let index = 0; index < 18; index += 1) await ws.pick({ taskId: 't1', kind: 'file', linkCount: 2 });
  await assert.rejects(ws.pick({ taskId: 't1', kind: 'file', linkCount: 2 }), /Add up to 20 items to a workspace\./);
  assert.equal(ws.list('t1').length, 18);
  await ws.pick({ taskId: 't2', kind: 'file', linkCount: 0 });
});

test('WS-02: remove and prune only touch what they name', async () => {
  const { ws, saved } = setup({ picks: [pickFile('C:\\a.txt'), pickFile('C:\\b.txt'), pickFile('C:\\c.txt')] });
  const a = await ws.pick({ taskId: 't1', kind: 'file', linkCount: 0 });
  await ws.pick({ taskId: 't2', kind: 'file', linkCount: 0 });
  await ws.pick({ taskId: 't3', kind: 'file', linkCount: 0 });
  ws.remove(a.id);
  assert.equal(ws.list('t1').length, 0);
  ws.prune(['t2']);
  assert.equal(ws.list('t2').length, 1);
  assert.equal(ws.list('t3').length, 0);
  const writes = saved.length;
  ws.prune(['t2']);
  assert.equal(saved.length, writes);
});

test('WS-02: opening reports each item and never closes anything', async () => {
  const { ws, opened, spawned, present } = setup({
    picks: [pickFile('C:\\a.txt'), pickFile('C:\\b.txt')],
    openPathError: { 'C:\\b.txt': 'The system cannot find the file' },
    failUrl: 'https://bad.example/'
  });
  present.add('C:\\Apps\\Code.exe');
  await ws.pick({ taskId: 't1', kind: 'file', linkCount: 0 });
  await ws.pick({ taskId: 't1', kind: 'file', linkCount: 0 });
  await ws.addApp({ taskId: 't1', path: 'C:\\Apps\\Code.exe', linkCount: 0 });
  const results = await ws.open({ taskId: 't1', urls: ['https://good.example/', 'https://bad.example/'] });
  assert.deepEqual(results.map((r) => r.ok), [true, false, true, false, true]);
  assert.deepEqual(opened, ['https://good.example/', 'https://bad.example/', 'C:\\a.txt', 'C:\\b.txt']);
  assert.deepEqual(spawned[0], { path: 'C:\\Apps\\Code.exe', args: [], options: { detached: true, stdio: 'ignore', cwd: 'C:\\Apps' } });
  assert.equal(spawned[1], 'unref');
});

test('WS-02: a missing app counts as a failure and is not started', async () => {
  const { ws, spawned } = setup();
  await ws.addApp({ taskId: 't1', path: 'C:\\Apps\\Code.exe', linkCount: 0 });
  const results = await ws.open({ taskId: 't1', urls: [] });
  assert.deepEqual(results, [{ label: 'VS Code', ok: false }]);
  assert.equal(spawned.length, 0);
});

test('WS-02: bad arguments are rejected before anything runs', async () => {
  const { ws, opened } = setup();
  const long = `https://x.example/${'a'.repeat(2100)}`;
  const bad = [
    () => ws.pick({ taskId: 't1', kind: 'app', linkCount: 0 }),
    () => ws.pick({ taskId: 'x'.repeat(65), kind: 'file', linkCount: 0 }),
    () => ws.pick({ taskId: 't1', kind: 'file', linkCount: -1 }),
    () => ws.pick({ taskId: 't1', kind: 'file' }),
    () => ws.addApp({ taskId: 't1', path: 5, linkCount: 0 }),
    () => ws.addApp(null),
    () => ws.open({ taskId: 't1', urls: ['file:///C:/Windows/system32/calc.exe'] }),
    () => ws.open({ taskId: 't1', urls: ['javascript:alert(1)'] }),
    () => ws.open({ taskId: 't1', urls: [long] }),
    () => ws.open({ taskId: 't1', urls: Array.from({ length: 21 }, () => 'https://a.example/') }),
    () => ws.open({ taskId: 't1', urls: 'https://a.example/' }),
    () => ws.open({ taskId: 5, urls: [] })
  ];
  for (const run of bad) await assert.rejects(Promise.resolve().then(run));
  assert.throws(() => ws.list(5));
  assert.throws(() => ws.remove({}));
  assert.throws(() => ws.prune('t1'));
  assert.throws(() => ws.prune(Array.from({ length: 5001 }, (_, index) => `t${index}`)));
  assert.throws(() => ws.prune([1]));
  assert.throws(() => ws.apps(null));
  assert.deepEqual(opened, []);
});

test('WS-02: prune refuses an empty list and accepts a large one', async () => {
  const { ws } = setup({ picks: [pickFile('C:\\a.txt')] });
  await ws.pick({ taskId: 't1', kind: 'file', linkCount: 0 });
  ws.prune([]);
  assert.equal(ws.list('t1').length, 1);
  ws.prune(Array.from({ length: 5000 }, (_, index) => 'other' + index));
  assert.equal(ws.list('t1').length, 0);
  assert.throws(() => ws.prune(Array.from({ length: 5001 }, (_, index) => 't' + index)));
});

test('WS-02: more runnable extensions are refused, including trailing dots and spaces', async () => {
  const names = ['a.pdf.exe', 'A.EXE', 'a.exe.', 'a.exe ', 'a.url', 'a.py', 'a.rdp', 'a.msc', 'a.settingcontent-ms'];
  const { ws } = setup({ picks: names.map((name) => pickFile('C:\\x\\' + name)) });
  for (const name of names) {
    await assert.rejects(ws.pick({ taskId: 't1', kind: 'file', linkCount: 0 }), /Add apps from the app list instead\./, name);
  }
  assert.equal(ws.list('t1').length, 0);
});

test('WS-02: an app path longer than 260 characters is refused', async () => {
  const long = 'C:\\' + 'a'.repeat(300) + '.exe';
  const { ws } = setup({ apps: [{ path: long, name: 'Long' }] });
  await assert.rejects(ws.addApp({ taskId: 't1', path: long, linkCount: 0 }), /Choose an app from the list\./);
});

test('WS-02: opening re-checks items from a crafted registry', async () => {
  const registryText = JSON.stringify({
    f1: { taskId: 't1', kind: 'file', path: 'C:\\x\\evil.exe.', label: 'evil' },
    f2: { taskId: 't1', kind: 'file', path: 'C:\\x\\ok.txt', label: 'ok' },
    a1: { taskId: 't1', kind: 'app', path: 'C:\\x\\script.bat', label: 'bat' },
    a2: { taskId: 't1', kind: 'app', path: 'C:\\' + 'a'.repeat(300) + '.exe', label: 'long' }
  });
  const { ws, opened, spawned, present } = setup({ registryText });
  for (const path of ['C:\\x\\evil.exe.', 'C:\\x\\ok.txt', 'C:\\x\\script.bat']) present.add(path);
  const results = await ws.open({ taskId: 't1', urls: [] });
  assert.deepEqual(results.map((item) => [item.label, item.ok]), [['evil', false], ['ok', true], ['bat', false], ['long', false]]);
  assert.deepEqual(opened, ['C:\\x\\ok.txt']);
  assert.equal(spawned.length, 0);
});

test('WS-02: linksOnly opens the websites and none of the local items', async () => {
  const { ws, opened } = setup({ picks: [pickFile('C:\\a.txt')] });
  await ws.pick({ taskId: 't1', kind: 'file', linkCount: 0 });
  await ws.open({ taskId: 't1', urls: ['https://a.example/'], linksOnly: true });
  assert.deepEqual(opened, ['https://a.example/']);
});
