import { createRequire } from 'node:module';
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const config = require('../../src/core/config.js');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neitor-config-'));

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('config', () => {
  it('descarta claves heredadas y conserva la ventana', () => {
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
      schema: 1,
      version: '1.0.0',
      app_name: 'ollamaNeitor',
      flask: { host: '127.0.0.1', port: 5000 },
      ollama: { host: 'http://127.0.0.1:11434', basePath: 'C:/models' },
      appearance: { theme: 'esmeralda', variant: 'light', glass: 0.5, orbs: false },
      ui: { window: { width: 1200, height: 700, maximized: false }, acrylic: true, junk: 1 }
    }));

    const data = config.init(dir);
    expect(data.version).toBeUndefined();
    expect(data.app_name).toBeUndefined();
    expect(data.flask).toBeUndefined();
    expect(data.ui.junk).toBeUndefined();
    expect(data.ui.window.width).toBe(1200);
    expect(data.ui.acrylic).toBe(true);
    expect(data.ollama.basePath).toBe('C:/models');
    expect(data.appearance.theme).toBe('esmeralda');
    expect(data.appearance.variant).toBe('light');
  });

  it('mantiene los valores por defecto y la ventana al actualizar', () => {
    const updated = config.update({ ui: { performanceMode: true } });
    expect(updated.ui.performanceMode).toBe(true);
    expect(updated.ui.window.height).toBe(700);
    expect(updated.transfer.nameTemplate).toBe('{modelo}_{tag}');
    expect(updated.chat.temperature).toBe(0.7);
  });
});
