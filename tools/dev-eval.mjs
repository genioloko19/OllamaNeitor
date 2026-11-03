#!/usr/bin/env node
/**
 * Evalúa una expresión en el renderer vía CDP.
 * Uso: node tools/dev-eval.mjs "document.title" [--shot nombre]
 * Requiere Electron con --remote-debugging-port=9222.
 */
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PORT = Number(process.env.CDP_PORT) || 9222;
const fileIndex = process.argv.indexOf('--file');
const expression = fileIndex >= 0
  ? readFileSync(process.argv[fileIndex + 1], 'utf8')
  : (process.argv[2] || '1');
const shotIndex = process.argv.indexOf('--shot');
const shotName = shotIndex >= 0 ? process.argv[shotIndex + 1] : null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function findTarget() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const targets = await response.json();
      const page = targets.find((target) => target.type === 'page' && String(target.url).startsWith('app://neitor'));
      if (page) return page;
    } catch { /* ignore */ }
    await sleep(400);
  }
  throw new Error('No se encontró la página');
}

const target = await findTarget();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolvePromise, reject) => {
  ws.addEventListener('open', resolvePromise, { once: true });
  ws.addEventListener('error', reject, { once: true });
});

let id = 0;
const pending = new Map();
ws.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const entry = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(message.error.message));
    else entry.resolve(message.result);
  }
});

function send(method, params = {}) {
  const requestId = ++id;
  return new Promise((resolvePromise, reject) => {
    pending.set(requestId, { resolve: resolvePromise, reject });
    ws.send(JSON.stringify({ id: requestId, method, params }));
  });
}

await send('Runtime.enable');
const result = await send('Runtime.evaluate', {
  expression,
  awaitPromise: true,
  returnByValue: true,
  userGesture: true
});

if (result.exceptionDetails) {
  console.error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  process.exitCode = 1;
} else {
  console.log(JSON.stringify(result.result?.value, null, 2));
}

if (shotName) {
  await sleep(500);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const dir = resolve(process.env.TEMP || '.', 'opencode');
  mkdirSync(dir, { recursive: true });
  const file = resolve(dir, `neitor-${shotName}.png`);
  writeFileSync(file, Buffer.from(shot.data, 'base64'));
  console.error(`📸 ${file}`);
}

ws.close();
