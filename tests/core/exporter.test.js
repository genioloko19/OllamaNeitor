import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import exporter from '../../src/core/exporter.js';

const dirs = [];
function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neitor-export-'));
  dirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});

function makeBase() {
  const base = tempDir();
  const manifests = path.join(base, 'manifests', 'registry.ollama.ai', 'library', 'demo');
  const blobs = path.join(base, 'blobs');
  fs.mkdirSync(manifests, { recursive: true });
  fs.mkdirSync(blobs, { recursive: true });
  const configDigest = `sha256:${'c'.repeat(64)}`;
  const layerDigest = `sha256:${'d'.repeat(64)}`;
  fs.writeFileSync(path.join(blobs, configDigest.replace(':', '-')), Buffer.alloc(20, 1));
  fs.writeFileSync(path.join(blobs, layerDigest.replace(':', '-')), Buffer.alloc(200, 2));
  fs.writeFileSync(path.join(manifests, 'latest'), JSON.stringify({
    schemaVersion: 2,
    config: { digest: configDigest, size: 20 },
    layers: [{ digest: layerDigest, size: 200 }]
  }));
  return { base, configDigest, layerDigest };
}

describe('exporter', () => {
  it('planifica archivos, tamaños y nombre de salida', () => {
    const { base: basePath } = makeBase();
    const destDir = tempDir();
    const plan = exporter.buildTasks({
      basePath,
      destDir,
      models: [{ name: 'demo', tag: 'latest' }],
      template: '{modelo}_{tag}',
      verify: true
    });
    expect(plan.tasks).toHaveLength(1);
    expect(plan.totalBytes).toBe(220);
    expect(plan.tasks[0].files).toHaveLength(3);
    expect(plan.tasks[0].outputFinal.endsWith('demo_latest.tar')).toBe(true);
    expect(plan.tasks[0].outputPart.endsWith('.part')).toBe(true);
  });

  it('reserva nombres distintos para modelos con la misma plantilla', () => {
    const { base: basePath } = makeBase();
    const destDir = tempDir();
    const plan = exporter.buildTasks({
      basePath,
      destDir,
      models: [
        { name: 'demo', tag: 'latest' },
        { name: 'demo', tag: 'latest' }
      ],
      template: '{modelo}_{tag}',
      verify: false
    });
    expect(plan.tasks).toHaveLength(2);
    expect(plan.tasks[0].outputFinal).not.toBe(plan.tasks[1].outputFinal);
    expect(plan.tasks[1].outputFinal.endsWith('-2.tar')).toBe(true);
  });

  it('rechaza modelos solo API sin manifiesto local', () => {
    const { base: basePath } = makeBase();
    const destDir = tempDir();
    expect(() => exporter.buildTasks({
      basePath,
      destDir,
      models: [{ name: 'solo-api', tag: 'latest', manifestPath: null }],
      template: '{modelo}_{tag}',
      verify: true
    })).toThrow(/no son exportables/);
  });

  it('falla si falta un blob', () => {
    const { base: basePath, layerDigest } = makeBase();
    fs.rmSync(path.join(basePath, 'blobs', layerDigest.replace(':', '-')));
    const destDir = tempDir();
    expect(() => exporter.buildTasks({
      basePath,
      destDir,
      models: [{ name: 'demo', tag: 'latest' }],
      template: '{modelo}_{tag}',
      verify: true
    })).toThrow(/no son exportables/);
  });

  it('falla con una ruta base inválida', () => {
    const destDir = tempDir();
    expect(() => exporter.buildTasks({
      basePath: path.join(tempDir(), 'nope'),
      destDir,
      models: [{ name: 'demo', tag: 'latest' }],
      template: '{modelo}_{tag}',
      verify: true
    })).toThrow();
  });
});
