'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const MAX_BYTES = 2 * 1024 * 1024;
const KEEP_FILES = 3;
const LEVELS = { debug: 10, info: 20, success: 20, warn: 30, error: 40 };

class Logger extends EventEmitter {
  constructor() {
    super();
    this.dir = null;
    this.file = null;
    this.level = 'info';
    this.buffer = [];
  }

  init(dir, level = 'info') {
    this.dir = dir;
    this.setLevel(level);
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, 'app.log');
    this.rotateIfNeeded();
  }

  setLevel(level) {
    this.level = LEVELS[level] ? level : 'info';
    return this.level;
  }

  rotateIfNeeded() {
    try {
      if (!this.file || !fs.existsSync(this.file)) return;
      const { size } = fs.statSync(this.file);
      if (size < MAX_BYTES) return;
      for (let i = KEEP_FILES - 1; i >= 1; i -= 1) {
        const from = path.join(this.dir, `app.${i}.log`);
        const to = path.join(this.dir, `app.${i + 1}.log`);
        if (fs.existsSync(from)) fs.renameSync(from, to);
      }
      fs.renameSync(this.file, path.join(this.dir, 'app.1.log'));
    } catch {
      /* la rotación nunca debe romper la app */
    }
  }

  write(level, message, meta) {
    if ((LEVELS[level] || 20) < (LEVELS[this.level] || 20)) return null;
    const entry = {
      ts: new Date().toISOString(),
      level,
      message: String(message),
      meta: meta || null
    };
    this.buffer.push(entry);
    if (this.buffer.length > 500) this.buffer.shift();
    try {
      if (this.file) {
        this.rotateIfNeeded();
        const metaText = meta ? ` ${JSON.stringify(meta)}` : '';
        fs.appendFileSync(this.file, `${entry.ts} [${level.toUpperCase()}] ${entry.message}${metaText}\n`, 'utf8');
      }
    } catch {
      /* ignore */
    }
    this.emit('log', entry);
    return entry;
  }

  info(message, meta) { return this.write('info', message, meta); }
  warn(message, meta) { return this.write('warn', message, meta); }
  error(message, meta) { return this.write('error', message, meta); }
  success(message, meta) { return this.write('success', message, meta); }
}

module.exports = new Logger();
