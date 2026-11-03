/** Panel de control: Apariencia, Transferencias, Ollama, Base de datos y Avanzado. */

import { getState, subscribe } from '../store.js';
import { bridge, call } from '../ipc.js';
import {
  saveConfig, refreshModels, refreshStatus, refreshAchievements, refreshBlobStats, formatVariantLabel
} from '../services.js';
import {
  getThemes, getAppearance, setTheme, setGlass, setOrbs, setVariant
} from '../theme-engine.js';
import { fmtBytes, fmtDate, fmtTime, escapeHtml, debounce, shortPath } from '../lib/format.js';
import { toast } from '../lib/toast.js';
import { confirm, errorDialog } from '../lib/swal.js';

const TABS = [
  { id: 'appearance', label: 'Apariencia', icon: 'fa-palette' },
  { id: 'transfer', label: 'Transferencias', icon: 'fa-box-open' },
  { id: 'ollama', label: 'Ollama', icon: 'fa-server' },
  { id: 'database', label: 'Base de datos', icon: 'fa-database' },
  { id: 'advanced', label: 'Avanzado', icon: 'fa-sliders' }
];

export function mount(container) {
  let disposed = false;
  let tab = 'appearance';
  let offLogs = () => {};
  let logEntries = [];

  container.innerHTML = `
    <div class="view-inner">
      <header class="page-head">
        <div>
          <h1><i class="fa-solid fa-sliders"></i> Panel de control</h1>
          <p class="page-sub">Apariencia, transferencias, conexión con Ollama y mantenimiento. Todo se guarda en <span class="mono">%APPDATA%\\Neitor\\OllamaNeitor</span>.</p>
        </div>
      </header>

      <div class="settings-layout">
        <aside class="glass-panel settings-nav" role="tablist">
          ${TABS.map((item) => `
            <button data-tab="${item.id}" class="${item.id === tab ? 'active' : ''}" role="tab">
              <i class="fa-solid ${item.icon}"></i> ${item.label}
            </button>
          `).join('')}
        </aside>
        <section class="glass-panel settings-panel" id="settings-panel"></section>
      </div>
    </div>
  `;

  const $ = (selector) => container.querySelector(selector);
  const panel = $('#settings-panel');

  /* ================= Apariencia ================= */

  function appearanceHtml() {
    const appearance = getState().appearance || getAppearance();
    const themes = getThemes();
    const variantLabel = formatVariantLabel(appearance.variant);
    return `
      <div class="settings-section">
        <div class="row-wrap" style="justify-content:space-between">
          <div>
            <h2>Apariencia</h2>
            <p class="hint">12 temas independientes. Cada uno define paleta, geometría, patrón y orbes.</p>
          </div>
          <div class="row">
            <span class="pill pill-accent"><i class="fa-solid fa-palette"></i> ${themes.length} temas</span>
            <span class="pill" id="variant-pill"><i class="fa-solid fa-display"></i> Modo: ${escapeHtml(variantLabel)}</span>
          </div>
        </div>
        <div class="alert" style="margin-top:12px">
          <i class="fa-solid fa-circle-info"></i>
          <span>El modo (Claro, Oscuro, Alto contraste o Auto) se cambia desde el selector del encabezado. Aquí eliges el tema.</span>
        </div>
      </div>

      <div class="settings-section">
        <div class="theme-grid" id="theme-grid">
          ${themes.map((theme) => `
            <button class="theme-card ${theme.id === appearance.theme ? 'active' : ''}" data-select-theme="${theme.id}" title="${escapeHtml(theme.tagline)}">
              <span class="theme-swatch">
                ${theme.seeds.map((color) => `<span style="background:${escapeHtml(color)}"></span>`).join('')}
              </span>
              <span class="theme-name">${escapeHtml(theme.name)} <i class="fa-solid ${theme.icon}"></i></span>
              <span class="theme-tag">${escapeHtml(theme.tagline)}</span>
            </button>
          `).join('')}
        </div>
      </div>

      <div class="settings-section">
        <div class="form-grid">
          <div class="field">
            <label for="glass-range">Intensidad del glass</label>
            <input type="range" id="glass-range" class="range" min="40" max="100" value="${Math.round((appearance.glass || 0.8) * 100)}" />
            <small><span id="glass-value">${Math.round((appearance.glass || 0.8) * 100)}</span> % · más alto = más desenfoque</small>
          </div>
          <div class="field">
            <label>Orbes ambientales</label>
            <label class="switch">
              <input type="checkbox" id="orbs-toggle" ${appearance.orbs ? 'checked' : ''} />
              <span class="track"></span>
              Mostrar orbes de fondo
            </label>
            <small>Se desactivan automáticamente en alto contraste.</small>
          </div>
        </div>
      </div>

      <div class="settings-section">
        <label class="field-label">Vista previa</label>
        <div class="glass-soft" style="padding:16px;margin-top:8px">
          <div class="row-wrap" style="justify-content:space-between">
            <div class="row">
              <span class="brand-mark" style="width:34px;height:34px;font-size:15px"><i class="fa-solid fa-bolt"></i></span>
              <div>
                <strong style="display:block;font-size:13px">OllamaNeitor</strong>
                <small class="muted">Así se ve tu tema con el modo actual.</small>
              </div>
            </div>
            <div class="row">
              <span class="pill pill-accent"><i class="fa-solid fa-bolt"></i> acento</span>
              <span class="pill pill-success"><i class="fa-solid fa-check"></i> éxito</span>
              <button class="btn btn-sm btn-primary">Botón</button>
            </div>
          </div>
        </div>
      </div>

      <div class="settings-section">
        <div class="row-wrap" style="justify-content:space-between">
          <button class="btn btn-ghost btn-sm" id="appearance-reset"><i class="fa-solid fa-rotate-left"></i> Restablecer apariencia</button>
          <span class="tiny soft">Se guarda en localStorage y en config.json</span>
        </div>
      </div>
    `;
  }

  function bindAppearance() {
    container.querySelectorAll('[data-select-theme]').forEach((button) => {
      button.addEventListener('click', () => {
        setTheme(button.dataset.selectTheme);
        bindAppearanceActive();
      });
    });

    const applyGlass = debounce((value) => setGlass(value / 100), 220);
    $('#glass-range').addEventListener('input', (event) => {
      $('#glass-value').textContent = event.target.value;
      applyGlass(Number(event.target.value));
    });

    $('#orbs-toggle').addEventListener('change', (event) => setOrbs(event.target.checked));

    $('#appearance-reset').addEventListener('click', () => {
      setTheme('cyber-neon');
      setGlass(0.8);
      setOrbs(true);
      setVariant('auto');
      renderPanel();
      toast.success('Apariencia restablecida');
    });

    bindAppearanceActive();
  }

  function bindAppearanceActive() {
    const appearance = getState().appearance || getAppearance();
    container.querySelectorAll('[data-select-theme]').forEach((button) => {
      button.classList.toggle('active', button.dataset.selectTheme === appearance.theme);
    });
    const variantPill = document.getElementById('variant-pill');
    if (variantPill) variantPill.innerHTML = `<i class="fa-solid fa-display"></i> Modo: ${escapeHtml(formatVariantLabel(appearance.variant))}`;
  }

  /* ================= Transferencias ================= */

  function transferHtml() {
    const config = getState().config || {};
    const transfer = config.transfer || {};
    return `
      <div class="settings-section">
        <h2>Transferencias</h2>
        <p class="hint">Valores por defecto para exportar e importar. Cada operación puede sobrescribirlos.</p>
      </div>

      <div class="settings-section">
        <div class="form-grid">
          <div class="field full">
            <label for="cfg-dest">Carpeta de destino por defecto</label>
            <div class="input-row">
              <input id="cfg-dest" class="input" value="${escapeHtml(transfer.destDir || '')}" />
              <button class="btn btn-sm" id="cfg-dest-browse"><i class="fa-solid fa-folder-open"></i> Examinar</button>
            </div>
          </div>
          <div class="field">
            <label for="cfg-template">Plantilla de nombre</label>
            <input id="cfg-template" class="input" value="${escapeHtml(transfer.nameTemplate || '{modelo}_{tag}')}" />
            <small>Tokens: {modelo} {tag} {familia} {quant} {fecha}</small>
          </div>
          <div class="field">
            <label for="cfg-maxgb">Límite de tamaño por paquete (GB)</label>
            <input id="cfg-maxgb" class="input" type="number" min="1" max="500" value="${Number(transfer.maxGb) || 50}" />
          </div>
          <div class="field full">
            <label>Integridad</label>
            <label class="switch">
              <input type="checkbox" id="cfg-verify" ${transfer.verify !== false ? 'checked' : ''} />
              <span class="track"></span>
              Verificar sha256 por defecto
            </label>
          </div>
        </div>
      </div>

      <div class="settings-section">
        <div class="row-wrap">
          <button class="btn btn-primary btn-sm" id="cfg-save-transfer"><i class="fa-solid fa-floppy-disk"></i> Guardar transferencias</button>
          <span class="tiny soft">Se aplica a las próximas exportaciones e importaciones.</span>
        </div>
      </div>
    `;
  }

  function bindTransfer() {
    $('#cfg-dest-browse').addEventListener('click', async () => {
      try {
        const folder = await call(bridge.dialogs.pickFolder, { title: 'Carpeta de exportación por defecto' });
        if (folder) $('#cfg-dest').value = folder;
      } catch (error) {
        toast.error('No se pudo abrir el selector', error.message);
      }
    });

    $('#cfg-save-transfer').addEventListener('click', async () => {
      try {
        await saveConfig({
          transfer: {
            destDir: $('#cfg-dest').value.trim(),
            nameTemplate: $('#cfg-template').value.trim() || '{modelo}_{tag}',
            maxGb: Number($('#cfg-maxgb').value) || 50,
            verify: $('#cfg-verify').checked
          }
        });
        toast.success('Transferencias guardadas');
      } catch (error) {
        await errorDialog('No se pudo guardar', error);
      }
    });
  }

  /* ================= Ollama ================= */

  function ollamaHtml() {
    const config = getState().config || {};
    const ollama = config.ollama || {};
    const ui = config.ui || {};
    const base = getState().base || {};
    return `
      <div class="settings-section">
        <h2>Ollama</h2>
        <p class="hint">Conexión con el servicio y ruta donde se almacenan los modelos.</p>
      </div>

      <div class="settings-section">
        <div class="form-grid">
          <div class="field">
            <label for="cfg-host">Host de Ollama</label>
            <input id="cfg-host" class="input" value="${escapeHtml(ollama.host || 'http://127.0.0.1:11434')}" />
          </div>
          <div class="field">
            <label for="cfg-timeout">Timeout de conexión (ms)</label>
            <input id="cfg-timeout" class="input" type="number" min="500" max="30000" value="${Number(ollama.timeoutMs) || 4000}" />
          </div>
          <div class="field full">
            <label for="cfg-base">Ruta base de modelos</label>
            <div class="input-row">
              <input id="cfg-base" class="input" value="${escapeHtml(ollama.basePath || '')}" />
              <button class="btn btn-sm" id="cfg-base-browse"><i class="fa-solid fa-folder-open"></i> Examinar</button>
              <button class="btn btn-sm" id="cfg-base-open" title="Abrir carpeta"><i class="fa-solid fa-folder-tree"></i></button>
            </div>
            <small>Debe contener las carpetas <span class="mono">blobs</span> y <span class="mono">manifests</span>.</small>
          </div>
        </div>
        <div id="cfg-base-info" class="alert" style="margin-top:12px">
          <i class="fa-solid ${base.valid ? 'fa-circle-check' : 'fa-triangle-exclamation'}"></i>
          <span>${base.valid ? 'Estructura válida' : 'Estructura no verificada'} · ${escapeHtml(shortPath(base.basePath || ollama.basePath || '', 70))}</span>
        </div>
      </div>

      <div class="settings-section">
        <h3 style="margin-bottom:10px">Rendimiento y ventana</h3>
        <div class="form-grid">
          <div class="field">
            <label>Acrílico nativo (Windows 11)</label>
            <label class="switch">
              <input type="checkbox" id="cfg-acrylic" ${ui.acrylic ? 'checked' : ''} />
              <span class="track"></span>
              Activar material acrílico
            </label>
            <small>Puede reducir el rendimiento al arrastrar la ventana.</small>
          </div>
          <div class="field">
            <label>Modo rendimiento</label>
            <label class="switch">
              <input type="checkbox" id="cfg-performance" ${ui.performanceMode ? 'checked' : ''} />
              <span class="track"></span>
              Reducir animaciones y orbes
            </label>
            <small>Recomendado en equipos con GPU integrada.</small>
          </div>
        </div>
      </div>

      <div class="settings-section">
        <div class="row-wrap">
          <button class="btn btn-primary btn-sm" id="cfg-save-ollama"><i class="fa-solid fa-floppy-disk"></i> Guardar conexión</button>
          <button class="btn btn-ghost btn-sm" id="cfg-test"><i class="fa-solid fa-plug-circle-check"></i> Probar conexión</button>
          <span id="cfg-test-result" class="tiny soft"></span>
        </div>
      </div>
    `;
  }

  function bindOllama() {
    $('#cfg-base-browse').addEventListener('click', async () => {
      try {
        const folder = await call(bridge.dialogs.pickFolder, { title: 'Seleccionar carpeta de modelos de Ollama' });
        if (folder) $('#cfg-base').value = folder;
      } catch (error) {
        toast.error('No se pudo abrir el selector', error.message);
      }
    });

    $('#cfg-base-open').addEventListener('click', async () => {
      try { await call(bridge.shell.openPath, $('#cfg-base').value.trim()); }
      catch (error) { toast.error('No se pudo abrir la carpeta', error.message); }
    });

    $('#cfg-acrylic').addEventListener('change', async (event) => {
      try {
        const result = await call(bridge.window.setAcrylic, event.target.checked);
        if (!result.applied) {
          toast.warning('Acrílico no disponible', 'Requiere Windows 11 y una ventana compatible.');
          event.target.checked = false;
        }
      } catch (error) {
        toast.error('No se pudo cambiar el material', error.message);
      }
    });

    $('#cfg-test').addEventListener('click', async () => {
      const label = $('#cfg-test-result');
      label.innerHTML = '<span class="spinner"></span> probando…';
      try {
        const result = await call(bridge.ollama.status);
        label.textContent = result.online
          ? `En línea · v${result.version} · ${result.modelCount} modelo(s)`
          : `Sin conexión · ${result.error || 'servicio no disponible'}`;
        toast[result.online ? 'success' : 'warning'](
          result.online ? 'Ollama responde' : 'Ollama no responde',
          result.online ? `${result.modelCount} modelos detectados` : result.error
        );
      } catch (error) {
        label.textContent = 'Error de conexión';
        toast.error('No se pudo probar la conexión', error.message);
      }
    });

    $('#cfg-save-ollama').addEventListener('click', async () => {
      const host = $('#cfg-host').value.trim();
      const basePath = $('#cfg-base').value.trim();
      if (!/^https?:\/\//i.test(host)) {
        toast.warning('Host inválido', 'Debe empezar por http:// o https://');
        return;
      }
      try {
        await saveConfig({
          ollama: {
            host,
            basePath,
            timeoutMs: Number($('#cfg-timeout').value) || 4000
          },
          ui: {
            acrylic: $('#cfg-acrylic').checked,
            performanceMode: $('#cfg-performance').checked
          }
        });
        toast.success('Conexión guardada', 'El inventario se actualizará ahora.');
        await Promise.all([refreshModels({ silent: true }), refreshStatus()]);
        window.dispatchEvent(new CustomEvent('neitor:refresh-data'));
        renderPanel();
      } catch (error) {
        await errorDialog('No se pudo guardar', error);
      }
    });
  }

  /* ================= Base de datos ================= */

  function databaseHtml() {
    const base = getState().base || {};
    return `
      <div class="settings-section">
        <h2>Base de datos de blobs</h2>
        <p class="hint">Cada capa de modelo se guarda una sola vez y se comparte por digest. Los blobs huérfanos ocupan espacio recuperable.</p>
      </div>
      <div class="settings-section">
        <div class="row-wrap">
          <button class="btn btn-primary btn-sm" id="db-refresh"><i class="fa-solid fa-rotate"></i> Analizar</button>
          <button class="btn btn-ghost btn-sm" id="db-open"><i class="fa-solid fa-folder-tree"></i> Abrir carpeta de modelos</button>
        </div>
        <div id="db-stats" class="stack-sm" style="margin-top:12px">
          <div class="empty" style="padding:22px"><i class="fa-solid fa-database"></i><strong>Sin analizar</strong><p>Pulsa Analizar para leer los blobs y detectar huérfanos.</p></div>
        </div>
      </div>
      <div class="settings-section">
        <label class="field-label">Blobs huérfanos</label>
        <div id="db-orphans" class="table-wrap" style="margin-top:8px;max-height:260px">
          <table class="data"><thead><tr><th>Archivo</th><th>Tamaño</th></tr></thead><tbody><tr><td colspan="2" class="soft">Sin datos.</td></tr></tbody></table>
        </div>
        <p class="hint" style="margin-top:8px">La limpieza automática queda fuera de la alfa v0: revisa la lista antes de borrar manualmente.</p>
      </div>
      <div class="settings-section">
        <div class="alert">
          <i class="fa-solid fa-folder-tree"></i>
          <span>Ruta analizada: <span class="mono">${escapeHtml(shortPath(base.basePath || (getState().config?.ollama?.basePath) || '', 80))}</span></span>
        </div>
      </div>
    `;
  }

  function bindDatabase() {
    $('#db-open').addEventListener('click', async () => {
      const target = getState().config?.ollama?.basePath || getState().base?.basePath;
      try { await call(bridge.shell.openPath, target); }
      catch (error) { toast.error('No se pudo abrir la carpeta', error.message); }
    });

    $('#db-refresh').addEventListener('click', async () => {
      const button = $('#db-refresh');
      button.disabled = true;
      button.innerHTML = '<span class="spinner"></span> Analizando…';
      try {
        const stats = await refreshBlobStats();
        renderDatabaseStats(stats);
      } catch (error) {
        await errorDialog('No se pudo analizar la base de datos', error);
      } finally {
        button.disabled = false;
        button.innerHTML = '<i class="fa-solid fa-rotate"></i> Analizar';
      }
    });
  }

  function renderDatabaseStats(stats) {
    const box = $('#db-stats');
    if (!stats || !stats.ok) {
      box.innerHTML = `<div class="alert warning"><i class="fa-solid fa-triangle-exclamation"></i><span>No se encontró la carpeta <span class="mono">blobs</span> en la ruta configurada.</span></div>`;
      return;
    }
    box.innerHTML = `
      <div class="grid-3">
        <div class="detail-item"><span>Tamaño total</span><strong>${escapeHtml(stats.totalLabel || fmtBytes(stats.totalBytes))}</strong></div>
        <div class="detail-item"><span>Blobs</span><strong>${stats.blobCount}</strong></div>
        <div class="detail-item"><span>Referenciados</span><strong>${stats.referenced}</strong></div>
        <div class="detail-item"><span>Huérfanos</span><strong>${stats.orphanCount}</strong></div>
        <div class="detail-item"><span>Espacio recuperable</span><strong>${escapeHtml(stats.orphanLabel || fmtBytes(stats.orphanBytes))}</strong></div>
        <div class="detail-item"><span>Manifiestos</span><strong>${stats.manifests}</strong></div>
      </div>
    `;
    const orphans = Array.isArray(stats.orphans) ? stats.orphans : [];
    const body = orphans.length
      ? orphans.slice(0, 60).map((orphan) => `<tr><td class="mono tiny">${escapeHtml(orphan.name)}</td><td class="nowrap">${escapeHtml(orphan.sizeLabel)}</td></tr>`).join('')
      : `<tr><td colspan="2" class="soft">No hay blobs huérfanos.</td></tr>`;
    $('#db-orphans').innerHTML = `<table class="data"><thead><tr><th>Archivo</th><th>Tamaño</th></tr></thead><tbody>${body}</tbody></table>`;
  }

  /* ================= Avanzado ================= */

  function advancedHtml() {
    const info = getState();
    return `
      <div class="settings-section">
        <h2>Avanzado</h2>
        <p class="hint">Registro, mantenimiento y datos de la aplicación.</p>
      </div>

      <div class="settings-section">
        <div class="row-wrap" style="justify-content:space-between">
          <label class="field-label">Registro en vivo</label>
          <div class="row">
            <button class="btn btn-ghost btn-sm" id="log-refresh"><i class="fa-solid fa-rotate"></i> Refrescar</button>
            <button class="btn btn-ghost btn-sm" id="log-open"><i class="fa-solid fa-folder-open"></i> Abrir carpeta</button>
          </div>
        </div>
        <div class="log-view" id="log-view" style="margin-top:8px"></div>
      </div>

      <div class="settings-section">
        <h3 style="margin-bottom:10px">Mantenimiento</h3>
        <div class="row-wrap">
          <button class="btn btn-ghost btn-sm" id="adv-reset-achievements"><i class="fa-solid fa-trophy"></i> Reiniciar logros</button>
          <button class="btn btn-ghost btn-sm" id="adv-reset-config"><i class="fa-solid fa-rotate-left"></i> Restaurar configuración</button>
          <button class="btn btn-ghost btn-sm" id="adv-show-config"><i class="fa-solid fa-file-code"></i> Ver config.json</button>
          <button class="btn btn-ghost btn-sm" id="adv-open-data"><i class="fa-solid fa-folder-tree"></i> Abrir datos</button>
        </div>
      </div>

      <div class="settings-section">
        <h3 style="margin-bottom:10px">Aplicación</h3>
        <div class="detail-grid">
          <div class="detail-item"><span>Versión</span><strong>${escapeHtml(info.version)}</strong></div>
          <div class="detail-item"><span>Plataforma</span><strong>${escapeHtml(info.platform)}</strong></div>
          <div class="detail-item"><span>Datos</span><strong class="mono">${escapeHtml(shortPath(info.paths?.root || '', 48))}</strong></div>
          <div class="detail-item"><span>Logs</span><strong class="mono">${escapeHtml(shortPath(info.paths?.logs || '', 48))}</strong></div>
          <div class="detail-item full"><span>Ruta base de Ollama</span><strong class="mono">${escapeHtml(shortPath(info.config?.ollama?.basePath || '', 80))}</strong></div>
        </div>
      </div>
    `;
  }

  function renderLogs() {
    const view = $('#log-view');
    if (!view) return;
    if (!logEntries.length) {
      view.innerHTML = '<span class="soft">Sin entradas todavía.</span>';
      return;
    }
    view.innerHTML = logEntries.slice(-220).map((entry) => `
      <span class="log-line ${escapeHtml(entry.level)}">
        <span class="ts">${fmtTime(entry.ts)}</span><span class="lvl">${escapeHtml(entry.level.toUpperCase())}</span>${escapeHtml(entry.message)}
      </span>
    `).join('');
    view.scrollTop = view.scrollHeight;
  }

  async function loadLogs() {
    try {
      const buffer = await call(bridge.logs.list);
      logEntries = Array.isArray(buffer) ? buffer : [];
      renderLogs();
    } catch (error) {
      logEntries = [];
      renderLogs();
    }
  }

  function bindAdvanced() {
    loadLogs();
    offLogs = bridge ? bridge.logs.onEvent((entry) => {
      if (disposed) return;
      logEntries.push(entry);
      if (logEntries.length > 500) logEntries.shift();
      if (tab === 'advanced') renderLogs();
    }) : () => {};

    $('#log-refresh').addEventListener('click', loadLogs);
    $('#log-open').addEventListener('click', async () => {
      try { await call(bridge.logs.openFolder); }
      catch (error) { toast.error('No se pudo abrir la carpeta', error.message); }
    });

    $('#adv-reset-achievements').addEventListener('click', async () => {
      const ok = await confirm({
        title: 'Reiniciar logros',
        text: 'Se perderán el XP, los trofeos y las estadísticas acumuladas.',
        confirmText: 'Reiniciar',
        icon: 'warning',
        danger: true
      });
      if (!ok) return;
      try {
        await call(bridge.achievements.reset);
        await refreshAchievements();
        toast.success('Logros reiniciados');
      } catch (error) {
        await errorDialog('No se pudieron reiniciar los logros', error);
      }
    });

    $('#adv-reset-config').addEventListener('click', async () => {
      const ok = await confirm({
        title: 'Restaurar configuración',
        text: 'Se restablecerán conexión, rutas, apariencia y preferencias. La app se recargará.',
        confirmText: 'Restaurar',
        icon: 'warning',
        danger: true
      });
      if (!ok) return;
      try {
        await call(bridge.config.reset);
        window.localStorage.removeItem('neitor.appearance.v1');
        window.location.reload();
      } catch (error) {
        await errorDialog('No se pudo restaurar', error);
      }
    });

    $('#adv-show-config').addEventListener('click', async () => {
      const configPath = getState().paths?.config;
      try { await call(bridge.shell.showItem, configPath); }
      catch (error) { toast.error('No se encontró config.json', error.message); }
    });

    $('#adv-open-data').addEventListener('click', async () => {
      try { await call(bridge.shell.openPath, getState().paths?.root); }
      catch (error) { toast.error('No se pudo abrir la carpeta', error.message); }
    });
  }

  /* ================= Render y navegación ================= */

  function renderPanel() {
    offLogs();
    offLogs = () => {};
    container.querySelectorAll('[data-tab]').forEach((button) => {
      button.classList.toggle('active', button.dataset.tab === tab);
    });

    if (tab === 'appearance') {
      panel.innerHTML = appearanceHtml();
      bindAppearance();
    } else if (tab === 'transfer') {
      panel.innerHTML = transferHtml();
      bindTransfer();
    } else if (tab === 'ollama') {
      panel.innerHTML = ollamaHtml();
      bindOllama();
    } else if (tab === 'database') {
      panel.innerHTML = databaseHtml();
      bindDatabase();
    } else {
      panel.innerHTML = advancedHtml();
      bindAdvanced();
    }
  }

  container.querySelectorAll('[data-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      tab = button.dataset.tab;
      renderPanel();
    });
  });

  const onTheme = () => {
    if (tab === 'appearance') bindAppearanceActive();
  };
  window.addEventListener('neitor:theme', onTheme);

  const unsubscribe = subscribe(() => {
    if (disposed) return;
    if (tab === 'appearance') bindAppearanceActive();
  });

  renderPanel();

  return () => {
    disposed = true;
    offLogs();
    window.removeEventListener('neitor:theme', onTheme);
    unsubscribe();
  };
}
