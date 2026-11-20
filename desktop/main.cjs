const { app, BrowserWindow, ipcMain } = require('electron');
const { randomBytes } = require('node:crypto');
const { mkdir, readFile, writeFile } = require('node:fs/promises');
const { join, resolve } = require('node:path');
const { createFocusBridge, PORT } = require('./focus-bridge.cjs');

const loginFlag = '--login-launch';
const loginLaunch = process.platform === 'win32' && process.argv.includes(loginFlag);
const windowsStartup = process.platform === 'win32';
const loginItem = {
  path: process.execPath,
  args: process.defaultApp ? [resolve(process.argv[1]), loginFlag] : [loginFlag]
};
let mainWindow;
let focus;
let pairingCode;
let bridge;

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
  bridge = createFocusBridge(token, () => focus);
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
  ipcMain.handle('desktop:focus', (event, snapshot) => {
    fromApp(event);
    if (snapshot === null) {
      focus = null;
      return;
    }
    const { endAt, domains, nextAction } = snapshot;
    if (!Number.isSafeInteger(endAt) || !Array.isArray(domains) || domains.length > 30
      || !domains.every((domain) => typeof domain === 'string' && domain.length <= 253)
      || !(nextAction === null || (typeof nextAction === 'string' && nextAction.length <= 160))) {
      throw new Error('Invalid focus session.');
    }
    focus = { endAt, domains, nextAction };
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
      additionalArguments: loginLaunch ? [loginFlag] : []
    }
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.loadFile(join(__dirname, '../dist/index.html')).catch(console.error);
}

// Windows shows reminder notifications under this application identity.
if (process.platform === 'win32') app.setAppUserModelId('com.fixmyself.app');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow?.isMinimized()) mainWindow.restore();
    mainWindow?.focus();
  });
  app.whenReady().then(async () => {
    await openBridge().catch((error) => console.error('Chrome pairing unavailable:', error.message));
    registerHandlers();
    createWindow();
  }).catch(console.error);
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => bridge?.close());
}
