#!/usr/bin/env node
/** Informe de contraste de las 36 combinaciones (tema × variante). */
import { audit } from './build-themes.mjs';

const { failures, rows } = audit();
const width = Math.max(...rows.map((row) => row.theme.length));
console.log(`${'TEMA'.padEnd(width)}  VARIANTE   PEOR RATIO`);
console.log(`${'-'.repeat(width)}  ---------  ----------`);
for (const row of rows) {
  console.log(`${row.theme.padEnd(width)}  ${row.variant.padEnd(9)}  ${row.worst.toFixed(2)}:1`);
}
if (failures.length) {
  console.error(`\n${failures.length} fallo(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log('\n✔ Las 36 combinaciones cumplen los umbrales de contraste.');
