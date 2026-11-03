import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as tarModule from 'tar';
import importer from '../../src/core/importer.js';

const tar = tarModule.default && tarModule.default.c ? tarModule.default : tarModule;

const dirs = [];
function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neitor-import-'));
  dirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});

function makePackage() {
  const root = tempDir();
  const source = path.join(root, 'source');
  const manifests = path.join(source, 'manifests', 'registry.ollama.ai', 'library', 'demo');
  const blobs = path.join(source, 'blobs');
  fs.mkdirSync(manifests, { recursive: true });
  fs.mkdirSync(blobs, { recursive: true });

  fs.writeFileSync(path.join(blobs, 'sha256-config'), JSON.stringify({ model_format: 'gguf', model_family: 'demo' }));
  fs.writeFileSync(path.join(blobs, 'sha256-layer'), Buffer.alloc(100, 7));
  fs.writeFileSync(path.join(manifests, 'latest'), JSON.stringify({
    schemaVersion: 2,
    config: { digest: 'sha256:config', size: 40, mediaType: 'application/vnd.docker.container.image.v1+json' },
    layers: [
      { digest: 'sha256:layer', size: 100, mediaType: 'application/vnd.ollama.image.model' }
    ]
  }));

  const tarPath = path.join(root, 'demo.tar');
  return tar.c({ cwd: source, file: tarPath, portable: true }, ['manifests', 'blobs']).then(() => tarPath);
}

describe('importer', () => {
  it('rechaza rutas no permitidas', () => {
    expect(importer.isSafeEntry('manifests/registry.ollama.ai/library/demo/latest')).toBe(true);
    expect(importer.isSafeEntry('blobs/sha256-abc')).toBe(true);
    expect(importer.isSafeEntry('neitor.json')).toBe(true);
    expect(importer.isSafeEntry('../evil')).toBe(false);
    expect(importer.isSafeEntry('/etc/passwd')).toBe(false);
    expect(importer.isSafeEntry('C:/Windows/system32')).toBe(false);
    expect(importer.isSafeEntry('evil.txt')).toBe(false);
  });

  it('deriva la identidad de la ruta dentro del tar', () => {
    expect(importer.identityFromTarPath('manifests/registry.ollama.ai/library/llama3/latest')).toEqual({
      name: 'llama3', tag: 'latest', rel: ['registry.ollama.ai', 'library', 'llama3', 'latest']
    });
    expect(importer.identityFromTarPath('manifests/registry.ollama.ai/user/model/8b').name).toBe('user/model');
  });

  it('escanea un tar válido sin extraerlo', async () => {
    const tarPath = await makePackage();
    const result = await importer.scanTar(tarPath);
    expect(result.valid).toBe(true);
    expect(result.unsafe).toEqual([]);
    expect(result.models).toHaveLength(1);
    const model = result.models[0];
    expect(model.name).toBe('demo');
    expect(model.tag).toBe('latest');
    expect(model.sizeBytes).toBeGreaterThanOrEqual(100);
    expect(model.digests).toEqual(['sha256:config', 'sha256:layer']);
  });

  it('marca paquetes con entradas ajenas como inválidos', async () => {
    const root = tempDir();
    const source = path.join(root, 'evil');
    fs.mkdirSync(source, { recursive: true });
    fs.writeFileSync(path.join(source, 'evil.txt'), 'no debería estar aquí');
    const tarPath = path.join(root, 'evil.tar');
    await tar.c({ cwd: source, file: tarPath, portable: true }, ['evil.txt']);

    const result = await importer.scanTar(tarPath);
    expect(result.valid).toBe(false);
    expect(result.unsafe).toContain('evil.txt');
  });
});
