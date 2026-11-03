'use strict';

const { randomUUID } = require('node:crypto');
const { EventEmitter } = require('node:events');

class JobRegistry extends EventEmitter {
  constructor() {
    super();
    this.jobs = new Map();
  }

  create(type, meta = {}) {
    const id = meta.id || randomUUID();
    const job = {
      id,
      type,
      status: 'running',
      startedAt: new Date().toISOString(),
      cancel: meta.cancel || (() => {}),
      meta: meta.meta || {}
    };
    this.jobs.set(id, job);
    this.emit('started', job);
    return job;
  }

  get(id) {
    return this.jobs.get(id) || null;
  }

  finish(id, status = 'done', result = null) {
    const job = this.jobs.get(id);
    if (!job) return null;
    job.status = status;
    job.finishedAt = new Date().toISOString();
    if (result !== null && result !== undefined) job.result = result;
    this.emit('finished', job);
    return job;
  }

  waitFor(id, timeoutMs = 120000) {
    const job = this.jobs.get(id);
    if (!job) return Promise.reject(new Error(`Trabajo desconocido: ${id}`));
    if (job.status !== 'running' && job.status !== 'cancelling') return Promise.resolve(job);
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

  cancel(id) {
    const job = this.jobs.get(id);
    if (!job) return false;
    try { job.cancel(); } catch { /* ignore */ }
    job.status = 'cancelling';
    return true;
  }

  cancelAll() {
    for (const job of this.jobs.values()) {
      if (job.status === 'running') this.cancel(job.id);
    }
  }

  runningCount() {
    return [...this.jobs.values()].filter((job) => job.status === 'running').length;
  }

  list() {
    return [...this.jobs.values()];
  }
}

module.exports = new JobRegistry();
