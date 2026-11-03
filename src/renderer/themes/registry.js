/**
 * OllamaNeitor — Registro de temas
 * 12 temas autocontenidos (sin agrupación). Cada tema define su propia
 * paleta, geometría, patrón de fondo y disposición de orbes.
 *
 * Este archivo es la única fuente de verdad. `tools/build-themes.mjs`
 * genera `src/renderer/css/themes.generated.css` a partir de él.
 */

export const VARIANTS = [
  { id: 'light', name: 'Claro', icon: 'fa-sun', title: 'Modo claro' },
  { id: 'dark', name: 'Oscuro', icon: 'fa-moon', title: 'Modo oscuro' },
  { id: 'contrast', name: 'Alto contraste', icon: 'fa-circle-half-stroke', title: 'Modo de alto contraste' },
  { id: 'auto', name: 'Auto', icon: 'fa-display', title: 'Seguir el tema de Windows' }
];

export const THEMES = [
  {
    id: 'cyber-neon',
    name: 'Cyber Neón',
    tagline: 'Azul eléctrico, violeta y cian sobre noche profunda.',
    icon: 'fa-bolt',
    seeds: ['#3b82f6', '#8b5cf6', '#d946ef', '#22d3ee'],
    bg: { dark: '#060a14', light: '#eef4ff' },
    geometry: {
      radiusSm: 10, radiusMd: 16, radiusLg: 20, radiusXl: 28,
      pad: 20, gap: 16, space: 8, borderW: 1,
      blurPanel: 24, blurCard: 24, shadow: 0.55,
      pattern: 'mesh', orbCount: 3, orbLayout: 'corners', orbOpacity: 0.55, orbSpeed: 18
    }
  },
  {
    id: 'esmeralda',
    name: 'Esmeralda',
    tagline: 'Verdes botánicos con superficies amplias y aire.',
    icon: 'fa-leaf',
    seeds: ['#059669', '#10b981', '#34d399', '#6ee7b7'],
    bg: { dark: '#04120d', light: '#eefaf3' },
    geometry: {
      radiusSm: 14, radiusMd: 22, radiusLg: 28, radiusXl: 36,
      pad: 24, gap: 20, space: 10, borderW: 1.5,
      blurPanel: 26, blurCard: 22, shadow: 0.45,
      pattern: 'aurora', orbCount: 3, orbLayout: 'bottom', orbOpacity: 0.5, orbSpeed: 22
    }
  },
  {
    id: 'atardecer',
    name: 'Atardecer',
    tagline: 'Rojos, naranjas y ámbar con calidez de ocaso.',
    icon: 'fa-sun',
    seeds: ['#ef4444', '#f97316', '#f59e0b', '#fbbf24'],
    bg: { dark: '#140a06', light: '#fff4ec' },
    geometry: {
      radiusSm: 12, radiusMd: 18, radiusLg: 24, radiusXl: 32,
      pad: 20, gap: 18, space: 8, borderW: 1,
      blurPanel: 22, blurCard: 20, shadow: 0.5,
      pattern: 'radial', orbCount: 2, orbLayout: 'diagonal', orbOpacity: 0.5, orbSpeed: 20
    }
  },
  {
    id: 'zafiro-oceano',
    name: 'Zafiro Océano',
    tagline: 'Azules profundos, rejilla sutil y densidad compacta.',
    icon: 'fa-gem',
    seeds: ['#1d4ed8', '#2563eb', '#0ea5e9', '#38bdf8'],
    bg: { dark: '#040b1a', light: '#eef5ff' },
    geometry: {
      radiusSm: 6, radiusMd: 10, radiusLg: 14, radiusXl: 18,
      pad: 16, gap: 12, space: 7, borderW: 1,
      blurPanel: 18, blurCard: 16, shadow: 0.4,
      pattern: 'grid', orbCount: 2, orbLayout: 'top', orbOpacity: 0.45, orbSpeed: 26
    }
  },
  {
    id: 'amatista',
    name: 'Amatista',
    tagline: 'Violetas luminosos, anillos y radios generosos.',
    icon: 'fa-gem',
    seeds: ['#7c3aed', '#a855f7', '#d946ef', '#f0abfc'],
    bg: { dark: '#0e0618', light: '#f7f0ff' },
    geometry: {
      radiusSm: 16, radiusMd: 24, radiusLg: 30, radiusXl: 40,
      pad: 26, gap: 22, space: 9, borderW: 1,
      blurPanel: 28, blurCard: 26, shadow: 0.6,
      pattern: 'rings', orbCount: 3, orbLayout: 'corners', orbOpacity: 0.5, orbSpeed: 24
    }
  },
  {
    id: 'carmesi',
    name: 'Carmesí',
    tagline: 'Rojos intensos, ondas suaves y contraste decidido.',
    icon: 'fa-heart',
    seeds: ['#dc2626', '#e11d48', '#f43f5e', '#fda4af'],
    bg: { dark: '#14060a', light: '#fff1f3' },
    geometry: {
      radiusSm: 8, radiusMd: 14, radiusLg: 18, radiusXl: 24,
      pad: 18, gap: 14, space: 8, borderW: 1,
      blurPanel: 20, blurCard: 18, shadow: 0.5,
      pattern: 'waves', orbCount: 2, orbLayout: 'diagonal', orbOpacity: 0.45, orbSpeed: 19
    }
  },
  {
    id: 'oro-imperial',
    name: 'Oro Imperial',
    tagline: 'Ámbar y bronce, bordes finos y máxima densidad.',
    icon: 'fa-crown',
    seeds: ['#b45309', '#d97706', '#f59e0b', '#fde68a'],
    bg: { dark: '#100c04', light: '#fff9e8' },
    geometry: {
      radiusSm: 4, radiusMd: 8, radiusLg: 12, radiusXl: 16,
      pad: 16, gap: 12, space: 7, borderW: 1,
      blurPanel: 16, blurCard: 14, shadow: 0.35,
      pattern: 'none', orbCount: 2, orbLayout: 'top', orbOpacity: 0.35, orbSpeed: 30
    }
  },
  {
    id: 'obsidian-stealth',
    name: 'Obsidian Stealth',
    tagline: 'Grafito discreto, ruido fino y cero protagonismo.',
    icon: 'fa-ghost',
    seeds: ['#1f2937', '#374151', '#4b5563', '#9ca3af'],
    bg: { dark: '#08090b', light: '#f2f3f5' },
    geometry: {
      radiusSm: 2, radiusMd: 6, radiusLg: 8, radiusXl: 12,
      pad: 14, gap: 10, space: 6, borderW: 1,
      blurPanel: 12, blurCard: 10, shadow: 0.25,
      pattern: 'noise', orbCount: 1, orbLayout: 'corners', orbOpacity: 0.25, orbSpeed: 34
    }
  },
  {
    id: 'synthwave-80s',
    name: 'Synthwave 80s',
    tagline: 'Rosa neón, púrpura y cian con líneas de neón.',
    icon: 'fa-music',
    seeds: ['#ec4899', '#a855f7', '#6366f1', '#22d3ee'],
    bg: { dark: '#0b0416', light: '#fff0fb' },
    geometry: {
      radiusSm: 12, radiusMd: 20, radiusLg: 26, radiusXl: 34,
      pad: 22, gap: 18, space: 9, borderW: 1,
      blurPanel: 24, blurCard: 22, shadow: 0.65,
      pattern: 'scanlines', orbCount: 3, orbLayout: 'dual', orbOpacity: 0.55, orbSpeed: 16
    }
  },
  {
    id: 'glacial-artico',
    name: 'Glacial Ártico',
    tagline: 'Cianes helados, anillos y superficies etéreas.',
    icon: 'fa-snowflake',
    seeds: ['#06b6d4', '#22d3ee', '#67e8f9', '#a5f3fc'],
    bg: { dark: '#041216', light: '#eefcfd' },
    geometry: {
      radiusSm: 10, radiusMd: 16, radiusLg: 22, radiusXl: 30,
      pad: 24, gap: 20, space: 9, borderW: 1,
      blurPanel: 26, blurCard: 24, shadow: 0.4,
      pattern: 'rings', orbCount: 3, orbLayout: 'top', orbOpacity: 0.4, orbSpeed: 28
    }
  },
  {
    id: 'neon-tropical',
    name: 'Neón Tropical',
    tagline: 'Turquesa, coral y amarillo con ondas vivas.',
    icon: 'fa-umbrella-beach',
    seeds: ['#0d9488', '#06b6d4', '#f472b6', '#facc15'],
    bg: { dark: '#03110f', light: '#effcf7' },
    geometry: {
      radiusSm: 14, radiusMd: 20, radiusLg: 26, radiusXl: 34,
      pad: 22, gap: 16, space: 8, borderW: 1,
      blurPanel: 22, blurCard: 20, shadow: 0.5,
      pattern: 'waves', orbCount: 2, orbLayout: 'dual', orbOpacity: 0.5, orbSpeed: 20
    }
  },
  {
    id: 'bosque-nocturno',
    name: 'Bosque Nocturno',
    tagline: 'Verdes profundos, aurora tenue y aire de bosque.',
    icon: 'fa-tree',
    seeds: ['#14532d', '#15803d', '#84cc16', '#d9f99d'],
    bg: { dark: '#050f08', light: '#f2f9ee' },
    geometry: {
      radiusSm: 12, radiusMd: 18, radiusLg: 24, radiusXl: 32,
      pad: 24, gap: 20, space: 10, borderW: 1.5,
      blurPanel: 24, blurCard: 22, shadow: 0.4,
      pattern: 'aurora', orbCount: 3, orbLayout: 'bottom', orbOpacity: 0.45, orbSpeed: 26
    }
  }
];

export const THEME_MAP = new Map(THEMES.map((theme) => [theme.id, theme]));

export const DEFAULT_APPEARANCE = {
  theme: 'cyber-neon',
  variant: 'auto',
  glass: 0.8,
  orbs: true
};

export function getTheme(id) {
  return THEME_MAP.get(id) || THEME_MAP.get(DEFAULT_APPEARANCE.theme);
}

export function resolveVariant(preference, systemDark) {
  if (preference === 'auto') return systemDark ? 'dark' : 'light';
  if (preference === 'light' || preference === 'dark' || preference === 'contrast') return preference;
  return systemDark ? 'dark' : 'light';
}
