'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('browserAPI', {
  // Window controls
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),

  // App info
  getVersion: () => ipcRenderer.invoke('app-version'),
  getMemoryUsage: () => ipcRenderer.invoke('get-memory-usage'),

  // Auto-updater
  onUpdaterStatus: (cb) => ipcRenderer.on('updater-status', (_, data) => cb(data)),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  checkUpdate: () => ipcRenderer.invoke('check-update'),

  // Extensions
  loadExtension: () => ipcRenderer.invoke('load-extension'),
  getExtensions: () => ipcRenderer.invoke('get-extensions'),
  removeExtension: (id) => ipcRenderer.invoke('remove-extension', id),

  // Keyboard shortcuts → renderer handles them
  onShortcut: (cb) => {
    const shortcuts = [
      'shortcut-new-tab',
      'shortcut-close-tab',
      'shortcut-reload',
      'shortcut-hard-reload',
      'shortcut-back',
      'shortcut-forward',
    ];
    shortcuts.forEach((ch) => ipcRenderer.on(ch, () => cb(ch)));
  },
});
