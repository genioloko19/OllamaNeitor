'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { randomUUID } = require('node:crypto');
const jobs = require('./jobs');
const logger = require('./logger');
const { fail, wrap, serialize } = require('./errors');
const { inspectBasePath, ensureDir, buildFileName, uniquePath, freeBytes } = require('./paths');
const { readManifest, digestsOf, digestToBlobName, manifestPathFor } = require('./manifest');

const WORKER = path.join(__dirname, '..', '..', 'electron', 'workers', 'transfer.worker.js');

function resolveManifest(basePath, model) {
  if (model.manifestPath && fs.existsSync(model.manifestPath)) return model.manifestPath;
  const base = inspectBasePath(basePath);
  const candidate = manifestPathFor(base.manifests, model.name, model.tag);
  if (fs.existsSync(candidate)) return candidate;
  return null;
}

function buildTasks({ basePath, destDir, models, template, verify }) {
  const base = inspectBasePath(basePath);
  if (!base.hasManifests || !base.hasBlobs) {
    fail('E_PATH_INVALID', 'La ruta base de Ollama no contiene las carpetas manifests y blobs');
  }
  ensureDir(destDir);

  const tasks = [];
  let totalBytes = 0;
  const missing = [];

  for (const model of models) {
    const manifestPath = resolveManifest(basePath, model);
    if (!manifestPath) {
      missing.push(`${model.name}:${model.tag} (manifiesto)`);
      continue;
    }
    const manifest = readManifest(manifestPath);
    const relManifest = path.relative(base.manifests, manifestPath);
    const files = [{ src: manifestPath, dest: path.join('manifests', relManifest), digest: null }];

    for (const digest of digestsOf(manifest)) {
      const blobName = digestToBlobName(digest);
      const blobFile = path.join(base.blobs, blobName);
      try {
        const stat = fs.statSync(blobFile);
        files.push({ src: blobFile, dest: path.join('blobs', blobName), digest, size: stat.size });
        totalBytes += stat.size;
      } catch {
        missing.push(`${model.name}:${model.tag} → ${blobName}`);
      }
    }

    const jobId = randomUUID();
    const stagingDir = path.join(destDir, '.neitor-staging', jobId);
    const baseName = buildFileName(template, model);
    const outputFinal = uniquePath(destDir, baseName, '.tar');
    tasks.push({
      jobId,
      model: {
        id: `${model.name}:${model.tag}`,
        name: model.name,
        tag: model.tag,
        family: model.family || '',
        parameterSize: model.parameterSize || '',
        quantization: model.quantization || ''
      },
      manifestPath,
      relManifest,
      stagingDir,
      outputPart: `${outputFinal}.part`,
      outputFinal,
      files
    });
  }

  if (missing.length) {
    fail('E_NOT_FOUND', `Faltan ${missing.length} archivo(s) del modelo`, { missing: missing.slice(0, 40) });
  }
  if (!tasks.length) fail('E_NOT_FOUND', 'No hay modelos válidos para exportar');

  const free = freeBytes(destDir);
  const required = Math.ceil(totalBytes * 1.08) + 100 * 1024 * 1024;
  if (free !== null && free < required) {
    fail('E_NO_SPACE', 'No hay espacio suficiente para exportar', {
      free, required, freeLabel: (free / 1024 ** 3).toFixed(2), requiredLabel: (required / 1024 ** 3).toFixed(2)
    });
  }

  return { tasks, totalBytes, verify: Boolean(verify), destDir };
}

/**
 * Inicia una exportación. Devuelve el jobId inmediatamente y emite progreso
 * mediante el registro de jobs.
 */
async function startExport({ basePath, destDir, models, template, verify = true }) {
  const plan = buildTasks({ basePath, destDir, models, template, verify });
  const jobId = randomUUID();
  let worker = null;

  const job = jobs.create('export', {
    meta: { totalBytes: plan.totalBytes, taskCount: plan.tasks.length, destDir },
    cancel: () => {
      if (worker) {
        try { worker.postMessage({ type: 'cancel' }); } catch { /* ignore */ }
        setTimeout(() => { try { worker.terminate(); } catch { /* ignore */ } }, 1500).unref?.();
      }
    }
  });

  worker = new Worker(WORKER, {
    workerData: {
      mode: 'export',
      jobId: job.id,
      tasks: plan.tasks,
      verify: plan.verify,
      totalBytes: plan.totalBytes
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
      cleanupStaging(plan.tasks, true);
      worker.terminate();
    } else if (message.type === 'cancelled') {
      cleanupStaging(plan.tasks, false);
      jobs.emit('cancelled', { jobId: job.id });
      jobs.finish(job.id, 'cancelled');
      worker.terminate();
    } else if (message.type === 'error') {
      logger.error('Exportación fallida', { error: message.error });
      job.error = message.error;
      jobs.emit('error', { jobId: job.id, error: message.error });
      jobs.finish(job.id, 'error');
      cleanupStaging(plan.tasks, false);
      worker.terminate();
    }
  });

  worker.on('error', (error) => {
    logger.error('Worker de exportación falló', { error: error.message });
    job.error = serialize(error);
    jobs.emit('error', { jobId: job.id, error: serialize(error) });
    jobs.finish(job.id, 'error');
    cleanupStaging(plan.tasks, false);
  });

  worker.on('exit', (code) => {
    if (jobs.get(job.id) && jobs.get(job.id).status === 'running') {
      if (code !== 0) {
        jobs.emit('error', { jobId: job.id, error: { code: 'E_UNKNOWN', message: `El proceso de exportación terminó con código ${code}` } });
        jobs.finish(job.id, 'error');
      }
    }
  });

  return {
    jobId: job.id,
    totalBytes: plan.totalBytes,
    taskCount: plan.tasks.length,
    outputs: plan.tasks.map((task) => task.outputFinal)
  };
}

function cleanupStaging(tasks, keepSuccessful) {
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

async function exportNow(options) {
  const result = await startExport(options);
  const job = jobs.get(result.jobId);
  return { ...result, job };
}

module.exports = { startExport, exportNow, buildTasks, cleanupStaging, wrap };
