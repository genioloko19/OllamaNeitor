import { createRequire } from 'node:module';
import { describe, it, expect, afterAll } from 'vitest';
import { resolveUserDataDir } from '../../src/core/paths.js';
import path from 'node:path';

const require = createRequire(import.meta.url);
const jobs = require('../../src/core/jobs.js');

afterAll(() => {
  jobs.cancelAll();
  jobs.clearHistory();
  jobs.setConcurrency(1);
});

describe('jobs', () => {
  it('serializa con concurrencia 1 y arranca el siguiente al terminar', async () => {
    jobs.setConcurrency(1);
    const started = [];
    const first = jobs.enqueue('test', {
      start: () => started.push('first')
    });
    const second = jobs.enqueue('test', {
      start: () => started.push('second')
    });
    expect(started).toEqual(['first']);
    expect(jobs.get(second.id).status).toBe('queued');

    jobs.finish(first.id, 'done', { ok: true });
    expect(started).toEqual(['first', 'second']);
    jobs.finish(second.id, 'done', { ok: true });

    const list = jobs.list();
    expect(list.find((job) => job.id === first.id).status).toBe('done');
    expect(list.find((job) => job.id === second.id).status).toBe('done');
  });

  it('cancela un trabajo en cola sin ejecutarlo', () => {
    jobs.setConcurrency(1);
    const started = [];
    const running = jobs.enqueue('test', { start: () => started.push('running') });
    const queued = jobs.enqueue('test', { start: () => started.push('queued') });
    expect(jobs.cancel(queued.id)).toBe(true);
    expect(jobs.get(queued.id).status).toBe('cancelled');
    jobs.finish(running.id, 'done');
    expect(started).toEqual(['running']);
  });

  it('guarda progreso y permite reenganchar por id', () => {
    const job = jobs.enqueue('test', { start: () => {} });
    jobs.updateProgress(job.id, { percent: 42, phase: 'copy' });
    const progress = jobs.get(job.id).progress;
    expect(progress.percent).toBe(42);
    expect(progress.phase).toBe('copy');
    jobs.finish(job.id, 'done');
  });

  it('poda el historial y limpia terminados', () => {
    jobs.setConcurrency(1);
    const made = [];
    for (let i = 0; i < 8; i += 1) {
      const job = jobs.enqueue('test', { start: () => {} });
      jobs.finish(job.id, 'done', { index: i });
      made.push(job.id);
    }
    expect(jobs.list().length).toBeLessThanOrEqual(jobs.historyLimit);
    jobs.clearHistory();
    expect(jobs.list().filter((job) => ['done', 'partial', 'error', 'cancelled'].includes(job.status))).toHaveLength(0);
  });
});

describe('resolveUserDataDir', () => {
  it('usa datos junto al portable cuando está empaquetado', () => {
    const result = resolveUserDataDir({
      portableDir: 'D:\\USB\\OllamaNeitor',
      appData: 'C:\\Users\\demo\\AppData\\Roaming',
      isPackaged: true
    });
    expect(result).toBe(path.join('D:\\USB\\OllamaNeitor', 'OllamaNeitorData'));
  });

  it('usa AppData para la versión instalada', () => {
    const result = resolveUserDataDir({
      portableDir: '',
      appData: 'C:\\Users\\demo\\AppData\\Roaming',
      isPackaged: true
    });
    expect(result).toBe(path.join('C:\\Users\\demo\\AppData\\Roaming', 'Neitor', 'OllamaNeitor'));
  });
});
