/** Vista Exportar: selección, plantilla, trabajos reenganchables y verificación. */

import { getState, subscribe, setSelected, selectMany, selectedModels } from '../store.js';
import { bridge, call } from '../ipc.js';
import { refreshAchievements, listJobs } from '../services.js';
import { fmtBytes, escapeHtml, debounce } from '../lib/format.js';
import { toast } from '../lib/toast.js';
import { alert, errorDialog } from '../lib/swal.js';

export function mount(container) {
  let disposed = false;
  let jobId = null;
  let running = false;
  let lastPercent = 0;
  let lastModels = null;
  let activeJobs = [];

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
              <span class="pill" id="exp-exportable">0 exportables</span>
            </div>
            <small>Solo se pueden exportar modelos con manifiesto y blobs locales.</small>
          </div>
        </div>
      </section>

      <div class="table-wrap" style="max-height:min(42vh,420px)">
        <table class="data">
          <thead>
            <tr>
              <th class="check"><input type="checkbox" class="check" id="exp-select-all" aria-label="Seleccionar exportables" /></th>
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
            <button id="exp-start" class="btn btn-primary" disabled><i class="fa-solid fa-box-open"></i> Exportar seleccionados</button>
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

  function activeExport() {
    return activeJobs.find((job) => job.type === 'export' && ['queued', 'running', 'cancelling'].includes(job.status));
  }

  function updateSummary() {
    const state = getState();
    const selected = selectedModels();
    const exportable = state.models.filter((model) => model.exportable);
    const total = selected.reduce((sum, model) => sum + (model.sizeBytes || 0), 0);
    $('#exp-count').textContent = `${selected.length} modelo(s)`;
    $('#exp-size').textContent = fmtBytes(total);
    $('#exp-exportable').textContent = `${exportable.length} exportables`;

    const checkbox = $('#exp-select-all');
    checkbox.checked = exportable.length > 0 && exportable.every((model) => state.selection.has(model.id));
    checkbox.indeterminate = !checkbox.checked && exportable.some((model) => state.selection.has(model.id));

    const busy = running || Boolean(activeExport());
    $('#exp-start').disabled = busy || selected.length === 0 || selected.some((model) => !model.exportable);
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
      const disabled = !model.exportable;
      return `
        <tr class="${selected ? 'selected' : ''}" data-id="${escapeHtml(model.id)}">
          <td class="check">
            <input type="checkbox" class="check" data-select="${escapeHtml(model.id)}"
              ${selected ? 'checked' : ''} ${disabled ? 'disabled' : ''}
              title="${disabled ? escapeHtml(model.exportBlockReason || 'no exportable') : 'Seleccionar'}" />
          </td>
          <td>
            <div class="row" style="gap:6px">
              <strong>${escapeHtml(model.name)}</strong>
              <span class="pill">${escapeHtml(model.tag)}</span>
              ${disabled ? `<span class="pill pill-warning" title="${escapeHtml(model.exportBlockReason || '')}">no exportable</span>` : ''}
            </div>
          </td>
          <td>${model.family ? `<span class="pill pill-accent">${escapeHtml(model.family)}</span>` : '<span class="soft">—</span>'}</td>
          <td>${model.quantization ? `<span class="mono">${escapeHtml(model.quantization)}</span>` : '<span class="soft">—</span>'}</td>
          <td class="nowrap">${fmtBytes(model.sizeBytes)}</td>
          <td class="tiny muted truncate" style="max-width:240px" title="${escapeHtml(model.manifestPath || '')}">
            ${model.manifestPath ? escapeHtml(model.manifestPath.split(/[\\/]/).slice(-4).join('/')) : 'solo API'}
          </td>
        </tr>
      `;
    }).join('');
    updateSummary();
  }

  function templatePreview() {
    const value = $('#exp-template').value || '{modelo}_{tag}';
    const sample = getState().models.find((model) => model.exportable)
      || { name: 'llama3', tag: 'latest', family: 'llama', quantization: 'Q4_K_M' };
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const preview = value
      .replace(/\{modelo\}/g, sample.name)
      .replace(/\{tag\}/g, sample.tag || 'latest')
      .replace(/\{familia\}/g, sample.family || 'familia')
      .replace(/\{quant\}/g, sample.quantization || 'quant')
      .replace(/\{fecha\}/g, stamp);
    $('#exp-preview').textContent = `${preview}.tar`;
  }

  function resetProgress() {
    lastPercent = 0;
    $('#exp-bar').style.width = '0%';
    $('#exp-percent').textContent = '0 %';
    $('#exp-file').textContent = '';
    $('#exp-status').textContent = 'Listo para exportar.';
  }

  function applyProgress(progress) {
    if (!progress) return;
    if (progress.model && !progress.percent && progress.percent !== 0) return;
    const percent = Number(progress.percent) || 0;
    if (percent >= lastPercent) {
      lastPercent = percent;
      $('#exp-bar').style.width = `${percent}%`;
      $('#exp-percent').textContent = `${percent} %`;
    }
    const model = progress.model ? `${progress.model.name}:${progress.model.tag}` : (progress.meta && progress.meta.model ? progress.meta.model : '');
    const phase = progress.phase === 'package' ? 'Empaquetando' : progress.phase === 'copy' ? 'Copiando' : 'Procesando';
    $('#exp-status').textContent = `${phase}${progress.taskIndex ? ` ${progress.taskIndex}/${progress.taskCount}` : ''}${model ? ` · ${model}` : ''}`;
    $('#exp-file').textContent = progress.file || '';
    if (percent >= 100) $('#exp-status').textContent = 'Completado';
  }

  async function adoptJob(job) {
    if (!job) return;
    jobId = job.id;
    running = true;
    $('#exp-start').disabled = true;
    $('#exp-cancel').classList.remove('hidden');
    $('#exp-status').textContent = job.status === 'queued' ? 'En cola…' : 'Recuperando progreso…';
    if (job.progress) applyProgress(job.progress);
  }

  async function refreshJobs({ adopt = false } = {}) {
    try {
      const list = await listJobs();
      activeJobs = Array.isArray(list) ? list : [];
      if (adopt) {
        const active = activeExport();
        if (active && !running) await adoptJob(active);
        if (!active && !running) {
          const last = activeJobs.find((job) => job.type === 'export' && ['done', 'partial', 'error', 'cancelled'].includes(job.status));
          if (last) {
            $('#exp-status').textContent = last.status === 'done'
              ? `Última exportación completada${last.result && last.result.exportFolder ? ` · ${last.result.exportFolder}` : ''}`
              : `Última exportación: ${last.status}`;
          }
        }
      }
      updateSummary();
    } catch { /* ignore */ }
  }

  function finish(job) {
    running = false;
    jobId = null;
    $('#exp-cancel').classList.add('hidden');
    refreshJobs();
    if (!job) return;
    const results = job.result && Array.isArray(job.result.results) ? job.result.results : [];
    const ok = results.filter((result) => result.ok && !result.skipped);
    const failed = results.filter((result) => !result.ok);
    const bytes = ok.reduce((sum, result) => sum + (result.bytes || 0), 0);

    if (job.status === 'cancelled') {
      resetProgress();
      $('#exp-status').textContent = 'Exportación cancelada.';
      toast.warning('Exportación cancelada');
      return;
    }
    if (job.status === 'error') {
      resetProgress();
      $('#exp-status').textContent = 'Error en la exportación.';
      toast.error('Exportación fallida', job.error && job.error.message ? job.error.message : 'Error desconocido');
      return;
    }

    $('#exp-bar').style.width = '100%';
    $('#exp-percent').textContent = '100 %';
    $('#exp-status').textContent = `Completado · ${ok.length} correcto(s), ${failed.length} fallido(s)`;
    refreshAchievements().catch(() => {});
    if (failed.length === 0 && ok.length) {
      import('../lib/confetti.js').then(({ celebrate }) => celebrate()).catch(() => {});
    }
    alert({
      title: failed.length ? 'Exportación completada con incidencias' : 'Exportación completada',
      icon: failed.length ? 'warning' : 'success',
      html: `
        <div style="text-align:left">
          <p><strong>${ok.length}</strong> exportado(s) · <strong>${failed.length}</strong> fallido(s) · ${fmtBytes(bytes)}</p>
          <p style="margin-top:6px">Carpeta: <span class="mono">${escapeHtml((job.result && job.result.exportFolder) || '')}</span></p>
          ${failed.length ? `<ul style="margin-top:8px;padding-left:18px;font-size:11px">${failed.map((result) => `<li>${escapeHtml(result.model?.id || 'modelo')}: ${escapeHtml(result.error?.message || 'error')}</li>`).join('')}</ul>` : ''}
        </div>
      `
    });
  }

  async function start() {
    if (running) return;
    const state = getState();
    const models = selectedModels();
    if (!models.length) {
      toast.warning('Sin selección', 'Marca al menos un modelo exportable.');
      return;
    }
    const invalid = models.filter((model) => !model.exportable);
    if (invalid.length) {
      toast.error('Selección no exportable', `${invalid.length} modelo(s) solo existen vía API o tienen blobs faltantes.`);
      return;
    }
    if (activeExport()) {
      toast.warning('Exportación en curso', 'Espera a que termine la operación actual.');
      return;
    }
    const destDir = $('#exp-dest').value.trim();
    if (!destDir) {
      toast.warning('Falta la carpeta', 'Indica una carpeta de destino.');
      $('#exp-dest').focus();
      return;
    }

    running = true;
    jobId = null;
    $('#exp-start').disabled = true;
    $('#exp-cancel').classList.remove('hidden');
    $('#exp-status').textContent = `Validando ${models.length} modelo(s)…`;
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
        template: $('#exp-template').value.trim() || '{modelo}_{tag}',
        verify: $('#exp-verify').checked
      });
      jobId = result.jobId;
      if (disposed) return;
      $('#exp-status').textContent = result.queued ? 'Trabajo en cola…' : `Exportando ${result.taskCount} modelo(s)…`;
      toast.info(result.queued ? 'Exportación en cola' : 'Exportación iniciada', `${result.taskCount} modelo(s) · ${fmtBytes(result.totalBytes)}`);
      setTimeout(() => refreshJobs({ adopt: true }), 150);
    } catch (error) {
      running = false;
      if (disposed) return;
      $('#exp-start').disabled = false;
      $('#exp-cancel').classList.add('hidden');
      resetProgress();
      await errorDialog('No se pudo iniciar la exportación', error);
    }
  }

  /* ---------------- Eventos de trabajos ---------------- */

  const offProgress = bridge ? bridge.jobs.onProgress((progress) => {
    if (disposed) return;
    if (jobId && progress.jobId !== jobId) return;
    if (!jobId && progress.type === 'export') {
      jobId = progress.jobId;
      running = true;
      $('#exp-cancel').classList.remove('hidden');
    }
    if (progress.type === 'export') applyProgress(progress);
  }) : () => {};

  const offFinished = bridge ? bridge.jobs.onFinished((job) => {
    if (disposed || !job || job.type !== 'export') return;
    if (jobId && job.id !== jobId) return;
    finish(job);
  }) : () => {};

  const offChanged = bridge ? bridge.jobs.onChanged((list) => {
    if (disposed) return;
    activeJobs = Array.isArray(list) ? list : [];
    if (!running) updateSummary();
  }) : () => {};

  /* ---------------- UI ---------------- */

  $('#exp-body').addEventListener('change', (event) => {
    const checkbox = event.target.closest('[data-select]');
    if (!checkbox || checkbox.disabled) return;
    setSelected(checkbox.dataset.select, checkbox.checked);
    renderTable();
  });

  $('#exp-select-all').addEventListener('change', (event) => {
    selectMany(getState().models.filter((model) => model.exportable).map((model) => model.id), event.target.checked);
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

  $('#exp-template').addEventListener('input', debounce(templatePreview, 120));
  container.querySelectorAll('[data-token]').forEach((button) => {
    button.addEventListener('click', () => {
      const input = $('#exp-template');
      const token = button.dataset.token;
      const startPos = input.selectionStart || input.value.length;
      const endPos = input.selectionEnd || input.value.length;
      input.value = input.value.slice(0, startPos) + token + input.value.slice(endPos);
      input.focus();
      input.setSelectionRange(startPos + token.length, startPos + token.length);
      templatePreview();
    });
  });

  $('#exp-start').addEventListener('click', start);
  $('#exp-cancel').addEventListener('click', async () => {
    if (!jobId) return;
    try {
      await call(bridge.jobs.cancel, jobId);
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
  templatePreview();
  lastModels = getState().models;
  refreshJobs({ adopt: true });

  return () => {
    disposed = true;
    unsubscribe();
    offProgress();
    offFinished();
    offChanged();
  };
}
