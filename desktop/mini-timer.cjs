const { mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const WIDTH = 240;
const HEIGHT = 72;
const INSET = 16;

// Accepts the renderer's view and returns a clean copy, or null (FOC-12).
function validMiniView(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const keys = Object.keys(value);
  if (value.show === false) return keys.length === 1 ? { show: false } : null;
  if (value.show !== true) return null;
  const allowed = ['show', 'endAt', 'label', 'status', 'clickThrough'];
  if (keys.some((key) => !allowed.includes(key)) || keys.length !== allowed.length) return null;
  const { endAt, label, status, clickThrough } = value;
  if (!Number.isSafeInteger(endAt)) return null;
  if (typeof label !== 'string' || label.length < 1 || label.length > 160) return null;
  if (typeof status !== 'string' || status.length > 40) return null;
  if (typeof clickThrough !== 'boolean') return null;
  return { show: true, endAt, label, status, clickThrough };
}

// Keeps a saved position when the whole window fits in one work area; otherwise the
// top-right corner of the first work area.
function placeWindow(saved, workAreas, size = { width: WIDTH, height: HEIGHT }) {
  if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
    const inside = workAreas.some((area) => saved.x >= area.x && saved.y >= area.y
      && saved.x + size.width <= area.x + area.width && saved.y + size.height <= area.y + area.height);
    if (inside) return saved;
  }
  const first = workAreas[0] ?? { x: 0, y: 0, width: 1280, height: 720 };
  return { x: first.x + first.width - size.width - INSET, y: first.y + INSET };
}

function createMiniTimer({ BrowserWindow, screen, userDataPath, preloadPath, htmlPath }) {
  const positionFile = join(userDataPath, 'mini-timer.json');
  let win = null;
  let lastSave = 0;
  let pendingSave = null;

  const readSaved = () => {
    try {
      const data = JSON.parse(readFileSync(positionFile, 'utf8'));
      return Number.isFinite(data?.x) && Number.isFinite(data?.y) ? { x: data.x, y: data.y } : null;
    } catch {
      return null;
    }
  };
  const save = () => {
    pendingSave = null;
    lastSave = Date.now();
    if (!win || win.isDestroyed()) return;
    const [x, y] = win.getPosition();
    try {
      mkdirSync(userDataPath, { recursive: true });
      writeFileSync(positionFile, JSON.stringify({ x, y }));
    } catch (error) {
      console.error('Floating timer position not saved:', error.message);
    }
  };
  const scheduleSave = () => {
    if (pendingSave) return;
    const wait = Math.max(0, 1000 - (Date.now() - lastSave));
    pendingSave = setTimeout(save, wait);
  };

  function create() {
    const position = placeWindow(readSaved(), screen.getAllDisplays().map((display) => display.workArea),
      { width: WIDTH, height: HEIGHT });
    win = new BrowserWindow({
      x: position.x,
      y: position.y,
      width: WIDTH,
      height: HEIGHT,
      frame: false,
      resizable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      show: false,
      title: 'Fix Myself timer',
      backgroundColor: '#183d2f',
      webPreferences: { preload: preloadPath, sandbox: true, contextIsolation: true, nodeIntegration: false }
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event) => event.preventDefault());
    win.on('moved', scheduleSave);
    win.on('closed', () => { win = null; });
    win.loadFile(htmlPath).catch(console.error);
  }

  function send(view) {
    const message = { endAt: view.endAt, label: view.label, status: view.status };
    if (win.webContents.isLoading()) win.webContents.once('did-finish-load', () => {
      if (win && !win.isDestroyed()) win.webContents.send('mini:view', message);
    });
    else win.webContents.send('mini:view', message);
  }

  return {
    apply(view) {
      if (!view.show) {
        if (win && !win.isDestroyed()) win.hide();
        return;
      }
      if (!win || win.isDestroyed()) create();
      win.setIgnoreMouseEvents(view.clickThrough, { forward: true });
      send(view);
      if (!win.isVisible()) win.showInactive();
    },
    destroy() {
      if (pendingSave) clearTimeout(pendingSave);
      pendingSave = null;
      if (win && !win.isDestroyed()) win.destroy();
      win = null;
    }
  };
}

module.exports = { validMiniView, placeWindow, createMiniTimer, WIDTH, HEIGHT };
