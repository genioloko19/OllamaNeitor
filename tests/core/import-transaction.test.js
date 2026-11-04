import { createRequire } from 'node:module';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import * as tarModule from 'tar';

const require = createRequire(import.meta.url);
const config = require('../../src/core/config.js');
const jobs = require('../../src/core/jobs.js');
const importer = require('../../src/core/importer.js');
const { digestToBlobName } = require('../../src/core/manifest.js');

const tar = tarModule.default && tarModule.default.c ? tarModule.default : tarModule;
const dirs = [];
function tempDir(prefix = 'neitor-tx-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}
const hash = (buffer) => `sha256:${crypto.createHash('sha256').update(buffer).digest('hex')}`;

function leftoverArtifacts(dir) {
  const names = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.includes('.part-') || entry.name.includes('.bak-')) names.push(full);
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return names;
}

function makeTar({ models }) {
  const root = tempDir('neitor-pkg-');
  const source = path.join(root, 'source');
  const blobs = path.join(source, 'blobs');
  fs.mkdirSync(blobs, { recursive: true });
  for (const model of models) {
    const manifestDir = path.join(source, 'manifests', 'registry.ollama.ai', 'library', model.name);
    fs.mkdirSync(manifestDir, { recursive: true });
    const layers = [];
    for (const [index, blob] of model.blobs.entries()) {
      const actualDigest = hash(blob);
      const declaredDigest = model.corrupt && index === model.corruptIndex ? hash(Buffer.from(`otro-${index}`)) : actualDigest;
      fs.writeFileSync(path.join(blobs, digestToBlobName(declaredDigest)), blob);
      layers.push({ digest: declaredDigest, size: blob.length });
    }
    fs.writeFileSync(path.join(manifestDir, 'latest'), JSON.stringify({ schemaVersion: 2, layers }));
  }
  const file = path.join(root, 'paquete.tar');
  return tar.c({ cwd: source, file, portable: true }, ['manifests', 'blobs']).then(() => file);
}

beforeAll(() => {
  config.init(tempDir('neitor-userdata-'));
});

afterAll(() => {
  jobs.cancelAll();
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});

async function runImport(basePath, file, conflict = 'overwrite') {
  const started = await importer.startImport({ basePath, files: [file], conflict, verify: true });
  const job = await jobs.waitFor(started.jobId, 30000);
  return job;
}

function makeDest() {
  const dest = tempDir('neitor-dest-');
  fs.mkdirSync(path.join(dest, 'manifests'), { recursive: true });
  fs.mkdirSync(path.join(dest, 'blobs'), { recursive: true });
  return dest;
}

describe('importación transaccional', () => {
  it('conserva el primer modelo cuando el segundo está corrupto', async () => {
    const file = await makeTar({
      models: [
        { name: 'alpha', blobs: [Buffer.from('blob alpha')] },
        { name: 'beta', blobs: [Buffer.from('blob beta')], corrupt: true, corruptIndex: 0 }
      ]
    });
    const dest = makeDest();
    const job = await runImport(dest, file);
    expect(job.status).toBe('partial');
    const results = job.result.results;
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toHaveLength(1);
    const failed = results.find((result) => !result.ok);
    expect(failed.error.code).toBe('E_DIGEST_MISMATCH');
    expect(fs.existsSync(path.join(dest, 'manifests', 'registry.ollama.ai', 'library', 'alpha', 'latest'))).toBe(true);
    expect(fs.existsSync(path.join(dest, 'manifests', 'registry.ollama.ai', 'library', 'beta', 'latest'))).toBe(false);
    expect(leftoverArtifacts(dest)).toEqual([]);
  }, 40000);

  it('omite sin tocar el manifiesto existente', async () => {
    const file = await makeTar({ models: [{ name: 'alpha', blobs: [Buffer.from('nuevo')] }] });
    const dest = makeDest();
    const manifest = path.join(dest, 'manifests', 'registry.ollama.ai', 'library', 'alpha', 'latest');
    fs.mkdirSync(path.dirname(manifest), { recursive: true });
    fs.writeFileSync(manifest, '{"antiguo":true}');
    const job = await runImport(dest, file, 'skip');
    const result = job.result.results[0];
    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(true);
    expect(fs.readFileSync(manifest, 'utf8')).toBe('{"antiguo":true}');
  }, 40000);

  it('renombra el tag cuando el modelo ya existe', async () => {
    const file = await makeTar({ models: [{ name: 'alpha', blobs: [Buffer.from('renombrado')] }] });
    const dest = makeDest();
    const original = path.join(dest, 'manifests', 'registry.ollama.ai', 'library', 'alpha', 'latest');
    fs.mkdirSync(path.dirname(original), { recursive: true });
    fs.writeFileSync(original, '{"antiguo":true}');
    const job = await runImport(dest, file, 'rename');
    const result = job.result.results[0];
    expect(result.ok).toBe(true);
    expect(result.model.tag).toBe('latest-imported');
    expect(fs.readFileSync(original, 'utf8')).toBe('{"antiguo":true}');
    expect(fs.existsSync(path.join(dest, 'manifests', 'registry.ollama.ai', 'library', 'alpha', 'latest-imported'))).toBe(true);
  }, 40000);

  it('sobrescribe con backup y no deja restos', async () => {
    const file = await makeTar({ models: [{ name: 'alpha', blobs: [Buffer.from('sobrescrito')] }] });
    const dest = makeDest();
    const manifest = path.join(dest, 'manifests', 'registry.ollama.ai', 'library', 'alpha', 'latest');
    fs.mkdirSync(path.dirname(manifest), { recursive: true });
    fs.writeFileSync(manifest, '{"antiguo":true}');
    const job = await runImport(dest, file, 'overwrite');
    const result = job.result.results[0];
    expect(result.ok).toBe(true);
    expect(result.replaced).toBe(true);
    expect(fs.readFileSync(manifest, 'utf8')).not.toBe('{"antiguo":true}');
    expect(leftoverArtifacts(dest)).toEqual([]);
  }, 40000);
});
