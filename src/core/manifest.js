'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { fail } = require('./errors');

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    fail('E_TAR_INVALID', `No se pudo leer el manifiesto ${path.basename(file)}: ${error.message}`);
  }
}

function readManifest(file) {
  const manifest = readJson(file);
  if (!manifest || typeof manifest !== 'object' || !Array.isArray(manifest.layers)) {
    fail('E_TAR_INVALID', `Manifiesto inválido: ${file}`);
  }
  return manifest;
}

function isSafeDigest(digest) {
  const value = String(digest || '');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_+.-]{0,31}:[a-zA-Z0-9_+.-]{8,128}$/.test(value)) return false;
  if (value.includes('..')) return false;
  return true;
}

function digestToBlobName(digest) {
  if (!isSafeDigest(digest)) {
    const error = new Error(`Digest inválido o inseguro: ${digest}`);
    error.code = 'E_TAR_UNSAFE';
    throw error;
  }
  return String(digest).replace(':', '-');
}

function digestEntries(manifest) {
  const entries = [];
  if (manifest.config && manifest.config.digest) {
    entries.push({ role: 'config', ...manifest.config });
  }
  for (const layer of manifest.layers || []) {
    if (layer && layer.digest) entries.push({ role: 'layer', ...layer });
  }
  return entries;
}

function digestsOf(manifest) {
  return [...new Set(digestEntries(manifest).map((entry) => entry.digest))];
}

/** Deriva `name` y `tag` a partir de manifests/<registry>/<namespace>/<modelo>/<tag>. */
function identityFromManifestPath(manifestsRoot, manifestFile) {
  const rel = path.relative(manifestsRoot, manifestFile).split(path.sep).filter(Boolean);
  if (rel.length < 2) return { name: rel.join('/') || 'desconocido', tag: 'latest', registry: '', namespace: '' };
  const tag = rel[rel.length - 1];
  const model = rel[rel.length - 2];
  const prefix = rel.slice(0, -2).join('/');
  let name = model;
  if (prefix === 'registry.ollama.ai/library') name = model;
  else if (prefix.startsWith('registry.ollama.ai/')) name = `${prefix.slice('registry.ollama.ai/'.length)}/${model}`;
  else if (prefix) name = `${prefix}/${model}`;
  return {
    name,
    tag,
    registry: rel.length >= 3 ? rel[0] : '',
    namespace: rel.length >= 3 ? rel[1] : ''
  };
}

function manifestPathFor(manifestsRoot, name, tag) {
  const { validateModelIdentity, assertInside } = require('./paths');
  const identity = validateModelIdentity({ name, tag });
  const parts = identity.name.split('/').filter(Boolean);
  let target;
  if (parts.length === 1) {
    target = path.join(manifestsRoot, 'registry.ollama.ai', 'library', parts[0], identity.tag);
  } else if (parts[0] === 'hf.co' || parts[0].includes('.')) {
    target = path.join(manifestsRoot, ...parts, identity.tag);
  } else {
    target = path.join(manifestsRoot, 'registry.ollama.ai', ...parts, identity.tag);
  }
  assertInside(manifestsRoot, target, 'ruta del manifiesto');
  return target;
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
  const scaled = value / 1024 ** index;
  const decimals = scaled >= 100 || index === 0 ? 0 : scaled >= 10 ? 1 : 2;
  return `${scaled.toFixed(decimals)} ${units[index]}`;
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('es-ES', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
  });
}

/** Lee el blob de configuración para obtener familia, parámetros y quantización. */
function describeFromConfigBlob(blobsRoot, manifest) {
  const configEntry = manifest.config;
  if (!configEntry || !configEntry.digest) return {};
  const file = path.join(blobsRoot, digestToBlobName(configEntry.digest));
  try {
    const info = JSON.parse(fs.readFileSync(file, 'utf8'));
    const families = Array.isArray(info.model_families) && info.model_families.length
      ? info.model_families
      : info.model_family ? [info.model_family] : [];
    return {
      family: families[0] || '',
      families: families.slice(0, 4),
      parameterSize: info.model_type || '',
      quantization: info.file_type || '',
      format: info.model_format || ''
    };
  } catch {
    return {};
  }
}

module.exports = {
  readJson,
  readManifest,
  digestToBlobName,
  isSafeDigest,
  digestEntries,
  digestsOf,
  identityFromManifestPath,
  manifestPathFor,
  formatBytes,
  formatDate,
  describeFromConfigBlob
};
