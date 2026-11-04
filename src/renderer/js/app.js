/** OllamaNeitor — arranque del renderer, cabecera, router y eventos globales. */

import { getState, patch, subscribe } from './store.js';
import { bridge, call, isAvailable } from './ipc.js';
import {
  initTheme, setVariant, syncSystemTheme, getAppearance, hydrate
} from './theme-engine.js';
import {
  loadAppInfo, loadConfig, refreshAll, refreshAchievements, formatVariantLabel
} from './services.js';
import { fmtBytes, shortPath, escapeHtml, debounce } from './lib/format.js';
import { toast } from './lib/toast.js';
import { openModal } from './lib/modal.js';
import { playAchievement, playLevelUp } from './lib/audio.js';
import { celebrate } from './lib/confetti.js';

import * as dashboard from './views/dashboard.js';
import * as models from './views/models.js';
import * as exportView from './views/export.js';
import * as importView from './views/import.js';
import * as chat from './views/chat.js';
import * as settings from './views/settings.js';

const views = {
  dashboard,
  models,
  export: exportView,
  import: importView,
  chat,
  settings
};

const titles = {
  dashboard: 'Dashboard',
  models: 'Modelos',
  export: 'Exportar',
  import: 'Importar',
  chat: 'Chat',
  settings: 'Panel de control'
};

const viewRoot = document.getElementById('view-root');
let currentCleanup = null;
let currentRoute = null;
let lastLevel = 1;
let levelInitialized = false;

/* ============================================================
   Cabecera y estado
   ============================================================ */

function updateHeader() {
  const state = getState();
  const achievements = state.achievements;
  const level = achievements && achievements.level ? achievements.level : { level: 1, xp: 0, nextLevelXp: 100, progress: 0 };
  const totals = achievements && achievements.totals ? achievements.totals : { bytesFreed: 0 };
  const catalog = achievements && Array.isArray(achievements.catalog) ? achievements.catalog : [];
  const unlocked = catalog.filter((trophy) => trophy.unlocked);

  document.getElementById('header-level').textContent = `LVL ${level.level}`;
  document.getElementById('header-xp-fill').style.width = `${Math.round((level.progress || 0) * 100)}%`;
  document.getElementById('header-xp-label').textContent = `${level.xp} / ${level.nextLevelXp} XP`;
  document.getElementById('header-ram').textContent = fmtBytes(totals.bytesFreed || 0);

  const badge = document.getElementById('trophy-badge');
  badge.textContent = String(unlocked.length);
  badge.classList.toggle('hidden', unlocked.length === 0);
  document.getElementById('btn-trophies').title = `Sala de trofeos · ${unlocked.length}/${catalog.length}`;

  document.getElementById('nav-models-count').textContent = String(state.summary.count || 0);
  const basePath = state.config?.ollama?.basePath || state.base?.basePath || '—';
  document.getElementById('status-base-label').textContent = shortPath(basePath, 52);
  document.getElementById('status-base').title = basePath;

  const ollama = state.ollama || {};
  const dot = document.getElementById('ollama-dot');
  dot.className = `status-dot ${ollama.online ? 'online' : 'offline'}`;
  document.getElementById('ollama-label').textContent = ollama.online ? 'Ollama en línea' : 'Ollama sin conexión';
  document.getElementById('ollama-version').textContent = ollama.online
    ? `v${ollama.version || '?'} · ${ollama.modelCount || state.models.length} modelo(s)`
    : (ollama.error ? 'revisa la conexión' : 'sin datos');

  document.getElementById('disk-mini-total').textContent = fmtBytes(state.summary.diskBytes || 0);
  document.getElementById('disk-mini-sub').textContent = `${state.summary.count || 0} modelos en inventario`;

  document.getElementById('brand-version').textContent = `v${state.version}`;
  document.getElementById('status-text').innerHTML = `${state.models.length} modelo(s) · ${fmtBytes(state.summary.diskBytes || 0)} en disco · ${state.ollama.online ? 'API conectada' : 'modo local'}`;

  const appearance = state.appearance || getAppearance();
  document.querySelectorAll('.variant-btn').forEach((button) => {
    button.classList.toggle('active', button.dataset.variant === appearance.variant);
    button.setAttribute('aria-pressed', String(button.dataset.variant === appearance.variant));
  });

  if (state.achievements && state.achievements.level) {
    const levelNumber = state.achievements.level.level;
    if (!levelInitialized) {
      lastLevel = levelNumber;
      levelInitialized = true;
    } else if (levelNumber > lastLevel) {
      playLevelUp();
      if (!getState().config?.ui?.performanceMode) celebrate();
    }
    lastLevel = levelNumber;
  }
}

function applyPerformanceMode() {
  const enabled = Boolean(getState().config?.ui?.performanceMode);
  document.documentElement.setAttribute('data-performance', enabled ? 'on' : 'off');
}

/* ============================================================
   Router
   ============================================================ */

function routeFromHash() {
  const raw = window.location.hash.replace(/^#\/?/, '').split('?')[0];
  return views[raw] ? raw : 'dashboard';
}

async function navigate(route, { force = false } = {}) {
  const target = views[route] ? route : 'dashboard';
  if (!force && target === currentRoute) return;
  currentRoute = target;

  if (typeof currentCleanup === 'function') {
    try { currentCleanup(); } catch (error) { console.error(error); }
  }
  currentCleanup = null;
  viewRoot.innerHTML = '';
  viewRoot.scrollTop = 0;

  document.querySelectorAll('.nav-item').forEach((button) => {
    const active = button.dataset.route === target;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });

  document.title = `OllamaNeitor · ${titles[target] || 'Inicio'}`;

  try {
    currentCleanup = await views[target].mount(viewRoot);
  } catch (error) {
    console.error(error);
    viewRoot.innerHTML = `
      <div class="view-inner">
        <div class="glass-panel empty" style="margin-top:20px">
          <i class="fa-solid fa-triangle-exclamation" style="color:var(--danger)"></i>
          <strong>No se pudo abrir la vista</strong>
          <p>${escapeHtml(error.message || String(error))}</p>
          <button class="btn btn-sm" id="view-reload">Recargar</button>
        </div>
      </div>
    `;
    viewRoot.querySelector('#view-reload')?.addEventListener('click', () => window.location.reload());
  }
}

function go(route) {
  if (routeFromHash() === route) navigate(route, { force: true });
  else window.location.hash = `#/${route}`;
}

/* ============================================================
   Selector de modo (header)
   ============================================================ */

function wireVariantSwitch() {
  document.querySelectorAll('.variant-btn').forEach((button) => {
    button.addEventListener('click', () => {
      setVariant(button.dataset.variant);
      updateHeader();
    });
  });
}

/* ============================================================
   Menú de acciones
   ============================================================ */

function wireActionsMenu() {
  const button = document.getElementById('btn-actions');
  const dropdown = document.getElementById('actions-dropdown');

  const close = () => {
    dropdown.classList.add('hidden');
    button.setAttribute('aria-expanded', 'false');
  };
  const toggle = () => {
    const open = dropdown.classList.contains('hidden');
    dropdown.classList.toggle('hidden', !open);
    button.setAttribute('aria-expanded', String(open));
  };

  button.addEventListener('click', (event) => {
    event.stopPropagation();
    toggle();
  });

  dropdown.addEventListener('click', async (event) => {
    const action = event.target.closest('[data-action]');
    if (!action) return;
    close();
    const name = action.dataset.action;
    if (name === 'export') go('export');
    else if (name === 'import') go('import');
    else if (name === 'pull') {
      go('models');
      setTimeout(() => document.getElementById('pull-input')?.focus(), 220);
    } else if (name === 'refresh') {
      await refreshAll({ silent: true });
      toast.info('Inventario actualizado');
    } else if (name === 'trophies') {
      openTrophies();
    } else if (name === 'logs') {
      try { await call(bridge.logs.openFolder); }
      catch (error) { toast.error('No se pudo abrir el registro', error.message); }
    }
  });

  document.addEventListener('click', (event) => {
    if (!dropdown.classList.contains('hidden') && !event.target.closest('.actions-menu')) close();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close();
  });
}

/* ============================================================
   Sala de trofeos
   ============================================================ */

function renderTrophies() {
  const drawer = document.getElementById('trophy-list');
  const achievements = getState().achievements;
  if (!achievements) {
    drawer.innerHTML = '<div class="empty"><i class="fa-solid fa-trophy"></i><strong>Cargando trofeos…</strong></div>';
    return;
  }
  const catalog = achievements.catalog || [];
  const unlocked = catalog.filter((trophy) => trophy.unlocked).length;
  drawer.innerHTML = `
    <div class="alert" style="margin-bottom:4px">
      <i class="fa-solid fa-crown"></i>
      <span>Nivel ${achievements.level.level} · ${achievements.xp} XP · ${unlocked}/${catalog.length} trofeos</span>
    </div>
    ${catalog.map((trophy) => `
      <div class="trophy-card ${trophy.unlocked ? 'unlocked' : 'locked'}">
        <span class="trophy-icon"><i class="fa-solid ${escapeHtml(trophy.icon)}"></i></span>
        <div class="trophy-meta">
          <strong>${escapeHtml(trophy.name)}</strong>
          <p>${escapeHtml(trophy.description)}</p>
        </div>
        <span class="trophy-xp">${trophy.unlocked ? '✓' : `+${trophy.xp} XP`}</span>
      </div>
    `).join('')}
    <div class="alert" style="margin-top:6px">
      <i class="fa-solid fa-circle-info"></i>
      <span>Los trofeos se guardan en <span class="mono">achievements.json</span>.</span>
    </div>
  `;
}

function openTrophies() {
  const drawer = document.getElementById('trophy-drawer');
  const backdrop = document.getElementById('drawer-backdrop');
  renderTrophies();
  drawer.classList.remove('hidden');
  backdrop.classList.remove('hidden');
  requestAnimationFrame(() => drawer.classList.add('open'));
}

function closeTrophies() {
  const drawer = document.getElementById('trophy-drawer');
  const backdrop = document.getElementById('drawer-backdrop');
  drawer.classList.remove('open');
  backdrop.classList.add('hidden');
  setTimeout(() => drawer.classList.add('hidden'), 320);
}

function wireTrophies() {
  document.getElementById('btn-trophies').addEventListener('click', openTrophies);
  document.getElementById('trophy-close').addEventListener('click', closeTrophies);
  document.getElementById('drawer-backdrop').addEventListener('click', closeTrophies);
  window.addEventListener('neitor:open-trophies', openTrophies);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeTrophies();
  });
  refreshAchievements().then(renderTrophies).catch(() => {});
}

function showAchievement(trophy) {
  const root = document.getElementById('achievement-root');
  const node = document.createElement('div');
  node.className = 'achievement-pop';
  node.innerHTML = `
    <span class="trophy-icon"><i class="fa-solid ${escapeHtml(trophy.icon)}"></i></span>
    <div>
      <strong>Trofeo: ${escapeHtml(trophy.name)}</strong>
      <small>${escapeHtml(trophy.description)} · +${trophy.xp} XP</small>
    </div>
  `;
  root.appendChild(node);
  playAchievement();
  if (!getState().config?.ui?.performanceMode) celebrate();
  setTimeout(() => {
    node.classList.add('out');
    setTimeout(() => node.remove(), 340);
  }, 3800);
}

/* ============================================================
   Ventana
   ============================================================ */

function wireWindow() {
  document.getElementById('win-min').addEventListener('click', () => bridge?.window.minimize());
  document.getElementById('win-max').addEventListener('click', () => bridge?.window.maximize());
  document.getElementById('win-close').addEventListener('click', () => bridge?.window.close());

  if (!bridge) return;
  bridge.window.onMaximize(({ maximized }) => {
    const icon = document.querySelector('#win-max i');
    if (!icon) return;
    icon.className = maximized ? 'fa-regular fa-clone' : 'fa-regular fa-square';
    document.getElementById('win-max').title = maximized ? 'Restaurar' : 'Maximizar';
  });
}

/* ============================================================
   Eventos globales
   ============================================================ */

function wireGlobalEvents() {
  const onRefresh = debounce(async () => {
    try {
      await loadConfig();
      applyPerformanceMode();
      await refreshAll();
      updateHeader();
    } catch (error) {
      console.warn(error);
    }
  }, 160);
  window.addEventListener('neitor:refresh-data', onRefresh);

  window.addEventListener('neitor:theme', () => {
    updateHeader();
    const appearance = getAppearance();
    document.querySelectorAll('.variant-btn').forEach((button) => {
      button.classList.toggle('active', button.dataset.variant === appearance.variant);
    });
  });

  if (bridge) {
    bridge.system.onThemeChange(({ dark }) => syncSystemTheme(dark));
    bridge.achievements.onState((state) => {
      patch({ achievements: state });
      renderTrophies();
    });
    bridge.achievements.onUnlocked(({ trophy, state }) => {
      patch({ achievements: state });
      renderTrophies();
      updateHeader();
      showAchievement(trophy);
    });
    bridge.logs.onEvent(() => { /* la vista Avanzado se suscribe por su cuenta */ });
    bridge.transfer.onError((event) => {
      if (event && event.error && !document.querySelector('.modal-backdrop')) {
        toast.error('Operación fallida', event.error.message || 'Error desconocido');
      }
    });
  }

  document.getElementById('status-base').addEventListener('click', async () => {
    const target = getState().config?.ollama?.basePath;
    try { await call(bridge.shell.openPath, target); }
    catch (error) { toast.error('No se pudo abrir la carpeta', error.message); }
  });

  document.getElementById('status-logs').addEventListener('click', async () => {
    try { await call(bridge.logs.openFolder); }
    catch (error) { toast.error('No se pudo abrir el registro', error.message); }
  });

  document.getElementById('btn-settings').addEventListener('click', () => go('settings'));

  document.querySelectorAll('.nav-item').forEach((button) => {
    button.addEventListener('click', () => go(button.dataset.route));
  });

  document.addEventListener('keydown', (event) => {
    if (event.altKey || event.metaKey) return;
    if (event.ctrlKey && /^[1-6]$/.test(event.key)) {
      event.preventDefault();
      const order = ['dashboard', 'models', 'export', 'import', 'chat', 'settings'];
      go(order[Number(event.key) - 1]);
    }
    if (event.ctrlKey && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      go('models');
      setTimeout(() => document.getElementById('models-search')?.focus(), 200);
    }
  });

  const unsubscribe = subscribe(() => {
    updateHeader();
    applyPerformanceMode();
  });
  return unsubscribe;
}

/* ============================================================
   Bootstrap
   ============================================================ */

async function boot() {
  if (!isAvailable()) {
    document.getElementById('boot-splash').innerHTML = `
      <div class="boot-logo" style="background:var(--danger)"><i class="fa-solid fa-plug-circle-xmark"></i></div>
      <strong>Sin puente de Electron</strong>
      <small>Ejecuta la app con <span class="mono">npm start</span>.</small>
    `;
    return;
  }

  initTheme(window.__NEITOR_INITIAL);
  wireVariantSwitch();
  wireActionsMenu();
  wireTrophies();
  wireWindow();
  wireGlobalEvents();

  window.addEventListener('hashchange', () => navigate(routeFromHash()));

  try {
    await loadAppInfo();
    await loadConfig();
    const configAppearance = getState().config?.appearance;
    const bootInfo = window.__NEITOR_INITIAL || {};
    if (configAppearance && !bootInfo.hasStored) {
      hydrate(configAppearance);
    }
    applyPerformanceMode();
    await refreshAll({ silent: true });
    updateHeader();
  } catch (error) {
    toast.error('Error al cargar datos', error.message);
  }

  lastLevel = getState().achievements?.level?.level || 1;
  if (!window.location.hash) window.location.hash = '#/dashboard';
  await navigate(routeFromHash());
  updateHeader();
  renderTrophies();

  setTimeout(() => {
    const splash = document.getElementById('boot-splash');
    splash.classList.add('done');
    setTimeout(() => splash.remove(), 400);
  }, 280);
}

boot().catch((error) => {
  console.error(error);
  const splash = document.getElementById('boot-splash');
  if (splash) {
    splash.innerHTML = `
      <div class="boot-logo" style="background:var(--danger)"><i class="fa-solid fa-triangle-exclamation"></i></div>
      <strong>No se pudo iniciar</strong>
      <small>${escapeHtml(error.message || String(error))}</small>
    `;
  }
});
