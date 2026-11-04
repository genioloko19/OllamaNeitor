'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const api = require('./ollama-api');
const logger = require('./logger');
const {
  readManifest,
  digestsOf,
  digestToBlobName,
  identityFromManifestPath,
  formatBytes,
  describeFromConfigBlob
} = require('./manifest');
const { inspectBasePath } = require('./paths');

const cache = new Map();

function walkManifests(dir, out = []) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkManifests(full, out);
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

function modelFromManifest(base, manifestsRoot, manifestFile) {
  let stat;
  try {
    stat = fs.statSync(manifestFile);
  } catch {
    return null;
  }
  const cached = cache.get(manifestFile);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.model;

  let manifest;
  try {
    manifest = readManifest(manifestFile);
  } catch (error) {
    logger.warn(`Manifiesto ilegible: ${manifestFile}`, { error: error.message });
    return null;
  }
  const identity = identityFromManifestPath(manifestsRoot, manifestFile);
  const digests = digestsOf(manifest);
  let sizeBytes = 0;
  let blobCount = 0;
  const missing = [];
  for (const digest of digests) {
    try {
      const blobFile = path.join(base.blobs, digestToBlobName(digest));
      const info = fs.statSync(blobFile);
      if (!info.isFile()) throw new Error('no es archivo');
      sizeBytes += info.size;
      blobCount += 1;
    } catch {
      missing.push(digest);
    }
  }
  let described = {};
  try {
    described = describeFromConfigBlob(base.blobs, manifest);
  } catch {
    described = {};
  }
  const model = {
    id: `${identity.name}:${identity.tag}`,
    name: identity.name,
    tag: identity.tag,
    manifestPath: manifestFile,
    digest: manifest.config ? manifest.config.digest : '',
    sizeBytes,
    blobCount,
    missingBlobs: missing.length,
    manifestBytes: stat.size,
    modifiedAt: stat.mtime.toISOString(),
    source: 'disk',
    exportable: missing.length === 0,
    exportBlockReason: missing.length ? `faltan ${missing.length} blob(s)` : '',
    ...described
  };
  cache.set(manifestFile, { mtimeMs: stat.mtimeMs, size: stat.size, model });
  return model;
}

function scanLocal(basePath) {
  const base = inspectBasePath(basePath);
  if (!base.hasManifests) return [];
  const files = walkManifests(base.manifests);
  const models = [];
  for (const file of files) {
    const model = modelFromManifest(base, base.manifests, file);
    if (model) models.push(model);
  }
  return models.sort((a, b) => a.id.localeCompare(b.id));
}

function splitName(value) {
  const raw = String(value || '');
  const index = raw.lastIndexOf(':');
  if (index > 0 && !raw.slice(index + 1).includes('/')) {
    return { name: raw.slice(0, index), tag: raw.slice(index + 1) };
  }
  return { name: raw, tag: 'latest' };
}

function mergeApi(local, apiModels) {
  const byId = new Map(local.map((model) => [model.id, { ...model }]));
  for (const item of apiModels) {
    const { name, tag } = splitName(item.name || item.model);
    const id = `${name}:${tag}`;
    const existing = byId.get(id);
    const details = item.details || {};
    const families = Array.isArray(details.families) && details.families.length
      ? details.families
      : details.family ? [details.family] : [];
    if (existing) {
      existing.source = 'both';
      existing.apiDigest = item.digest || existing.digest;
      existing.sizeBytes = Number(item.size) || existing.sizeBytes;
      existing.family = existing.family || details.family || families[0] || '';
      existing.families = existing.families && existing.families.length ? existing.families : families;
      existing.parameterSize = existing.parameterSize || details.parameter_size || '';
      existing.quantization = existing.quantization || details.quantization_level || '';
      existing.format = existing.format || details.format || '';
      existing.modifiedAt = item.modified_at || existing.modifiedAt;
      existing.exportable = Boolean(existing.manifestPath) && existing.missingBlobs === 0;
      existing.exportBlockReason = existing.exportable ? '' : 'sin manifiesto local';
    } else {
      byId.set(id, {
        id,
        name,
        tag,
        manifestPath: null,
        digest: item.digest || '',
        apiDigest: item.digest || '',
        sizeBytes: Number(item.size) || 0,
        blobCount: 0,
        missingBlobs: 0,
        modifiedAt: item.modified_at || null,
        source: 'api',
        exportable: false,
        exportBlockReason: 'solo API (sin manifiesto local)',
        family: details.family || families[0] || '',
        families,
        parameterSize: details.parameter_size || '',
        quantization: details.quantization_level || '',
        format: details.format || ''
      });
    }
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

async function listModels({ basePath, host, timeoutMs = 2500, includeApi = true }) {
  let local = [];
  let localError = null;
  try {
    local = scanLocal(basePath);
  } catch (error) {
    localError = error.message;
  }

  let apiModels = null;
  let apiError = null;
  let version = null;
  if (includeApi) {
    try {
      const [tagList, ver] = await Promise.all([
        api.tags(host, timeoutMs),
        api.version(host, timeoutMs).catch(() => null)
      ]);
      apiModels = tagList;
      version = ver;
    } catch (error) {
      apiError = error.message;
    }
  }

  const models = apiModels ? mergeApi(local, apiModels) : local.map((model) => ({
    ...model,
    exportable: Boolean(model.manifestPath) && model.missingBlobs === 0,
    exportBlockReason: model.missingBlobs ? `faltan ${model.missingBlobs} blob(s)` : ''
  }));
  const totalBytes = models.reduce((sum, model) => sum + (Number(model.sizeBytes) || 0), 0);
  return {
    models,
    base: inspectBasePath(basePath),
    ollama: {
      online: apiModels !== null,
      version,
      error: apiError,
      localError
    },
    summary: {
      count: models.length,
      localCount: local.length,
      diskBytes: local.reduce((sum, model) => sum + (Number(model.sizeBytes) || 0), 0),
      totalBytes,
      exportableCount: models.filter((model) => model.exportable).length
    }
  };
}

function blobStats(basePath) {
  const base = inspectBasePath(basePath);
  if (!base.hasBlobs) {
    return {
      ok: false,
      totalBytes: 0,
      totalLabel: '0 B',
      blobCount: 0,
      referencedCount: 0,
      referencedBytes: 0,
      referencedLabel: '0 B',
      missingCount: 0,
      missingBytes: 0,
      missingLabel: '0 B',
      orphanCount: 0,
      orphanBytes: 0,
      orphanLabel: '0 B',
      orphans: [],
      missing: [],
      manifestErrors: 0,
      manifests: 0
    };
  }

  const referenced = new Map();
  let manifests = 0;
  let manifestErrors = 0;
  if (base.hasManifests) {
    for (const file of walkManifests(base.manifests)) {
      try {
        const manifest = readManifest(file);
        for (const entry of [
          manifest.config,
          ...(Array.isArray(manifest.layers) ? manifest.layers : [])
        ]) {
          if (!entry || !entry.digest) continue;
          referenced.set(entry.digest, Number(entry.size) || 0);
        }
        manifests += 1;
      } catch {
        manifestErrors += 1;
      }
    }
  }

  const blobs = new Map();
  let entries = [];
  try {
    entries = fs.readdirSync(base.blobs, { withFileTypes: true }).filter((entry) => entry.isFile());
  } catch { /* ignore */ }
  for (const entry of entries) {
    try {
      const info = fs.statSync(path.join(base.blobs, entry.name));
      blobs.set(entry.name, info.size);
    } catch { /* ignore */ }
  }

  const orphans = [];
  const orphanNames = [];
  let totalBytes = 0;
  let orphanCount = 0;
  let orphanBytes = 0;
  for (const [name, size] of blobs) {
    totalBytes += size;
    const digest = name.replace(/^sha256-/, 'sha256:');
    if (!referenced.has(digest)) {
      orphanCount += 1;
      orphanBytes += size;
      orphanNames.push(name);
      if (orphans.length < 500) orphans.push({ name, size, sizeLabel: formatBytes(size) });
    }
  }

  let referencedCount = 0;
  let referencedBytes = 0;
  let missingCount = 0;
  let missingBytes = 0;
  const missing = [];
  for (const [digest, size] of referenced) {
    let blobName;
    try {
      blobName = digestToBlobName(digest);
    } catch {
      missingCount += 1;
      continue;
    }
    if (blobs.has(blobName)) {
      referencedCount += 1;
      referencedBytes += blobs.get(blobName);
    } else {
      missingCount += 1;
      missingBytes += size;
      if (missing.length < 500) missing.push({ digest, blobName, size, sizeLabel: formatBytes(size) });
    }
  }

  return {
    ok: true,
    totalBytes,
    totalLabel: formatBytes(totalBytes),
    blobCount: blobs.size,
    referencedCount,
    referencedBytes,
    referencedLabel: formatBytes(referencedBytes),
    missingCount,
    missingBytes,
    missingLabel: formatBytes(missingBytes),
    orphanCount,
    orphanBytes,
    orphanLabel: formatBytes(orphanBytes),
    orphans: orphans.sort((a, b) => b.size - a.size),
    orphanNames,
    missing,
    manifestErrors,
    manifests
  };
}

async function deleteOrphans({ basePath, names = null, dryRun = false } = {}) {
  const base = inspectBasePath(basePath);
  if (!base.hasBlobs) return { deleted: 0, freedBytes: 0, dryRun, candidates: [] };
  const stats = blobStats(basePath);
  const candidates = (stats.orphanNames || [])
    .filter((name) => !names || names.includes(name))
    .map((name) => {
      try {
        return { name, size: fs.statSync(path.join(base.blobs, name)).size };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  if (dryRun) {
    return { deleted: 0, freedBytes: candidates.reduce((sum, orphan) => sum + orphan.size, 0), dryRun: true, candidates };
  }
  let deleted = 0;
  let freedBytes = 0;
  for (const orphan of candidates) {
    try {
      fs.rmSync(path.join(base.blobs, orphan.name), { force: true });
      deleted += 1;
      freedBytes += orphan.size;
    } catch { /* ignore */ }
  }
  return { deleted, freedBytes, freedLabel: formatBytes(freedBytes), dryRun: false };
}

function hashFile(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(file, { highWaterMark: 1024 * 1024 });
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(`sha256:${hash.digest('hex')}`));
    stream.on('error', reject);
  });
}

async function verifyModel({ basePath, id }) {
  const local = scanLocal(basePath);
  const model = local.find((item) => item.id === id);
  if (!model || !model.manifestPath) {
    return { ok: false, id, error: 'No se encontró el manifiesto local', missing: [], corrupt: [] };
  }
  let manifest;
  try {
    manifest = readManifest(model.manifestPath);
  } catch (error) {
    return { ok: false, id, error: error.message, missing: [], corrupt: [] };
  }
  const base = inspectBasePath(basePath);
  const missing = [];
  const corrupt = [];
  let checked = 0;
  let bytes = 0;
  for (const digest of digestsOf(manifest)) {
    const blobFile = path.join(base.blobs, digestToBlobName(digest));
    if (!fs.existsSync(blobFile)) {
      missing.push(digest);
      continue;
    }
    const actual = await hashFile(blobFile);
    checked += 1;
    bytes += fs.statSync(blobFile).size;
    if (actual !== digest) corrupt.push({ digest, actual });
  }
  return {
    ok: missing.length === 0 && corrupt.length === 0,
    id,
    checked,
    bytes,
    bytesLabel: formatBytes(bytes),
    missing,
    corrupt
  };
}

function removeEmptyDirs(dir, stopAt) {
  let current = dir;
  while (current && current !== stopAt && current.startsWith(stopAt)) {
    try {
      if (fs.readdirSync(current).length === 0) {
        fs.rmdirSync(current);
        current = path.dirname(current);
      } else break;
    } catch {
      break;
    }
  }
}

async function deleteModel({ basePath, host, id }) {
  let removedViaApi = false;
  try {
    await api.remove(host, id, 15000);
    removedViaApi = true;
  } catch (error) {
    logger.warn(`No se pudo eliminar ${id} vía API: ${error.message}`);
  }

  const base = inspectBasePath(basePath);
  const local = scanLocal(basePath);
  const model = local.find((item) => item.id === id);
  if (!model || !model.manifestPath) {
    if (removedViaApi) return { id, removedViaApi, removedFiles: 0 };
    throw new Error(`No se encontró el modelo ${id}`);
  }

  const manifest = readManifest(model.manifestPath);
  const digests = digestsOf(manifest);
  const remaining = local.filter((item) => item.id !== id);
  const stillReferenced = new Set();
  for (const other of remaining) {
    if (!other.manifestPath) continue;
    try {
      for (const digest of digestsOf(readManifest(other.manifestPath))) {
        stillReferenced.add(digestToBlobName(digest));
      }
    } catch { /* ignore */ }
  }

  let removedFiles = 0;
  for (const digest of digests) {
    const blobName = digestToBlobName(digest);
    if (stillReferenced.has(blobName)) continue;
    const blobFile = path.join(base.blobs, blobName);
    try {
      fs.rmSync(blobFile, { force: true });
      removedFiles += 1;
    } catch { /* ignore */ }
  }
  try {
    fs.rmSync(model.manifestPath, { force: true });
    removedFiles += 1;
  } catch { /* ignore */ }
  removeEmptyDirs(path.dirname(model.manifestPath), base.manifests);
  cache.delete(model.manifestPath);
  return { id, removedViaApi, removedFiles, freedBytes: model.sizeBytes };
}

function clearCache() {
  cache.clear();
}

module.exports = {
  walkManifests,
  scanLocal,
  mergeApi,
  listModels,
  blobStats,
  deleteOrphans,
  verifyModel,
  deleteModel,
  clearCache
};
