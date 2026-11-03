'use strict';

/**
 * Worker de importación: extrae en staging, valida rutas, verifica digests,
 * resuelve conflictos y hace commit atómico con rollback.
 */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { parentPort, workerData } = require('node:worker_threads');
const tar = require('tar');
const { digestsOf, digestToBlobName, formatBytes } = require('../../src/core/manifest');

let cancelled = false;
parentPort.on('message', (message) => {
  if (message && message.type === 'cancel') cancelled = true;
});

function emit(payload) {
  try { parentPort.postMessage(payload); } catch { /* ignore */ }
}

function assertNotCancelled() {
  if (cancelled) {
    const error = new Error('Operación cancelada');
    error.code = 'E_CANCELLED';
    throw error;
  }
}

function safeRm(target) {
  try { fs.rmSync(target, { recursive: true, force: true }); } catch { /* ignore */ }
}

function isSafeEntry(entryPath) {
  const normalized = String(entryPath || '').replace(/\\/g, '/');
  if (!normalized || normalized.startsWith('/')) return false;
  if (/^[a-zA-Z]:/.test(normalized)) return false;
  const parts = normalized.split('/').filter(Boolean);
  if (parts.includes('..')) return false;
  return normalized.startsWith('manifests/') || normalized.startsWith('blobs/') || normalized === 'neitor.json';
}

function walk(dir, out = []) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

function identityFromRel(relParts) {
  const parts = [...relParts];
  const tag = parts.pop() || 'latest';
  const model = parts.pop() || 'modelo';
  const prefix = parts.join('/');
  let name = model;
  if (prefix === 'registry.ollama.ai/library') name = model;
  else if (prefix.startsWith('registry.ollama.ai/')) name = `${prefix.slice('registry.ollama.ai/'.length)}/${model}`;
  else if (prefix) name = `${prefix}/${model}`;
  return { name, tag };
}

function hashFile(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(file, { highWaterMark: 1024 * 1024 });
    stream.on('data', (chunk) => {
      if (cancelled) {
        const error = new Error('Operación cancelada');
        error.code = 'E_CANCELLED';
        stream.destroy();
        reject(error);
        return;
      }
      hash.update(chunk);
    });
    stream.on('end', () => resolve(`sha256:${hash.digest('hex')}`));
    stream.on('error', reject);
  });
}

function nextFreeTag(manifestsRoot, relParts) {
  const tag = relParts[relParts.length - 1];
  const base = relParts.slice(0, -1);
  let candidate = `${tag}-imported`;
  let index = 2;
  for (;;) {
    const target = path.join(manifestsRoot, ...base, candidate);
    if (!fs.existsSync(target)) return { tag: candidate, relParts: [...base, candidate] };
    candidate = `${tag}-imported-${index}`;
    index += 1;
  }
}

async function commitModel({ manifestFile, relParts, staging, manifestsRoot, blobsRoot, conflict, verify, created }) {
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  if (!manifest || !Array.isArray(manifest.layers)) {
    const error = new Error('Manifiesto inválido dentro del paquete');
    error.code = 'E_TAR_INVALID';
    throw error;
  }
  const digests = digestsOf(manifest);
  const blobs = [];
  let bytes = 0;

  for (const digest of digests) {
    const blobName = digestToBlobName(digest);
    const source = path.join(staging, 'blobs', blobName);
    if (!fs.existsSync(source)) {
      const error = new Error(`Falta el blob ${blobName} dentro del paquete`);
      error.code = 'E_TAR_INVALID';
      throw error;
    }
    const stat = fs.statSync(source);
    bytes += stat.size;
    if (verify) {
      const actual = await hashFile(source);
      if (actual !== digest) {
        const error = new Error(`Digest distinto en ${blobName} (esperado ${digest}, obtenido ${actual})`);
        error.code = 'E_DIGEST_MISMATCH';
        throw error;
      }
    }
    blobs.push({ digest, blobName, source, size: stat.size });
  }

  assertNotCancelled();

  let targetRel = relParts;
  let targetManifest = path.join(manifestsRoot, ...targetRel);
  let replaced = false;

  if (fs.existsSync(targetManifest)) {
    if (conflict === 'skip') {
      const { name } = identityFromRel(relParts);
      return { ok: true, skipped: true, model: { name, tag: relParts[relParts.length - 1] }, target: targetManifest, bytes: 0 };
    }
    if (conflict === 'rename') {
      const renamed = nextFreeTag(manifestsRoot, relParts);
      targetRel = renamed.relParts;
      targetManifest = path.join(manifestsRoot, ...targetRel);
    } else {
      replaced = true;
    }
  }

  const createdBlobs = [];
  const createdManifest = !fs.existsSync(targetManifest);

  for (const blob of blobs) {
    const target = path.join(blobsRoot, blob.blobName);
    if (fs.existsSync(target)) {
      const existing = fs.statSync(target);
      if (existing.size !== blob.size) {
        const error = new Error(`El blob ${blob.blobName} ya existe con un tamaño distinto`);
        error.code = 'E_CONFLICT';
        throw error;
      }
      continue;
    }
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.copyFile(blob.source, target);
    createdBlobs.push(target);
    created.blobs.push(target);
  }

  await fsp.mkdir(path.dirname(targetManifest), { recursive: true });
  await fsp.copyFile(manifestFile, targetManifest);
  if (createdManifest) created.manifests.push(targetManifest);

  const { name, tag } = identityFromRel(targetRel);
  return {
    ok: true,
    model: { id: `${name}:${tag}`, name, tag, family: '', parameterSize: '', quantization: '' },
    target: targetManifest,
    bytes,
    verified: Boolean(verify),
    replaced,
    sizeLabel: formatBytes(bytes)
  };
}

async function runImport() {
  const { tasks, basePath, manifestsRoot, blobsRoot, conflict, verify } = workerData;
  const results = [];

  for (let index = 0; index < tasks.length; index += 1) {
    const task = tasks[index];
    const startedAt = Date.now();
    const created = { blobs: [], manifests: [] };
    const progress = (fraction, phase, extra = {}) => {
      emit({
        type: 'progress',
        phase,
        taskIndex: index + 1,
        taskCount: tasks.length,
        file: task.fileName,
        percent: Math.min(99, Math.round(((index + fraction) / tasks.length) * 100)),
        ...extra
      });
    };

    try {
      assertNotCancelled();
      safeRm(task.stagingDir);
      await fsp.mkdir(task.stagingDir, { recursive: true });
      progress(0.04, 'extract');

      const unsafe = [];
      await tar.x({
        file: task.file,
        cwd: task.stagingDir,
        preservePaths: false,
        strict: true,
        filter: (entryPath) => {
          if (isSafeEntry(entryPath)) return true;
          unsafe.push(entryPath);
          return false;
        }
      });
      if (unsafe.length) {
        const error = new Error(`Entradas no permitidas: ${unsafe.slice(0, 3).join(', ')}`);
        error.code = 'E_TAR_UNSAFE';
        throw error;
      }

      const stagingManifests = path.join(task.stagingDir, 'manifests');
      const files = fs.existsSync(stagingManifests) ? walk(stagingManifests) : [];
      if (!files.length) {
        const error = new Error('El paquete no contiene manifiestos de Ollama');
        error.code = 'E_TAR_INVALID';
        throw error;
      }

      const imported = [];
      for (let i = 0; i < files.length; i += 1) {
        assertNotCancelled();
        const manifestFile = files[i];
        const relParts = path.relative(stagingManifests, manifestFile).split(path.sep).filter(Boolean);
        progress(0.25 + (0.7 * (i / files.length)), 'verify', {
          model: identityFromRel(relParts)
        });
        const result = await commitModel({
          manifestFile,
          relParts,
          staging: task.stagingDir,
          manifestsRoot,
          blobsRoot,
          conflict,
          verify,
          created
        });
        imported.push(result);
        results.push(result);
        emit({ type: 'task-done', result });
      }

      progress(0.98, 'commit');
      safeRm(task.stagingDir);
      emit({
        type: 'progress',
        phase: 'done',
        taskIndex: index + 1,
        taskCount: tasks.length,
        file: task.fileName,
        percent: Math.round(((index + 1) / tasks.length) * 100),
        imported
      });
    } catch (error) {
      for (const manifest of created.manifests) safeRm(manifest);
      for (const blob of created.blobs) safeRm(blob);
      safeRm(task.stagingDir);
      if (error.code === 'E_CANCELLED' || cancelled) {
        emit({ type: 'cancelled' });
        return;
      }
      const result = {
        ok: false,
        file: task.file,
        fileName: task.fileName,
        error: { code: error.code || 'E_UNKNOWN', message: error.message },
        seconds: (Date.now() - startedAt) / 1000
      };
      results.push(result);
      emit({ type: 'task-error', result });
    }
  }

  emit({ type: 'done', results });
}

runImport().catch((error) => {
  emit({ type: 'error', error: { code: error.code || 'E_UNKNOWN', message: error.message } });
});
