import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import manifest from '../../src/core/manifest.js';
import paths from '../../src/core/paths.js';

const tempDirs = [];
function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neitor-manifest-'));
  tempDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

describe('manifest', () => {
  it('traduce digests a nombres de blob', () => {
    expect(manifest.digestToBlobName('sha256:abc123')).toBe('sha256-abc123');
  });

  it('deriva identidad para library, usuario y hf.co', () => {
    const root = path.join('C:', 'models', 'manifests');
    const library = manifest.identityFromManifestPath(root, path.join(root, 'registry.ollama.ai', 'library', 'llama3', 'latest'));
    expect(library.name).toBe('llama3');
    expect(library.tag).toBe('latest');

    const user = manifest.identityFromManifestPath(root, path.join(root, 'registry.ollama.ai', 'socrates', 'custom', '8b'));
    expect(user.name).toBe('socrates/custom');
    expect(user.tag).toBe('8b');

    const hf = manifest.identityFromManifestPath(root, path.join(root, 'hf.co', 'bartowski', 'Qwen2.5', 'Q4_K_M'));
    expect(hf.name).toBe('hf.co/bartowski/Qwen2.5');
    expect(hf.tag).toBe('Q4_K_M');
  });

  it('construye rutas de manifiesto', () => {
    const root = path.join('C:', 'manifests');
    expect(manifest.manifestPathFor(root, 'llama3', 'latest')).toBe(path.join(root, 'registry.ollama.ai', 'library', 'llama3', 'latest'));
    expect(manifest.manifestPathFor(root, 'hf.co/user/repo', 'Q4')).toBe(path.join(root, 'hf.co', 'user', 'repo', 'Q4'));
  });

  it('lee familia y quantización del blob de configuración', () => {
    const base = tempDir();
    const blobs = path.join(base, 'blobs');
    fs.mkdirSync(blobs, { recursive: true });
    fs.writeFileSync(path.join(blobs, 'sha256-config'), JSON.stringify({
      model_family: 'qwen2',
      model_families: ['qwen2', 'qwen'],
      model_type: '7B',
      file_type: 'Q4_K_M',
      model_format: 'gguf'
    }));
    const info = manifest.describeFromConfigBlob(blobs, { config: { digest: 'sha256:config' } });
    expect(info.family).toBe('qwen2');
    expect(info.parameterSize).toBe('7B');
    expect(info.quantization).toBe('Q4_K_M');
  });

  it('formatea bytes', () => {
    expect(manifest.formatBytes(0)).toBe('0 B');
    expect(manifest.formatBytes(1024)).toBe('1.00 KB');
    expect(manifest.formatBytes(4.5 * 1024 ** 3)).toBe('4.50 GB');
  });
});

describe('paths', () => {
  it('sanea nombres y expande tokens de plantilla', () => {
    expect(paths.sanitizeName('llama:3/8b')).toBe('llama_3_8b');
    const name = paths.buildFileName('{modelo}_{tag}_{quant}', {
      name: 'llama3', tag: '8b', quantization: 'Q4_K_M'
    });
    expect(name).toBe('llama3_8b_Q4_K_M');
  });

  it('impide rutas fuera del área permitida', () => {
    expect(paths.isSubPath('C:/models', 'C:/models/blobs/x')).toBe(true);
    expect(paths.isSubPath('C:/models', 'C:/other/x')).toBe(false);
    expect(() => paths.assertInside('C:/models', 'C:/other')).toThrow();
  });
});
