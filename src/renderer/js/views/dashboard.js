/** Vista Dashboard: KPIs, RAM/VRAM real, gráficas y trofeos recientes. */

import { getState, subscribe } from '../store.js';
import { bridge, call } from '../ipc.js';
import { refreshPs, refreshAchievements } from '../services.js';
import { createDoughnut, createHorizontalBars, destroyCharts } from '../lib/charts.js';
import { fmtBytes, fmtDate, escapeHtml } from '../lib/format.js';
import { toast } from '../lib/toast.js';

export function mount(container) {
  let disposed = false;
  let timer = null;
  let lastModels = null;

  container.innerHTML = `
    <div class="view-inner">
      <header class="page-head">
        <div>
          <h1><i class="fa-solid fa-chart-pie"></i> Dashboard</h1>
          <p class="page-sub">Telemetría en tiempo real de tu biblioteca de modelos, memoria liberada y progreso.</p>
        </div>
        <div class="page-actions">
          <button class="btn btn-ghost btn-sm" id="dash-refresh"><i class="fa-solid fa-rotate"></i> Refrescar</button>
          <button class="btn btn-primary btn-sm" id="dash-export"><i class="fa-solid fa-box-open"></i> Exportar</button>
        </div>
      </header>

      <div class="grid-kpi">
        <article class="glass-panel kpi">
          <span class="kpi-icon"><i class="fa-solid fa-crown"></i></span>
          <div class="kpi-body">
            <div class="kpi-label">Rango y nivel</div>
            <div class="kpi-value" id="kpi-level">LVL 1</div>
            <div class="kpi-sub" id="kpi-xp">0 XP</div>
            <div class="progress kpi-progress"><span id="kpi-xp-fill"></span></div>
          </div>
        </article>

        <article class="glass-panel kpi">
          <span class="kpi-icon"><i class="fa-solid fa-layer-group"></i></span>
          <div class="kpi-body">
            <div class="kpi-label">Modelos</div>
            <div class="kpi-value" id="kpi-models">0</div>
            <div class="kpi-sub" id="kpi-models-sub">sin inventario</div>
          </div>
        </article>

        <article class="glass-panel kpi">
          <span class="kpi-icon"><i class="fa-solid fa-microchip"></i></span>
          <div class="kpi-body">
            <div class="kpi-label">RAM/VRAM liberada</div>
            <div class="kpi-value" id="kpi-ram">0 B</div>
            <div class="kpi-sub" id="kpi-ram-sub">0 modelos cargados</div>
          </div>
        </article>

        <article class="glass-panel kpi">
          <span class="kpi-icon"><i class="fa-solid fa-trophy"></i></span>
          <div class="kpi-body">
            <div class="kpi-label">Trofeos</div>
            <div class="kpi-value" id="kpi-trophies">0</div>
            <div class="kpi-sub" id="kpi-trophies-sub">0 desbloqueados</div>
          </div>
        </article>
      </div>

      <div class="grid-charts">
        <section class="glass-panel chart-card">
          <div class="chart-head">
            <h3><i class="fa-solid fa-chart-pie"></i> Familias de modelos</h3>
            <span class="pill" id="family-count">0 familias</span>
          </div>
          <div class="chart-box" id="family-chart"></div>
        </section>

        <section class="glass-panel chart-card">
          <div class="chart-head">
            <h3><i class="fa-solid fa-chart-simple"></i> Modelos por tamaño</h3>
            <span class="pill" id="top-count">top 6</span>
          </div>
          <div class="chart-box" id="size-chart"></div>
        </section>
      </div>

      <div class="grid-2">
        <section class="glass-panel" style="padding:15px 16px">
          <div class="chart-head" style="margin-bottom:10px">
            <h3><i class="fa-solid fa-memory"></i> Memoria en uso</h3>
            <span class="pill" id="ram-total">0 B</span>
          </div>
          <div id="ram-list" class="stack-sm"></div>
          <p class="hint" style="margin-top:10px">Datos reales de <span class="mono">/api/ps</span>. Descargar un modelo lo expulsa de RAM/VRAM al instante.</p>
        </section>

        <section class="glass-panel" style="padding:15px 16px">
          <div class="chart-head" style="margin-bottom:10px">
            <h3><i class="fa-solid fa-trophy"></i> Trofeos recientes</h3>
            <button class="btn btn-ghost btn-sm" id="dash-trophies">Ver todos</button>
          </div>
          <div id="recent-trophies" class="stack-sm"></div>
        </section>
      </div>
    </div>
  `;

  const $ = (selector) => container.querySelector(selector);

  function renderKpis() {
    const state = getState();
    const achievements = state.achievements;
    const level = achievements && achievements.level ? achievements.level : { level: 1, xp: 0, progress: 0, nextLevelXp: 100 };
    $('#kpi-level').textContent = `LVL ${level.level}`;
    $('#kpi-xp').textContent = `${level.xp} / ${level.nextLevelXp} XP`;
    $('#kpi-xp-fill').style.width = `${Math.round((level.progress || 0) * 100)}%`;

    $('#kpi-models').textContent = String(state.summary.count || 0);
    $('#kpi-models-sub').textContent = `${fmtBytes(state.summary.diskBytes || 0)} en disco`;

    const freed = achievements && achievements.totals ? achievements.totals.bytesFreed : 0;
    $('#kpi-ram').textContent = fmtBytes(freed);
    $('#kpi-ram-sub').textContent = `${state.ps.length} modelo(s) cargado(s) ahora`;

    const catalog = achievements && Array.isArray(achievements.catalog) ? achievements.catalog : [];
    const unlocked = catalog.filter((trophy) => trophy.unlocked);
    $('#kpi-trophies').textContent = `${unlocked.length}/${catalog.length}`;
    $('#kpi-trophies-sub').textContent = `${unlocked.length} desbloqueado(s)`;
  }

  function renderRam() {
    const state = getState();
    const list = $('#ram-list');
    if (!state.ps.length) {
      list.innerHTML = `
        <div class="empty" style="padding:22px 10px">
          <i class="fa-solid fa-plug-circle-xmark"></i>
          <strong>Sin modelos en memoria</strong>
          <p>Ollama no tiene modelos cargados ahora mismo.</p>
        </div>
      `;
      $('#ram-total').textContent = '0 B';
      return;
    }
    const total = state.ps.reduce((sum, model) => sum + (Number(model.size) || 0), 0);
    $('#ram-total').textContent = fmtBytes(total);
    list.innerHTML = state.ps.map((model) => `
      <div class="trophy-card" style="align-items:center">
        <span class="trophy-icon" style="color:var(--accent)"><i class="fa-solid fa-microchip"></i></span>
        <div class="trophy-meta grow">
          <strong class="truncate">${escapeHtml(model.name)}</strong>
          <p>${escapeHtml(model.sizeLabel)} en memoria · ${escapeHtml(model.vramLabel)} en VRAM</p>
        </div>
        <button class="btn btn-ghost btn-sm" data-unload="${escapeHtml(model.name)}">
          <i class="fa-solid fa-power-off"></i> Descargar
        </button>
      </div>
    `).join('');
  }

  function renderTrophies() {
    const state = getState();
    const catalog = state.achievements && Array.isArray(state.achievements.catalog) ? state.achievements.catalog : [];
    const unlocked = catalog.filter((trophy) => trophy.unlocked);
    const list = $('#recent-trophies');
    if (!unlocked.length) {
      list.innerHTML = `
        <div class="empty" style="padding:22px 10px">
          <i class="fa-solid fa-trophy"></i>
          <strong>Aún sin trofeos</strong>
          <p>Exporta o importa un modelo para empezar a desbloquear logros.</p>
        </div>
      `;
      return;
    }
    list.innerHTML = unlocked.slice(-4).reverse().map((trophy) => `
      <div class="trophy-card unlocked">
        <span class="trophy-icon"><i class="fa-solid ${escapeHtml(trophy.icon)}"></i></span>
        <div class="trophy-meta">
          <strong>${escapeHtml(trophy.name)}</strong>
          <p>${escapeHtml(trophy.description)}</p>
        </div>
        <span class="trophy-xp">+${trophy.xp} XP</span>
      </div>
    `).join('');
  }

  function emptyChart(box, iconName, title, text) {
    box.innerHTML = `
      <div class="empty" style="height:100%">
        <i class="fa-solid ${iconName}"></i>
        <strong>${title}</strong>
        <p>${text}</p>
      </div>
    `;
  }

  function buildCharts() {
    const state = getState();
    destroyCharts();
    const familyBox = $('#family-chart');
    const sizeBox = $('#size-chart');
    if (!state.models.length) {
      familyBox.innerHTML = '';
      sizeBox.innerHTML = '';
      emptyChart(familyBox, 'fa-chart-pie', 'Sin datos todavía', 'Aparecerán cuando tengas modelos en Ollama.');
      emptyChart(sizeBox, 'fa-chart-simple', 'Sin datos todavía', 'Exporta o descarga un modelo para ver su tamaño.');
      $('#family-count').textContent = '0 familias';
      return;
    }

    const counts = new Map();
    for (const model of state.models) {
      const family = model.family || 'desconocida';
      counts.set(family, (counts.get(family) || 0) + 1);
    }
    const families = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    $('#family-count').textContent = `${families.length} familia(s)`;

    familyBox.innerHTML = '<canvas></canvas>';
    createDoughnut(familyBox.querySelector('canvas'), families.map(([family]) => family), families.map(([, count]) => count));

    const top = [...state.models]
      .sort((a, b) => (b.sizeBytes || 0) - (a.sizeBytes || 0))
      .slice(0, 6);
    sizeBox.innerHTML = '<canvas></canvas>';
    createHorizontalBars(
      sizeBox.querySelector('canvas'),
      top.map((model) => `${model.name}:${model.tag}`),
      top.map((model) => model.sizeBytes || 0),
      'Tamaño'
    );
  }

  async function unloadModel(id, button) {
    button.disabled = true;
    const original = button.innerHTML;
    button.innerHTML = '<span class="spinner"></span> Descargando…';
    try {
      const result = await call(bridge.ollama.unload, id);
      toast.success('Memoria liberada', `${id} · ${fmtBytes(result.freed)} recuperados`);
      await Promise.all([refreshPs(), refreshAchievements()]);
    } catch (error) {
      toast.error('No se pudo descargar el modelo', error.message);
      button.disabled = false;
      button.innerHTML = original;
    }
  }

  $('#ram-list').addEventListener('click', (event) => {
    const button = event.target.closest('[data-unload]');
    if (button) unloadModel(button.dataset.unload, button);
  });

  $('#dash-refresh').addEventListener('click', async () => {
    const button = $('#dash-refresh');
    button.disabled = true;
    try {
      await Promise.all([refreshPs(), refreshAchievements()]);
      window.dispatchEvent(new CustomEvent('neitor:refresh-data'));
      toast.info('Telemetría actualizada');
    } finally {
      button.disabled = false;
    }
  });

  $('#dash-export').addEventListener('click', () => { window.location.hash = '#/export'; });
  $('#dash-trophies').addEventListener('click', () => window.dispatchEvent(new CustomEvent('neitor:open-trophies')));

  renderKpis();
  renderRam();
  renderTrophies();
  buildCharts();
  lastModels = getState().models;

  const unsubscribe = subscribe(() => {
    if (disposed) return;
    renderKpis();
    renderRam();
    renderTrophies();
    const state = getState();
    if (state.models !== lastModels) {
      lastModels = state.models;
      buildCharts();
    }
  });

  const onTheme = () => {
    if (!disposed) buildCharts();
  };
  window.addEventListener('neitor:theme', onTheme);

  refreshPs().catch(() => {});
  timer = setInterval(() => {
    if (!disposed) refreshPs().catch(() => {});
  }, 5000);

  return () => {
    disposed = true;
    clearInterval(timer);
    unsubscribe();
    window.removeEventListener('neitor:theme', onTheme);
    destroyCharts();
  };
}
