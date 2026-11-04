'use strict';

const { randomUUID } = require('node:crypto');
const { EventEmitter } = require('node:events');

const DEFAULT_CONCURRENCY = 1;
const DEFAULT_HISTORY = 50;
const MAX_QUEUE = 100;

class JobRegistry extends EventEmitter {
  constructor() {
    super();
    this.jobs = new Map();
    this.queue = [];
    this.concurrency = DEFAULT_CONCURRENCY;
    this.historyLimit = DEFAULT_HISTORY;
  }

  setConcurrency(value) {
    const numeric = Math.max(1, Math.min(4, Number(value) || DEFAULT_CONCURRENCY));
    this.concurrency = numeric;
    this.process();
    return numeric;
  }

  enqueue(type, { meta = {}, start = null, cancel = null } = {}) {
    if (this.queue.length + this.runningCount() >= MAX_QUEUE) {
      const error = new Error('Hay demasiados trabajos en cola');
      error.code = 'E_BUSY';
      throw error;
    }
    const id = randomUUID();
    const job = {
      id,
      type,
      status: 'queued',
      createdAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null,
      meta,
      progress: null,
      result: null,
      error: null,
      start,
      cancel
    };
    this.jobs.set(id, job);
    this.queue.push(id);
    this.emitChanged();
    this.process();
    return this.toPublic(job);
  }

  process() {
    while (this.runningCount() < this.concurrency && this.queue.length) {
      const id = this.queue.shift();
      const job = this.jobs.get(id);
      if (!job || job.status !== 'queued') continue;
      job.status = 'running';
      job.startedAt = new Date().toISOString();
      this.emit('started', this.toPublic(job));
      this.emitChanged();
      try {
        if (typeof job.start === 'function') job.start(job);
      } catch (error) {
        this.fail(job.id, error);
      }
    }
  }

  get(id) {
    return this.jobs.get(id) || null;
  }

  getPublic(id) {
    const job = this.jobs.get(id);
    return job ? this.toPublic(job) : null;
  }

  toPublic(job) {
    return {
      id: job.id,
      type: job.type,
      status: job.status,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      meta: job.meta,
      progress: job.progress,
      result: job.result,
      error: job.error
    };
  }

  list({ limit = this.historyLimit } = {}) {
    const jobs = [...this.jobs.values()]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, Math.max(1, limit))
      .map((job) => this.toPublic(job));
    return jobs;
  }

  active(type = null) {
    return [...this.jobs.values()].filter((job) => (
      (job.status === 'running' || job.status === 'queued' || job.status === 'cancelling')
      && (!type || job.type === type)
    ));
  }

  runningCount() {
    return [...this.jobs.values()].filter((job) => job.status === 'running' || job.status === 'cancelling').length;
  }

  hasActive(type = null) {
    return this.active(type).length > 0;
  }

  updateProgress(id, payload) {
    const job = this.jobs.get(id);
    if (!job) return null;
    job.progress = { ...payload, updatedAt: new Date().toISOString() };
    this.emit('progress', { jobId: id, type: job.type, ...job.progress });
    return job.progress;
  }

  finish(id, status = 'done', result = null) {
    const job = this.jobs.get(id);
    if (!job) return null;
    job.status = status;
    job.finishedAt = new Date().toISOString();
    if (result !== null && result !== undefined) job.result = result;
    if (job.progress) job.progress.percent = 100;
    this.emit('finished', this.toPublic(job));
    this.emitChanged();
    this.prune();
    this.process();
    return this.toPublic(job);
  }

  fail(id, error) {
    const job = this.jobs.get(id);
    if (!job) return null;
    job.error = error && error.code
      ? { code: error.code, message: error.message }
      : { code: 'E_UNKNOWN', message: error && error.message ? error.message : String(error) };
    return this.finish(id, 'error');
  }

  cancel(id) {
    const job = this.jobs.get(id);
    if (!job) return false;
    if (job.status === 'queued') {
      job.status = 'cancelled';
      job.finishedAt = new Date().toISOString();
      this.queue = this.queue.filter((queued) => queued !== id);
      this.emit('cancelled', { jobId: id });
      this.emit('finished', this.toPublic(job));
      this.emitChanged();
      this.process();
      return true;
    }
    if (job.status === 'running') {
      job.status = 'cancelling';
      this.emitChanged();
      try {
        if (typeof job.cancel === 'function') job.cancel();
      } catch { /* ignore */ }
      setTimeout(() => {
        const current = this.jobs.get(id);
        if (current && current.status === 'cancelling') this.finish(id, 'cancelled');
      }, 15000).unref?.();
      return true;
    }
    return false;
  }

  cancelAll() {
    for (const job of [...this.jobs.values()]) {
      if (job.status === 'queued' || job.status === 'running') this.cancel(job.id);
    }
  }

  clearHistory() {
    for (const [id, job] of [...this.jobs.entries()]) {
      if (['done', 'partial', 'error', 'cancelled'].includes(job.status)) this.jobs.delete(id);
    }
    this.emitChanged();
    return this.list();
  }

  prune() {
    const finished = [...this.jobs.values()]
      .filter((job) => ['done', 'partial', 'error', 'cancelled'].includes(job.status))
      .sort((a, b) => new Date(b.finishedAt || 0) - new Date(a.finishedAt || 0));
    for (const job of finished.slice(this.historyLimit)) {
      this.jobs.delete(job.id);
    }
  }

  waitFor(id, timeoutMs = 120000) {
    const job = this.jobs.get(id);
    if (!job) return Promise.reject(new Error(`Trabajo desconocido: ${id}`));
    if (!['queued', 'running', 'cancelling'].includes(job.status)) return Promise.resolve(this.toPublic(job));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.removeListener('finished', onFinished);
        reject(new Error('Timeout esperando el trabajo'));
      }, timeoutMs);
      const onFinished = (finished) => {
        if (finished.id !== id) return;
        clearTimeout(timer);
        this.removeListener('finished', onFinished);
        resolve(finished);
      };
      this.on('finished', onFinished);
    });
  }

  emitChanged() {
    this.emit('changed', this.list());
  }
}

module.exports = new JobRegistry();
