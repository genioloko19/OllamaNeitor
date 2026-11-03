#!/usr/bin/env node
/**
 * Genera src/renderer/css/themes.generated.css a partir del registro de temas
 * y ejecuta la auditoría de contraste de las 36 combinaciones.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { THEMES, VARIANTS } from '../src/renderer/themes/registry.js';
import {
  contrast, composite, ensureContrast, mix, readableOn, rgba
} from './color.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT = resolve(ROOT, 'src/renderer/css/themes.generated.css');
const VARIANTS_REAL = VARIANTS.filter((v) => v.id !== 'auto').map((v) => v.id);

function tokensFor(theme, variant) {
  const [s1, s2, s3, s4] = theme.seeds;
  const isContrast = variant === 'contrast';
  const isLight = variant === 'light';

  const bg = isContrast ? '#000000' : isLight ? theme.bg.light : theme.bg.dark;
  const bg2 = isContrast ? '#000000' : mix(bg, s1, isLight ? 0.06 : 0.12);

  const surface = isContrast
    ? '#000000'
    : isLight
      ? 'rgba(255, 255, 255, 0.72)'
      : 'rgba(255, 255, 255, 0.06)';
  const surface2 = isContrast
    ? '#0a0a0a'
    : isLight
      ? 'rgba(255, 255, 255, 0.84)'
      : 'rgba(255, 255, 255, 0.09)';
  const surfaceStrong = isContrast
    ? '#111111'
    : isLight
      ? 'rgba(255, 255, 255, 0.94)'
      : 'rgba(255, 255, 255, 0.14)';

  const surfaceOnBg = composite(surface, bg);
  const strongOnBg = composite(surfaceStrong, bg);

  const text = isContrast ? '#ffffff' : isLight ? '#0b1220' : '#f8fafc';
  const muted = isContrast
    ? '#f2f2f2'
    : isLight
      ? 'rgba(15, 23, 42, 0.68)'
      : 'rgba(248, 250, 252, 0.68)';
  const soft = isContrast
    ? '#e6e6e6'
    : isLight
      ? 'rgba(15, 23, 42, 0.52)'
      : 'rgba(248, 250, 252, 0.5)';

  const border = isContrast
    ? '#ffffff'
    : isLight
      ? 'rgba(15, 23, 42, 0.14)'
      : 'rgba(255, 255, 255, 0.14)';
  const borderStrong = isContrast
    ? '#ffffff'
    : isLight
      ? 'rgba(15, 23, 42, 0.50)'
      : 'rgba(255, 255, 255, 0.35)';

  const accentRatio = isContrast ? 7 : 4.5;
  const accent = ensureContrast(s1, surfaceOnBg, accentRatio);
  const accent2 = ensureContrast(s2, surfaceOnBg, isContrast ? 7 : 4.5);
  const accent3 = ensureContrast(s3, surfaceOnBg, isContrast ? 7 : 4.5);
  const accent4 = ensureContrast(s4, surfaceOnBg, isContrast ? 7 : 4.5);
  const onAccent = isContrast ? '#000000' : readableOn(accent);

  const success = ensureContrast(isContrast ? '#4ade80' : isLight ? '#15803d' : '#34d399', bg, isContrast ? 7 : 4.5);
  const warning = ensureContrast(isContrast ? '#fde047' : isLight ? '#b45309' : '#fbbf24', bg, isContrast ? 7 : 4.5);
  const danger = ensureContrast(isContrast ? '#ff8080' : isLight ? '#b91c1c' : '#f87171', bg, isContrast ? 7 : 4.5);
  const info = ensureContrast(isContrast ? accent : isLight ? '#1d4ed8' : '#60a5fa', bg, isContrast ? 7 : 4.5);

  const glow = isContrast ? 'rgba(0, 0, 0, 0)' : rgba(s1, isLight ? 0.18 : 0.35);
  const patternColor = isContrast ? 'rgba(0, 0, 0, 0)' : rgba(s1, isLight ? 0.1 : 0.12);

  const shadow = isContrast
    ? 'none'
    : isLight
      ? `0 18px 48px rgba(15, 23, 42, ${(theme.geometry.shadow * 0.18).toFixed(2)})`
      : `0 18px 48px rgba(0, 0, 0, ${theme.geometry.shadow.toFixed(2)})`;
  const shadowPop = isContrast
    ? 'none'
    : isLight
      ? `0 26px 70px rgba(15, 23, 42, ${(theme.geometry.shadow * 0.26).toFixed(2)})`
      : `0 26px 70px rgba(0, 0, 0, ${(theme.geometry.shadow * 1.15).toFixed(2)})`;

  return {
    variant,
    bg,
    bg2,
    surface,
    surface2,
    surfaceStrong,
    surfaceOnBg,
    strongOnBg,
    text,
    muted,
    soft,
    border,
    borderStrong,
    accent,
    accent2,
    accent3,
    accent4,
    onAccent,
    success,
    warning,
    danger,
    info,
    glow,
    patternColor,
    shadow,
    shadowPop,
    radiusSm: `${theme.geometry.radiusSm}px`,
    radiusMd: `${theme.geometry.radiusMd}px`,
    radiusLg: `${theme.geometry.radiusLg}px`,
    radiusXl: `${theme.geometry.radiusXl}px`,
    pad: `${theme.geometry.pad}px`,
    gap: `${theme.geometry.gap}px`,
    space: `${theme.geometry.space}px`,
    borderW: `${theme.geometry.borderW}px`,
    blurPanel: isContrast ? '0px' : `${theme.geometry.blurPanel}px`,
    blurCard: isContrast ? '0px' : `${theme.geometry.blurCard}px`,
    orbOpacity: isContrast ? 0 : isLight ? theme.geometry.orbOpacity * 0.55 : theme.geometry.orbOpacity,
    orbSpeed: `${theme.geometry.orbSpeed}s`,
    s1, s2, s3, s4
  };
}

function geometryBlock(theme) {
  const g = theme.geometry;
  return `/* ${theme.name} — geometría propia */
:root[data-theme="${theme.id}"] {
  --radius-sm: ${g.radiusSm}px;
  --radius-md: ${g.radiusMd}px;
  --radius-lg: ${g.radiusLg}px;
  --radius-xl: ${g.radiusXl}px;
  --pad: ${g.pad}px;
  --gap: ${g.gap}px;
  --space: ${g.space}px;
  --border-w: ${g.borderW}px;
  --blur-panel: ${g.blurPanel}px;
  --blur-card: ${g.blurCard}px;
  --orb-opacity-theme: ${g.orbOpacity};
  --orb-speed: ${g.orbSpeed}s;
  --theme-name: "${theme.name}";
}`;
}

function variantBlock(theme, t) {
  return `:root[data-theme="${theme.id}"][data-variant="${t.variant}"] {
  color-scheme: ${t.variant === 'light' ? 'light' : 'dark'};
  --bg: ${t.bg};
  --bg-2: ${t.bg2};
  --bg-gradient: linear-gradient(145deg, ${t.bg} 0%, ${t.bg2} 58%, ${t.bg} 100%);
  --surface: ${t.surface};
  --surface-2: ${t.surface2};
  --surface-strong: ${t.surfaceStrong};
  --text: ${t.text};
  --text-muted: ${t.muted};
  --text-soft: ${t.soft};
  --border: ${t.border};
  --border-strong: ${t.borderStrong};
  --accent: ${t.accent};
  --accent-2: ${t.accent2};
  --accent-3: ${t.accent3};
  --accent-4: ${t.accent4};
  --accent-soft: ${rgba(t.accent, t.variant === 'contrast' ? 0.22 : 0.14)};
  --accent-line: ${rgba(t.accent, 0.4)};
  --on-accent: ${t.onAccent};
  --success: ${t.success};
  --warning: ${t.warning};
  --danger: ${t.danger};
  --info: ${t.info};
  --glow: ${t.glow};
  --pattern-color: ${t.patternColor};
  --shadow-card: ${t.shadow};
  --shadow-pop: ${t.shadowPop};
  --blur-panel: ${t.blurPanel};
  --blur-card: ${t.blurCard};
  --orb-1: ${t.s1};
  --orb-2: ${t.s2};
  --orb-3: ${t.s3};
  --orb-opacity: ${t.orbOpacity.toFixed(2)};
  --orb-speed: ${t.orbSpeed};
}`;
}

function buildCss() {
  const blocks = [
    '/* ============================================================\n' +
    '   GENERADO AUTOMÁTICAMENTE por tools/build-themes.mjs\n' +
    '   No editar a mano. Fuente: src/renderer/themes/registry.js\n' +
    '   ============================================================ */',
    ...THEMES.map(geometryBlock),
    ...THEMES.flatMap((theme) => VARIANTS_REAL.map((variant) => variantBlock(theme, tokensFor(theme, variant))))
  ];
  return `${blocks.join('\n\n')}\n`;
}

function audit() {
  const failures = [];
  const rows = [];
  for (const theme of THEMES) {
    for (const variant of VARIANTS_REAL) {
      const t = tokensFor(theme, variant);
      const minText = variant === 'contrast' ? 7 : 4.5;
      const minUi = variant === 'contrast' ? 4.5 : 3;
      const checks = [
        ['texto/fondo', contrast(t.text, t.surfaceOnBg), minText],
        ['texto atenuado/superficie', contrast(composite(t.muted, t.surfaceOnBg), t.surfaceOnBg), minText],
        ['acento principal/superficie', contrast(t.accent, t.surfaceOnBg), minText],
        ['acento 2/superficie', contrast(t.accent2, t.surfaceOnBg), minUi],
        ['acento 3/superficie', contrast(t.accent3, t.surfaceOnBg), minUi],
        ['borde fuerte/fondo', contrast(composite(t.borderStrong, t.bg), t.bg), minUi],
        ['texto sobre acento', contrast(t.onAccent, t.accent), 4.5],
        ['texto/superficie elevada', contrast(t.text, t.strongOnBg), minText]
      ];
      for (const [label, ratio, min] of checks) {
        if (ratio + 0.01 < min) {
          failures.push(`${theme.name} · ${variant} · ${label}: ${ratio.toFixed(2)} < ${min}`);
        }
      }
      const worst = Math.min(...checks.map((c) => c[1]));
      rows.push({ theme: theme.name, variant, worst });
    }
  }
  return { failures, rows };
}

export { tokensFor, audit, buildCss };

function main() {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, buildCss(), 'utf8');

  const BOOT_OUT = resolve(ROOT, 'src/renderer/themes/themes.boot.js');
  const bootData = {
    appearance: { theme: 'cyber-neon', variant: 'auto', glass: 0.8, orbs: true },
    themes: Object.fromEntries(THEMES.map((theme) => [theme.id, {
      pattern: theme.geometry.pattern,
      orbLayout: theme.geometry.orbLayout,
      orbCount: theme.geometry.orbCount,
      colors: {
        light: theme.bg.light,
        dark: theme.bg.dark,
        contrast: '#000000'
      }
    }]))
  };
  writeFileSync(
    BOOT_OUT,
    `/* GENERADO por tools/build-themes.mjs — no editar a mano. */\nwindow.__NEITOR_APP = ${JSON.stringify(bootData, null, 2)};\n`,
    'utf8'
  );

  const { failures, rows } = audit();
  console.log(`✔ ${THEMES.length} temas × ${VARIANTS_REAL.length} variantes = ${THEMES.length * VARIANTS_REAL.length} combinaciones generadas.`);
  console.log(`  ${OUT}`);
  const byVariant = VARIANTS_REAL.map((v) => {
    const subset = rows.filter((r) => r.variant === v);
    return `${v}: peor ratio ${Math.min(...subset.map((r) => r.worst)).toFixed(2)}:1`;
  });
  console.log(`  Contraste — ${byVariant.join(' · ')}`);

  if (failures.length) {
    console.error(`\n✖ ${failures.length} comprobaciones de contraste fallidas:`);
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exitCode = 1;
  } else {
    console.log('✔ Auditoría de contraste superada.');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
