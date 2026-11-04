'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ipcMain, dialog, shell, nativeTheme, app, Notification } = require('electron');
const config = require('../../src/core/config');
const logger = require('../../src/core/logger');
const jobs = require('../../src/core/jobs');
const inventory = require('../../src/core/inventory');
const exporter = require('../../src/core/exporter');
const importer = require('../../src/core/importer');
const api = require('../../src/core/ollama-api');
const achievements = require('../../src/core/achievements');
const conversations = require('../../src/core/conversations');
const backup = require('../../src/core/backup');
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

  /* ---------------- Backup / restore ---------------- */

  handle('backup:create', async (payload) => {
    const file = payload && payload.file;
    if (!file) throw new Error('Indica el archivo de backup');
    const target = normalize(expandHome(file));
    const result = await backup.createBackup({
      userDataDir: config.paths().root,
      file: target,
      appVersion: app.getVersion()
    });
    logger.info('Backup creado', { file: target, size: result.size });
    return result;
  });

  handle('backup:list', () => backup.listBackups(config.paths().root));

  handle('backup:restore', async (payload) => {
    const file = payload && payload.file;
    if (!file) throw new Error('Indica el archivo de backup');
    const userDataDir = config.paths().root;
    const prepared = await backup.prepareRestore({ userDataDir, file: normalize(expandHome(file)) });
    try {
      const staging = prepared.stagingDir;
      const restored = { config: false, achievements: false, conversations: false };

      const configFile = path.join(staging, 'config.json');
      if (fs.existsSync(configFile)) {
        const data = JSON.parse(fs.readFileSync(configFile, 'utf8'));
        config.replace(data);
        logger.setLevel(config.get().ui.logLevel);
        jobs.setConcurrency(config.get().transfer.concurrency);
        restored.config = true;
      }

      const achievementsFile = path.join(staging, 'achievements.json');
      if (fs.existsSync(achievementsFile)) {
        fs.copyFileSync(achievementsFile, path.join(userDataDir, 'achievements.json'));
        achievements.init(userDataDir);
        restored.achievements = true;
      }

      const conversationsDir = path.join(staging, 'conversations');
      if (fs.existsSync(conversationsDir)) {
        const target = path.join(userDataDir, 'conversations');
        fs.rmSync(target, { recursive: true, force: true });
        fs.cpSync(conversationsDir, target, { recursive: true });
        conversations.init(target);
        restored.conversations = true;
      }

      logger.info('Backup restaurado', { file, ...restored, preRestore: prepared.preRestore });
      return { ...restored, requiresReload: true, preRestore: prepared.preRestore, manifest: prepared.manifest };
    } finally {
      backup.cleanup(prepared.stagingDir);
    }
  });

  handle('backup:openFolder', async () => {
    const dir = path.join(config.paths().root, 'backups');
    ensureDir(dir);
    await shell.openPath(dir);
    return { dir };
  });

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
    const compression = payload.compression === 'gzip' ? 'gzip' : 'none';
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
      maxGb: cfg.transfer.maxGb,
      compression
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

  handle('ollama:pullMany', (models) => {
    const cfg = config.get();
    const list = Array.isArray(models) ? models.map((model) => String(model).trim()).filter(Boolean) : [];
    if (!list.length) throw new Error('Indica al menos un modelo');
    let controller = null;
    const job = jobs.enqueue('pull-many', {
      meta: { models: list },
      start: async (current) => {
        controller = new AbortController();
        const results = [];
        try {
          for (let index = 0; index < list.length; index += 1) {
            const name = list[index];
            jobs.updateProgress(current.id, {
              phase: 'download', model: name, taskIndex: index + 1, taskCount: list.length,
              percent: Math.round((index / list.length) * 100)
            });
            try {
              await api.pull({
                host: cfg.ollama.host,
                model: name,
                signal: controller.signal,
                onProgress: (event) => {
                  const total = Number(event.total) || 0;
                  const completed = Number(event.completed) || 0;
                  const within = total ? (completed / total) : 0;
                  jobs.updateProgress(current.id, {
                    phase: event.status || 'download',
                    model: name,
                    taskIndex: index + 1,
                    taskCount: list.length,
                    percent: Math.min(99, Math.round(((index + within) / list.length) * 100))
                  });
                }
              });
              results.push({ model: name, ok: true });
            } catch (error) {
              if (error.code === 'E_CANCELLED') throw error;
              results.push({ model: name, ok: false, error: { code: error.code, message: error.message } });
            }
          }
          const failed = results.filter((result) => !result.ok);
          jobs.finish(current.id, failed.length ? 'partial' : 'done', { results });
        } catch (error) {
          if (error.code === 'E_CANCELLED') jobs.finish(current.id, 'cancelled');
          else jobs.fail(current.id, error);
        }
      },
      cancel: () => { if (controller) controller.abort(); }
    });
    return { jobId: job.id, count: list.length };
  });

  handle('ollama:copy', async (payload) => {
    const cfg = config.get();
    const source = String((payload && payload.source) || '').trim();
    const destination = String((payload && payload.destination) || '').trim();
    if (!source || !destination) throw new Error('Indica origen y destino');
    if (source === destination) throw new Error('El origen y el destino son iguales');
    await api.copy(cfg.ollama.host, source, destination, 60000);
    return { source, destination };
  });

  handle('ollama:push', (model) => {
    const cfg = config.get();
    const name = String(model || '').trim();
    if (!name) throw new Error('Indica un modelo');
    let controller = null;
    const job = jobs.enqueue('push', {
      meta: { model: name },
      start: async (current) => {
        controller = new AbortController();
        try {
          await api.push({
            host: cfg.ollama.host,
            model: name,
            signal: controller.signal,
            onProgress: (event) => {
              const total = Number(event.total) || 0;
              const completed = Number(event.completed) || 0;
              jobs.updateProgress(current.id, {
                phase: event.status || 'push',
                percent: total ? Math.min(99, Math.round((completed / total) * 100)) : 0
              });
            }
          });
          jobs.finish(current.id, 'done', { model: name });
        } catch (error) {
          if (error.code === 'E_CANCELLED') jobs.finish(current.id, 'cancelled');
          else jobs.fail(current.id, error);
        }
      },
      cancel: () => { if (controller) controller.abort(); }
    });
    return { jobId: job.id, model: name };
  });

  handle('ollama:create', (payload) => {
    const cfg = config.get();
    const model = String((payload && payload.model) || '').trim();
    const file = String((payload && payload.file) || '').trim();
    if (!model || !file) throw new Error('Indica el nombre del modelo y el Modelfile');
    const target = normalize(expandHome(file));
    const stat = fs.statSync(target);
    if (!stat.isFile() || stat.size > 5 * 1024 * 1024) throw new Error('Modelfile inválido o demasiado grande');
    const modelfile = fs.readFileSync(target, 'utf8');
    let controller = null;
    const job = jobs.enqueue('create', {
      meta: { model },
      start: async (current) => {
        controller = new AbortController();
        try {
          await api.create({
            host: cfg.ollama.host,
            model,
            modelfile,
            signal: controller.signal,
            onProgress: (event) => {
              jobs.updateProgress(current.id, { phase: event.status || 'create', percent: Number(event.percent) || 0 });
            }
          });
          jobs.finish(current.id, 'done', { model });
        } catch (error) {
          if (error.code === 'E_CANCELLED') jobs.finish(current.id, 'cancelled');
          else jobs.fail(current.id, error);
        }
      },
      cancel: () => { if (controller) controller.abort(); }
    });
    return { jobId: job.id, model };
  });

  handle('ollama:deleteMany', (ids) => {
    const cfg = config.get();
    const list = Array.isArray(ids) ? ids.filter(Boolean) : [];
    if (!list.length) throw new Error('Selecciona al menos un modelo');
    const job = jobs.enqueue('delete', {
      meta: { models: list },
      start: async (current) => {
        const results = [];
        for (let index = 0; index < list.length; index += 1) {
          const id = list[index];
          try {
            await api.remove(cfg.ollama.host, id, 15000);
            results.push({ model: id, ok: true });
          } catch (error) {
            results.push({ model: id, ok: false, error: { code: error.code, message: error.message } });
          }
          jobs.updateProgress(current.id, {
            phase: 'delete', model: id,
            percent: Math.round(((index + 1) / list.length) * 100),
            taskIndex: index + 1, taskCount: list.length
          });
        }
        const failed = results.filter((result) => !result.ok);
        jobs.finish(current.id, failed.length ? 'partial' : 'done', { results });
      }
    });
    return { jobId: job.id, count: list.length };
  });

  handle('ollama:unloadMany', async (ids) => {
    const cfg = config.get();
    const list = Array.isArray(ids) ? ids.filter(Boolean) : [];
    if (!list.length) throw new Error('Selecciona al menos un modelo');
    let freed = 0;
    let unloaded = 0;
    try {
      const running = await api.ps(cfg.ollama.host, cfg.ollama.timeoutMs);
      for (const id of list) {
        const found = running.find((model) => (model.name || model.model) === id);
        await api.unload(cfg.ollama.host, id, 30000);
        unloaded += 1;
        freed += found ? Number(found.size) || 0 : 0;
      }
    } catch (error) {
      if (!unloaded) throw error;
    }
    const registered = achievements.register({ type: 'unload', bytes: freed, models: unloaded });
    send('achievements:state', registered.state);
    return { unloaded, freed, freedLabel: formatBytes(freed), state: registered.state };
  });

  /* ---------------- Chat ---------------- */

  const chatController = { current: null, streamId: null };
  const capabilityCache = new Map();

  handle('chat:capabilities', async (model) => {
    const cfg = config.get();
    const name = String(model || '').trim();
    if (!name) throw new Error('Modelo inválido');
    const key = `${cfg.ollama.host}|${name}`;
    const cached = capabilityCache.get(key);
    if (cached && Date.now() - cached.at < 5 * 60 * 1000) return cached.value;
    try {
      const info = await api.show(cfg.ollama.host, name, 8000);
      const capabilities = Array.isArray(info.capabilities) ? info.capabilities : [];
      const families = (info.details && Array.isArray(info.details.families)) ? info.details.families : [];
      const vision = capabilities.includes('vision')
        || families.some((family) => ['clip', 'mllama', 'llava'].includes(String(family).toLowerCase()));
      const value = { model: name, vision, capabilities, families };
      capabilityCache.set(key, { at: Date.now(), value });
      return value;
    } catch (error) {
      return { model: name, vision: false, capabilities: [], families: [], error: error.message };
    }
  });

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
          messages: messages.map((message) => ({
            role: message.role,
            content: message.content,
            ...(Array.isArray(message.images) && message.images.length
              ? { images: message.images.filter((image) => typeof image === 'string').slice(0, 4) }
              : {})
          })),
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
      filters: [
        { name: 'Paquetes OllamaNeitor', extensions: ['tar', 'gz', 'tgz'] },
        { name: 'Todos los archivos', extensions: ['*'] }
      ]
    });
    if (result.canceled) return [];
    return result.filePaths;
  });

  handle('dialog:saveFile', async (options) => {
    const win = getWindow();
    const result = await dialog.showSaveDialog(win, {
      title: (options && options.title) || 'Guardar archivo',
      defaultPath: options && options.defaultPath ? expandHome(options.defaultPath) : undefined,
      filters: options && Array.isArray(options.filters) ? options.filters : undefined
    });
    if (result.canceled || !result.filePath) return null;
    return result.filePath;
  });

  handle('dialog:pickBackup', async () => {
    const win = getWindow();
    const result = await dialog.showOpenDialog(win, {
      title: 'Seleccionar backup de OllamaNeitor',
      properties: ['openFile'],
      filters: [{ name: 'Backup OllamaNeitor', extensions: ['gz', 'tgz'] }]
    });
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
  });

  handle('dialog:pickFile', async (options) => {
    const win = getWindow();
    const result = await dialog.showOpenDialog(win, {
      title: (options && options.title) || 'Seleccionar archivo',
      properties: ['openFile'],
      filters: options && Array.isArray(options.filters) ? options.filters : undefined
    });
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
  });

  handle('dialog:pickImages', async () => {
    const win = getWindow();
    const result = await dialog.showOpenDialog(win, {
      title: 'Seleccionar imágenes',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Imágenes', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }]
    });
    if (result.canceled) return [];
    return result.filePaths;
  });

  handle('files:readBase64', (paths) => {
    const list = Array.isArray(paths) ? paths.slice(0, 4) : [];
    const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };
    return list.map((file) => {
      const target = normalize(expandHome(file));
      const ext = path.extname(target).toLowerCase();
      if (!mime[ext]) throw new Error(`Formato de imagen no permitido: ${ext}`);
      const stat = fs.statSync(target);
      if (!stat.isFile() || stat.size > 20 * 1024 * 1024) throw new Error('La imagen supera 20 MB o no es válida');
      return {
        name: path.basename(target),
        mime: mime[ext],
        size: stat.size,
        data: fs.readFileSync(target).toString('base64')
      };
    });
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

  handle('jobs:retry', async (id) => {
    const job = jobs.get(id);
    if (!job) throw new Error('Trabajo no encontrado');
    if (['queued', 'running', 'cancelling'].includes(job.status)) throw new Error('El trabajo sigue activo');
    const cfg = config.get();
    if (job.type === 'export') {
      return exporter.startExport({
        basePath: cfg.ollama.basePath,
        destDir: job.meta.destDir,
        models: job.meta.models || [],
        template: job.meta.template || cfg.transfer.nameTemplate,
        verify: job.meta.verify !== false,
        maxGb: cfg.transfer.maxGb,
        compression: job.meta.compression || 'none'
      });
    }
    if (job.type === 'import') {
      return importer.startImport({
        basePath: cfg.ollama.basePath,
        files: job.meta.files || [],
        conflict: job.meta.conflict || 'overwrite',
        verify: job.meta.verify !== false
      });
    }
    throw new Error(`Reintento no soportado para ${job.type}`);
  });

  /* ---------------- Eventos de trabajos y logros ---------------- */

  jobs.on('progress', (payload) => {
    send('jobs:progress', payload);
    send('transfer:progress', payload);
  });
  jobs.on('changed', (list) => send('jobs:changed', list));
  jobs.on('finished', (job) => {
    send('jobs:finished', job);
    try {
      const win = getWindow();
      const focused = win && !win.isDestroyed() && win.isFocused();
      if (config.get().ui.notifications !== false && !focused && Notification.isSupported()) {
        const label = job.type === 'export' ? 'Exportación' : job.type === 'import' ? 'Importación' : 'Descarga';
        const result = job.status === 'done' ? 'completada' : job.status === 'partial' ? 'completada con incidencias' : job.status === 'cancelled' ? 'cancelada' : 'fallida';
        new Notification({
          title: `OllamaNeitor · ${label} ${result}`,
          body: job.error && job.error.message ? job.error.message : (job.meta && job.meta.model ? job.meta.model : 'Abre la aplicación para ver el resultado.')
        }).show();
      }
    } catch { /* ignore */ }
  });
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
