/** Motor de temas: aplica 12 temas × 3 variantes + Auto, persiste y emite eventos. */

import { THEMES, VARIANTS, DEFAULT_APPEARANCE, getTheme, resolveVariant } from '../themes/registry.js';
import { bridge } from './ipc.js';
import { patch } from './store.js';

const KEY = 'neitor.appearance.v1';
const VALID_VARIANTS = ['light', 'dark', 'contrast', 'auto'];

let current = { ...DEFAULT_APPEARANCE };
let systemDark = true;
let previewing = null;
let persistTimer = null;

const root = document.documentElement;

function sanitize(appearance = {}) {
  const theme = getTheme(appearance.theme);
  const variant = VALID_VARIANTS.includes(appearance.variant) ? appearance.variant : 'auto';
  const glass = Math.min(1, Math.max(0.4, Number(appearance.glass) || DEFAULT_APPEARANCE.glass));
  const orbs = appearance.orbs !== false;
  return { theme: theme.id, variant, glass, orbs };
}

function saveLocal() {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(current));
  } catch (error) {
    /* almacenamiento no disponible */
  }
}

function persistRemote() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(async () => {
    try {
      if (bridge && bridge.appearance) {
        await bridge.appearance.persist(current);
      }
    } catch (error) {
      console.warn('No se pudo persistir la apariencia', error);
    }
  }, 300);
}

function resolved() {
  return resolveVariant(current.variant, systemDark);
}

function backgroundFor(meta, variant) {
  if (variant === 'contrast') return '#000000';
  if (variant === 'light') return meta.bg.light;
  return meta.bg.dark;
}

function paint(themeId, { persist = false } = {}) {
  const meta = getTheme(themeId);
  const variant = resolved();

  root.setAttribute('data-theme', meta.id);
  root.setAttribute('data-variant', variant);
  root.setAttribute('data-variant-pref', current.variant);
  root.setAttribute('data-pattern', meta.geometry.pattern);
  root.setAttribute('data-orb-layout', meta.geometry.orbLayout);
  root.setAttribute('data-orb-count', String(meta.geometry.orbCount));
  root.setAttribute('data-orbs', current.orbs ? 'on' : 'off');
  root.style.setProperty('--glass-strength', String(current.glass));

  const bg = backgroundFor(meta, variant);
  const metaTag = document.querySelector('meta[name="theme-color"]');
  if (metaTag) metaTag.setAttribute('content', bg);
  try {
    if (bridge && bridge.window) bridge.window.setBackground(bg);
  } catch (error) { /* ignore */ }

  window.dispatchEvent(new CustomEvent('neitor:theme', {
    detail: {
      theme: meta.id,
      themeName: meta.name,
      preference: current.variant,
      variant,
      glass: current.glass,
      orbs: current.orbs,
      preview: Boolean(previewing)
    }
  }));

  if (persist) {
    current.theme = meta.id;
    patch({ appearance: { ...current } });
    saveLocal();
    persistRemote();
  }
}

export function initTheme(initial) {
  const boot = initial || window.__NEITOR_INITIAL || {};
  systemDark = typeof boot.systemDark === 'boolean' ? boot.systemDark : true;
  current = sanitize(boot.appearance || DEFAULT_APPEARANCE);
  patch({ appearance: { ...current } });
  paint(current.theme, { persist: true });
  saveLocal();

  const media = window.matchMedia('(prefers-color-scheme: dark)');
  if (media && media.addEventListener) {
    media.addEventListener('change', (event) => {
      systemDark = event.matches;
      patch({ systemDark });
      if (current.variant === 'auto') paint(current.theme, { persist: true });
    });
  }

  return { ...current };
}

export function syncSystemTheme(dark) {
  if (typeof dark !== 'boolean' || dark === systemDark) return;
  systemDark = dark;
  patch({ systemDark });
  if (current.variant === 'auto') paint(current.theme, { persist: true });
}

export function setTheme(themeId, { persist = true } = {}) {
  const meta = getTheme(themeId);
  current.theme = meta.id;
  previewing = null;
  paint(meta.id, { persist });
  return meta;
}

/** Aplica una apariencia externa (por ejemplo, la de config.json) y la persiste. */
export function hydrate(appearance) {
  current = sanitize(appearance || DEFAULT_APPEARANCE);
  patch({ appearance: { ...current } });
  paint(current.theme, { persist: true });
  return { ...current };
}

export function setVariant(variant) {
  current.variant = VALID_VARIANTS.includes(variant) ? variant : 'auto';
  paint(current.theme, { persist: true });
  return current.variant;
}

export function setGlass(value) {
  current.glass = Math.min(1, Math.max(0.4, Number(value) || DEFAULT_APPEARANCE.glass));
  paint(current.theme, { persist: true });
  return current.glass;
}

export function setOrbs(enabled) {
  current.orbs = Boolean(enabled);
  paint(current.theme, { persist: true });
  return current.orbs;
}

export function previewTheme(themeId) {
  if (!themeId || themeId === current.theme) return;
  previewing = themeId;
  paint(themeId, { persist: false });
}

export function restorePreview() {
  if (!previewing) return;
  previewing = null;
  paint(current.theme, { persist: false });
}

export function getAppearance() {
  return { ...current };
}

export function getThemes() {
  return THEMES.map((theme) => ({
    id: theme.id,
    name: theme.name,
    tagline: theme.tagline,
    icon: theme.icon,
    seeds: [...theme.seeds],
    geometry: { ...theme.geometry }
  }));
}

export function getVariants() {
  return VARIANTS.map((variant) => ({ ...variant }));
}

export function getResolvedVariant() {
  return resolved();
}
