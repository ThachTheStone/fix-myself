import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { appName, parseProcessList } = require('../desktop/apps.cjs');

test('the open app list keeps one entry per program and skips damaged rows (APP-01)', () => {
  const listed = parseProcessList(JSON.stringify([
    { Path: 'C:\\Program Files\\Microsoft VS Code\\Code.exe', Name: 'Visual Studio Code' },
    { Path: 'c:\\program files\\microsoft vs code\\code.exe', Name: 'Code again' },
    { Path: 'C:\\Program Files\\Slack\\slack.exe', Name: '' },
    { Path: 'C:\\Windows\\System32\\ApplicationFrameHost.exe' },
    { Path: 'C:\\Program Files (x86)\\Microsoft\\EdgeWebView\\Application\\1\\msedgewebview2.exe' },
    { Name: 'No path' },
    { Path: '   ' },
    null
  ]));
  assert.deepEqual(listed, [
    { path: 'C:\\Program Files\\Slack\\slack.exe', name: 'slack' },
    { path: 'C:\\Program Files\\Microsoft VS Code\\Code.exe', name: 'Visual Studio Code' }
  ]);
});

test('a single running app and an empty answer both parse safely (APP-01)', () => {
  assert.deepEqual(parseProcessList(JSON.stringify({ Path: 'C:\\Apps\\Notion\\Notion.exe', Name: 'Notion' })), [
    { path: 'C:\\Apps\\Notion\\Notion.exe', name: 'Notion' }
  ]);
  assert.deepEqual(parseProcessList(''), []);
  assert.deepEqual(parseProcessList('not json'), []);
  assert.deepEqual(parseProcessList('null'), []);
  assert.deepEqual(parseProcessList('42'), []);
});

test('a missing description falls back to the executable name (APP-01)', () => {
  assert.equal(appName('C:\\Apps\\Obsidian\\Obsidian.exe'), 'Obsidian');
  assert.equal(appName('C:/Apps/Obsidian/Obsidian'), 'Obsidian');
});
