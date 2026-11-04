#!/usr/bin/env node
/** Captura las pantallas del manual en el orden del recorrido de usuario. */
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const PORT = Number(process.env.CDP_PORT) || 9222;
const OUT = resolve(process.env.TEMP || '.', 'opencode');
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function target() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const pages = await response.json();
      const page = pages.find((p) => p.type === 'page' && String(p.url).startsWith('app://neitor'));
      if (page) return page;
    } catch { /* ignore */ }
    await sleep(500);
  }
  throw new Error('No se encontró la página');
}

const page = await target();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.addEventListener('open', res, { once: true });
  ws.addEventListener('error', rej, { once: true });
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

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result?.value;
}

async function shot(name) {
  await sleep(450);
  const image = await send('Page.captureScreenshot', { format: 'png' });
  const file = resolve(OUT, `neitor-${name}.png`);
  writeFileSync(file, Buffer.from(image.data, 'base64'));
  console.log(`📸 ${file}`);
}

async function route(hash) {
  await evaluate(`location.hash = ${JSON.stringify(hash)}; true`);
  await sleep(800);
}

await send('Runtime.enable');
await send('Page.enable');
await sleep(700);

await route('#/dashboard');
await shot('manual-dashboard');

await route('#/models');
await shot('manual-models');

await route('#/export');
await shot('manual-export');

await route('#/import');
await shot('manual-import');

await route('#/chat');
await shot('manual-chat');

await route('#/settings');
await shot('manual-settings');

await evaluate(`document.getElementById('btn-trophies').click(); true`);
await sleep(600);
await shot('manual-trophies');
await evaluate(`document.getElementById('trophy-close').click(); true`);
await sleep(400);

await route('#/settings');
await evaluate(`document.querySelector('[data-select-theme="esmeralda"]').click(); document.querySelector('.variant-btn[data-variant="light"]').click(); true`);
await sleep(500);
await route('#/dashboard');
await shot('manual-light-dashboard');

await route('#/settings');
await evaluate(`document.querySelector('.variant-btn[data-variant="contrast"]').click(); true`);
await sleep(600);
await shot('manual-contrast');

await evaluate(`document.querySelector('[data-select-theme="cyber-neon"]').click(); document.querySelector('.variant-btn[data-variant="auto"]').click(); true`);
await sleep(500);

ws.close();
