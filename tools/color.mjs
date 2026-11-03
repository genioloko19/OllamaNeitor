/** Utilidades de color para el generador de temas (sRGB). */

export function parseHex(hex) {
  const clean = String(hex).trim().replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) throw new Error(`Color inválido: ${hex}`);
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16)
  };
}

export function toHex({ r, g, b }) {
  const h = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

export function mix(a, b, t) {
  const c1 = parseHex(a);
  const c2 = parseHex(b);
  return toHex({
    r: c1.r + (c2.r - c1.r) * t,
    g: c1.g + (c2.g - c1.g) * t,
    b: c1.b + (c2.b - c1.b) * t
  });
}

export function rgba(hex, alpha) {
  const { r, g, b } = parseHex(hex);
  return `rgba(${r}, ${g}, ${b}, ${Number(alpha.toFixed(3))})`;
}

export function parseRgba(value) {
  const m = String(value).match(/rgba?\(([^)]+)\)/i);
  if (!m) return { ...parseHex(value), a: 1 };
  const parts = m[1].split(',').map((p) => p.trim());
  return {
    r: Number(parts[0]),
    g: Number(parts[1]),
    b: Number(parts[2]),
    a: parts[3] === undefined ? 1 : Number(parts[3])
  };
}

export function composite(fg, bg) {
  const f = parseRgba(fg);
  const b = parseRgba(bg);
  const a = f.a;
  return toHex({
    r: f.r * a + b.r * (1 - a),
    g: f.g * a + b.g * (1 - a),
    b: f.b * a + b.b * (1 - a)
  });
}

export function luminance(hex) {
  const { r, g, b } = parseHex(hex);
  const channel = (v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrast(a, b) {
  const l1 = luminance(a);
  const l2 = luminance(b);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Ajusta un color mezclándolo hacia blanco o negro hasta alcanzar
 * el ratio de contraste objetivo contra `bg`.
 */
export function ensureContrast(color, bg, target = 4.5) {
  if (contrast(color, bg) >= target) return color;
  const towardsWhite = contrast('#ffffff', bg) >= contrast('#000000', bg);
  const pole = towardsWhite ? '#ffffff' : '#000000';
  let best = color;
  for (let i = 1; i <= 40; i += 1) {
    const candidate = mix(color, pole, i / 40);
    best = candidate;
    if (contrast(candidate, bg) >= target) return candidate;
  }
  return best;
}

export function readableOn(bg, options = ['#ffffff', '#08111f']) {
  const scored = options
    .map((color) => ({ color, ratio: contrast(color, bg) }))
    .sort((a, b) => b.ratio - a.ratio);
  return scored[0].color;
}

export function clampAlpha(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}
