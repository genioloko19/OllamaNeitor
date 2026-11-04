'use strict';

const fs = require('node:fs');
const path = require('node:path');
const tar = require('tar');
const { Worker } = require('node:worker_threads');
const { randomUUID } = require('node:crypto');
const jobs = require('./jobs');
const logger = require('./logger');
const { fail, serialize } = require('./errors');
const { inspectBasePath, ensureDir, assertInside } = require('./paths');
const { readManifest, digestToBlobName, digestsOf, formatBytes } = require('./manifest');
const { validateEntry, isSafeEntry, normalizeEntryPath } = require('./tar-safety');

const WORKER = path.join(__dirname, '..', '..', 'electron', 'workers', 'import.worker.js');

function identityFromTarPath(entryPath) {
  const normalized = normalizeEntryPath(entryPath);
  const rel = normalized.split('/').filter(Boolean);
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

function manifestSignature(manifest) {
  const config = manifest && manifest.config ? manifest.config.digest : '';
  const layers = (manifest && Array.isArray(manifest.layers) ? manifest.layers : [])
    .map((layer) => layer.digest)
    .filter(Boolean);
  return JSON.stringify({ config, layers });
}

function conflictFor(basePath, rel, signature) {
  if (!basePath) return 'unknown';
  const base = inspectBasePath(basePath);
  if (!base.hasManifests) return 'unknown';
  const target = path.join(base.manifests, ...rel);
  try {
    assertInside(base.manifests, target, 'manifiesto');
  } catch {
    return 'invalid';
  }
  if (!fs.existsSync(target)) return 'new';
  try {
    const existing = readManifest(target);
    return manifestSignature(existing) === signature ? 'same' : 'different';
  } catch {
    return 'different';
  }
}

/**
 * Inspecciona un tar sin extraerlo: localiza manifiestos, calcula tamaños,
 * detecta entradas inseguras y, si se indica basePath, previsualiza conflictos.
 */
async function scanTar(file, { basePath = null } = {}) {
  if (!fs.existsSync(file)) fail('E_PATH_MISSING', `No existe el archivo ${file}`);
  const models = [];
  const blobSizes = new Map();
  const unsafe = [];

  await tar.list({
    file,
    onentry: (entry) => {
      const entryPath = normalizeEntryPath(entry.path);
      const check = validateEntry(entryPath, entry.type);
      if (!check.ok) {
        unsafe.push({ path: entryPath, reason: check.reason });
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
            for (const digest of digests) sizeBytes += blobSizes.get(digestToBlobName(digest)) || 0;
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
              quantization: '',
              conflict: conflictFor(basePath, identity.rel, manifestSignature(manifest))
            });
          } catch (error) {
            logger.warn(`Manifiesto inválido dentro de ${path.basename(file)}`, { error: error.message });
          }
        });
      } else {
        if (entry.type === 'File' && entryPath.startsWith('blobs/') && entry.size) {
          blobSizes.set(path.posix.basename(entryPath), entry.size);
        }
        entry.resume();
      }
    }
  });

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

async function scanFolder(folder, options = {}) {
  if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) {
    fail('E_PATH_INVALID', `Carpeta no válida: ${folder}`);
  }
  const files = fs.readdirSync(folder)
    .filter((name) => {
      const lower = name.toLowerCase();
      return lower.endsWith('.tar') || lower.endsWith('.tar.gz') || lower.endsWith('.tgz');
    })
    .map((name) => path.join(folder, name));
  const packages = [];
  for (const file of files) {
    try {
      packages.push(await scanTar(file, options));
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

function spawnImport(job, tasks, options) {
  const worker = new Worker(WORKER, {
    workerData: {
      jobId: job.id,
      mode: 'import',
      tasks,
      basePath: options.basePath,
      manifestsRoot: options.manifestsRoot,
      blobsRoot: options.blobsRoot,
      conflict: options.conflict,
      verify: options.verify
    }
  });

  job.worker = worker;

  worker.on('message', (message) => {
    if (!message || !message.type) return;
    if (message.type === 'progress') {
      jobs.updateProgress(job.id, message);
    } else if (message.type === 'task-done' || message.type === 'task-error') {
      jobs.updateProgress(job.id, message);
    } else if (message.type === 'done') {
      const failed = (message.results || []).filter((result) => !result.ok);
      const payload = { jobId: job.id, ...message };
      jobs.emit('result', payload);
      jobs.finish(job.id, failed.length ? 'partial' : 'done', payload);
      worker.terminate();
    } else if (message.type === 'cancelled') {
      jobs.emit('cancelled', { jobId: job.id });
      jobs.finish(job.id, 'cancelled');
      worker.terminate();
    } else if (message.type === 'error') {
      jobs.emit('error', { jobId: job.id, error: message.error });
      jobs.fail(job.id, message.error);
      worker.terminate();
    }
  });

  worker.on('error', (error) => {
    jobs.fail(job.id, serialize(error));
  });

  worker.on('exit', (code) => {
    const current = jobs.get(job.id);
    if (current && ['running', 'cancelling'].includes(current.status) && code !== 0) {
      jobs.fail(job.id, { code: 'E_UNKNOWN', message: `El proceso de importación terminó con código ${code}` });
    }
  });

  return worker;
}

async function startImport({ basePath, files, conflict = 'overwrite', verify = true }) {
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

  let worker = null;
  const job = jobs.enqueue('import', {
    meta: {
      taskCount: tasks.length,
      basePath: base.basePath,
      files: tasks.map((task) => task.file),
      conflict,
      verify: Boolean(verify)
    },
    start: (current) => {
      worker = spawnImport(current, tasks, {
        basePath: base.basePath,
        manifestsRoot: base.manifests,
        blobsRoot: base.blobs,
        conflict,
        verify
      });
    },
    cancel: () => {
      if (worker) {
        try { worker.postMessage({ type: 'cancel' }); } catch { /* ignore */ }
        setTimeout(() => { try { worker.terminate(); } catch { /* ignore */ } }, 1500).unref?.();
      }
    }
  });

  return {
    jobId: job.id,
    taskCount: tasks.length,
    files: selected,
    queued: job.status === 'queued'
  };
}

module.exports = { scanTar, scanFolder, startImport, isSafeEntry, identityFromTarPath, manifestSignature };
