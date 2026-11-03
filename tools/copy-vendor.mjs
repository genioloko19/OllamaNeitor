#!/usr/bin/env node
/** Copia las librerías de terceros a src/renderer/vendor para uso 100 % offline. */
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MODULES = resolve(ROOT, 'node_modules');
const VENDOR = resolve(ROOT, 'src/renderer/vendor');

const copies = [
  ['@fortawesome/fontawesome-free/css/all.min.css', 'fontawesome/css/all.min.css'],
  ['@fortawesome/fontawesome-free/webfonts', 'fontawesome/webfonts', true],
  ['chart.js/dist/chart.umd.min.js', 'chartjs/chart.umd.min.js'],
  ['sweetalert2/dist/sweetalert2.all.min.js', 'sweetalert2/sweetalert2.all.min.js'],
  ['sweetalert2/dist/sweetalert2.min.css', 'sweetalert2/sweetalert2.min.css'],
  ['animate.css/animate.min.css', 'animate.css/animate.min.css'],
  ['canvas-confetti/dist/confetti.browser.js', 'confetti/confetti.browser.js'],
  ['marked/lib/marked.umd.js', 'marked/marked.umd.js'],
  ['dompurify/dist/purify.min.js', 'dompurify/purify.min.js']
];

let missing = 0;
mkdirSync(VENDOR, { recursive: true });

for (const [from, to, recursive] of copies) {
  const source = resolve(MODULES, from);
  const target = resolve(VENDOR, to);
  if (!existsSync(source)) {
    console.warn(`  ⚠ No encontrado: ${source}`);
    missing += 1;
    continue;
  }
  mkdirSync(dirname(target), { recursive: true });
  cpSync(source, target, { recursive: Boolean(recursive), force: true });
  console.log(`  ✔ ${to}`);
}

if (missing) {
  console.warn(`\n${missing} archivo(s) no copiados. Ejecuta "npm install" y reintenta.`);
  process.exitCode = 1;
} else {
  console.log(`\nVendor listo en ${VENDOR}`);
}
