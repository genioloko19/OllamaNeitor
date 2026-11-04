'use strict';

/**
 * Worker de importación transaccional por modelo.
 *
 * Cada manifiesto es una transacción independiente:
 *  - blobs y manifiesto se escriben en .part-<uuid> y se renombran al final;
 *  - un overwrite guarda el manifiesto anterior en .bak-<uuid>;
 *  - si algo falla, se revierte solo ese modelo;
 *  - los modelos ya confirmados no se tocan.
 */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { parentPort, workerData } = require('node:worker_threads');
const tar = require('tar');
const { digestsOf, digestToBlobName, formatBytes } = require('../../src/core/manifest');
const {
  validateEntry, scanStaging, normalizeEntryPath
} = require('../../src/core/tar-safety');
const {
  assertInside, validateModelName, validateTag
} = require('../../src/core/paths');

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

function isRegularFile(file) {
  try {
    return fs.lstatSync(file).isFile();
  } catch {
    return false;
  }
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

async function nextFreeTag(manifestsRoot, relParts) {
  const base = relParts.slice(0, -1);
  const tag = relParts[relParts.length - 1];
  let candidate = `${tag}-imported`;
  let index = 2;
  for (;;) {
    const target = path.join(manifestsRoot, ...base, candidate);
    assertInside(manifestsRoot, target, 'manifiesto renombrado');
    if (!fs.existsSync(target)) return [...base, candidate];
    candidate = `${tag}-imported-${index}`;
    index += 1;
  }
}

function validateRelParts(relParts) {
  if (!Array.isArray(relParts) || relParts.length < 2) {
    const error = new Error('Ruta de manifiesto inválida');
    error.code = 'E_TAR_UNSAFE';
    throw error;
  }
  const tag = relParts[relParts.length - 1];
  const nameParts = relParts.slice(0, -1);
  validateModelName(nameParts.join('/'));
  validateTag(tag);
  for (const part of relParts) {
    if (!part || part === '.' || part === '..') {
      const error = new Error(`Segmento de ruta inválido: ${part}`);
      error.code = 'E_TAR_UNSAFE';
      throw error;
    }
  }
}

class ModelTransaction {
  constructor({ staging, manifestsRoot, blobsRoot, verify }) {
    this.staging = staging;
    this.manifestsRoot = manifestsRoot;
    this.blobsRoot = blobsRoot;
    this.verify = verify;
    this.createdBlobs = [];
    this.createdManifests = [];
    this.backups = [];
    this.temps = [];
    this.replaced = false;
  }

  trackTemp(file) {
    this.temps.push(file);
    return file;
  }

  async copyBlob(blobName, digest, size) {
    const source = path.join(this.staging, 'blobs', blobName);
    if (!isRegularFile(source)) {
      const error = new Error(`Falta el blob ${blobName} dentro del paquete`);
      error.code = 'E_TAR_INVALID';
      throw error;
    }
    const target = path.join(this.blobsRoot, blobName);
    assertInside(this.blobsRoot, target, 'blob de destino');

    if (fs.existsSync(target)) {
      const existing = fs.statSync(target);
      if (!existing.isFile() || existing.size !== size) {
        const error = new Error(`El blob ${blobName} ya existe con un tamaño distinto`);
        error.code = 'E_CONFLICT';
        throw error;
      }
      if (this.verify) {
        const actual = await hashFile(target);
        if (actual !== digest) {
          const error = new Error(`El blob existente ${blobName} no coincide con su digest`);
          error.code = 'E_CONFLICT';
          throw error;
        }
      }
      return { skipped: true, bytes: 0 };
    }

    await fsp.mkdir(path.dirname(target), { recursive: true });
    const temp = this.trackTemp(path.join(this.blobsRoot, `.${blobName}.part-${crypto.randomUUID()}`));
    await fsp.copyFile(source, temp);
    if (this.verify) {
      const actual = await hashFile(temp);
      if (actual !== digest) {
        const error = new Error(`Digest distinto en ${blobName} (esperado ${digest}, obtenido ${actual})`);
        error.code = 'E_DIGEST_MISMATCH';
        throw error;
      }
    }
    try {
      await fsp.rename(temp, target);
    } catch (error) {
      if (error.code === 'EEXIST' || fs.existsSync(target)) {
        safeRm(temp);
        return { skipped: true, bytes: 0 };
      }
      throw error;
    }
    this.temps = this.temps.filter((item) => item !== temp);
    this.createdBlobs.push(target);
    return { skipped: false, bytes: size };
  }

  async commitManifest(source, relParts, conflict) {
    validateRelParts(relParts);
    let targetRel = [...relParts];
    let target = path.join(this.manifestsRoot, ...targetRel);
    assertInside(this.manifestsRoot, target, 'manifiesto de destino');

    if (fs.existsSync(target)) {
      if (conflict === 'skip') {
        return { skipped: true, target, targetRel };
      }
      if (conflict === 'rename') {
        targetRel = await nextFreeTag(this.manifestsRoot, relParts);
        target = path.join(this.manifestsRoot, ...targetRel);
        assertInside(this.manifestsRoot, target, 'manifiesto renombrado');
      } else {
        const backup = this.trackTemp(`${target}.bak-${crypto.randomUUID()}`);
        await fsp.copyFile(target, backup);
        this.backups.push({ target, backup });
        this.replaced = true;
      }
    }

    await fsp.mkdir(path.dirname(target), { recursive: true });
    const temp = this.trackTemp(`${target}.part-${crypto.randomUUID()}`);
    await fsp.copyFile(source, temp);
    if (fs.existsSync(target) && conflict === 'overwrite') {
      await fsp.rm(target, { force: true });
    }
    await fsp.rename(temp, target);
    this.temps = this.temps.filter((item) => item !== temp);
    this.createdManifests.push(target);
    return { skipped: false, target, targetRel, replaced: this.replaced };
  }

  rollback() {
    for (const manifest of this.createdManifests) safeRm(manifest);
    for (const blob of this.createdBlobs) safeRm(blob);
    for (const { target, backup } of this.backups) {
      try {
        if (fs.existsSync(backup)) {
          fs.rmSync(target, { force: true });
          fs.renameSync(backup, target);
        }
      } catch { /* ignore */ }
    }
    for (const temp of this.temps) safeRm(temp);
  }

  cleanupBackups() {
    for (const { backup } of this.backups) safeRm(backup);
  }
}

async function importManifest({ manifestFile, relParts, staging, manifestsRoot, blobsRoot, conflict, verify, progress }) {
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  if (!manifest || !Array.isArray(manifest.layers)) {
    const error = new Error('Manifiesto inválido dentro del paquete');
    error.code = 'E_TAR_INVALID';
    throw error;
  }
  const digests = digestsOf(manifest);
  const transaction = new ModelTransaction({ staging, manifestsRoot, blobsRoot, verify });
  let bytes = 0;

  try {
    const identity = identityFromRel(relParts);
    progress({ phase: 'verify', model: identity });

    // Verificación previa de todos los blobs antes de tocar el destino.
    for (const digest of digests) {
      const blobName = digestToBlobName(digest);
      const source = path.join(staging, 'blobs', blobName);
      if (!isRegularFile(source)) {
        const error = new Error(`Falta el blob ${blobName} dentro del paquete`);
        error.code = 'E_TAR_INVALID';
        throw error;
      }
      if (verify) {
        const actual = await hashFile(source);
        if (actual !== digest) {
          const error = new Error(`Digest distinto en ${blobName} (esperado ${digest}, obtenido ${actual})`);
          error.code = 'E_DIGEST_MISMATCH';
          throw error;
        }
      }
    }

    assertNotCancelled();

    // Si el destino existe y la política es omitir, no se copia nada.
    const targetPreview = path.join(manifestsRoot, ...relParts);
    assertInside(manifestsRoot, targetPreview, 'manifiesto de destino');
    if (conflict === 'skip' && fs.existsSync(targetPreview)) {
      transaction.cleanupBackups();
      return {
        ok: true,
        skipped: true,
        model: { id: `${identity.name}:${identity.tag}`, ...identity },
        target: targetPreview,
        bytes: 0,
        verified: Boolean(verify)
      };
    }

    progress({ phase: 'commit', model: identity });
    for (const digest of digests) {
      assertNotCancelled();
      const blobName = digestToBlobName(digest);
      const size = fs.statSync(path.join(staging, 'blobs', blobName)).size;
      const result = await transaction.copyBlob(blobName, digest, size);
      bytes += result.bytes;
    }

    assertNotCancelled();
    const committed = await transaction.commitManifest(manifestFile, relParts, conflict);
    const finalIdentity = identityFromRel(committed.targetRel || relParts);
    transaction.cleanupBackups();

    return {
      ok: true,
      skipped: Boolean(committed.skipped),
      model: { id: `${finalIdentity.name}:${finalIdentity.tag}`, ...finalIdentity },
      target: committed.target,
      bytes,
      verified: Boolean(verify),
      replaced: Boolean(committed.replaced),
      sizeLabel: formatBytes(bytes)
    };
  } catch (error) {
    transaction.rollback();
    throw error;
  }
}

async function runImport() {
  const { tasks, manifestsRoot, blobsRoot, conflict, verify } = workerData;
  const results = [];

  for (let index = 0; index < tasks.length; index += 1) {
    const task = tasks[index];
    const startedAt = Date.now();
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
      progress(0.02, 'extract');

      const unsafe = [];
      await tar.x({
        file: task.file,
        cwd: task.stagingDir,
        preservePaths: false,
        strict: true,
        filter: (entryPath, entry) => {
          const check = validateEntry(normalizeEntryPath(entryPath), entry && entry.type);
          if (check.ok) return true;
          unsafe.push({ path: entryPath, reason: check.reason });
          return false;
        }
      });

      const stagingCheck = scanStaging(task.stagingDir);
      if (unsafe.length || !stagingCheck.ok) {
        const reasons = [...unsafe, ...stagingCheck.unsafe].slice(0, 8)
          .map((item) => `${item.path}: ${item.reason}`)
          .join('; ');
        const error = new Error(`Entradas no permitidas: ${reasons}`);
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

      for (let i = 0; i < files.length; i += 1) {
        assertNotCancelled();
        const manifestFile = files[i];
        const relParts = path.relative(stagingManifests, manifestFile).split(path.sep).filter(Boolean);
        try {
          const result = await importManifest({
            manifestFile,
            relParts,
            staging: task.stagingDir,
            manifestsRoot,
            blobsRoot,
            conflict,
            verify,
            progress: (extra) => progress(0.2 + (0.75 * (i / files.length)), extra.phase, extra)
          });
          result.file = task.file;
          result.fileName = task.fileName;
          result.seconds = (Date.now() - startedAt) / 1000;
          results.push(result);
          emit({ type: 'task-done', result });
        } catch (error) {
          if (error.code === 'E_CANCELLED' || cancelled) throw error;
          const result = {
            ok: false,
            file: task.file,
            fileName: task.fileName,
            model: identityFromRel(relParts),
            error: { code: error.code || 'E_UNKNOWN', message: error.message },
            seconds: (Date.now() - startedAt) / 1000
          };
          results.push(result);
          emit({ type: 'task-error', result });
        }
      }

      progress(0.99, 'commit');
      safeRm(task.stagingDir);
      emit({
        type: 'progress',
        phase: 'done',
        taskIndex: index + 1,
        taskCount: tasks.length,
        file: task.fileName,
        percent: Math.round(((index + 1) / tasks.length) * 100)
      });
    } catch (error) {
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
