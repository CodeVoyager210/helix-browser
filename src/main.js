'use strict';

const { app, BrowserWindow, ipcMain, session, shell, Menu, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');
const path = require('path');
const fs = require('fs');

// ─── Logging ────────────────────────────────────────────────────────────────
autoUpdater.logger = log;
autoUpdater.logger.transports.file.level = 'info';
log.info('Helix Browser starting...');

// ─── RAM Optimisation: Chromium command-line flags ───────────────────────────
app.commandLine.appendSwitch('process-per-site');
app.commandLine.appendSwitch('enable-features', 'NetworkServiceInProcess2');
app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling,MediaSessionService');
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=256');
app.commandLine.appendSwitch('renderer-process-limit', '8');
app.commandLine.appendSwitch('disable-renderer-backgrounding');

// Reduce GPU memory footprint
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
app.commandLine.appendSwitch('disable-gpu-program-cache');

let mainWindow = null;

// ─── Create the main window ──────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    frame: false,           // custom titlebar
    titleBarStyle: 'hidden',
    backgroundColor: '#0f0f13',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,       // we need <webview> for each tab
      spellcheck: false,      // saves ~30 MB
      sandbox: false,
    },
    icon: path.join(__dirname, '../assets/icon.png'),
    show: false,
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer/index.html'));

  // Gracefully show once ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Open external links in the OS browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Limit session disk cache to 100 MB to free RAM of mapped cache pages
  session.defaultSession.clearCache();
  session.defaultSession.setSpellCheckerLanguages([]);

  // Disable unused permissions
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowed = ['clipboard-read', 'fullscreen', 'pointerLock'];
    callback(allowed.includes(permission));
  });

  loadExtensions();
  setupAutoUpdater();
  setupMenu();
}

// ─── Extensions ──────────────────────────────────────────────────────────────
async function loadExtensions() {
  const extFile = path.join(app.getPath('userData'), 'helix-extensions.json');
  try {
    if (!fs.existsSync(extFile)) return;
    const extensions = JSON.parse(fs.readFileSync(extFile, 'utf8'));
    for (const extPath of extensions) {
      if (fs.existsSync(extPath)) {
        await session.defaultSession.loadExtension(extPath);
        log.info(`Loaded extension: ${extPath}`);
      }
    }
  } catch (e) {
    log.error('Failed to load extensions', e);
  }
}

function saveExtensions(paths) {
  const extFile = path.join(app.getPath('userData'), 'helix-extensions.json');
  fs.writeFileSync(extFile, JSON.stringify(paths));
}

function getLoadedExtensionPaths() {
  return session.defaultSession.getAllExtensions().map(e => e.path);
}

// ─── Auto-Updater ────────────────────────────────────────────────────────────
function setupAutoUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    sendUpdaterStatus('checking');
  });

  autoUpdater.on('update-available', (info) => {
    sendUpdaterStatus('available', info.version);
  });

  autoUpdater.on('update-not-available', () => {
    sendUpdaterStatus('not-available');
  });

  autoUpdater.on('download-progress', (progressObj) => {
    sendUpdaterStatus('progress', progressObj.percent);
  });

  autoUpdater.on('update-downloaded', () => {
    sendUpdaterStatus('downloaded');
  });

  autoUpdater.on('error', (err) => {
    log.error('Update error:', err);
    sendUpdaterStatus('error', err.message);
  });

  // Check for updates shortly after app is ready (give window time to paint)
  setTimeout(() => {
    try {
      autoUpdater.checkForUpdatesAndNotify();
    } catch (e) {
      log.warn('Auto-update check skipped (likely dev mode):', e.message);
    }
  }, 5000);
}

function sendUpdaterStatus(status, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('updater-status', { status, payload });
  }
}

// ─── IPC Handlers ────────────────────────────────────────────────────────────
ipcMain.handle('install-update', () => {
  autoUpdater.quitAndInstall();
});

ipcMain.handle('check-update', async () => {
  try {
    await autoUpdater.checkForUpdates();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('app-version', () => app.getVersion());

ipcMain.on('window-minimize', () => mainWindow?.minimize());
ipcMain.on('window-maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.on('window-close', () => mainWindow?.close());

ipcMain.handle('get-memory-usage', () => process.memoryUsage());

// Extension IPCs
ipcMain.handle('load-extension', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Unpacked Chrome Extension',
    properties: ['openDirectory']
  });
  if (canceled || filePaths.length === 0) return { ok: false, canceled: true };

  const extPath = filePaths[0];
  try {
    const ext = await session.defaultSession.loadExtension(extPath);
    
    // Save to persisted list
    const loadedPaths = getLoadedExtensionPaths();
    if (!loadedPaths.includes(extPath)) loadedPaths.push(extPath);
    saveExtensions(loadedPaths);

    return { ok: true, extension: { name: ext.name, version: ext.version, id: ext.id, path: ext.path } };
  } catch (e) {
    log.error('Extension load error:', e);
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('get-extensions', () => {
  return session.defaultSession.getAllExtensions().map(e => ({
    name: e.name, version: e.version, id: e.id, path: e.path
  }));
});

ipcMain.handle('remove-extension', (event, extId) => {
  try {
    const ext = session.defaultSession.getAllExtensions().find(e => e.id === extId);
    if (ext) {
      session.defaultSession.removeExtension(extId);
      const loadedPaths = getLoadedExtensionPaths();
      saveExtensions(loadedPaths);
      return { ok: true };
    }
    return { ok: false, error: 'Extension not found' };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ─── Menu (minimal — most UI is in renderer) ─────────────────────────────────
function setupMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        { label: 'New Tab', accelerator: 'CmdOrCtrl+T', click: () => mainWindow?.webContents.send('shortcut-new-tab') },
        { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: () => mainWindow?.webContents.send('shortcut-close-tab') },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => mainWindow?.webContents.send('shortcut-reload') },
        { label: 'Hard Reload', accelerator: 'CmdOrCtrl+Shift+R', click: () => mainWindow?.webContents.send('shortcut-hard-reload') },
        { type: 'separator' },
        { label: 'Toggle DevTools', accelerator: 'F12', click: () => mainWindow?.webContents.toggleDevTools() },
        { type: 'separator' },
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+=', role: 'zoomIn' },
        { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', role: 'zoomOut' },
        { label: 'Reset Zoom', accelerator: 'CmdOrCtrl+0', role: 'resetZoom' },
      ],
    },
    {
      label: 'History',
      submenu: [
        { label: 'Back', accelerator: 'Alt+Left', click: () => mainWindow?.webContents.send('shortcut-back') },
        { label: 'Forward', accelerator: 'Alt+Right', click: () => mainWindow?.webContents.send('shortcut-forward') },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ─── App lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
