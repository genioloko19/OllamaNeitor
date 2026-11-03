'use strict';

const fs = require('node:fs');
const path = require('node:path');
const tar = require('tar');
const { Worker } = require('node:worker_threads');
const { randomUUID } = require('node:crypto');
const jobs = require('./jobs');
const logger = require('./logger');
const { fail, serialize } = require('./errors');
const { inspectBasePath, ensureDir } = require('./paths');
const { readManifest, digestToBlobName, digestsOf, formatBytes, identityFromManifestPath } = require('./manifest');

const WORKER = path.join(__dirname, '..', '..', 'electron', 'workers', 'import.worker.js');

function normalizeEntryPath(value) {
  return String(value || '').replace(/\\/g, '/');
}

function isSafeEntry(entryPath) {
  const normalized = normalizeEntryPath(entryPath);
  if (!normalized || normalized.startsWith('/')) return false;
  if (/^[a-zA-Z]:/.test(normalized)) return false;
  const parts = normalized.split('/').filter(Boolean);
  if (parts.includes('..')) return false;
  return normalized.startsWith('manifests/') || normalized.startsWith('blobs/') || normalized === 'neitor.json';
}

function identityFromTarPath(entryPath) {
  const normalized = normalizeEntryPath(entryPath);
  const rel = normalized.split('/').filter(Boolean);
  // ["manifests", "<registry>", ..., "<modelo>", "<tag>"]
  const withoutRoot = rel.slice(1);
  if (withoutRoot.length < 2) return { name: withoutRoot.join('/') || 'desconocido', tag: 'latest', rel: withoutRoot };
  const tag = withoutRoot[withoutRoot.length - 1];
  const model = withoutRoot[withoutRoot.length - 2];
  const prefix = withoutRoot.slice(0, -2).join('/');
  let name = model;
  if (prefix === 'registry.ollama.ai/library') name = model;
  else if (prefix.startsWith('registry.ollama.ai/')) name = `${prefix.slice('registry.ollama.ai/'.length)}/${model}`;
  else if (prefix) name = `${prefix}/${model}`;
  return { name, tag, rel: withoutRoot };
}

/**
 * Inspecciona un tar sin extraerlo por completo: localiza manifiestos,
 * calcula tamaños y detecta entradas inseguras.
 */
async function scanTar(file) {
  if (!fs.existsSync(file)) fail('E_PATH_MISSING', `No existe el archivo ${file}`);
  const models = [];
  const blobSizes = new Map();
  const unsafe = [];

  await tar.list({
    file,
    onentry: (entry) => {
      const entryPath = normalizeEntryPath(entry.path);
      if (!isSafeEntry(entryPath)) {
        unsafe.push(entryPath);
        entry.resume();
        return;
      }
      if (entry.type === 'File' && entryPath.startsWith('manifests/')) {
        const chunks = [];
        entry.on('data', (chunk) => chunks.push(chunk));
        entry.on('end', () => {
          try {
            const manifest = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if (!manifest || !Array.isArray(manifest.layers)) return;
            const identity = identityFromTarPath(entryPath);
            const digests = digestsOf(manifest);
            let sizeBytes = 0;
            for (const digest of digests) {
              sizeBytes += blobSizes.get(digestToBlobName(digest)) || 0;
            }
            const layers = (manifest.layers || []).reduce((sum, layer) => sum + (Number(layer.size) || 0), 0);
            const configSize = manifest.config && manifest.config.size ? manifest.config.size : 0;
            models.push({
              file,
              fileName: path.basename(file),
              name: identity.name,
              tag: identity.tag,
              id: `${identity.name}:${identity.tag}`,
              manifestPath: entryPath,
              rel: identity.rel,
              digest: manifest.config ? manifest.config.digest : '',
              digests,
              sizeBytes: sizeBytes || layers + configSize,
              tarBytes: 0,
              family: '',
              parameterSize: '',
              quantization: ''
            });
          } catch (error) {
            logger.warn(`Manifiesto inválido dentro de ${path.basename(file)}`, { error: error.message });
          }
        });
      } else {
        if (entryPath.startsWith('blobs/') && entry.size) {
          blobSizes.set(path.posix.basename(entryPath), entry.size);
        }
        entry.resume();
      }
    }
  });

  // Segunda pasada ligera para completar tamaños que dependen del orden de entradas.
  for (const model of models) {
    if (!model.sizeBytes) {
      model.sizeBytes = model.digests.reduce((sum, digest) => sum + (blobSizes.get(digestToBlobName(digest)) || 0), 0);
    }
    model.tarBytes = fs.statSync(file).size;
    model.sizeLabel = formatBytes(model.sizeBytes);
  }

  return {
    file,
    fileName: path.basename(file),
    tarBytes: fs.statSync(file).size,
    tarLabel: formatBytes(fs.statSync(file).size),
    models,
    unsafe,
    valid: unsafe.length === 0 && models.length > 0
  };
}

async function scanFolder(folder) {
  if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) {
    fail('E_PATH_INVALID', `Carpeta no válida: ${folder}`);
  }
  const files = fs.readdirSync(folder)
    .filter((name) => name.toLowerCase().endsWith('.tar'))
    .map((name) => path.join(folder, name));
  const packages = [];
  for (const file of files) {
    try {
      packages.push(await scanTar(file));
    } catch (error) {
      packages.push({
        file,
        fileName: path.basename(file),
        tarBytes: 0,
        tarLabel: '—',
        models: [],
        unsafe: [],
        valid: false,
        error: error.message
      });
    }
  }
  return packages;
}

async function startImport({ basePath, files, conflict = 'ask', verify = true }) {
  const base = inspectBasePath(basePath);
  if (!fs.existsSync(base.basePath)) {
    fail('E_PATH_MISSING', `La ruta base no existe: ${base.basePath}`);
  }
  ensureDir(base.manifests);
  ensureDir(base.blobs);

  const selected = [...new Set(files)].filter((file) => fs.existsSync(file));
  if (!selected.length) fail('E_NOT_FOUND', 'No hay paquetes válidos para importar');

  const tempDir = path.join(require('./config').paths().temp, 'import');
  ensureDir(tempDir);

  const tasks = selected.map((file) => ({
    file,
    fileName: path.basename(file),
    stagingDir: path.join(tempDir, randomUUID())
  }));

  const jobId = randomUUID();
  let worker = null;

  const job = jobs.create('import', {
    meta: { taskCount: tasks.length, basePath: base.basePath },
    cancel: () => {
      if (worker) {
        try { worker.postMessage({ type: 'cancel' }); } catch { /* ignore */ }
        setTimeout(() => { try { worker.terminate(); } catch { /* ignore */ } }, 1500).unref?.();
      }
    }
  });

  worker = new Worker(WORKER, {
    workerData: {
      jobId: job.id,
      mode: 'import',
      tasks,
      basePath: base.basePath,
      manifestsRoot: base.manifests,
      blobsRoot: base.blobs,
      conflict,
      verify: Boolean(verify)
    }
  });

  worker.on('message', (message) => {
    if (!message || !message.type) return;
    if (message.type === 'progress') {
      jobs.emit('progress', { jobId: job.id, ...message });
    } else if (message.type === 'task-done' || message.type === 'task-error') {
      jobs.emit('progress', { jobId: job.id, ...message });
    } else if (message.type === 'done') {
      const failed = (message.results || []).filter((result) => !result.ok);
      const payload = { jobId: job.id, ...message };
      job.result = payload;
      jobs.emit('result', payload);
      jobs.finish(job.id, failed.length ? 'partial' : 'done', payload);
      worker.terminate();
    } else if (message.type === 'cancelled') {
      jobs.emit('cancelled', { jobId: job.id });
      jobs.finish(job.id, 'cancelled');
      worker.terminate();
    } else if (message.type === 'error') {
      job.error = message.error;
      jobs.emit('error', { jobId: job.id, error: message.error });
      jobs.finish(job.id, 'error');
      worker.terminate();
    }
  });

  worker.on('error', (error) => {
    job.error = serialize(error);
    jobs.emit('error', { jobId: job.id, error: serialize(error) });
    jobs.finish(job.id, 'error');
  });

  worker.on('exit', (code) => {
    const current = jobs.get(job.id);
    if (current && current.status === 'running' && code !== 0) {
      jobs.emit('error', { jobId: job.id, error: { code: 'E_UNKNOWN', message: `El proceso de importación terminó con código ${code}` } });
      jobs.finish(job.id, 'error');
    }
  });

  return { jobId: job.id, taskCount: tasks.length, files: selected };
}

module.exports = { scanTar, scanFolder, startImport, isSafeEntry, identityFromTarPath };
