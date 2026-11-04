'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  app, BrowserWindow, protocol, ipcMain, shell, nativeTheme, Menu, session
} = require('electron');
const config = require('../src/core/config');
const logger = require('../src/core/logger');
const jobs = require('../src/core/jobs');
const achievements = require('../src/core/achievements');
const conversations = require('../src/core/conversations');
const { ensureDir } = require('../src/core/paths');
const { register } = require('./ipc');

app.setName('OllamaNeitor');
app.setAppUserModelId('com.neitor.ollamaneitor');

// Aísla los datos de la alfa v0 de versiones anteriores (V1–V3 usaban %APPDATA%\ollamaNeitor).
const USER_DATA_DIR = path.join(app.getPath('appData'), 'Neitor', 'OllamaNeitor');
app.setPath('userData', USER_DATA_DIR);

const DEV = process.argv.includes('--dev');
const RENDERER_ROOT = path.resolve(__dirname, '..', 'src', 'renderer');
const START_URL = 'app://neitor/index.html';

let mainWindow = null;
let ipcApi = null;

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true
    }
  }
]);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.map': 'application/json; charset=utf-8'
};

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "media-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "worker-src 'self' blob:",
  "frame-ancestors 'none'"
].join('; ');

function handleAppProtocol() {
  protocol.handle('app', async (request) => {
    try {
      const url = new URL(request.url);
      let pathname = decodeURIComponent(url.pathname || '/');
      if (pathname === '/' || pathname === '') pathname = '/index.html';
      const relative = pathname.replace(/^\/+/, '');
      const target = path.resolve(RENDERER_ROOT, relative);
      const rel = path.relative(RENDERER_ROOT, target);
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        return new Response('Forbidden', { status: 403 });
      }
      const data = await fs.promises.readFile(target);
      const ext = path.extname(target).toLowerCase();
      const headers = {
        'content-type': MIME[ext] || 'application/octet-stream',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff'
      };
      if (ext === '.html') headers['content-security-policy'] = CSP;
      return new Response(data, { status: 200, headers });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

function loadWindowState() {
  const stored = (config.get().ui && config.get().ui.window) || null;
  if (stored && Number.isFinite(stored.width) && Number.isFinite(stored.height)) {
    return {
      width: Math.max(1024, stored.width),
      height: Math.max(680, stored.height),
      x: Number.isFinite(stored.x) ? stored.x : undefined,
      y: Number.isFinite(stored.y) ? stored.y : undefined,
      maximized: Boolean(stored.maximized)
    };
  }
  return { width: 1320, height: 880, maximized: false };
}

function createWindow() {
  const state = loadWindowState();
  const win = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    frame: false,
    roundedCorners: true,
    backgroundColor: '#060a14',
    title: 'OllamaNeitor',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      devTools: true
    }
  });

  mainWindow = win;
  win.setMenu(null);
  win.loadURL(START_URL);

  win.once('ready-to-show', () => {
    if (state.maximized) win.maximize();
    win.show();
  });

  const sendMaximized = () => {
    if (!win.isDestroyed()) win.webContents.send('window:maximized', { maximized: win.isMaximized() });
  };
  win.on('maximize', sendMaximized);
  win.on('unmaximize', sendMaximized);
  win.on('enter-full-screen', sendMaximized);
  win.on('leave-full-screen', sendMaximized);

  win.on('close', () => {
    try {
      const bounds = win.getNormalBounds();
      config.update({
        ui: {
          window: {
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height,
            maximized: win.isMaximized()
          }
        }
      });
    } catch { /* ignore */ }
  });

  win.on('closed', () => {
    mainWindow = null;
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('app://neitor/')) event.preventDefault();
  });

  win.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));

  win.webContents.on('before-input-event', (_event, input) => {
    if (!DEV) return;
    if (input.type === 'keyDown' && input.key === 'F12') {
      win.webContents.toggleDevTools();
    }
    if (input.type === 'keyDown' && input.control && input.shift && input.key.toLowerCase() === 'i') {
      win.webContents.toggleDevTools();
    }
  });

  win.webContents.on('console-message', (...args) => {
    try {
      const details = args[1] && typeof args[1] === 'object'
        ? args[1]
        : { level: args[1], message: args[2], lineNumber: args[3], sourceId: args[4] };
      logger.info(`[renderer] ${details.message}`, {
        level: details.level,
        line: details.lineNumber,
        source: details.sourceId ? path.basename(String(details.sourceId)) : undefined
      });
    } catch { /* ignore */ }
  });

  win.webContents.on('did-fail-load', (_event, code, description, url) => {
    logger.error('Fallo de carga del renderer', { code, description, url });
  });

  win.webContents.on('render-process-gone', (_event, details) => {
    logger.error('El proceso del renderer terminó', details);
  });

  if (DEV) win.webContents.openDevTools({ mode: 'detach' });

  try {
    if (process.platform === 'win32' && typeof win.setBackgroundMaterial === 'function' && config.get().ui.acrylic) {
      win.setBackgroundMaterial('acrylic');
    }
  } catch { /* opcional */ }

  return win;
}

async function bootstrap() {
  const userData = app.getPath('userData');
  config.init(userData);
  logger.init(config.paths().logs, config.get().ui.logLevel);
  achievements.init(userData);
  conversations.init(config.paths().conversations);
  ensureDir(config.paths().temp);

  handleAppProtocol();
  Menu.setApplicationMenu(null);
  nativeTheme.themeSource = 'system';

  ipcApi = register({ getWindow: () => mainWindow });
  createWindow();

  nativeTheme.on('updated', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('system:theme', { dark: nativeTheme.shouldUseDarkColors });
    }
  });

  logger.info('OllamaNeitor iniciado', {
    version: app.getVersion(),
    electron: process.versions.electron,
    platform: process.platform,
    userData
  });

  if (DEV) {
    logger.info('Modo desarrollo activo', { renderer: RENDERER_ROOT });
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady()
    .then(bootstrap)
    .catch((error) => {
      try {
        logger.error('Fallo al iniciar la aplicación', { error: error.message, stack: error.stack });
      } catch { /* ignore */ }
      app.quit();
    });
}

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  jobs.cancelAll();
});

app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (event) => event.preventDefault());
});

process.on('uncaughtException', (error) => {
  try {
    logger.error('Excepción no controlada', { error: error.message, stack: error.stack });
  } catch { /* ignore */ }
});

process.on('unhandledRejection', (reason) => {
  try {
    logger.error('Promesa rechazada sin manejar', { reason: String(reason) });
  } catch { /* ignore */ }
});
