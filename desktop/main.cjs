const { app, BrowserWindow, ipcMain, Menu, nativeImage, Tray } = require('electron');
const { randomBytes } = require('node:crypto');
const { mkdir, readFile, writeFile } = require('node:fs/promises');
const { join, resolve } = require('node:path');
const { createFocusBridge, validSnapshot, MAX_PLAN_BYTES, PORT } = require('./focus-bridge.cjs');
const { listOpenApps } = require('./apps.cjs');
const { createAppGuard } = require('./app-guard.cjs');
const { startWatcher } = require('./app-watcher.cjs');

const loginFlag = '--login-launch';
const loginLaunch = process.platform === 'win32' && process.argv.includes(loginFlag);
const windowsStartup = process.platform === 'win32';
const loginItem = {
  path: process.execPath,
  args: process.defaultApp ? [resolve(process.argv[1]), loginFlag] : [loginFlag]
};
let mainWindow;
let published;
let pairingCode;
let bridge;
let tray;
let quitting = false;
let keepRunning = process.platform === 'win32';
const chromeReports = new Map();
let appGuard = null;

// Fix Myself's own windows are always allowed (APP-04). Refreshed at most every five seconds.
let ownPids = { at: 0, pids: new Set([process.pid]) };
function appPids() {
  if (Date.now() - ownPids.at > 5000) {
    ownPids = { at: Date.now(), pids: new Set([process.pid, ...app.getAppMetrics().map((metric) => metric.pid)]) };
  }
  return ownPids.pids;
}

function toRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

// Limits apps during a focus session with an app preset (APP-03 to APP-07).
function createGuard() {
  if (process.platform !== 'win32' || appGuard) return;
  appGuard = createAppGuard({
    startWatcher,
    ownPids: appPids,
    onIntervene: (view) => {
      showWindow();
      toRenderer('desktop:app-intervention', view);
    },
    onEvent: (record) => toRenderer('desktop:app-event', record),
    onCoverage: (coverage) => toRenderer('desktop:app-coverage', coverage)
  });
}

// A small "◒" mark drawn in code so the tray needs no image asset.
function trayIcon() {
  const size = 32;
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const offset = (y * size + x) * 4;
      const dx = x - 15.5;
      const dy = y - 15.5;
      const distance = Math.hypot(dx, dy);
      const corner = Math.max(Math.abs(dx) - 9, 0) ** 2 + Math.max(Math.abs(dy) - 9, 0) ** 2 <= 36;
      if (!corner) continue;
      const mint = distance <= 10 && (distance >= 7.5 || dy > 0);
      // BGRA
      pixels.set(mint ? [0xad, 0xef, 0xd7, 0xff] : [0x2f, 0x3d, 0x18, 0xff], offset);
    }
  }
  return nativeImage.createFromBitmap(pixels, { width: size, height: size });
}

function showWindow() {
  if (!mainWindow) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createTray() {
  if (process.platform !== 'win32' || tray) return;
  tray = new Tray(trayIcon());
  tray.setToolTip('Fix Myself');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Today', click: showWindow },
    { type: 'separator' },
    { label: 'Quit Fix Myself', click: () => { quitting = true; app.quit(); } }
  ]));
  tray.on('click', showWindow);
}

async function openBridge() {
  const tokenFile = join(app.getPath('userData'), 'chrome-token');
  await mkdir(app.getPath('userData'), { recursive: true });
  let token = await readFile(tokenFile, 'utf8').catch((error) => {
    if (error.code !== 'ENOENT') throw error;
    return null;
  });
  if (token === null) {
    token = randomBytes(32).toString('hex');
    await writeFile(tokenFile, token, { mode: 0o600, flag: 'wx' });
  }
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('Invalid desktop pairing file.');
  bridge = createFocusBridge(token, () => published ?? undefined,
    (report) => chromeReports.set(report.profileId, report), showWindow);
  await new Promise((resolveListen, rejectListen) => {
    bridge.once('error', rejectListen);
    bridge.listen(PORT, '127.0.0.1', resolveListen);
  });
  pairingCode = token;
}

function fromApp(event) {
  if (event.sender !== mainWindow?.webContents || event.senderFrame !== event.sender.mainFrame) {
    throw new Error('Unexpected desktop request.');
  }
}

function registerHandlers() {
  ipcMain.handle('desktop:status', (event) => {
    fromApp(event);
    const startup = windowsStartup && app.getLoginItemSettings(loginItem).openAtLogin;
    return { startup, pairingCode };
  });
  ipcMain.handle('desktop:set-startup', (event, openAtLogin) => {
    fromApp(event);
    if (!windowsStartup || typeof openAtLogin !== 'boolean') throw new Error('Windows startup is unavailable.');
    app.setLoginItemSettings({ ...loginItem, openAtLogin });
    if (app.getLoginItemSettings(loginItem).openAtLogin !== openAtLogin) {
      throw new Error('Windows did not accept the startup setting.');
    }
  });
  ipcMain.handle('desktop:chrome-reports', (event) => {
    fromApp(event);
    return [...chromeReports.values()];
  });
  ipcMain.handle('desktop:set-background', (event, enabled) => {
    fromApp(event);
    if (typeof enabled !== 'boolean') throw new Error('Invalid background setting.');
    keepRunning = enabled && process.platform === 'win32';
  });
  ipcMain.handle('desktop:show', (event) => {
    fromApp(event);
    showWindow();
  });
  if (process.platform === 'win32') {
    ipcMain.handle('desktop:list-apps', async (event) => {
      fromApp(event);
      return listOpenApps();
    });
    ipcMain.handle('desktop:app-limit', (event, limit) => {
      fromApp(event);
      if (!appGuard.setLimit(limit)) throw new Error('Invalid app limit.');
    });
    ipcMain.handle('desktop:app-pass', (event, path, reason) => {
      fromApp(event);
      const until = appGuard.grantPass(path, reason);
      if (until === null) throw new Error('This app no longer offers a pass.');
      return until;
    });
    ipcMain.handle('desktop:app-coverage', (event) => {
      fromApp(event);
      return appGuard.coverage();
    });
  }
  // The planner publishes the focus session and the rule set together. Chrome
  // keeps them, so rules outlive this window (BLK-07).
  ipcMain.handle('desktop:plan', (event, snapshot) => {
    fromApp(event);
    const clean = validSnapshot(snapshot);
    if (!clean) throw new Error('Invalid Chrome plan.');
    if (Buffer.byteLength(JSON.stringify(clean), 'utf8') > MAX_PLAN_BYTES) {
      throw new Error('The rule set is too large for Chrome.');
    }
    published = clean;
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    title: 'Fix Myself',
    width: 1060,
    height: 800,
    minWidth: 340,
    minHeight: 510,
    backgroundColor: '#f6f5ef',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      // Reminders and the Chrome session keep updating while the window is hidden.
      backgroundThrottling: false,
      additionalArguments: loginLaunch ? [loginFlag] : []
    }
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  mainWindow.on('close', (event) => {
    if (keepRunning && !quitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.loadFile(join(__dirname, '../dist/index.html')).catch(console.error);
}

// Windows shows reminder notifications under this application identity.
if (process.platform === 'win32') app.setAppUserModelId('com.fixmyself.app');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  app.whenReady().then(async () => {
    await openBridge().catch((error) => console.error('Chrome pairing unavailable:', error.message));
    createGuard();
    registerHandlers();
    createWindow();
    createTray();
  }).catch(console.error);
  app.on('window-all-closed', () => { if (!keepRunning) app.quit(); });
  app.on('before-quit', () => {
    quitting = true;
    bridge?.close();
    appGuard?.stop();
  });
}
