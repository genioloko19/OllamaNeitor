import { createRequire } from 'node:module';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const require = createRequire(import.meta.url);
const config = require('../../src/core/config.js');
const jobs = require('../../src/core/jobs.js');
const exporter = require('../../src/core/exporter.js');
const importer = require('../../src/core/importer.js');

const dirs = [];
function tempDir(prefix = 'neitor-transfer-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

function sha256(buffer) {
  return `sha256:${crypto.createHash('sha256').update(buffer).digest('hex')}`;
}

function makeBase({ corrupt = false } = {}) {
  const base = tempDir('neitor-base-');
  const manifests = path.join(base, 'manifests', 'registry.ollama.ai', 'library', 'demo');
  const blobs = path.join(base, 'blobs');
  fs.mkdirSync(manifests, { recursive: true });
  fs.mkdirSync(blobs, { recursive: true });

  const configBuffer = Buffer.from(JSON.stringify({ model_format: 'gguf', model_family: 'demo', model_type: '1B', file_type: 'Q4_0' }));
  const layerBuffer = crypto.randomBytes(4096);
  const configDigest = sha256(configBuffer);
  const layerDigest = sha256(layerBuffer);
  fs.writeFileSync(path.join(blobs, configDigest.replace(':', '-')), configBuffer);
  fs.writeFileSync(path.join(blobs, layerDigest.replace(':', '-')), layerBuffer);
  if (corrupt) {
    fs.writeFileSync(path.join(blobs, 'sha256-deadbeef'), Buffer.from('contenido corrupto'));
  }

  fs.writeFileSync(path.join(manifests, 'latest'), JSON.stringify({
    schemaVersion: 2,
    config: { digest: corrupt ? 'sha256:deadbeef' : configDigest, size: configBuffer.length },
    layers: [{ digest: layerDigest, size: layerBuffer.length }]
  }));

  return { base, configDigest, layerDigest };
}

function waitForResult(jobId, timeoutMs = 30000) {
  return jobs.waitFor(jobId, timeoutMs).then((job) => {
    if (job.status === 'error') throw new Error(job.error?.message || 'Error del trabajo');
    if (!job.result) throw new Error('El trabajo terminó sin resultado');
    return job.result;
  });
}

beforeAll(() => {
  const userData = tempDir('neitor-userdata-');
  config.init(userData);
});

afterAll(() => {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});

describe('transferencia completa (worker + tar + verificación)', () => {
  it('exporta, escanea e importa un modelo en una base limpia', async () => {
    const { base } = makeBase();
    const destDir = tempDir('neitor-export-');
    const started = await exporter.startExport({
      basePath: base,
      destDir,
      models: [{ name: 'demo', tag: 'latest' }],
      template: '{modelo}_{tag}',
      verify: true
    });

    const exported = await waitForResult(started.jobId);
    expect(exported.results).toHaveLength(1);
    expect(exported.results[0].ok).toBe(true);
    expect(fs.existsSync(started.outputs[0])).toBe(true);
    expect(fs.existsSync(`${started.outputs[0]}.part`)).toBe(false);

    const scanned = await importer.scanTar(started.outputs[0]);
    expect(scanned.valid).toBe(true);
    expect(scanned.models[0].name).toBe('demo');

    const destBase = tempDir('neitor-dest-');
    const importing = await importer.startImport({
      basePath: destBase,
      files: [started.outputs[0]],
      conflict: 'overwrite',
      verify: true
    });
    const imported = await waitForResult(importing.jobId);
    const result = imported.results.find((item) => item.ok);
    expect(result).toBeTruthy();
    expect(result.model.name).toBe('demo');
    expect(fs.existsSync(path.join(destBase, 'manifests', 'registry.ollama.ai', 'library', 'demo', 'latest'))).toBe(true);

    const blobs = fs.readdirSync(path.join(destBase, 'blobs'));
    expect(blobs.length).toBe(2);
    for (const blob of blobs) {
      const stat = fs.statSync(path.join(destBase, 'blobs', blob));
      expect(stat.size).toBeGreaterThan(0);
    }
  }, 40000);

  it('detecta un digest corrupto y limpia el staging', async () => {
    const { base } = makeBase({ corrupt: true });
    const destDir = tempDir('neitor-export-bad-');
    const started = await exporter.startExport({
      basePath: base,
      destDir,
      models: [{ name: 'demo', tag: 'latest' }],
      template: '{modelo}-{tag}',
      verify: true
    });
    const exported = await waitForResult(started.jobId);
    expect(exported.results[0].ok).toBe(false);
    expect(exported.results[0].error.code).toBe('E_DIGEST_MISMATCH');
    expect(fs.existsSync(started.outputs[0])).toBe(false);
  }, 40000);
});
