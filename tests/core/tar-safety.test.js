import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import safety from '../../src/core/tar-safety.js';

const dirs = [];
function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neitor-safety-'));
  dirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});

describe('tar-safety', () => {
  it('acepta solo rutas del paquete', () => {
    expect(safety.validateEntryPath('manifests/registry.ollama.ai/library/demo/latest').ok).toBe(true);
    expect(safety.validateEntryPath('blobs/sha256-abc').ok).toBe(true);
    expect(safety.validateEntryPath('neitor.json').ok).toBe(true);
    expect(safety.validateEntryPath('../evil').ok).toBe(false);
    expect(safety.validateEntryPath('/etc/passwd').ok).toBe(false);
    expect(safety.validateEntryPath('C:/Windows/system32').ok).toBe(false);
    expect(safety.validateEntryPath('manifests/../evil').ok).toBe(false);
    expect(safety.validateEntryPath('manifests/\0evil').ok).toBe(false);
    expect(safety.validateEntryPath('evil.txt').ok).toBe(false);
  });

  it('rechaza enlaces y entradas especiales', () => {
    expect(safety.validateEntry('manifests/library/demo/latest', 'File').ok).toBe(true);
    expect(safety.validateEntry('manifests/library/demo', 'Directory').ok).toBe(true);
    expect(safety.validateEntry('blobs/sha256-abc', 'SymbolicLink').ok).toBe(false);
    expect(safety.validateEntry('blobs/sha256-abc', 'Link').ok).toBe(false);
    expect(safety.validateEntry('blobs/sha256-abc', 'CharacterDevice').ok).toBe(false);
    expect(safety.validateEntry('blobs/sha256-abc', 'FIFO').ok).toBe(false);
  });

  it('detecta archivos fuera del staging', () => {
    const root = tempDir();
    fs.mkdirSync(path.join(root, 'manifests', 'library', 'demo'), { recursive: true });
    fs.mkdirSync(path.join(root, 'blobs'), { recursive: true });
    fs.writeFileSync(path.join(root, 'neitor.json'), '{}');
    fs.writeFileSync(path.join(root, 'blobs', 'sha256-abc'), 'x');
    fs.writeFileSync(path.join(root, 'evil.txt'), 'no');
    expect(safety.scanStaging(root).ok).toBe(false);
  });

  it('acepta un staging limpio', () => {
    const root = tempDir();
    fs.mkdirSync(path.join(root, 'manifests', 'library', 'demo'), { recursive: true });
    fs.mkdirSync(path.join(root, 'blobs'), { recursive: true });
    fs.writeFileSync(path.join(root, 'neitor.json'), '{}');
    fs.writeFileSync(path.join(root, 'blobs', 'sha256-abc'), 'x');
    const result = safety.scanStaging(root);
    expect(result.ok).toBe(true);
    expect(result.unsafe).toEqual([]);
  });
});
