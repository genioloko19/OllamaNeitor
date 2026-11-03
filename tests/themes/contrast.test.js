import { describe, it, expect } from 'vitest';
import { audit } from '../../tools/build-themes.mjs';
import { THEMES, VARIANTS, getTheme, resolveVariant } from '../../src/renderer/themes/registry.js';

describe('temas', () => {
  it('define 12 temas autocontenidos y 4 modos', () => {
    expect(THEMES).toHaveLength(12);
    expect(VARIANTS.map((variant) => variant.id)).toEqual(['light', 'dark', 'contrast', 'auto']);
    const ids = new Set(THEMES.map((theme) => theme.id));
    expect(ids.size).toBe(12);
    for (const theme of THEMES) {
      expect(theme.seeds).toHaveLength(4);
      expect(theme.geometry.radiusMd).toBeGreaterThan(0);
      expect(theme.geometry.pattern).toBeTruthy();
      expect(theme.geometry.orbCount).toBeGreaterThanOrEqual(1);
      expect(theme.bg.light).toMatch(/^#[0-9a-f]{6}$/i);
      expect(theme.bg.dark).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('genera las 36 combinaciones sin fallos de contraste', () => {
    const { failures, rows } = audit();
    expect(rows).toHaveLength(36);
    expect(failures).toEqual([]);
  });

  it('resuelve Auto según el sistema', () => {
    expect(resolveVariant('auto', true)).toBe('dark');
    expect(resolveVariant('auto', false)).toBe('light');
    expect(resolveVariant('contrast', false)).toBe('contrast');
    expect(getTheme('no-existe').id).toBe('cyber-neon');
  });
});
