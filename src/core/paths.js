'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fail } = require('./errors');

function expandHome(input) {
  if (!input) return input;
  const value = String(input).trim();
  if (value === '~') return os.homedir();
  if (value.startsWith('~/') || value.startsWith('~\\')) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

function normalize(input) {
  return path.resolve(expandHome(input));
}

function exists(input) {
  try {
    return fs.existsSync(input);
  } catch {
    return false;
  }
}

function isDirectory(input) {
  try {
    return fs.statSync(input).isDirectory();
  } catch {
    return false;
  }
}

function isSubPath(parent, candidate) {
  let parentResolved = path.resolve(parent);
  let candidateResolved = path.resolve(candidate);
  if (process.platform === 'win32') {
    parentResolved = parentResolved.toLowerCase();
    candidateResolved = candidateResolved.toLowerCase();
  }
  const rel = path.relative(parentResolved, candidateResolved);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

const INVALID_SEGMENT = /[<>:"|?*\u0000-\u001f]/;
const INVALID_TAG = /[<>:"/\\|?*\u0000-\u001f]/;

function validateModelName(name) {
  const value = String(name || '').trim();
  if (!value) fail('E_PATH_INVALID', 'El nombre del modelo está vacío');
  if (value.startsWith('/') || value.startsWith('\\') || /^[a-zA-Z]:/.test(value)) {
    fail('E_PATH_INVALID', `Nombre de modelo absoluto no permitido: ${value}`);
  }
  if (value.includes('\\')) fail('E_PATH_INVALID', `Nombre de modelo inválido: ${value}`);
  const segments = value.split('/');
  for (const segment of segments) {
    if (!segment || segment === '.' || segment === '..') {
      fail('E_PATH_INVALID', `Segmento de modelo inválido en: ${value}`);
    }
    if (INVALID_SEGMENT.test(segment)) {
      fail('E_PATH_INVALID', `Caracteres no permitidos en el nombre del modelo: ${value}`);
    }
  }
  return segments.join('/');
}

function validateTag(tag) {
  const value = String(tag || '').trim();
  if (!value || value === '.' || value === '..') {
    fail('E_PATH_INVALID', `Tag inválido: ${tag}`);
  }
  if (INVALID_TAG.test(value) || value.startsWith('.')) {
    fail('E_PATH_INVALID', `Tag inválido: ${tag}`);
  }
  return value;
}

function validateModelIdentity(model) {
  return {
    name: validateModelName(model && model.name),
    tag: validateTag(model && model.tag)
  };
}

function resolveUserDataDir({ portableDir, appData, isPackaged = false } = {}) {
  const base = appData || path.join(os.homedir(), 'AppData', 'Roaming');
  if (isPackaged && portableDir) {
    return path.join(portableDir, 'OllamaNeitorData');
  }
  return path.join(base, 'Neitor', 'OllamaNeitor');
}

function ensureInside(parent, candidate, label = 'ruta') {
  const normalized = normalize(candidate);
  assertInside(parent, normalized, label);
  return normalized;
}

function assertInside(parent, candidate, label = 'ruta') {
  if (!isSubPath(parent, candidate)) {
    fail('E_PATH_INVALID', `La ${label} queda fuera del área permitida: ${candidate}`);
  }
  return candidate;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function defaultBasePath() {
  return path.join(os.homedir(), '.ollama', 'models');
}

function inspectBasePath(basePath) {
  const root = normalize(basePath || defaultBasePath());
  const manifests = path.join(root, 'manifests');
  const blobs = path.join(root, 'blobs');
  const hasManifests = isDirectory(manifests);
  const hasBlobs = isDirectory(blobs);
  let modelCount = 0;
  if (hasManifests) {
    try {
      modelCount = countFiles(manifests);
    } catch {
      modelCount = 0;
    }
  }
  return {
    basePath: root,
    manifests,
    blobs,
    hasManifests,
    hasBlobs,
    modelCount,
    valid: hasManifests && hasBlobs
  };
}

function countFiles(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) total += countFiles(path.join(dir, entry.name));
    else if (entry.isFile()) total += 1;
  }
  return total;
}

function sanitizeName(value, fallback = 'modelo') {
  const clean = String(value || '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '');
  return clean || fallback;
}

function buildFileName(template, model) {
  const values = {
    modelo: String(model.name || 'modelo').replace(/[\\/]/g, '_'),
    tag: model.tag || 'latest',
    familia: model.family || 'desconocida',
    quant: model.quantization || 'quant',
    fecha: new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-'),
    tamaño: model.parameterSize || model.tag || 'size'
  };
  let output = String(template || '{modelo}_{tag}');
  for (const [key, value] of Object.entries(values)) {
    output = output.split(`{${key}}`).join(sanitizeName(value, key));
  }
  output = output.replace(/[{}]/g, '').trim();
  return sanitizeName(output, sanitizeName(`${values.modelo}_${values.tag}`));
}

function uniquePath(dir, base, ext) {
  let candidate = path.join(dir, `${base}${ext}`);
  let index = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${base}-${index}${ext}`);
    index += 1;
  }
  return candidate;
}

function freeBytes(dir) {
  try {
    const stats = fs.statfsSync(dir);
    return Number(stats.bavail) * Number(stats.bsize);
  } catch {
    return null;
  }
}

module.exports = {
  expandHome,
  normalize,
  exists,
  isDirectory,
  isSubPath,
  assertInside,
  ensureInside,
  ensureDir,
  defaultBasePath,
  inspectBasePath,
  countFiles,
  sanitizeName,
  buildFileName,
  uniquePath,
  freeBytes,
  validateModelName,
  validateTag,
  validateModelIdentity,
  resolveUserDataDir
};
