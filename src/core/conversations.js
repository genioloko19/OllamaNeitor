'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

let dir = null;

function init(conversationsDir) {
  dir = conversationsDir;
  fs.mkdirSync(dir, { recursive: true });
}

function fileFor(id) {
  return path.join(dir, `${String(id).replace(/[^a-zA-Z0-9-]/g, '')}.json`);
}

function list() {
  if (!dir || !fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
        return {
          id: data.id,
          title: data.title || 'Conversación',
          model: data.model || '',
          updatedAt: data.updatedAt,
          messageCount: Array.isArray(data.messages) ? data.messages.length : 0
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
}

function get(id) {
  const file = fileFor(id);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function save(conversation) {
  if (!dir) throw new Error('Almacén de conversaciones no inicializado');
  const id = conversation.id || randomUUID();
  const messages = Array.isArray(conversation.messages) ? conversation.messages : [];
  const firstUser = messages.find((message) => message.role === 'user');
  const title = conversation.title || (firstUser ? String(firstUser.content).slice(0, 60) : 'Nueva conversación');
  const payload = {
    id,
    title,
    model: conversation.model || '',
    messages,
    createdAt: conversation.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  const file = fileFor(id);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
  fs.renameSync(tmp, file);
  return payload;
}

function remove(id) {
  const file = fileFor(id);
  if (fs.existsSync(file)) fs.rmSync(file, { force: true });
  return { id, removed: true };
}

module.exports = { init, list, get, save, remove };
