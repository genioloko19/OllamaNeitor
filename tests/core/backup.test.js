import { createRequire } from 'node:module';
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const backup = require('../../src/core/backup.js');

const dirs = [];
function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neitor-backup-'));
  dirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});

function makeUserData() {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ schema: 1, appearance: { theme: 'esmeralda' } }));
  fs.writeFileSync(path.join(dir, 'achievements.json'), JSON.stringify({ version: 1, xp: 50, totals: {}, trophies: [] }));
  fs.mkdirSync(path.join(dir, 'conversations'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'conversations', 'a.json'), JSON.stringify({ id: 'a', messages: [] }));
  return dir;
}

describe('backup', () => {
  it('crea un tar.gz con manifiesto y datos', async () => {
    const userDataDir = makeUserData();
    const file = path.join(tempDir(), 'backup.tar.gz');
    const result = await backup.createBackup({ userDataDir, file, appVersion: '1.1.0' });
    expect(fs.existsSync(file)).toBe(true);
    expect(result.entries).toContain('config.json');
    expect(result.entries).toContain('conversations');
    expect(result.manifest.app).toBe('OllamaNeitor');

    const prepared = await backup.prepareRestore({ userDataDir, file });
    expect(prepared.manifest.version).toBe('1.1.0');
    expect(fs.existsSync(path.join(prepared.stagingDir, 'config.json'))).toBe(true);
    expect(fs.existsSync(path.join(prepared.stagingDir, 'conversations', 'a.json'))).toBe(true);
    expect(fs.existsSync(prepared.preRestore)).toBe(true);
    backup.cleanup(prepared.stagingDir);
  });

  it('rechaza un archivo que no es backup', async () => {
    const userDataDir = makeUserData();
    const file = path.join(tempDir(), 'basura.tar.gz');
    fs.writeFileSync(file, 'no es un tar');
    await expect(backup.prepareRestore({ userDataDir, file })).rejects.toThrow();
  });
});
