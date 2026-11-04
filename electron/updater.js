'use strict';

const { app, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');
const logger = require('../src/core/logger');
const config = require('../src/core/config');
const { serialize } = require('../src/core/errors');

let getWindow = null;
let state = {
  enabled: false,
  status: 'idle',
  currentVersion: app.getVersion(),
  availableVersion: null,
  percent: 0,
  error: null,
  checkedAt: null
};

function send() {
  const win = getWindow && getWindow();
  if (win && !win.isDestroyed()) win.webContents.send('updater:status', { ...state });
}

function update(patch) {
  state = { ...state, ...patch };
  send();
  return state;
}

function handle(channel, fn) {
  ipcMain.handle(channel, async (_event, payload) => {
    try {
      return { ok: true, data: await fn(payload) };
    } catch (error) {
      return { ok: false, error: serialize(error) };
    }
  });
}

async function check() {
  if (!app.isPackaged) {
    return update({ enabled: false, status: 'disabled', error: 'Solo disponible en la versión empaquetada' });
  }
  if (state.status === 'checking' || state.status === 'downloading') return state;
  try {
    update({ status: 'checking', error: null });
    await autoUpdater.checkForUpdates();
    update({ checkedAt: new Date().toISOString() });
  } catch (error) {
    logger.warn('No se pudo comprobar actualizaciones', { error: error.message });
    update({ status: 'error', error: error.message });
  }
  return state;
}

async function download() {
  try {
    update({ status: 'downloading', percent: 0, error: null });
    await autoUpdater.downloadUpdate();
  } catch (error) {
    update({ status: 'error', error: error.message });
  }
  return state;
}

function install() {
  if (state.status !== 'downloaded') throw new Error('No hay una actualización descargada');
  setImmediate(() => autoUpdater.quitAndInstall(false, true));
  return { installing: true };
}

function init(options = {}) {
  getWindow = options.getWindow || null;
  state = { ...state, enabled: app.isPackaged, currentVersion: app.getVersion() };

  if (!app.isPackaged) {
    handle('updater:status', () => ({ ...state }));
    handle('updater:check', () => ({ ...state, status: 'disabled' }));
    handle('updater:download', () => ({ ...state, status: 'disabled' }));
    handle('updater:install', () => { throw new Error('Solo disponible en la versión empaquetada'); });
    return;
  }

  autoUpdater.logger = logger;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => update({ status: 'checking', error: null }));
  autoUpdater.on('update-available', (info) => update({ status: 'available', availableVersion: info.version, checkedAt: new Date().toISOString() }));
  autoUpdater.on('update-not-available', () => update({ status: 'up-to-date', availableVersion: null }));
  autoUpdater.on('download-progress', (progress) => update({ status: 'downloading', percent: Math.round(progress.percent || 0) }));
  autoUpdater.on('update-downloaded', (info) => update({ status: 'downloaded', availableVersion: info.version, percent: 100 }));
  autoUpdater.on('error', (error) => update({ status: 'error', error: error.message }));

  handle('updater:status', () => ({ ...state }));
  handle('updater:check', check);
  handle('updater:download', download);
  handle('updater:install', install);

  if (config.get().ui.autoUpdate !== false) {
    setTimeout(() => { check().catch(() => {}); }, 12000).unref?.();
  }
}

module.exports = { init, check, getState: () => ({ ...state }) };
