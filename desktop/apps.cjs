// Reads the apps that have a visible window so Settings can offer them by name
// instead of asking the user to type a program name (APP-01).
const { execFile } = require('node:child_process');

const LIST_COMMAND = [
  "$ErrorActionPreference='SilentlyContinue';",
  '[Console]::OutputEncoding = [Text.Encoding]::UTF8;',
  "Get-Process | Where-Object { $_.MainWindowHandle -ne 0 } | Sort-Object -Unique Path |",
  " Select-Object Path, @{n='Name';e={ if ($_.Description) { $_.Description } else { $_.ProcessName } }} |",
  ' ConvertTo-Json -Compress'
].join(' ');

// These processes own the shell and its flyouts rather than a user program, so
// offering them in a preset would only list windows nobody switches to (APP-01).
const SYSTEM_HOSTS = new Set([
  'applicationframehost',
  'shellexperiencehost',
  'searchui',
  'searchhost',
  'startmenuexperiencehost',
  'textinputhost',
  'lockapp',
  'msedgewebview2'
]);

function fileName(path) {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1];
}

function appName(path) {
  const file = fileName(path);
  return file.toLowerCase().endsWith('.exe') ? file.slice(0, -4) : file;
}

function parseProcessList(text) {
  if (typeof text !== 'string' || !text.trim()) return [];
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  if (!data || typeof data !== 'object') return [];
  const entries = Array.isArray(data) ? data : [data];
  const seen = new Set();
  const apps = [];
  for (const entry of entries) {
    if (!entry || typeof entry.Path !== 'string' || !entry.Path.trim()) continue;
    const key = entry.Path.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const derived = appName(entry.Path);
    if (SYSTEM_HOSTS.has(derived.toLowerCase())) continue;
    const name = typeof entry.Name === 'string' && entry.Name.trim() ? entry.Name.trim() : derived;
    apps.push({ path: entry.Path, name });
  }
  return apps.sort((a, b) => a.name.localeCompare(b.name));
}

function listOpenApps() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      resolve([]);
      return;
    }
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', LIST_COMMAND], {
      timeout: 10000,
      windowsHide: true
    }, (error, stdout) => {
      if (error) {
        resolve([]);
        return;
      }
      resolve(parseProcessList(String(stdout ?? '')));
    });
  });
}

module.exports = { appName, listOpenApps, parseProcessList };
