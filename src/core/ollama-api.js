'use strict';

const { fail } = require('./errors');

function normalizeHost(host) {
  const value = String(host || 'http://127.0.0.1:11434').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(value)) fail('E_CONFIG', `Host de Ollama inválido: ${value}`);
  return value;
}

function withTimeout(ms, signal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(500, Number(ms) || 4000));
  if (signal) {
    if (typeof AbortSignal !== 'undefined' && AbortSignal.any) {
      const combined = AbortSignal.any([signal, controller.signal]);
      return { signal: combined, clear: () => clearTimeout(timer) };
    }
    if (signal.aborted) controller.abort();
    signal.addEventListener('abort', () => controller.abort(), { once: true });
  }
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

async function request(host, endpoint, options = {}) {
  const base = normalizeHost(host);
  const { method = 'GET', body, timeoutMs = 4000, signal } = options;
  const { signal: timeoutSignal, clear } = withTimeout(timeoutMs, signal);
  try {
    const response = await fetch(`${base}${endpoint}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: timeoutSignal
    });
    return response;
  } catch (error) {
    if (error && error.name === 'AbortError') {
      if (signal && signal.aborted) fail('E_CANCELLED', 'Operación cancelada');
      fail('E_NO_OLLAMA', `Ollama no responde en ${base}`);
    }
    fail('E_NO_OLLAMA', `No se pudo conectar con Ollama en ${base}`);
  } finally {
    clear();
  }
}

async function json(host, endpoint, options = {}) {
  const response = await request(host, endpoint, options);
  if (!response.ok) {
    let detail = '';
    try {
      const data = await response.json();
      detail = data.error || '';
    } catch { /* ignore */ }
    fail('E_NO_OLLAMA', detail || `Ollama devolvió HTTP ${response.status}`);
  }
  return response.json();
}

async function* ndjson(response) {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          yield JSON.parse(trimmed);
        } catch {
          /* línea parcial o mensaje no JSON */
        }
      }
    }
    const tail = buffer.trim();
    if (tail) {
      try { yield JSON.parse(tail); } catch { /* ignore */ }
    }
  } finally {
    try { reader.releaseLock(); } catch { /* ignore */ }
  }
}

async function version(host, timeoutMs = 1500) {
  const data = await json(host, '/api/version', { timeoutMs });
  return data.version || 'desconocida';
}

async function tags(host, timeoutMs = 2500) {
  const data = await json(host, '/api/tags', { timeoutMs });
  return Array.isArray(data.models) ? data.models : [];
}

async function ps(host, timeoutMs = 2500) {
  const data = await json(host, '/api/ps', { timeoutMs });
  return Array.isArray(data.models) ? data.models : [];
}

async function show(host, model, timeoutMs = 5000) {
  return json(host, '/api/show', { method: 'POST', body: { model }, timeoutMs });
}

async function unload(host, model, timeoutMs = 15000) {
  return json(host, '/api/generate', {
    method: 'POST',
    body: { model, prompt: '', stream: false, keep_alive: 0 },
    timeoutMs
  });
}

async function remove(host, model, timeoutMs = 15000) {
  return json(host, '/api/delete', { method: 'DELETE', body: { model }, timeoutMs });
}

async function pull({ host, model, onProgress, signal }) {
  const response = await request(host, '/api/pull', {
    method: 'POST',
    body: { model, stream: true },
    timeoutMs: 30000,
    signal
  });
  if (!response.ok) {
    let detail = '';
    try { detail = (await response.json()).error || ''; } catch { /* ignore */ }
    fail('E_NO_OLLAMA', detail || `No se pudo descargar ${model}`);
  }
  let last = null;
  for await (const event of ndjson(response)) {
    last = event;
    if (event.error) fail('E_NO_OLLAMA', event.error);
    if (onProgress) onProgress(event);
  }
  return last;
}

async function chat({ host, model, messages, options, keepAlive, onChunk, signal, timeoutMs = 300000 }) {
  const response = await request(host, '/api/chat', {
    method: 'POST',
    body: { model, messages, stream: true, options: options || {}, keep_alive: keepAlive || undefined },
    timeoutMs,
    signal
  });
  if (!response.ok) {
    let detail = '';
    try { detail = (await response.json()).error || ''; } catch { /* ignore */ }
    fail('E_NO_OLLAMA', detail || `El modelo ${model} no respondió`);
  }
  let final = null;
  for await (const event of ndjson(response)) {
    if (event.error) fail('E_NO_OLLAMA', event.error);
    const delta = event.message && event.message.content ? event.message.content : '';
    if (delta && onChunk) onChunk(delta);
    if (event.done) final = event;
  }
  return final;
}

async function status({ host, timeoutMs = 1500 }) {
  try {
    const [ver, tagList, running] = await Promise.all([
      version(host, timeoutMs),
      tags(host, timeoutMs),
      ps(host, timeoutMs).catch(() => [])
    ]);
    return { online: true, version: ver, modelCount: tagList.length, running };
  } catch (error) {
    return { online: false, version: null, modelCount: 0, running: [], error: error.message };
  }
}

module.exports = {
  normalizeHost,
  request,
  json,
  version,
  tags,
  ps,
  show,
  unload,
  remove,
  pull,
  chat,
  status,
  ndjson
};
