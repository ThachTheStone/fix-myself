// Local items of a task workspace (WS-02). The main process owns the registry:
// the renderer only ever names an item by id, so it can never make this process
// open a path of its own choosing.
const { randomUUID } = require('node:crypto');
const { basename, dirname, extname } = require('node:path');

const MAX_ITEMS = 20;
const MAX_URLS = 20;
const MAX_URL_LENGTH = 2048;
const MAX_ID = 64;
const MAX_PRUNE = 5000;
const MAX_APP_PATH = 260;
const KINDS = new Set(['file', 'folder', 'app']);
const RUNNABLE = new Set(['.exe', '.bat', '.cmd', '.com', '.ps1', '.vbs', '.vbe', '.js', '.jse', '.wsf', '.msi', '.lnk', '.scr', '.hta', '.url', '.appref-ms', '.cpl', '.msc', '.reg', '.pif', '.application', '.gadget', '.jar', '.py', '.pyw', '.wsh', '.wsc', '.psc1', '.msp', '.inf', '.scf', '.rdp', '.chm', '.diagcab', '.settingcontent-ms', '.xbap']);

// Trailing dots and spaces are ignored by Windows, so "a.exe." is still a program.
const isRunnable = (path) => RUNNABLE.has(extname(String(path).replace(/[. ]+$/, '')).toLowerCase());
const isAppPath = (path) => typeof path === 'string' && path.length <= MAX_APP_PATH && /\.exe$/i.test(path);

const validId = (value) => typeof value === 'string' && value.length > 0 && value.length <= MAX_ID;

// A missing or broken file is an empty registry.
function parseRegistry(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return {};
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
  const registry = {};
  for (const [id, item] of Object.entries(data)) {
    if (!validId(id) || !item || typeof item !== 'object') continue;
    if (!validId(item.taskId) || !KINDS.has(item.kind)) continue;
    if (typeof item.path !== 'string' || !item.path || item.path.length > 1024) continue;
    registry[id] = { taskId: item.taskId, kind: item.kind, path: item.path, label: String(item.label ?? '').slice(0, 260) };
  }
  return registry;
}

function validLinkCount(value) {
  if (!Number.isInteger(value) || value < 0 || value > MAX_ITEMS) throw new Error('Invalid workspace request.');
  return value;
}

function validUrls(urls) {
  if (!Array.isArray(urls) || urls.length > MAX_URLS) throw new Error('Invalid workspace request.');
  return urls.map((url) => {
    if (typeof url !== 'string' || url.length > MAX_URL_LENGTH) throw new Error('Invalid workspace request.');
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error('Invalid workspace request.');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('Invalid workspace request.');
    return parsed.href;
  });
}

// `deps`: { registryText, save(text), exists(path), dialog, shell, spawn, listOpenApps, window() }
function createWorkspaces(deps) {
  const registry = parseRegistry(deps.registryText ?? '');

  const persist = () => deps.save(JSON.stringify(registry));
  const itemsOf = (taskId) => Object.entries(registry).filter(([, item]) => item.taskId === taskId);
  const view = ([id, item]) => ({ id, kind: item.kind, label: item.label });

  function create(taskId, kind, path, label, linkCount) {
    if (!validId(taskId)) throw new Error('Invalid workspace request.');
    const duplicate = itemsOf(taskId).find(([, item]) => item.kind === kind && item.path.toLowerCase() === path.toLowerCase());
    if (duplicate) return view(duplicate);
    if (validLinkCount(linkCount) + itemsOf(taskId).length >= MAX_ITEMS) throw new Error('Add up to 20 items to a workspace.');
    const id = randomUUID();
    registry[id] = { taskId, kind, path, label: label.slice(0, 260) };
    persist();
    return view([id, registry[id]]);
  }

  return {
    async pick({ taskId, kind, linkCount } = {}) {
      if (!validId(taskId) || (kind !== 'file' && kind !== 'folder')) throw new Error('Invalid workspace request.');
      validLinkCount(linkCount);
      const result = await deps.dialog.showOpenDialog(deps.window(), {
        properties: [kind === 'file' ? 'openFile' : 'openDirectory']
      });
      if (result.canceled || !result.filePaths?.[0]) return null;
      const path = result.filePaths[0];
      if (kind === 'file' && isRunnable(path)) throw new Error('Add apps from the app list instead.');
      return create(taskId, kind, path, basename(path) || path, linkCount);
    },

    async addApp({ taskId, path, linkCount } = {}) {
      if (!validId(taskId) || typeof path !== 'string' || path.length > 1024) throw new Error('Invalid workspace request.');
      validLinkCount(linkCount);
      if (path.length > MAX_APP_PATH) throw new Error('Choose an app from the list.');
      const match = (await deps.listOpenApps()).find((entry) => entry.path.toLowerCase() === path.toLowerCase());
      if (!match) throw new Error('Choose an app from the list.');
      return create(taskId, 'app', match.path, match.name, linkCount);
    },

    list(taskId) {
      if (!validId(taskId)) throw new Error('Invalid workspace request.');
      return itemsOf(taskId).map(([id, item]) => ({ ...view([id, item]), missing: !deps.exists(item.path) }));
    },

    remove(id) {
      if (!validId(id)) throw new Error('Invalid workspace request.');
      if (registry[id]) {
        delete registry[id];
        persist();
      }
    },

    prune(taskIds) {
      if (!Array.isArray(taskIds) || taskIds.length > MAX_PRUNE || !taskIds.every(validId)) {
        throw new Error('Invalid workspace request.');
      }
      // An empty list would wipe the registry, so it never counts as "no tasks remain".
      if (taskIds.length === 0) return;
      const keep = new Set(taskIds);
      let changed = false;
      for (const [id, item] of Object.entries(registry)) {
        if (keep.has(item.taskId)) continue;
        delete registry[id];
        changed = true;
      }
      if (changed) persist();
    },

    async open({ taskId, urls, linksOnly } = {}) {
      if (!validId(taskId)) throw new Error('Invalid workspace request.');
      const clean = validUrls(urls);
      const results = [];
      for (const url of clean) {
        results.push({ label: url, ok: await Promise.resolve(deps.shell.openExternal(url)).then(() => true, () => false) });
      }
      for (const [, item] of linksOnly === true ? [] : itemsOf(taskId)) {
        let ok = false;
        try {
          // The registry is re-checked at open time, in case its file was edited.
          if (item.kind === 'app' ? !isAppPath(item.path) : item.kind === 'file' && isRunnable(item.path)) {
            ok = false;
          } else if (item.kind === 'app') {
            if (deps.exists(item.path)) {
              const child = deps.spawn(item.path, [], { detached: true, stdio: 'ignore', cwd: dirname(item.path) });
              child.on?.('error', () => {});
              child.unref();
              ok = true;
            }
          } else {
            ok = (await deps.shell.openPath(item.path)) === '';
          }
        } catch {
          ok = false;
        }
        results.push({ label: item.label, ok });
      }
      return results;
    },

    apps(taskId) {
      if (!validId(taskId)) throw new Error('Invalid workspace request.');
      return itemsOf(taskId).filter(([, item]) => item.kind === 'app').map(([, item]) => ({ path: item.path, name: item.label }));
    }
  };
}

module.exports = { createWorkspaces, parseRegistry, RUNNABLE, MAX_ITEMS };
