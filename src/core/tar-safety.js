'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ALLOWED_PREFIXES = ['manifests/', 'blobs/'];
const ALLOWED_ROOT_FILES = new Set(['neitor.json']);
const SAFE_TYPES = new Set(['File', 'Directory', 'OldFile']);

function normalizeEntryPath(value) {
  return String(value || '').replace(/\\/g, '/');
}

function validateEntryPath(entryPath) {
  const normalized = normalizeEntryPath(entryPath);
  if (!normalized) return { ok: false, reason: 'Entrada vacía' };
  if (normalized.includes('\u0000')) return { ok: false, reason: 'NUL en la ruta' };
  if (normalized.startsWith('/')) return { ok: false, reason: 'Ruta absoluta' };
  if (/^[a-zA-Z]:/.test(normalized)) return { ok: false, reason: 'Ruta con unidad' };
  if (normalized.startsWith('//')) return { ok: false, reason: 'Ruta UNC' };
  const parts = normalized.split('/').filter(Boolean);
  if (!parts.length) return { ok: false, reason: 'Ruta vacía' };
  if (parts.some((part) => part === '..' || part === '.')) {
    return { ok: false, reason: 'Navegación con .. o .' };
  }
  const isAllowed = ALLOWED_PREFIXES.some((prefix) => normalized.startsWith(prefix))
    || ALLOWED_ROOT_FILES.has(normalized.replace(/\/+$/, ''));
  if (!isAllowed) return { ok: false, reason: 'Ruta fuera de manifests/, blobs/ o neitor.json' };
  return { ok: true, path: normalized };
}

function validateEntry(entryPath, type) {
  const pathCheck = validateEntryPath(entryPath);
  if (!pathCheck.ok) return pathCheck;
  if (type && !SAFE_TYPES.has(type)) {
    return { ok: false, reason: `Tipo de entrada no permitido: ${type}` };
  }
  return pathCheck;
}

function isSafeEntry(entryPath) {
  return validateEntryPath(entryPath).ok;
}

function walk(dir, out = []) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    out.push({ full: path.join(dir, entry.name), entry });
    if (entry.isDirectory()) walk(path.join(dir, entry.name), out);
  }
  return out;
}

/**
 * Verifica que el staging extraído solo contiene archivos regulares dentro de
 * manifests/, blobs/ o neitor.json, sin symlinks ni hardlinks.
 */
function scanStaging(stagingDir) {
  const root = path.resolve(stagingDir);
  const unsafe = [];
  let realRoot = root;
  try {
    realRoot = fs.realpathSync.native ? fs.realpathSync.native(root) : fs.realpathSync(root);
  } catch {
    return { ok: false, unsafe: [{ path: root, reason: 'No se pudo resolver el staging' }] };
  }

  for (const { full, entry } of walk(root)) {
    const rel = path.relative(root, full).split(path.sep).join('/');
    if (entry.isSymbolicLink()) {
      unsafe.push({ path: rel, reason: 'Enlace simbólico' });
      continue;
    }
    if (!entry.isFile() && !entry.isDirectory()) {
      unsafe.push({ path: rel, reason: 'Entrada especial' });
      continue;
    }
    if (entry.isDirectory()) {
      const dirRel = `${rel}/`;
      if (rel !== '' && !ALLOWED_PREFIXES.some((prefix) => dirRel.startsWith(prefix))) {
        unsafe.push({ path: rel, reason: 'Directorio fuera del paquete' });
      }
      continue;
    }
    const check = validateEntryPath(rel);
    if (!check.ok) {
      unsafe.push({ path: rel, reason: check.reason });
      continue;
    }
    try {
      const real = fs.realpathSync.native ? fs.realpathSync.native(full) : fs.realpathSync(full);
      const relative = path.relative(realRoot, real);
      if (relative.startsWith('..') || path.isAbsolute(relative)) {
        unsafe.push({ path: rel, reason: 'La ruta real escapa del staging' });
      }
    } catch {
      unsafe.push({ path: rel, reason: 'No se pudo resolver la ruta real' });
    }
  }

  return { ok: unsafe.length === 0, unsafe };
}

module.exports = {
  normalizeEntryPath,
  validateEntryPath,
  validateEntry,
  isSafeEntry,
  scanStaging,
  SAFE_TYPES
};
