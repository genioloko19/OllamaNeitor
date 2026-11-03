#!/usr/bin/env node
/**
 * Controlador de desarrollo por CDP.
 * Requiere lanzar Electron con --remote-debugging-port=9222.
 * Uso: node tools/dev-drive.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const PORT = Number(process.env.CDP_PORT) || 9222;
const OUT_DIR = process.env.SHOT_DIR || resolve(process.env.TEMP || '.', 'opencode');
mkdirSync(OUT_DIR, { recursive: true });

const errors = [];
let ws;
let nextId = 1;
const pending = new Map();

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function findTarget() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const targets = await response.json();
      const page = targets.find((target) => target.type === 'page' && String(target.url).startsWith('app://neitor'));
      if (page) return page;
    } catch { /* aún arrancando */ }
    await sleep(500);
  }
  throw new Error('No se encontró la página de OllamaNeitor en CDP');
}

function send(method, params = {}, timeout = 15000) {
  const id = nextId++;
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timeout CDP: ${method}`));
    }, timeout);
    pending.set(id, { resolve: resolvePromise, reject, timer });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true
  });
  if (result.exceptionDetails) {
    const message = result.exceptionDetails.exception?.description || result.exceptionDetails.text;
    errors.push(message);
    return { error: message };
  }
  return result.result?.value;
}

async function screenshot(name) {
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const file = resolve(OUT_DIR, `neitor-${name}.png`);
  writeFileSync(file, Buffer.from(shot.data, 'base64'));
  console.log(`  📸 ${file}`);
  return file;
}

async function route(hash, wait = 650) {
  await evaluate(`location.hash = ${JSON.stringify(hash)}; true`);
  await sleep(wait);
}

async function main() {
  const target = await findTarget();
  ws = new WebSocket(target.webSocketDebuggerUrl);

  await new Promise((resolvePromise, reject) => {
    ws.addEventListener('open', resolvePromise, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });

  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const entry = pending.get(message.id);
      clearTimeout(entry.timer);
      pending.delete(message.id);
      if (message.error) entry.reject(new Error(message.error.message));
      else entry.resolve(message.result);
      return;
    }
    if (message.method === 'Runtime.exceptionThrown') {
      const details = message.params.exceptionDetails;
      errors.push(details.exception?.description || details.text);
    }
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      errors.push(message.params.args.map((arg) => arg.value || arg.description).join(' '));
    }
  });

  await send('Runtime.enable');
  await send('Page.enable');
  await sleep(1200);

  const initial = await evaluate(`({
    ready: Boolean(window.neitor),
    theme: document.documentElement.dataset.theme,
    variant: document.documentElement.dataset.variant,
    pref: document.documentElement.dataset.variantPref,
    route: location.hash,
    models: document.querySelectorAll('#models-body tr').length,
    title: document.title
  })`);
  console.log('Estado inicial:', initial);

  await screenshot('dashboard');

  await route('#/models');
  console.log('Modelos:', await evaluate(`({
    rows: document.querySelectorAll('#models-body tr').length,
    count: document.querySelector('#models-count')?.textContent,
    families: [...document.querySelectorAll('#models-family option')].map(o => o.value)
  })`));
  await screenshot('models');

  await route('#/export');
  console.log('Exportar:', await evaluate(`({
    rows: document.querySelectorAll('#exp-body tr').length,
    dest: document.querySelector('#exp-dest')?.value,
    preview: document.querySelector('#exp-preview')?.textContent
  })`));
  await screenshot('export');

  await route('#/import');
  console.log('Importar:', await evaluate(`({
    rows: document.querySelectorAll('#imp-body tr').length,
    startDisabled: document.querySelector('#imp-start')?.disabled
  })`));
  await screenshot('import');

  await route('#/chat');
  console.log('Chat:', await evaluate(`({
    models: document.querySelectorAll('#chat-model option').length,
    messages: document.querySelectorAll('#chat-messages .msg').length,
    inputDisabled: document.querySelector('#chat-input')?.disabled
  })`));
  await screenshot('chat');

  await route('#/settings');
  await sleep(400);
  await screenshot('settings-appearance');

  const tabs = await evaluate(`(async () => {
    const out = [];
    for (const button of document.querySelectorAll('[data-tab]')) {
      button.click();
      await new Promise(r => setTimeout(r, 120));
      out.push({ tab: button.dataset.tab, heading: document.querySelector('#settings-panel h2, #settings-panel h3')?.textContent?.trim() || '' });
    }
    document.querySelector('[data-tab="appearance"]').click();
    await new Promise(r => setTimeout(r, 150));
    return out;
  })()`);
  console.log('Pestañas del panel:', tabs);

  const matrix = await evaluate(`(async () => {
    const out = [];
    const themes = [...document.querySelectorAll('[data-select-theme]')].map(button => button.dataset.selectTheme);
    for (const id of themes) {
      document.querySelector('[data-select-theme="' + id + '"]').click();
      await new Promise(r => setTimeout(r, 30));
      for (const variant of ['light', 'dark', 'contrast']) {
        document.querySelector('.variant-btn[data-variant="' + variant + '"]').click();
        await new Promise(r => setTimeout(r, 30));
        const root = document.documentElement;
        const styles = getComputedStyle(root);
        out.push({
          id,
          requested: variant,
          theme: root.dataset.theme,
          resolved: root.dataset.variant,
          pattern: root.dataset.pattern,
          orbs: root.dataset.orbCount,
          bg: styles.getPropertyValue('--bg').trim(),
          text: styles.getPropertyValue('--text').trim(),
          accent: styles.getPropertyValue('--accent').trim(),
          radius: styles.getPropertyValue('--radius-md').trim(),
          blur: styles.getPropertyValue('--blur-card').trim()
        });
      }
    }
    return out;
  })()`);

  console.log(`Combinaciones probadas: ${matrix.length}`);
  const invalid = matrix.filter((row) => !row.bg || !row.accent || !row.text || row.theme !== row.id || row.resolved !== row.requested);
  console.log('Combinaciones inválidas:', invalid.length ? invalid : 'ninguna');
  const geometries = new Set(matrix.map((row) => `${row.radius}|${row.pattern}|${row.orbs}|${row.blur}`));
  console.log('Perfiles de geometría distintos:', geometries.size);

  await evaluate(`document.querySelector('[data-select-theme="synthwave-80s"]').click(); document.querySelector('.variant-btn[data-variant="light"]').click(); true`);
  await sleep(500);
  await screenshot('settings-synthwave-light');

  await evaluate(`document.querySelector('[data-select-theme="glacial-artico"]').click(); document.querySelector('.variant-btn[data-variant="dark"]').click(); true`);
  await sleep(500);
  await screenshot('settings-glacial-dark');

  await evaluate(`document.querySelector('[data-select-theme="esmeralda"]').click(); document.querySelector('.variant-btn[data-variant="contrast"]').click(); true`);
  await sleep(500);
  await screenshot('settings-esmeralda-contrast');

  await evaluate(`document.querySelector('[data-select-theme="cyber-neon"]').click(); document.querySelector('.variant-btn[data-variant="auto"]').click(); true`);
  await sleep(500);

  await evaluate(`document.getElementById('btn-trophies').click(); true`);
  await sleep(500);
  await screenshot('trophies');
  await evaluate(`document.getElementById('trophy-close').click(); true`);

  await evaluate(`document.getElementById('btn-actions').click(); true`);
  await sleep(250);
  await screenshot('actions-menu');
  await evaluate(`document.body.click(); true`);

  await route('#/dashboard');
  await sleep(500);
  await screenshot('dashboard-final');

  console.log('\nErrores JS capturados:', errors.length ? errors : 'ninguno');
  ws.close();

  if (errors.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error('Fallo del controlador:', error);
  process.exit(1);
});
