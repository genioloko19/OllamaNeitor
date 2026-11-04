'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { randomUUID } = require('node:crypto');
const jobs = require('./jobs');
const logger = require('./logger');
const { fail, serialize } = require('./errors');
const { inspectBasePath, ensureDir, buildFileName, freeBytes, assertInside, validateModelIdentity } = require('./paths');
const { readManifest, digestsOf, digestToBlobName, manifestPathFor } = require('./manifest');

const WORKER = path.join(__dirname, '..', '..', 'electron', 'workers', 'transfer.worker.js');
const GB = 1024 ** 3;

function resolveManifest(base, model) {
  let candidate = null;
  if (model.manifestPath) {
    candidate = path.resolve(model.manifestPath);
    assertInside(base.manifests, candidate, 'manifiesto');
  } else if (model.name && model.tag) {
    candidate = manifestPathFor(base.manifests, model.name, model.tag);
  }
  if (!candidate || !fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) return null;
  assertInside(base.manifests, candidate, 'manifiesto');
  return candidate;
}

function reserveOutputName(destDir, baseName, ext, used) {
  let candidate = path.join(destDir, `${baseName}${ext}`);
  let index = 2;
  while (used.has(candidate.toLowerCase()) || fs.existsSync(candidate)) {
    candidate = path.join(destDir, `${baseName}-${index}${ext}`);
    index += 1;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

/**
 * Construye el plan de exportación. Falla entero si algún modelo seleccionado
 * no es exportable, para no generar un lote parcial silencioso.
 */
function buildTasks({ basePath, destDir, models, template, verify, maxGb = 50, compression = 'none' }) {
  const base = inspectBasePath(basePath);
  if (!base.hasManifests || !base.hasBlobs) {
    fail('E_PATH_INVALID', 'La ruta base de Ollama no contiene las carpetas manifests y blobs');
  }
  ensureDir(destDir);

  const tasks = [];
  const problems = [];
  const usedNames = new Set();
  let totalBytes = 0;

  for (const source of models) {
    let model;
    try {
      model = validateModelIdentity(source);
    } catch (error) {
      problems.push({ id: source && source.name ? `${source.name}:${source.tag}` : 'desconocido', reason: error.message });
      continue;
    }

    const id = `${model.name}:${model.tag}`;
    const manifestPath = resolveManifest(base, { ...source, ...model });
    if (!manifestPath) {
      problems.push({ id, reason: 'sin manifiesto local (modelo solo API o no encontrado)' });
      continue;
    }

    let manifest;
    try {
      manifest = readManifest(manifestPath);
    } catch (error) {
      problems.push({ id, reason: error.message });
      continue;
    }

    const relManifest = path.relative(base.manifests, manifestPath);
    if (relManifest.startsWith('..') || path.isAbsolute(relManifest)) {
      problems.push({ id, reason: 'el manifiesto queda fuera de la ruta base' });
      continue;
    }

    const files = [{ src: manifestPath, dest: path.join('manifests', relManifest), digest: null }];
    let missing = 0;
    for (const digest of digestsOf(manifest)) {
      const blobName = digestToBlobName(digest);
      const blobFile = path.join(base.blobs, blobName);
      try {
        const stat = fs.statSync(blobFile);
        if (!stat.isFile()) throw new Error('no es un archivo');
        files.push({ src: blobFile, dest: path.join('blobs', blobName), digest, size: stat.size });
        totalBytes += stat.size;
      } catch {
        missing += 1;
      }
    }
    if (missing > 0) {
      problems.push({ id, reason: `faltan ${missing} blob(s) en disco` });
      continue;
    }

    const stagingDir = path.join(destDir, '.neitor-staging', randomUUID());
    assertInside(destDir, stagingDir, 'carpeta de staging');
    const baseName = buildFileName(template, {
      ...source,
      name: model.name,
      tag: model.tag
    });
    const extension = compression === 'gzip' ? '.tar.gz' : '.tar';
    const outputFinal = reserveOutputName(destDir, baseName, extension, usedNames);
    assertInside(destDir, outputFinal, 'archivo de salida');

    tasks.push({
      jobId: randomUUID(),
      model: {
        id,
        name: model.name,
        tag: model.tag,
        family: source.family || '',
        parameterSize: source.parameterSize || '',
        quantization: source.quantization || ''
      },
      manifestPath,
      relManifest,
      stagingDir,
      outputPart: `${outputFinal}.part`,
      outputFinal,
      compression,
      files
    });
  }

  if (problems.length) {
    fail('E_NOT_FOUND', `${problems.length} modelo(s) no son exportables`, {
      invalid: problems,
      exportable: tasks.length
    });
  }
  if (!tasks.length) fail('E_NOT_FOUND', 'No hay modelos válidos para exportar');

  const limit = Math.max(1, Number(maxGb) || 50) * GB;
  if (totalBytes > limit) {
    fail('E_CONFIG', `El lote supera el límite configurado de ${Math.round(limit / GB)} GB`, {
      totalBytes,
      limit
    });
  }

  const free = freeBytes(destDir);
  const required = Math.ceil(totalBytes * 1.08) + 100 * 1024 * 1024;
  if (free !== null && free < required) {
    fail('E_NO_SPACE', 'No hay espacio suficiente para exportar', {
      free,
      required,
      freeLabel: (free / GB).toFixed(2),
      requiredLabel: (required / GB).toFixed(2)
    });
  }

  return { tasks, totalBytes, verify: Boolean(verify), destDir, compression };
}

function cleanupStaging(tasks) {
  for (const task of tasks) {
    try {
      fs.rmSync(task.stagingDir, { recursive: true, force: true });
      fs.rmSync(task.outputPart, { force: true });
    } catch { /* ignore */ }
  }
  const root = tasks[0] && tasks[0].stagingDir ? path.dirname(tasks[0].stagingDir) : null;
  if (root) {
    try {
      if (fs.existsSync(root) && fs.readdirSync(root).length === 0) fs.rmdirSync(root);
    } catch { /* ignore */ }
  }
}

function spawnExport(job, plan) {
  const worker = new Worker(WORKER, {
    workerData: {
      mode: 'export',
      jobId: job.id,
      tasks: plan.tasks,
      verify: plan.verify,
      totalBytes: plan.totalBytes,
      compression: plan.compression
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
      cleanupStaging(plan.tasks);
      jobs.finish(job.id, failed.length ? 'partial' : 'done', payload);
      worker.terminate();
    } else if (message.type === 'cancelled') {
      cleanupStaging(plan.tasks);
      jobs.emit('cancelled', { jobId: job.id });
      jobs.finish(job.id, 'cancelled');
      worker.terminate();
    } else if (message.type === 'error') {
      logger.error('Exportación fallida', { error: message.error });
      cleanupStaging(plan.tasks);
      jobs.emit('error', { jobId: job.id, error: message.error });
      jobs.fail(job.id, message.error);
      worker.terminate();
    }
  });

  worker.on('error', (error) => {
    logger.error('Worker de exportación falló', { error: error.message });
    cleanupStaging(plan.tasks);
    jobs.fail(job.id, serialize(error));
  });

  worker.on('exit', (code) => {
    const current = jobs.get(job.id);
    if (current && ['running', 'cancelling'].includes(current.status) && code !== 0) {
      jobs.fail(job.id, { code: 'E_UNKNOWN', message: `El proceso de exportación terminó con código ${code}` });
    }
  });

  return worker;
}

async function startExport({ basePath, destDir, models, template, verify = true, maxGb = 50, compression = 'none' }) {
  const plan = buildTasks({ basePath, destDir, models, template, verify, maxGb, compression });
  let worker = null;

  const job = jobs.enqueue('export', {
    meta: {
      totalBytes: plan.totalBytes,
      taskCount: plan.tasks.length,
      destDir,
      template,
      verify: plan.verify,
      compression: plan.compression,
      models: plan.tasks.map((task) => task.model)
    },
    start: (current) => { worker = spawnExport(current, plan); },
    cancel: () => {
      if (worker) {
        try { worker.postMessage({ type: 'cancel' }); } catch { /* ignore */ }
        setTimeout(() => { try { worker.terminate(); } catch { /* ignore */ } }, 1500).unref?.();
      }
    }
  });

  return {
    jobId: job.id,
    totalBytes: plan.totalBytes,
    taskCount: plan.tasks.length,
    outputs: plan.tasks.map((task) => task.outputFinal),
    queued: job.status === 'queued'
  };
}

module.exports = { startExport, buildTasks, cleanupStaging, reserveOutputName };
