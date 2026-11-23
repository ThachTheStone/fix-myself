// Decides what happens when a window comes to the front during a focus session
// with an app preset (APP-03 to APP-07). Electron-free so it can be tested.

// Fix Myself and Windows controls are always allowed (APP-04). Kept in step with
// ALWAYS_ALLOWED_APPS in app/model.js, plus shell hosts that own system windows.
const ALWAYS_ALLOWED = new Set([
  'explorer.exe', 'systemsettings.exe', 'taskmgr.exe', 'applicationframehost.exe', 'shellexperiencehost.exe',
  'startmenuexperiencehost.exe', 'searchhost.exe', 'searchapp.exe', 'searchui.exe', 'lockapp.exe', 'consent.exe',
  'narrator.exe', 'magnify.exe', 'osk.exe', 'fix myself.exe', 'textinputhost.exe', 'sihost.exe', 'dwm.exe',
  'logonui.exe', 'credentialuibroker.exe', 'pickerhost.exe', 'shellhost.exe', 'useroobebroker.exe'
]);
const SYSTEM_FOLDERS = [/^[a-z]:\\windows\\systemapps\\/i, /^[a-z]:\\windows\\immersivecontrolpanel\\/i];
const STRENGTHS = new Set(['block', 'pause']);
const REACT_AGAIN_MS = 3000;
const MAX_RESTARTS = 3;

const fileOf = (path) => path.split(/[\\/]/).pop().toLowerCase();

function isSystemApp(path) {
  return ALWAYS_ALLOWED.has(fileOf(path)) || SYSTEM_FOLDERS.some((pattern) => pattern.test(path));
}

const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const whole = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;

// The renderer publishes the running session's preset copy. Anything malformed
// is refused, and null turns the limit off.
function validLimit(limit) {
  if (limit === null || limit === undefined) return null;
  if (typeof limit !== 'object' || !Number.isSafeInteger(limit.endAt)) return undefined;
  if (!text(limit.name, 60) || !STRENGTHS.has(limit.strength)) return undefined;
  if (!whole(limit.countdownSeconds, 5, 60) || !whole(limit.passMinutes, 1, 30)) return undefined;
  if (!(limit.nextAction === null || limit.nextAction === undefined || (typeof limit.nextAction === 'string' && limit.nextAction.length <= 160))) return undefined;
  if (!Array.isArray(limit.apps) || limit.apps.length === 0 || limit.apps.length > 30) return undefined;
  const apps = [];
  for (const app of limit.apps) {
    if (!app || !text(app.path, 260) || !/\.exe$/i.test(app.path) || !text(app.name, 80)) return undefined;
    apps.push({ path: app.path, name: app.name });
  }
  return {
    endAt: limit.endAt,
    presetId: typeof limit.presetId === 'string' ? limit.presetId.slice(0, 64) : null,
    name: limit.name,
    strength: limit.strength,
    countdownSeconds: limit.countdownSeconds,
    passMinutes: limit.passMinutes,
    nextAction: limit.nextAction ?? null,
    apps
  };
}

// 'allow', 'unknown' (the path could not be read, for example an app running as
// administrator), or the preset's strength.
function decide(limit, foreground, { ownPids, passes, now }) {
  if (!limit || limit.endAt <= now || !foreground || !foreground.hwnd) return 'allow';
  if (ownPids.has(foreground.pid)) return 'allow';
  if (typeof foreground.path !== 'string' || !foreground.path) return foreground.pid ? 'unknown' : 'allow';
  const path = foreground.path.toLowerCase();
  if (isSystemApp(path)) return 'allow';
  if (limit.apps.some((app) => app.path.toLowerCase() === path)) return 'allow';
  if ((passes.get(path) ?? 0) > now) return 'allow';
  return limit.strength;
}

const appName = (path) => {
  const file = path.split(/[\\/]/).pop();
  return file.replace(/\.exe$/i, '');
};

// startWatcher: see app-watcher.cjs. ownPids: process ids of Fix Myself.
// onIntervene(view): show the intervention. onEvent(record): an APP-09 record.
// onCoverage(coverage): { state: 'off' | 'running' | 'unavailable', partial: [names] }.
function createAppGuard({ startWatcher, ownPids = () => new Set([process.pid]), onIntervene, onEvent, onCoverage,
  now = () => Date.now() }) {
  let limit = null;
  let watcher = null;
  let restarts = 0;
  let expiry = null;
  let passes = new Map();
  let lastAction = new Map();
  let unminimizable = new Set();
  let current = null; // { path, hwnd, name, mode } of the last intervention
  let coverage = { state: 'off', partial: [] };

  const setCoverage = (next) => {
    if (JSON.stringify(next) === JSON.stringify(coverage)) return;
    coverage = next;
    onCoverage?.(coverage);
  };
  const markPartial = (name) => {
    if (coverage.partial.includes(name)) return;
    setCoverage({ ...coverage, partial: [...coverage.partial, name].slice(-10) });
  };

  function nameOf(path) {
    const chosen = limit?.apps.find((app) => app.path.toLowerCase() === path.toLowerCase());
    return chosen?.name ?? appName(path);
  }

  function handle(event) {
    if (event.type === 'minimized') {
      if (!event.ok) {
        // Windows refused (for example an app running as administrator). Stop
        // retrying that window so the dialog and the review are not flooded.
        unminimizable.add(event.hwnd);
        markPartial(current?.hwnd === event.hwnd ? current.name : '?');
      }
      return;
    }
    if (event.type !== 'foreground') return;
    const time = now();
    const verdict = decide(limit, event, { ownPids: ownPids(), passes, now: time });
    if (verdict === 'allow') return;
    if (verdict === 'unknown') {
      markPartial('?');
      return;
    }
    if (unminimizable.has(event.hwnd)) return;
    // Minimize every time the app comes back; explain and count it at most once
    // every few seconds.
    watcher?.send('min ' + event.hwnd);
    if (time - (lastAction.get(event.hwnd) ?? 0) < REACT_AGAIN_MS) return;
    lastAction.set(event.hwnd, time);
    const name = nameOf(event.path);
    current = { path: event.path, hwnd: event.hwnd, name, mode: verdict, at: time };
    onEvent?.({ kind: verdict, path: event.path, name, at: new Date(time).toISOString() });
    onIntervene?.({
      mode: verdict,
      app: name,
      path: event.path,
      preset: limit.name,
      endAt: limit.endAt,
      allowed: limit.apps.map((app) => app.name),
      nextAction: limit.nextAction,
      countdownSeconds: verdict === 'pause' ? limit.countdownSeconds : null,
      passMinutes: verdict === 'pause' ? limit.passMinutes : null
    });
  }

  function start() {
    if (watcher) return;
    try {
      watcher = startWatcher({
        onEvent: (event) => { restarts = 0; handle(event); },
        onExit: () => {
          watcher = null;
          if (!limit) return;
          restarts += 1;
          if (restarts > MAX_RESTARTS) setCoverage({ state: 'unavailable', partial: [] });
          else setTimeout(() => { if (limit) start(); }, 1000 * restarts).unref?.();
        }
      });
      setCoverage({ state: 'running', partial: coverage.partial });
    } catch {
      watcher = null;
      setCoverage({ state: 'unavailable', partial: [] });
    }
  }

  function stop() {
    watcher?.stop();
    watcher = null;
    clearTimeout(expiry);
    expiry = null;
    setCoverage({ state: 'off', partial: [] });
  }

  const api = {
    // Returns false when the limit is malformed.
    setLimit(raw) {
      const next = validLimit(raw);
      if (next === undefined) return false;
      const active = next && next.endAt > now() ? next : null;
      const same = JSON.stringify(active) === JSON.stringify(limit);
      if (same) return true;
      const sameSession = active && limit && active.endAt === limit.endAt && active.presetId === limit.presetId;
      limit = active;
      if (!sameSession) {
        passes = new Map();
        lastAction = new Map();
        unminimizable = new Set();
        current = null;
      }
      if (!limit) {
        stop();
        return true;
      }
      restarts = 0;
      start();
      clearTimeout(expiry);
      expiry = setTimeout(() => api.setLimit(null), Math.min(limit.endAt - now(), 2 ** 31 - 1));
      expiry.unref?.();
      return true;
    },
    // A pass for the app of the current Pause intervention (APP-05).
    grantPass(path, reason) {
      if (!limit || limit.strength !== 'pause' || !current || current.mode !== 'pause') return null;
      if (typeof path !== 'string' || path.toLowerCase() !== current.path.toLowerCase()) return null;
      const time = now();
      // The countdown is enforced here too, not only in the window (APP-05).
      if (time < current.at + limit.countdownSeconds * 1000 - 500) return null;
      const until = Math.min(time + limit.passMinutes * 60_000, limit.endAt);
      passes.set(path.toLowerCase(), until);
      const clean = typeof reason === 'string' ? reason.trim().slice(0, 200) : '';
      onEvent?.({ kind: 'pass', path: current.path, name: current.name, reason: clean, at: new Date(time).toISOString() });
      watcher?.send('restore ' + current.hwnd);
      current = null;
      return until;
    },
    coverage: () => coverage,
    stop() {
      limit = null;
      stop();
    }
  };
  return api;
}

module.exports = { createAppGuard, decide, isSystemApp, validLimit, ALWAYS_ALLOWED };
