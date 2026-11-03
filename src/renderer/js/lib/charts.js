/** Gráficas Chart.js con tokens del tema. */

const instances = new Set();

export function themeTokens() {
  const styles = getComputedStyle(document.documentElement);
  const get = (name, fallback) => styles.getPropertyValue(name).trim() || fallback;
  return {
    text: get('--text', '#f8fafc'),
    muted: get('--text-muted', 'rgba(248,250,252,.68)'),
    border: get('--border', 'rgba(255,255,255,.14)'),
    surface: get('--surface-strong', 'rgba(255,255,255,.14)'),
    bg: get('--bg', '#060a14'),
    accent: get('--accent', '#60a5fa'),
    accent2: get('--accent-2', '#a78bfa'),
    accent3: get('--accent-3', '#f0abfc'),
    accent4: get('--accent-4', '#67e8f9'),
    success: get('--success', '#34d399'),
    warning: get('--warning', '#fbbf24'),
    danger: get('--danger', '#f87171'),
    info: get('--info', '#60a5fa')
  };
}

function hexToHsl(hex) {
  const clean = String(hex).replace('#', '');
  const value = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const r = parseInt(value.slice(0, 2), 16) / 255;
  const g = parseInt(value.slice(2, 4), 16) / 255;
  const b = parseInt(value.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return { h, s, l };
}

function hslToHex(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const toHex = (channel) => Math.round((channel + m) * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function palette(tokens, count) {
  if (!count) return [];
  const base = hexToHsl(tokens.accent);
  const step = 360 / count;
  return Array.from({ length: count }, (_, index) => {
    const hue = (base.h + index * step) % 360;
    const saturation = Math.min(0.88, Math.max(0.5, base.s));
    const lightness = Math.min(0.66, Math.max(0.4, base.l));
    return hslToHex(hue, saturation, lightness);
  });
}

function baseOptions(tokens) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 420, easing: 'easeOutQuart' },
    plugins: {
      legend: {
        labels: {
          color: tokens.muted,
          usePointStyle: true,
          boxWidth: 8,
          boxHeight: 8,
          padding: 12,
          font: { size: 10 }
        }
      },
      tooltip: {
        backgroundColor: tokens.bg,
        titleColor: tokens.text,
        bodyColor: tokens.muted,
        borderColor: tokens.border,
        borderWidth: 1,
        padding: 9,
        cornerRadius: 8,
        displayColors: true
      }
    }
  };
}

function register(chart) {
  instances.add(chart);
  return chart;
}

export function destroyCharts() {
  for (const chart of instances) {
    try { chart.destroy(); } catch { /* ignore */ }
  }
  instances.clear();
}

export function createDoughnut(canvas, labels, values) {
  if (!window.Chart || !canvas) return null;
  const tokens = themeTokens();
  const colors = palette(tokens, labels.length);
  return register(new window.Chart(canvas, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: colors,
        borderColor: tokens.bg,
        borderWidth: 2,
        hoverOffset: 5
      }]
    },
    options: {
      ...baseOptions(tokens),
      cutout: '66%',
      plugins: {
        ...baseOptions(tokens).plugins,
        legend: {
          position: 'bottom',
          labels: {
            color: tokens.muted,
            usePointStyle: true,
            boxWidth: 8,
            boxHeight: 8,
            padding: 10,
            font: { size: 10 }
          }
        }
      }
    }
  }));
}

export function createHorizontalBars(canvas, labels, values, label = 'Tamaño') {
  if (!window.Chart || !canvas) return null;
  const tokens = themeTokens();
  const colors = palette(tokens, labels.length);
  return register(new window.Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label,
        data: values,
        backgroundColor: colors,
        borderRadius: 6,
        borderSkipped: false,
        barThickness: 14
      }]
    },
    options: {
      ...baseOptions(tokens),
      indexAxis: 'y',
      plugins: {
        ...baseOptions(tokens).plugins,
        legend: { display: false },
        tooltip: {
          ...baseOptions(tokens).plugins.tooltip,
          callbacks: {
            label: (context) => `${label}: ${formatBytes(context.raw)}`
          }
        }
      },
      scales: {
        x: {
          grid: { color: tokens.border, drawBorder: false },
          ticks: {
            color: tokens.muted,
            font: { size: 10 },
            callback: (value) => formatBytes(value)
          }
        },
        y: {
          grid: { display: false },
          ticks: { color: tokens.text, font: { size: 10 } }
        }
      }
    }
  }));
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
  const scaled = value / 1024 ** index;
  return `${scaled.toFixed(scaled >= 10 ? 1 : 2)} ${units[index]}`;
}
