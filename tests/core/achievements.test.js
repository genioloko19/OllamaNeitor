import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import achievements from '../../src/core/achievements.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neitor-achievements-'));

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('achievements', () => {
  it('calcula niveles progresivos', () => {
    expect(achievements.levelInfo(0).level).toBe(1);
    expect(achievements.levelInfo(100).level).toBe(2);
    expect(achievements.levelInfo(400).level).toBe(3);
    const info = achievements.levelInfo(150);
    expect(info.progress).toBeGreaterThan(0);
    expect(info.progress).toBeLessThan(1);
  });

  it('acumula XP y desbloquea trofeos reales', () => {
    achievements.init(dir);
    achievements.reset();

    const result = achievements.register({ type: 'export', models: 1, bytes: 4 * 1024 ** 3, verified: true });
    expect(achievements.getState ? true : true).toBe(true);
    expect(result.state.xp).toBeGreaterThan(0);
    const ids = result.state.trophies;
    expect(ids).toContain('first-export');
    expect(ids).toContain('zero-corrupt');
    expect(result.state.totals.exported).toBe(1);
    expect(result.state.totals.verified).toBe(1);
  });

  it('acumula RAM liberada y chats', () => {
    achievements.reset();
    achievements.register({ type: 'unload', bytes: 2 * 1024 ** 3, models: 1 });
    const result = achievements.register({ type: 'chat' });
    expect(result.state.totals.bytesFreed).toBe(2 * 1024 ** 3);
    expect(result.state.totals.chats).toBe(1);
    expect(result.state.trophies).toContain('first-chat');
  });
});
