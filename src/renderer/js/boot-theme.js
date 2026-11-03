/* Arranque temprano: aplica tema y variante antes del primer pintado. */
(function bootTheme() {
  var KEY = 'neitor.appearance.v1';
  var app = window.__NEITOR_APP || { appearance: {}, themes: {} };
  var defaults = Object.assign(
    { theme: 'cyber-neon', variant: 'auto', glass: 0.8, orbs: true },
    app.appearance || {}
  );
  var saved = {};
  var hasStored = false;
  try {
    saved = JSON.parse(window.localStorage.getItem(KEY) || 'null') || {};
    hasStored = Boolean(saved && saved.theme && app.themes && app.themes[saved.theme]);
  } catch (error) {
    saved = {};
  }
  var appearance = Object.assign({}, defaults, saved);
  if (!app.themes || !app.themes[appearance.theme]) appearance.theme = defaults.theme;

  var media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  var systemDark = media ? media.matches : true;
  var variant = appearance.variant;
  if (variant === 'auto') variant = systemDark ? 'dark' : 'light';
  if (['light', 'dark', 'contrast'].indexOf(variant) === -1) variant = systemDark ? 'dark' : 'light';

  var root = document.documentElement;
  var geometry = (app.themes && app.themes[appearance.theme]) || {};

  root.setAttribute('data-theme', appearance.theme);
  root.setAttribute('data-variant', variant);
  root.setAttribute('data-variant-pref', appearance.variant);
  root.setAttribute('data-pattern', geometry.pattern || 'none');
  root.setAttribute('data-orb-layout', geometry.orbLayout || 'corners');
  root.setAttribute('data-orb-count', String(geometry.orbCount || 0));
  root.setAttribute('data-orbs', appearance.orbs === false ? 'off' : 'on');
  root.style.setProperty('--glass-strength', String(appearance.glass || 0.8));

  var bg = (geometry.colors && geometry.colors[variant]) || '#060a14';
  var meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.setAttribute('name', 'theme-color');
    document.head.appendChild(meta);
  }
  meta.setAttribute('content', bg);

  try {
    if (window.neitor && window.neitor.window) window.neitor.window.setBackground(bg);
  } catch (error) {
    /* preload aún no disponible */
  }

  window.__NEITOR_INITIAL = {
    appearance: appearance,
    systemDark: systemDark,
    resolved: variant,
    hasStored: hasStored
  };
})();
