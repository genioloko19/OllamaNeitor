'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const TROPHIES = [
  { id: 'first-export', name: 'Primer paquete', description: 'Exportaste tu primer modelo.', icon: 'fa-box-open', xp: 50 },
  { id: 'first-import', name: 'Bienvenido a casa', description: 'Importaste tu primer modelo.', icon: 'fa-file-import', xp: 50 },
  { id: 'ten-models', name: 'Coleccionista', description: 'Transferiste 10 modelos.', icon: 'fa-layer-group', xp: 120 },
  { id: 'hundred-gb', name: 'Movimiento de masas', description: 'Transferiste 100 GB acumulados.', icon: 'fa-hard-drive', xp: 250 },
  { id: 'five-families', name: 'Taxónomo', description: 'Gestionaste modelos de 5 familias distintas.', icon: 'fa-sitemap', xp: 100 },
  { id: 'zero-corrupt', name: 'Guardián del dígito', description: 'Completaste una transferencia verificada sin corrupción.', icon: 'fa-shield-halved', xp: 80 },
  { id: 'first-chat', name: 'Primera palabra', description: 'Iniciaste tu primera conversación.', icon: 'fa-comments', xp: 40 },
  { id: 'ram-hunter', name: 'Cazador de RAM', description: 'Liberaste 5 modelos de la memoria.', icon: 'fa-microchip', xp: 90 },
  { id: 'night-owl', name: 'Búho nocturno', description: 'Usaste la app después de medianoche.', icon: 'fa-moon', xp: 30 }
];

const XP = {
  export: 10,
  import: 10,
  unload: 5,
  chat: 1,
  inventory: 2,
  verified: 5,
  per100mb: 1
};

function emptyState() {
  return {
    version: 1,
    xp: 0,
    totals: {
      exported: 0,
      imported: 0,
      bytesTransferred: 0,
      bytesFreed: 0,
      unloaded: 0,
      chats: 0,
      corruptions: 0,
      verified: 0
    },
    families: [],
    trophies: [],
    history: [],
    updatedAt: null
  };
}

function levelInfo(xp) {
  const level = Math.floor(Math.sqrt(Math.max(0, xp) / 100)) + 1;
  const start = 100 * (level - 1) ** 2;
  const next = 100 * level ** 2;
  const span = Math.max(1, next - start);
  return {
    level,
    xp,
    levelStart: start,
    nextLevelXp: next,
    progress: Math.min(1, Math.max(0, (xp - start) / span)),
    remaining: Math.max(0, next - xp)
  };
}

class Achievements extends EventEmitter {
  constructor() {
    super();
    this.file = null;
    this.state = emptyState();
  }

  init(userDataDir) {
    fs.mkdirSync(userDataDir, { recursive: true });
    this.file = path.join(userDataDir, 'achievements.json');
    if (fs.existsSync(this.file)) {
      try {
        this.state = { ...emptyState(), ...JSON.parse(fs.readFileSync(this.file, 'utf8')) };
      } catch {
        this.state = emptyState();
      }
    }
    return this.snapshot();
  }

  snapshot() {
    const unlocked = new Set(this.state.trophies);
    return {
      ...this.state,
      level: levelInfo(this.state.xp),
      catalog: TROPHIES.map((trophy) => ({ ...trophy, unlocked: unlocked.has(trophy.id) }))
    };
  }

  save() {
    if (!this.file) return;
    this.state.updatedAt = new Date().toISOString();
    try {
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2), 'utf8');
      fs.renameSync(tmp, this.file);
    } catch {
      /* no romper la app por no poder guardar logros */
    }
  }

  addXp(points, reason) {
    const amount = Math.max(0, Math.round(points));
    if (!amount) return;
    this.state.xp += amount;
    this.pushHistory('xp', { amount, reason });
    this.emit('xp', { amount, reason, ...levelInfo(this.state.xp) });
  }

  pushHistory(type, data) {
    this.state.history.push({ type, at: new Date().toISOString(), ...data });
    if (this.state.history.length > 60) this.state.history.shift();
  }

  unlock(id) {
    if (this.state.trophies.includes(id)) return null;
    const trophy = TROPHIES.find((item) => item.id === id);
    if (!trophy) return null;
    this.state.trophies.push(id);
    this.addXp(trophy.xp, `trofeo:${trophy.name}`);
    this.pushHistory('trophy', { id, name: trophy.name });
    this.emit('unlocked', { trophy, state: this.snapshot() });
    return trophy;
  }

  evaluate() {
    const t = this.state.totals;
    const unlocked = [];
    const check = (id, condition) => {
      if (condition) {
        const trophy = this.unlock(id);
        if (trophy) unlocked.push(trophy);
      }
    };
    check('first-export', t.exported >= 1);
    check('first-import', t.imported >= 1);
    check('ten-models', t.exported + t.imported >= 10);
    check('hundred-gb', t.bytesTransferred >= 100 * 1024 ** 3);
    check('five-families', this.state.families.length >= 5);
    check('zero-corrupt', t.verified >= 1 && t.corruptions === 0);
    check('first-chat', t.chats >= 1);
    check('ram-hunter', t.unloaded >= 5);
    check('night-owl', new Date().getHours() >= 0 && new Date().getHours() < 5);
    return unlocked;
  }

  register(event = {}) {
    const type = event.type;
    const bytes = Number(event.bytes) || 0;
    const models = Number(event.models) || 0;

    if (type === 'export' || type === 'import') {
      const key = type === 'export' ? 'exported' : 'imported';
      this.state.totals[key] += Math.max(1, models);
      this.state.totals.bytesTransferred += bytes;
      if (event.verified) this.state.totals.verified += 1;
      const corrupted = Math.max(0, Number(event.corrupted) || 0);
      if (corrupted) this.state.totals.corruptions += corrupted;
      const base = type === 'export' ? XP.export : XP.import;
      this.addXp(base * Math.max(1, models) + Math.floor(bytes / (100 * 1024 ** 2)) * XP.per100mb + (event.verified ? XP.verified : 0), type);
    }

    if (type === 'corruption') {
      this.state.totals.corruptions += Math.max(1, Number(event.count) || 1);
    }

    if (type === 'unload') {
      this.state.totals.unloaded += Math.max(1, models);
      this.state.totals.bytesFreed += bytes;
      this.addXp(XP.unload, 'unload');
    }

    if (type === 'chat') {
      this.state.totals.chats += 1;
      this.addXp(XP.chat, 'chat');
    }

    if (type === 'inventory') {
      const incoming = Array.isArray(event.families) ? event.families.filter(Boolean) : [];
      const merged = new Set([...this.state.families, ...incoming]);
      this.state.families = [...merged].slice(0, 40);
    }

    const unlocked = this.evaluate();
    this.pushHistory(type, { bytes, models });
    this.save();
    return { state: this.snapshot(), unlocked };
  }

  reset() {
    this.state = emptyState();
    this.save();
    this.emit('reset', this.snapshot());
    return this.snapshot();
  }
}

module.exports = new Achievements();
module.exports.TROPHIES = TROPHIES;
module.exports.levelInfo = levelInfo;
