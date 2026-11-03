/** Vista Exportar: selección, plantilla de nombre, progreso y verificación. */

import { getState, subscribe, setSelected, selectMany, selectedModels, clearSelection } from '../store.js';
import { bridge, call } from '../ipc.js';
import { refreshAchievements } from '../services.js';
import { fmtBytes, escapeHtml, debounce } from '../lib/format.js';
import { toast } from '../lib/toast.js';
import { alert, errorDialog } from '../lib/swal.js';

export function mount(container) {
  let disposed = false;
  let jobId = null;
  let running = false;
  let lastPercent = 0;
  let lastModels = null;

  const config = getState().config || {};
  const transfer = config.transfer || {};
  const dest = transfer.destDir || '';
  const template = transfer.nameTemplate || '{modelo}_{tag}';
  const verify = transfer.verify !== false;

  container.innerHTML = `
    <div class="view-inner">
      <header class="page-head">
        <div>
          <h1><i class="fa-solid fa-box-open"></i> Exportar modelos</h1>
          <p class="page-sub">Empaqueta manifiestos y blobs en un tar verificado con sha256, listo para importar en otro equipo.</p>
        </div>
        <div class="page-actions">
          <button class="btn btn-ghost btn-sm" id="exp-refresh"><i class="fa-solid fa-rotate"></i> Refrescar</button>
        </div>
      </header>

      <section class="glass-panel" style="padding:16px">
        <div class="form-grid">
          <div class="field full">
            <label for="exp-dest">Carpeta de destino</label>
            <div class="input-row">
              <input id="exp-dest" class="input" value="${escapeHtml(dest)}" placeholder="C:\\Ruta\\de\\exportación" />
              <button id="exp-browse" class="btn btn-sm"><i class="fa-solid fa-folder-open"></i> Examinar</button>
            </div>
            <small>Si no existe, se creará automáticamente. Se comprueba el espacio libre antes de empezar.</small>
          </div>

          <div class="field full">
            <label for="exp-template">Plantilla de nombre</label>
            <div class="input-row">
              <input id="exp-template" class="input" value="${escapeHtml(template)}" />
            </div>
            <div class="row-wrap" style="margin-top:2px">
              <span class="tiny soft">Insertar:</span>
              ${['{modelo}', '{tag}', '{familia}', '{quant}', '{fecha}'].map((token) => `<button class="pill" data-token="${token}">${token}</button>`).join('')}
            </div>
            <small>Ejemplo: <span class="mono" id="exp-preview">—</span></small>
          </div>

          <div class="field">
            <label>Integridad</label>
            <label class="switch">
              <input type="checkbox" id="exp-verify" ${verify ? 'checked' : ''} />
              <span class="track"></span>
              Verificar sha256 de cada blob
            </label>
            <small>Recomendado. Duplica la lectura, pero detecta corrupción antes de empaquetar.</small>
          </div>

          <div class="field">
            <label>Resumen de selección</label>
            <div class="row-wrap">
              <span class="pill pill-accent" id="exp-count">0 modelos</span>
              <span class="pill" id="exp-size">0 B</span>
            </div>
            <small>La selección se comparte con la vista Modelos.</small>
          </div>
        </div>
      </section>

      <div class="table-wrap" style="max-height:min(42vh,420px)">
        <table class="data">
          <thead>
            <tr>
              <th class="check"><input type="checkbox" class="check" id="exp-select-all" aria-label="Seleccionar todo" /></th>
              <th>Modelo</th>
              <th>Familia</th>
              <th>Quant</th>
              <th>Tamaño</th>
              <th>Manifiesto</th>
            </tr>
          </thead>
          <tbody id="exp-body"></tbody>
        </table>
      </div>

      <section class="glass-panel" style="padding:14px 16px" id="exp-progress-card">
        <div class="row-wrap" style="justify-content:space-between">
          <div class="row">
            <button id="exp-start" class="btn btn-primary"><i class="fa-solid fa-box-open"></i> Exportar seleccionados</button>
            <button id="exp-cancel" class="btn btn-danger hidden"><i class="fa-solid fa-stop"></i> Cancelar</button>
          </div>
          <span id="exp-status" class="tiny muted">Listo para exportar.</span>
        </div>
        <div class="progress striped" style="margin-top:12px"><span id="exp-bar"></span></div>
        <div class="progress-meta">
          <span id="exp-percent">0 %</span>
          <span id="exp-file" class="truncate"></span>
        </div>
      </section>
    </div>
  `;

  const $ = (selector) => container.querySelector(selector);

  function updateSummary() {
    const state = getState();
    const selected = selectedModels();
    const total = selected.reduce((sum, model) => sum + (model.sizeBytes || 0), 0);
    $('#exp-count').textContent = `${selected.length} modelo(s)`;
    $('#exp-size').textContent = fmtBytes(total);
    const all = state.models;
    const checkbox = $('#exp-select-all');
    checkbox.checked = all.length > 0 && all.every((model) => state.selection.has(model.id));
    checkbox.indeterminate = !checkbox.checked && all.some((model) => state.selection.has(model.id));
    if (!running) $('#exp-start').disabled = selected.length === 0;
  }

  function renderTable() {
    const state = getState();
    const body = $('#exp-body');
    if (!state.models.length) {
      body.innerHTML = `<tr><td colspan="6"><div class="empty"><i class="fa-solid fa-inbox"></i><strong>Sin modelos</strong><p>Descarga o importa un modelo para poder exportarlo.</p></div></td></tr>`;
      updateSummary();
      return;
    }
    body.innerHTML = state.models.map((model) => {
      const selected = state.selection.has(model.id);
      return `
        <tr class="${selected ? 'selected' : ''}" data-id="${escapeHtml(model.id)}">
          <td class="check"><input type="checkbox" class="check" data-select="${escapeHtml(model.id)}" ${selected ? 'checked' : ''} /></td>
          <td><div class="row" style="gap:6px"><strong>${escapeHtml(model.name)}</strong><span class="pill">${escapeHtml(model.tag)}</span></div></td>
          <td>${model.family ? `<span class="pill pill-accent">${escapeHtml(model.family)}</span>` : '<span class="soft">—</span>'}</td>
          <td>${model.quantization ? `<span class="mono">${escapeHtml(model.quantization)}</span>` : '<span class="soft">—</span>'}</td>
          <td class="nowrap">${fmtBytes(model.sizeBytes)}</td>
          <td class="tiny muted truncate" style="max-width:240px" title="${escapeHtml(model.manifestPath || '')}">${model.manifestPath ? escapeHtml(model.manifestPath.split(/[\\/]/).slice(-4).join('/')) : 'solo API'}</td>
        </tr>
      `;
    }).join('');
    updateSummary();
  }

  function updatePreview() {
    const value = $('#exp-template').value || '{modelo}_{tag}';
    const sample = getState().models[0] || { name: 'llama3', tag: 'latest', family: 'llama', quantization: 'Q4_K_M' };
    const preview = value
      .replace(/\{modelo\}/g, sample.name)
      .replace(/\{tag\}/g, sample.tag || 'latest')
      .replace(/\{familia\}/g, sample.family || 'familia')
      .replace(/\{quant\}/g, sample.quantization || 'quant')
      .replace(/\{fecha\}/g, new Date().toISOString().slice(0, 10));
    $('#exp-preview').textContent = `${preview}.tar`;
  }

  function resetProgress() {
    lastPercent = 0;
    $('#exp-bar').style.width = '0%';
    $('#exp-percent').textContent = '0 %';
    $('#exp-file').textContent = '';
    $('#exp-status').textContent = 'Listo para exportar.';
  }

  async function start() {
    if (running) return;
    const state = getState();
    const models = selectedModels();
    if (!models.length) {
      toast.warning('Sin selección', 'Marca al menos un modelo.');
      return;
    }
    const destDir = $('#exp-dest').value.trim();
    if (!destDir) {
      toast.warning('Falta la carpeta', 'Indica una carpeta de destino.');
      $('#exp-dest').focus();
      return;
    }
    const templateValue = $('#exp-template').value.trim() || '{modelo}_{tag}';
    const verifyValue = $('#exp-verify').checked;

    running = true;
    jobId = null;
    $('#exp-start').disabled = true;
    $('#exp-cancel').classList.remove('hidden');
    $('#exp-status').textContent = `Validando ${selectedModels().length} modelo(s)…`;
    lastPercent = 0;
    $('#exp-bar').style.width = '0%';

    try {
      const result = await call(bridge.transfer.startExport, {
        models: models.map((model) => ({
          name: model.name,
          tag: model.tag,
          manifestPath: model.manifestPath,
          family: model.family,
          parameterSize: model.parameterSize,
          quantization: model.quantization
        })),
        destDir,
        template: templateValue,
        verify: verifyValue
      });
      jobId = result.jobId;
      if (disposed) return;
      $('#exp-status').textContent = `Exportando ${result.taskCount} modelo(s)…`;
      toast.info('Exportación iniciada', `${result.taskCount} modelo(s) · ${fmtBytes(result.totalBytes)}`);
    } catch (error) {
      running = false;
      if (disposed) return;
      $('#exp-start').disabled = false;
      $('#exp-cancel').classList.add('hidden');
      resetProgress();
      await errorDialog('No se pudo iniciar la exportación', error);
    }
  }

  function finish() {
    running = false;
    jobId = null;
    $('#exp-start').disabled = false;
    $('#exp-cancel').classList.add('hidden');
  }

  /* ---------------- Eventos IPC ---------------- */

  const offProgress = bridge ? bridge.transfer.onProgress((event) => {
    if (disposed || !jobId || event.jobId !== jobId) return;
    if (event.type === 'task-done') {
      $('#exp-status').textContent = `Empaquetado: ${event.result?.model?.id || ''}`;
      return;
    }
    if (event.type === 'task-error') {
      $('#exp-status').textContent = `Error en ${event.result?.model?.id || 'modelo'}`;
      return;
    }
    const percent = Number(event.percent) || 0;
    if (percent >= lastPercent) {
      lastPercent = percent;
      $('#exp-bar').style.width = `${percent}%`;
      $('#exp-percent').textContent = `${percent} %`;
    }
    const model = event.model ? `${event.model.name}:${event.model.tag}` : '';
    const phase = event.phase === 'package' ? 'Empaquetando' : 'Copiando';
    $('#exp-status').textContent = `${phase} ${event.taskIndex}/${event.taskCount} · ${model}`;
    $('#exp-file').textContent = event.file || '';
  }) : () => {};

  const offResult = bridge ? bridge.transfer.onResult(async (event) => {
    if (disposed || !jobId || event.jobId !== jobId) return;
    const results = Array.isArray(event.results) ? event.results : [];
    const ok = results.filter((result) => result.ok);
    const failed = results.filter((result) => !result.ok);
    const bytes = ok.reduce((sum, result) => sum + (result.bytes || 0), 0);
    $('#exp-bar').style.width = '100%';
    $('#exp-percent').textContent = '100 %';
    $('#exp-status').textContent = `Completado · ${ok.length} correcto(s), ${failed.length} fallido(s)`;
    finish();
    await refreshAchievements();
    if (window.confetti && failed.length === 0 && ok.length) {
      const { celebrate } = await import('../lib/confetti.js');
      celebrate();
    }
    await alert({
      title: failed.length ? 'Exportación completada con incidencias' : 'Exportación completada',
      icon: failed.length ? 'warning' : 'success',
      html: `
        <div style="text-align:left">
          <p><strong>${ok.length}</strong> exportado(s) · <strong>${failed.length}</strong> fallido(s) · ${fmtBytes(bytes)}</p>
          <p style="margin-top:6px">Carpeta: <span class="mono">${escapeHtml(event.exportFolder || '')}</span></p>
          ${failed.length ? `<ul style="margin-top:8px;padding-left:18px;font-size:11px">${failed.map((result) => `<li>${escapeHtml(result.model?.id || 'modelo')}: ${escapeHtml(result.error?.message || 'error')}</li>`).join('')}</ul>` : ''}
        </div>
      `
    });
  }) : () => {};

  const offError = bridge ? bridge.transfer.onError(async (event) => {
    if (disposed || !jobId || event.jobId !== jobId) return;
    finish();
    resetProgress();
    $('#exp-status').textContent = 'Error en la exportación.';
    toast.error('Exportación fallida', event.error?.message || 'Error desconocido');
  }) : () => {};

  const offCancelled = bridge ? bridge.transfer.onCancelled((event) => {
    if (disposed || !jobId || event.jobId !== jobId) return;
    finish();
    resetProgress();
    toast.warning('Exportación cancelada');
  }) : () => {};

  /* ---------------- UI ---------------- */

  $('#exp-body').addEventListener('change', (event) => {
    const checkbox = event.target.closest('[data-select]');
    if (!checkbox) return;
    setSelected(checkbox.dataset.select, checkbox.checked);
    renderTable();
  });

  $('#exp-select-all').addEventListener('change', (event) => {
    selectMany(getState().models.map((model) => model.id), event.target.checked);
    renderTable();
  });

  $('#exp-browse').addEventListener('click', async () => {
    try {
      const folder = await call(bridge.dialogs.pickFolder, {
        title: 'Seleccionar carpeta de exportación',
        defaultPath: $('#exp-dest').value || undefined
      });
      if (folder) $('#exp-dest').value = folder;
    } catch (error) {
      toast.error('No se pudo abrir el selector', error.message);
    }
  });

  $('#exp-template').addEventListener('input', debounce(updatePreview, 120));
  container.querySelectorAll('[data-token]').forEach((button) => {
    button.addEventListener('click', () => {
      const input = $('#exp-template');
      const token = button.dataset.token;
      const start = input.selectionStart || input.value.length;
      const end = input.selectionEnd || input.value.length;
      input.value = input.value.slice(0, start) + token + input.value.slice(end);
      input.focus();
      input.setSelectionRange(start + token.length, start + token.length);
      updatePreview();
    });
  });

  $('#exp-start').addEventListener('click', start);
  $('#exp-cancel').addEventListener('click', async () => {
    if (!jobId) return;
    try {
      await call(bridge.transfer.cancelExport, jobId);
      $('#exp-status').textContent = 'Cancelando…';
    } catch (error) {
      toast.error('No se pudo cancelar', error.message);
    }
  });
  $('#exp-refresh').addEventListener('click', () => window.dispatchEvent(new CustomEvent('neitor:refresh-data')));

  const unsubscribe = subscribe(() => {
    if (disposed) return;
    const state = getState();
    if (state.models !== lastModels) {
      lastModels = state.models;
      renderTable();
    } else {
      updateSummary();
    }
  });

  renderTable();
  updatePreview();
  lastModels = getState().models;

  return () => {
    disposed = true;
    unsubscribe();
    offProgress();
    offResult();
    offError();
    offCancelled();
  };
}
