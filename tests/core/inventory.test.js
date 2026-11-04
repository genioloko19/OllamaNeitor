import { createRequire } from 'node:module';
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const require = createRequire(import.meta.url);
const inventory = require('../../src/core/inventory.js');
const { digestToBlobName } = require('../../src/core/manifest.js');

const dirs = [];
function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neitor-inventory-'));
  dirs.push(dir);
  return dir;
}
const hash = (buffer) => `sha256:${crypto.createHash('sha256').update(buffer).digest('hex')}`;

afterAll(() => {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});

function writeManifest(base, name, tag, layers) {
  const dir = path.join(base, 'manifests', 'registry.ollama.ai', 'library', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, tag), JSON.stringify({ schemaVersion: 2, layers }));
}

function makeBase() {
  const base = tempDir();
  const blobs = path.join(base, 'blobs');
  fs.mkdirSync(blobs, { recursive: true });
  const shared = Buffer.from('contenido compartido');
  const layerB = Buffer.from('capa de B');
  const orphan = Buffer.from('blob huérfano');
  const missing = Buffer.from('blob que no existe');
  const sharedDigest = hash(shared);
  const layerBDigest = hash(layerB);
  const missingDigest = hash(missing);
  const orphanDigest = hash(orphan);
  fs.writeFileSync(path.join(blobs, digestToBlobName(sharedDigest)), shared);
  fs.writeFileSync(path.join(blobs, digestToBlobName(layerBDigest)), layerB);
  fs.writeFileSync(path.join(blobs, digestToBlobName(orphanDigest)), orphan);
  writeManifest(base, 'alpha', 'latest', [
    { digest: sharedDigest, size: shared.length },
    { digest: missingDigest, size: missing.length }
  ]);
  writeManifest(base, 'beta', 'latest', [
    { digest: sharedDigest, size: shared.length },
    { digest: layerBDigest, size: layerB.length }
  ]);
  fs.mkdirSync(path.join(base, 'manifests', 'registry.ollama.ai', 'library', 'broken'), { recursive: true });
  fs.writeFileSync(path.join(base, 'manifests', 'registry.ollama.ai', 'library', 'broken', 'latest'), '{no-json');
  return { base, sharedDigest, layerBDigest, missingDigest, orphanDigest, sizes: { shared: shared.length, layerB: layerB.length, orphan: orphan.length, missing: missing.length } };
}

describe('inventory', () => {
  it('calcula huérfanos, faltantes y errores de manifiesto sin cifras negativas', () => {
    const { base, sizes } = makeBase();
    const stats = inventory.blobStats(base);
    expect(stats.ok).toBe(true);
    expect(stats.blobCount).toBe(3);
    expect(stats.referencedCount).toBe(2);
    expect(stats.missingCount).toBe(1);
    expect(stats.orphanCount).toBe(1);
    expect(stats.orphanBytes).toBe(sizes.orphan);
    expect(stats.missingBytes).toBe(sizes.missing);
    expect(stats.manifestErrors).toBe(1);
    expect(stats.orphanCount).toBeGreaterThanOrEqual(0);
  });

  it('borra solo huérfanos y respeta blobs compartidos', async () => {
    const { base, orphanDigest, sharedDigest } = makeBase();
    const dry = await inventory.deleteOrphans({ basePath: base, dryRun: true });
    expect(dry.deleted).toBe(0);
    expect(dry.candidates).toHaveLength(1);

    const result = await inventory.deleteOrphans({ basePath: base });
    expect(result.deleted).toBe(1);
    expect(fs.existsSync(path.join(base, 'blobs', digestToBlobName(orphanDigest)))).toBe(false);
    expect(fs.existsSync(path.join(base, 'blobs', digestToBlobName(sharedDigest)))).toBe(true);
    expect(inventory.blobStats(base).orphanCount).toBe(0);
  });

  it('verifica integridad y detecta blobs faltantes', async () => {
    const { base } = makeBase();
    const alpha = await inventory.verifyModel({ basePath: base, id: 'alpha:latest' });
    expect(alpha.ok).toBe(false);
    expect(alpha.missing).toHaveLength(1);
    expect(alpha.corrupt).toHaveLength(0);

    const beta = await inventory.verifyModel({ basePath: base, id: 'beta:latest' });
    expect(beta.ok).toBe(true);
    expect(beta.checked).toBe(2);
  });

  it('marca modelos solo API o con blobs faltantes como no exportables', async () => {
    const { base } = makeBase();
    const result = await inventory.listModels({
      basePath: base,
      host: 'http://127.0.0.1:1',
      timeoutMs: 500,
      includeApi: true
    });
    expect(result.base.valid).toBe(true);
    const alpha = result.models.find((model) => model.id === 'alpha:latest');
    const beta = result.models.find((model) => model.id === 'beta:latest');
    expect(alpha.exportable).toBe(false);
    expect(beta.exportable).toBe(true);
    expect(result.summary.exportableCount).toBe(1);
  });

  it('elimina un modelo sin borrar blobs compartidos', async () => {
    const { base, layerBDigest, sharedDigest } = makeBase();
    const result = await inventory.deleteModel({ basePath: base, host: 'http://127.0.0.1:1', id: 'beta:latest' });
    expect(result.removedFiles).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(base, 'blobs', digestToBlobName(layerBDigest)))).toBe(false);
    expect(fs.existsSync(path.join(base, 'blobs', digestToBlobName(sharedDigest)))).toBe(true);
  });
});
