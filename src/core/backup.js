'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const tar = require('tar');
const { fail } = require('./errors');
const { ensureDir } = require('./paths');

const MANIFEST = 'neitor-backup.json';

function allowedEntry(entryPath) {
  const normalized = String(entryPath || '').replace(/\\/g, '/');
  if (normalized === 'config.json' || normalized === 'achievements.json' || normalized === MANIFEST) return true;
  if (normalized === 'conversations/') return true;
  if (normalized.startsWith('conversations/') && !normalized.includes('..')) return true;
  return false;
}

function existingEntries(userDataDir) {
  const entries = [];
  if (fs.existsSync(path.join(userDataDir, 'config.json'))) entries.push('config.json');
  if (fs.existsSync(path.join(userDataDir, 'achievements.json'))) entries.push('achievements.json');
  if (fs.existsSync(path.join(userDataDir, 'conversations'))) entries.push('conversations');
  return entries;
}

async function createBackup({ userDataDir, file, appVersion = '1.1.0' }) {
  const entries = existingEntries(userDataDir);
  if (!entries.length) fail('E_NOT_FOUND', 'No hay datos que respaldar');
  ensureDir(path.dirname(file));
  const manifestFile = path.join(userDataDir, MANIFEST);
  const manifest = {
    schema: 1,
    app: 'OllamaNeitor',
    version: appVersion,
    createdAt: new Date().toISOString(),
    entries
  };
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2), 'utf8');
  try {
    await tar.create({
      gzip: true,
      file,
      cwd: userDataDir,
      portable: true
    }, [...entries, MANIFEST]);
  } finally {
    try { fs.rmSync(manifestFile, { force: true }); } catch { /* ignore */ }
  }
  const size = fs.statSync(file).size;
  return { file, size, sizeLabel: `${(size / 1024).toFixed(1)} KB`, entries, manifest };
}

async function prepareRestore({ userDataDir, file }) {
  if (!fs.existsSync(file)) fail('E_PATH_MISSING', `No existe el backup: ${file}`);
  const stagingDir = path.join(userDataDir, 'temp', `restore-${crypto.randomUUID()}`);
  ensureDir(stagingDir);
  const unsafe = [];

  try {
    await tar.x({
      file,
      cwd: stagingDir,
      preservePaths: false,
      strict: true,
      filter: (entryPath, entry) => {
        const normalized = String(entryPath || '').replace(/\\/g, '/');
        if (entry && !['File', 'Directory'].includes(entry.type)) {
          unsafe.push({ path: normalized, reason: `Tipo no permitido: ${entry.type}` });
          return false;
        }
        if (!allowedEntry(normalized)) {
          unsafe.push({ path: normalized, reason: 'Ruta no permitida en un backup' });
          return false;
        }
        return true;
      }
    });
  } catch (error) {
    fs.rmSync(stagingDir, { recursive: true, force: true });
    fail('E_TAR_INVALID', `No se pudo extraer el backup: ${error.message}`);
  }

  if (unsafe.length) {
    fs.rmSync(stagingDir, { recursive: true, force: true });
    fail('E_TAR_UNSAFE', `El backup contiene entradas no permitidas: ${unsafe.slice(0, 4).map((item) => item.path).join(', ')}`);
  }

  const manifestPath = path.join(stagingDir, MANIFEST);
  if (!fs.existsSync(manifestPath)) {
    fs.rmSync(stagingDir, { recursive: true, force: true });
    fail('E_TAR_INVALID', 'El backup no contiene neitor-backup.json');
  }
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch {
    fs.rmSync(stagingDir, { recursive: true, force: true });
    fail('E_TAR_INVALID', 'neitor-backup.json no es válido');
  }
  if (manifest.app !== 'OllamaNeitor' || Number(manifest.schema) !== 1) {
    fs.rmSync(stagingDir, { recursive: true, force: true });
    fail('E_TAR_INVALID', 'El backup pertenece a otra aplicación o esquema');
  }

  const configFile = path.join(stagingDir, 'config.json');
  if (fs.existsSync(configFile)) {
    try { JSON.parse(fs.readFileSync(configFile, 'utf8')); }
    catch {
      fs.rmSync(stagingDir, { recursive: true, force: true });
      fail('E_TAR_INVALID', 'config.json del backup no es válido');
    }
  }

  const backupsDir = path.join(userDataDir, 'backups');
  ensureDir(backupsDir);
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const preRestore = path.join(backupsDir, `pre-restore-${stamp}.tar.gz`);
  await createBackup({ userDataDir, file: preRestore, appVersion: manifest.version || '1.1.0' });

  return { stagingDir, manifest, preRestore };
}

function cleanup(stagingDir) {
  try { fs.rmSync(stagingDir, { recursive: true, force: true }); } catch { /* ignore */ }
}

function listBackups(userDataDir) {
  const dir = path.join(userDataDir, 'backups');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith('.tar.gz'))
    .map((name) => {
      const full = path.join(dir, name);
      const stat = fs.statSync(full);
      return { name, path: full, size: stat.size, modifiedAt: stat.mtime.toISOString() };
    })
    .sort((a, b) => new Date(b.modifiedAt) - new Date(a.modifiedAt));
}

module.exports = { createBackup, prepareRestore, cleanup, listBackups, allowedEntry };
