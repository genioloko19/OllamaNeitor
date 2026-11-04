'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DEFAULTS = {
  schema: 1,
  ollama: {
    host: 'http://127.0.0.1:11434',
    basePath: path.join(os.homedir(), '.ollama', 'models'),
    timeoutMs: 4000
  },
  transfer: {
    destDir: path.join(os.homedir(), 'Desktop', 'OllamaNeitor Export'),
    nameTemplate: '{modelo}_{tag}',
    verify: true,
    concurrency: 1,
    maxGb: 50
  },
  appearance: {
    theme: 'cyber-neon',
    variant: 'auto',
    glass: 0.8,
    orbs: true
  },
  chat: {
    temperature: 0.7,
    num_ctx: 4096,
    top_p: 0.9,
    numPredict: -1,
    maxHistory: 40,
    keepAlive: '5m',
    systemPrompt: ''
  },
  ui: {
    performanceMode: false,
    logLevel: 'info',
    acrylic: false,
    closeToTray: false,
    notifications: true,
    autoUpdate: true,
    window: null
  }
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function deepMerge(base, patch) {
  if (!isObject(patch)) return base;
  const out = isObject(base) ? { ...base } : {};
  for (const [key, value] of Object.entries(patch)) {
    if (isObject(value) && isObject(out[key])) out[key] = deepMerge(out[key], value);
    else if (value !== undefined) out[key] = value;
  }
  return out;
}

/** Elimina claves heredadas de configuraciones antiguas y valida tipos básicos. */
function sanitize(defaults, data) {
  const source = isObject(data) ? data : {};
  const out = {};
  for (const [key, fallback] of Object.entries(defaults)) {
    const incoming = source[key];
    if (isObject(fallback)) {
      out[key] = sanitize(fallback, isObject(incoming) ? incoming : {});
      continue;
    }
    if (incoming === undefined) {
      out[key] = fallback;
      continue;
    }
    if (fallback === null) {
      out[key] = incoming;
      continue;
    }
    if (typeof fallback === 'number') {
      const numeric = Number(incoming);
      out[key] = Number.isFinite(numeric) ? numeric : fallback;
      continue;
    }
    if (typeof fallback === 'boolean') {
      out[key] = Boolean(incoming);
      continue;
    }
    out[key] = typeof incoming === typeof fallback ? incoming : fallback;
  }
  return out;
}

class ConfigStore {
  constructor() {
    this.dir = null;
    this.file = null;
    this.data = clone(DEFAULTS);
  }

  init(userDataDir) {
    this.dir = userDataDir;
    fs.mkdirSync(this.dir, { recursive: true });
    this.file = path.join(this.dir, 'config.json');
    this.data = sanitize(DEFAULTS, this.load());
    this.save();
    return this.data;
  }

  load() {
    if (!this.file || !fs.existsSync(this.file)) return clone(DEFAULTS);
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return this.migrate(deepMerge(clone(DEFAULTS), raw));
    } catch {
      const backup = this.file && fs.existsSync(`${this.file}.bak`) ? `${this.file}.bak` : null;
      if (backup) {
        try {
          return this.migrate(deepMerge(clone(DEFAULTS), JSON.parse(fs.readFileSync(backup, 'utf8'))));
        } catch {
          /* cae a defaults */
        }
      }
      return clone(DEFAULTS);
    }
  }

  migrate(data) {
    if (!data.schema || data.schema < 1) data.schema = 1;
    return data;
  }

  save() {
    if (!this.file) return;
    const tmp = `${this.file}.tmp`;
    try {
      if (fs.existsSync(this.file)) fs.copyFileSync(this.file, `${this.file}.bak`);
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
      fs.renameSync(tmp, this.file);
    } catch (error) {
      try { fs.rmSync(tmp, { force: true }); } catch { /* ignore */ }
      throw error;
    }
  }

  get() {
    return clone(this.data);
  }

  update(patch) {
    this.data = sanitize(DEFAULTS, this.migrate(deepMerge(this.data, patch)));
    this.save();
    return this.get();
  }

  replace(data) {
    this.data = sanitize(DEFAULTS, this.migrate(data || {}));
    this.save();
    return this.get();
  }

  setAppearance(appearance) {
    return this.update({ appearance });
  }

  reset() {
    this.data = clone(DEFAULTS);
    this.save();
    return this.get();
  }

  paths() {
    return {
      root: this.dir,
      config: this.file,
      logs: path.join(this.dir, 'logs'),
      temp: path.join(this.dir, 'temp'),
      conversations: path.join(this.dir, 'conversations'),
      achievements: path.join(this.dir, 'achievements.json')
    };
  }
}

module.exports = new ConfigStore();
module.exports.DEFAULTS = DEFAULTS;
module.exports.deepMerge = deepMerge;
module.exports.sanitize = sanitize;
