'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ipcMain, dialog, shell, nativeTheme, app } = require('electron');
const config = require('../../src/core/config');
const logger = require('../../src/core/logger');
const jobs = require('../../src/core/jobs');
const inventory = require('../../src/core/inventory');
const exporter = require('../../src/core/exporter');
const importer = require('../../src/core/importer');
const api = require('../../src/core/ollama-api');
const achievements = require('../../src/core/achievements');
const conversations = require('../../src/core/conversations');
const { serialize } = require('../../src/core/errors');
const { ensureDir, inspectBasePath, normalize, expandHome } = require('../../src/core/paths');
const { formatBytes } = require('../../src/core/manifest');

function register({ getWindow }) {
  const send = (channel, payload) => {
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  };

  const handle = (channel, fn) => {
    ipcMain.handle(channel, async (event, payload) => {
      try {
        return { ok: true, data: await fn(payload, event) };
      } catch (error) {
        const serialized = serialize(error);
        logger.error(`${channel}: ${serialized.message}`, { code: serialized.code });
        return { ok: false, error: serialized };
      }
    });
  };

  const currentBase = () => inspectBasePath(config.get().ollama.basePath);

  /* ---------------- App / configuración ---------------- */

  handle('app:info', () => {
    const cfg = config.get();
    return {
      name: app.getName(),
      version: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      platform: process.platform,
      userData: app.getPath('userData'),
      portable: Boolean(process.env.PORTABLE_EXECUTABLE_DIR) && app.isPackaged,
      paths: config.paths(),
      base: inspectBasePath(cfg.ollama.basePath),
      config: cfg
    };
  });

  handle('config:get', () => config.get());
  handle('config:set', (patch) => {
    const updated = config.update(patch || {});
    logger.setLevel(updated.ui.logLevel);
    jobs.setConcurrency(updated.transfer.concurrency);
    return updated;
  });
  handle('config:reset', () => {
    const updated = config.reset();
    logger.setLevel(updated.ui.logLevel);
    jobs.setConcurrency(updated.transfer.concurrency);
    return updated;
  });
  handle('config:paths', () => ({ paths: config.paths(), base: currentBase() }));

  handle('system:theme', () => ({ dark: nativeTheme.shouldUseDarkColors }));

  handle('appearance:persist', (appearance) => {
    const safe = appearance || {};
    const next = config.setAppearance({
      theme: typeof safe.theme === 'string' ? safe.theme : config.get().appearance.theme,
      variant: ['light', 'dark', 'contrast', 'auto'].includes(safe.variant) ? safe.variant : 'auto',
      glass: Math.min(1, Math.max(0.4, Number(safe.glass) || 0.8)),
      orbs: Boolean(safe.orbs)
    });
    return next.appearance;
  });

  /* ---------------- Modelos ---------------- */

  handle('models:list', async () => {
    const cfg = config.get();
    const result = await inventory.listModels({
      basePath: cfg.ollama.basePath,
      host: cfg.ollama.host,
      timeoutMs: cfg.ollama.timeoutMs
    });
    const families = [...new Set(result.models.map((model) => model.family).filter(Boolean))];
    const registered = achievements.register({ type: 'inventory', families });
    send('achievements:state', registered.state);
    return result;
  });

  handle('models:delete', async (id) => {
    const cfg = config.get();
    if (typeof id !== 'string' || !id.trim()) throw new Error('Modelo inválido');
    const result = await inventory.deleteModel({ basePath: cfg.ollama.basePath, host: cfg.ollama.host, id });
    inventory.clearCache();
    return result;
  });

  handle('models:blobStats', () => inventory.blobStats(config.get().ollama.basePath));

  handle('models:deleteOrphans', (payload) => inventory.deleteOrphans({
    basePath: config.get().ollama.basePath,
    names: payload && Array.isArray(payload.names) ? payload.names : null,
    dryRun: Boolean(payload && payload.dryRun)
  }));

  handle('models:verify', (payload) => {
    const id = typeof payload === 'string' ? payload : payload && payload.id;
    if (!id) throw new Error('Modelo inválido');
    return inventory.verifyModel({ basePath: config.get().ollama.basePath, id });
  });

  handle('models:show', async (id) => {
    const cfg = config.get();
    return api.show(cfg.ollama.host, id, 8000);
  });

  handle('models:details', async (id) => {
    const cfg = config.get();
    const local = inventory.scanLocal(cfg.ollama.basePath);
    const model = local.find((item) => item.id === id);
    let remote = null;
    try {
      remote = await api.show(cfg.ollama.host, id, 5000);
    } catch { /* offline */ }
    return { model, remote };
  });

  /* ---------------- Exportación ---------------- */

  handle('export:start', async (payload) => {
    const cfg = config.get();
    const models = Array.isArray(payload && payload.models) ? payload.models : [];
    if (!models.length) throw new Error('Selecciona al menos un modelo');
    const destDir = normalize(expandHome(payload.destDir || cfg.transfer.destDir));
    ensureDir(destDir);
    const template = String(payload.template || cfg.transfer.nameTemplate).slice(0, 120);
    const verify = payload.verify !== false;
    config.update({ transfer: { destDir, nameTemplate: template, verify } });
    return exporter.startExport({
      basePath: cfg.ollama.basePath,
      destDir,
      models: models.map((model) => ({
        name: model.name,
        tag: model.tag,
        manifestPath: model.manifestPath,
        family: model.family,
        parameterSize: model.parameterSize,
        quantization: model.quantization
      })),
      template,
      verify,
      maxGb: cfg.transfer.maxGb
    });
  });

  handle('export:cancel', (jobId) => ({ cancelled: jobs.cancel(jobId) }));

  /* ---------------- Importación ---------------- */

  handle('import:scanFolder', async (folder) => {
    const target = normalize(expandHome(folder));
    return importer.scanFolder(target, { basePath: config.get().ollama.basePath });
  });

  handle('import:scanTar', async (file) => importer.scanTar(normalize(expandHome(file)), {
    basePath: config.get().ollama.basePath
  }));

  handle('import:start', async (payload) => {
    const cfg = config.get();
    const files = Array.isArray(payload && payload.files) ? payload.files : [];
    const conflict = ['overwrite', 'skip', 'rename'].includes(payload.conflict) ? payload.conflict : 'overwrite';
    const verify = payload.verify !== false;
    return importer.startImport({
      basePath: cfg.ollama.basePath,
      files: files.map((file) => normalize(expandHome(file))),
      conflict,
      verify
    });
  });

  handle('import:cancel', (jobId) => ({ cancelled: jobs.cancel(jobId) }));

  /* ---------------- Ollama ---------------- */

  handle('ollama:status', async (payload) => {
    const cfg = config.get();
    const host = String((payload && payload.host) || cfg.ollama.host || '').trim();
    if (!/^https?:\/\//i.test(host)) throw new Error('Host de Ollama inválido');
    const timeoutMs = Math.min(30000, Math.max(500, Number(payload && payload.timeoutMs) || cfg.ollama.timeoutMs));
    const state = await api.status({ host, timeoutMs });
    return { ...state, base: inspectBasePath(cfg.ollama.basePath), host };
  });

  handle('ollama:ps', async () => {
    const cfg = config.get();
    const models = await api.ps(cfg.ollama.host, cfg.ollama.timeoutMs);
    return models.map((model) => ({
      name: model.name || model.model,
      size: Number(model.size) || 0,
      sizeLabel: formatBytes(model.size),
      sizeVram: Number(model.size_vram) || 0,
      vramLabel: formatBytes(model.size_vram),
      expiresAt: model.expires_at || null
    }));
  });

  handle('ollama:unload', async (id) => {
    const cfg = config.get();
    if (typeof id !== 'string' || !id.trim()) throw new Error('Modelo inválido');
    let freed = 0;
    try {
      const running = await api.ps(cfg.ollama.host, cfg.ollama.timeoutMs);
      const found = running.find((model) => (model.name || model.model) === id);
      if (found) freed = Number(found.size) || 0;
    } catch { /* ignore */ }
    await api.unload(cfg.ollama.host, id, 30000);
    const registered = achievements.register({ type: 'unload', bytes: freed, models: 1 });
    send('achievements:state', registered.state);
    return { id, freed, freedLabel: formatBytes(freed), state: registered.state };
  });

  let pullController = null;
  handle('ollama:pull', async (model) => {
    const cfg = config.get();
    const name = String(model || '').trim();
    if (!name) throw new Error('Indica un modelo para descargar');
    const job = jobs.enqueue('pull', {
      meta: { model: name },
      start: async (current) => {
        pullController = new AbortController();
        let last = null;
        try {
          await api.pull({
            host: cfg.ollama.host,
            model: name,
            signal: pullController.signal,
            onProgress: (event) => {
              last = event;
              const total = Number(event.total) || 0;
              const completed = Number(event.completed) || 0;
              jobs.updateProgress(current.id, {
                phase: event.status || 'download',
                model: name,
                total,
                completed,
                percent: total ? Math.min(99, Math.round((completed / total) * 100)) : 0,
                digest: event.digest || null
              });
            }
          });
          jobs.finish(current.id, 'done', { model: name, last });
        } catch (error) {
          if (error.code === 'E_CANCELLED') jobs.finish(current.id, 'cancelled');
          else jobs.fail(current.id, error);
        } finally {
          pullController = null;
        }
      },
      cancel: () => {
        if (pullController) pullController.abort();
      }
    });
    return { jobId: job.id, model: name, queued: job.status === 'queued' };
  });
  handle('ollama:cancelPull', () => {
    const active = jobs.active('pull');
    if (!active.length) return { cancelled: false };
    for (const job of active) jobs.cancel(job.id);
    return { cancelled: true };
  });

  /* ---------------- Chat ---------------- */

  const chatController = { current: null, streamId: null };

  handle('chat:send', (payload, event) => {
    if (chatController.current) throw new Error('Ya hay una respuesta en curso');
    const cfg = config.get();
    const model = String((payload && payload.model) || '').trim();
    const messages = Array.isArray(payload && payload.messages) ? payload.messages : [];
    if (!model) throw new Error('Selecciona un modelo');
    if (!messages.length) throw new Error('El mensaje está vacío');
    const streamId = `chat-${Date.now()}`;
    const controller = new AbortController();
    chatController.current = controller;
    chatController.streamId = streamId;
    const sender = event.sender;

    const emit = (channel, data) => {
      if (!sender.isDestroyed()) sender.send(channel, data);
    };

    void (async () => {
      try {
        const stats = await api.chat({
          host: cfg.ollama.host,
          model,
          messages: messages.map((message) => ({ role: message.role, content: message.content })),
          options: {
            temperature: Number(cfg.chat.temperature),
            num_ctx: Number(cfg.chat.num_ctx),
            top_p: Number(cfg.chat.top_p),
            ...(Number(cfg.chat.numPredict) > 0 ? { num_predict: Number(cfg.chat.numPredict) } : {})
          },
          keepAlive: cfg.chat.keepAlive,
          signal: controller.signal,
          onChunk: (delta) => emit('chat:chunk', { streamId, delta })
        });
        emit('chat:done', { streamId, stats });
        const registered = achievements.register({ type: 'chat', models: 0, bytes: 0 });
        send('achievements:state', registered.state);
      } catch (error) {
        const serialized = serialize(error);
        emit('chat:error', { streamId, error: serialized });
      } finally {
        if (chatController.streamId === streamId) chatController.current = null;
      }
    })();

    return { streamId };
  });

  handle('chat:cancel', () => {
    if (chatController.current) chatController.current.abort();
    return { cancelled: Boolean(chatController.current) };
  });

  handle('chat:list', () => conversations.list());
  handle('chat:get', (id) => conversations.get(id));
  handle('chat:save', (conversation) => conversations.save(conversation || {}));
  handle('chat:remove', (id) => conversations.remove(id));

  /* ---------------- Logros ---------------- */

  handle('achievements:get', () => achievements.snapshot());
  handle('achievements:reset', () => achievements.reset());

  /* ---------------- Diálogos / shell ---------------- */

  handle('dialog:pickFolder', async (options) => {
    const win = getWindow();
    const result = await dialog.showOpenDialog(win, {
      title: (options && options.title) || 'Seleccionar carpeta',
      defaultPath: options && options.defaultPath ? expandHome(options.defaultPath) : undefined,
      properties: ['openDirectory', 'createDirectory']
    });
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
  });

  handle('dialog:pickTarFiles', async () => {
    const win = getWindow();
    const result = await dialog.showOpenDialog(win, {
      title: 'Seleccionar paquetes de modelos',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Paquetes OllamaNeitor', extensions: ['tar'] }]
    });
    if (result.canceled) return [];
    return result.filePaths;
  });

  const assertExists = (target) => {
    const value = normalize(expandHome(target));
    if (!fs.existsSync(value)) throw new Error(`La ruta no existe: ${value}`);
    return value;
  };

  handle('shell:openPath', async (target) => {
    const value = assertExists(target);
    const error = await shell.openPath(value);
    if (error) throw new Error(error);
    return { opened: value };
  });

  handle('shell:showItem', (target) => {
    shell.showItemInFolder(assertExists(target));
    return { ok: true };
  });

  handle('shell:openExternal', async (url) => {
    const value = String(url || '');
    if (!/^https:\/\//i.test(value)) throw new Error('Solo se permiten enlaces HTTPS');
    await shell.openExternal(value);
    return { ok: true };
  });

  /* ---------------- Logs ---------------- */

  handle('log:list', () => logger.buffer);
  handle('log:openFolder', async () => {
    const dir = config.paths().logs;
    fs.mkdirSync(dir, { recursive: true });
    await shell.openPath(dir);
    return { dir };
  });

  /* ---------------- Ventana ---------------- */

  ipcMain.on('window:minimize', () => getWindow()?.minimize());
  ipcMain.on('window:maximize', () => {
    const win = getWindow();
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  ipcMain.on('window:close', () => getWindow()?.close());

  handle('window:isMaximized', () => ({ maximized: Boolean(getWindow()?.isMaximized()) }));

  handle('window:setBackground', (color) => {
    const value = String(color || '');
    if (!/^#[0-9a-fA-F]{6}$/.test(value)) throw new Error('Color inválido');
    const win = getWindow();
    if (win) win.setBackgroundColor(value);
    return { color: value };
  });

  handle('window:setAcrylic', (enabled) => {
    const win = getWindow();
    let applied = false;
    if (win && process.platform === 'win32' && typeof win.setBackgroundMaterial === 'function') {
      try {
        win.setBackgroundMaterial(enabled ? 'acrylic' : 'none');
        applied = true;
        config.update({ ui: { acrylic: Boolean(enabled) } });
      } catch {
        applied = false;
      }
    }
    return { applied, enabled: Boolean(enabled) };
  });

  /* ---------------- Trabajos ---------------- */

  handle('jobs:list', (payload) => jobs.list({ limit: (payload && payload.limit) || 50 }));
  handle('jobs:get', (id) => jobs.getPublic(id));
  handle('jobs:cancel', (id) => ({ cancelled: jobs.cancel(id) }));
  handle('jobs:clearHistory', () => jobs.clearHistory());

  /* ---------------- Eventos de trabajos y logros ---------------- */

  jobs.on('progress', (payload) => {
    send('jobs:progress', payload);
    send('transfer:progress', payload);
  });
  jobs.on('changed', (list) => send('jobs:changed', list));
  jobs.on('finished', (job) => send('jobs:finished', job));
  jobs.on('error', (payload) => send('transfer:error', payload));
  jobs.on('cancelled', (payload) => send('transfer:cancelled', payload));

  jobs.on('result', (payload) => {
    send('transfer:result', payload);
    const job = jobs.get(payload.jobId);
    const results = Array.isArray(payload.results) ? payload.results : [];
    const successful = results.filter((result) => result.ok && !result.skipped);
    const failed = results.filter((result) => !result.ok);
    const corrupted = failed.filter((result) => (
      result.error && ['E_DIGEST_MISMATCH', 'E_CONFLICT'].includes(result.error.code)
    )).length;
    if (corrupted) {
      const registered = achievements.register({ type: 'corruption', count: corrupted });
      send('achievements:state', registered.state);
    }
    if (!job || !successful.length) return;
    const bytes = successful.reduce((sum, result) => sum + (Number(result.bytes) || 0), 0);
    const verified = successful.every((result) => result.verified) && corrupted === 0;
    const type = job.type === 'export' ? 'export' : 'import';
    const registered = achievements.register({
      type,
      models: successful.length,
      bytes,
      verified,
      corrupted
    });
    send('achievements:state', registered.state);
  });

  achievements.on('unlocked', ({ trophy, state }) => {
    send('achievements:unlocked', { trophy, state });
  });

  logger.on('log', (entry) => send('log:event', entry));

  return {
    broadcast: send,
    chatController
  };
}

module.exports = { register };
