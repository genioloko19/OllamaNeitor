'use strict';

const fs = require('node:fs');
const path = require('node:path');
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
    const blobFile = path.join(base.blobs, digestToBlobName(digest));
    try {
      const info = fs.statSync(blobFile);
      sizeBytes += info.size;
      blobCount += 1;
    } catch {
      missing.push(digest);
    }
  }
  const described = describeFromConfigBlob(base.blobs, manifest);
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

  const models = apiModels ? mergeApi(local, apiModels) : local;
  const totalBytes = models.reduce((sum, model) => sum + (Number(model.sizeBytes) || 0), 0);
  return {
    models,
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
      totalBytes
    }
  };
}

function blobStats(basePath) {
  const base = inspectBasePath(basePath);
  if (!base.hasBlobs) {
    return { ok: false, totalBytes: 0, blobCount: 0, orphanCount: 0, orphanBytes: 0, orphans: [], referenced: 0 };
  }
  const referenced = new Set();
  let manifests = 0;
  if (base.hasManifests) {
    for (const file of walkManifests(base.manifests)) {
      try {
        const manifest = readManifest(file);
        for (const digest of digestsOf(manifest)) referenced.add(digestToBlobName(digest));
        manifests += 1;
      } catch { /* ignore */ }
    }
  }
  let entries = [];
  try {
    entries = fs.readdirSync(base.blobs, { withFileTypes: true }).filter((entry) => entry.isFile());
  } catch { /* ignore */ }
  let totalBytes = 0;
  let orphanBytes = 0;
  const orphans = [];
  for (const entry of entries) {
    const full = path.join(base.blobs, entry.name);
    let size = 0;
    try { size = fs.statSync(full).size; } catch { continue; }
    totalBytes += size;
    if (!referenced.has(entry.name)) {
      orphanBytes += size;
      if (orphans.length < 500) orphans.push({ name: entry.name, size, sizeLabel: formatBytes(size) });
    }
  }
  return {
    ok: true,
    totalBytes,
    totalLabel: formatBytes(totalBytes),
    blobCount: entries.length,
    referenced: referenced.size,
    orphanCount: entries.length - referenced.size,
    orphanBytes,
    orphanLabel: formatBytes(orphanBytes),
    orphans: orphans.sort((a, b) => b.size - a.size),
    manifests
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
  deleteModel,
  clearCache
};
