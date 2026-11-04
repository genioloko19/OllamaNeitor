/** Vista Importar: escaneo, conflictos, trabajos reenganchables y commit transaccional. */

import { bridge, call } from '../ipc.js';
import { refreshModels, refreshStatus, refreshAchievements, listJobs } from '../services.js';
import { fmtBytes, escapeHtml } from '../lib/format.js';
import { toast } from '../lib/toast.js';
import { alert, errorDialog } from '../lib/swal.js';

export function mount(container) {
  let disposed = false;
  let packages = [];
  let selected = new Set();
  let jobId = null;
  let running = false;
  let activeJobs = [];

  container.innerHTML = `
    <div class="view-inner">
      <header class="page-head">
        <div>
          <h1><i class="fa-solid fa-file-import"></i> Importar paquetes</h1>
          <p class="page-sub">Extrae en staging, valida rutas y digests, y confirma cada modelo de forma atómica.</p>
        </div>
        <div class="page-actions">
          <button class="btn btn-ghost btn-sm" id="imp-files"><i class="fa-solid fa-file-arrow-up"></i> Añadir .tar</button>
        </div>
      </header>

      <section class="glass-panel" style="padding:16px">
        <div class="form-grid">
          <div class="field full">
            <label for="imp-folder">Carpeta con paquetes</label>
            <div class="input-row">
              <input id="imp-folder" class="input" placeholder="Carpeta que contiene archivos .tar" />
              <button id="imp-browse" class="btn btn-sm"><i class="fa-solid fa-folder-open"></i> Examinar</button>
              <button id="imp-scan" class="btn btn-sm btn-primary"><i class="fa-solid fa-magnifying-glass"></i> Escanear</button>
            </div>
            <small>El escaneo lee el índice del tar sin extraerlo: detecta modelos, tamaños, conflictos y entradas inseguras.</small>
          </div>

          <div class="field">
            <label for="imp-conflict">Si el modelo ya existe</label>
            <select id="imp-conflict" class="select">
              <option value="overwrite">Sobrescribir (con backup)</option>
              <option value="rename">Importar con otro tag</option>
              <option value="skip">Omitir</option>
            </select>
          </div>

          <div class="field">
            <label>Integridad</label>
            <label class="switch">
              <input type="checkbox" id="imp-verify" checked />
              <span class="track"></span>
              Verificar sha256 al importar
            </label>
          </div>
        </div>
      </section>

      <div id="imp-summary" class="row-wrap">
        <span class="pill pill-accent" id="imp-count">0 paquete(s)</span>
        <span class="pill" id="imp-size">0 B</span>
        <span class="pill" id="imp-models">0 modelo(s)</span>
        <span class="pill" id="imp-conflicts">0 conflictos</span>
        <span class="grow"></span>
        <span class="tiny soft" id="imp-active"></span>
      </div>

      <div class="table-wrap" style="max-height:min(46vh,460px)">
        <table class="data">
          <thead>
            <tr>
              <th class="check"><input type="checkbox" class="check" id="imp-all" aria-label="Seleccionar todos" /></th>
              <th>Paquete</th>
              <th>Modelos</th>
              <th>Tamaño</th>
              <th>Estado</th>
              <th>Ruta</th>
            </tr>
          </thead>
          <tbody id="imp-body"></tbody>
        </table>
      </div>

      <section class="glass-panel" style="padding:14px 16px">
        <div class="row-wrap" style="justify-content:space-between">
          <div class="row">
            <button id="imp-start" class="btn btn-primary" disabled><i class="fa-solid fa-file-import"></i> Importar seleccionados</button>
            <button id="imp-cancel" class="btn btn-danger hidden"><i class="fa-solid fa-stop"></i> Cancelar</button>
          </div>
          <span id="imp-status" class="tiny muted">Escanea una carpeta para comenzar.</span>
        </div>
        <div class="progress striped" style="margin-top:12px"><span id="imp-bar"></span></div>
        <div class="progress-meta">
          <span id="imp-percent">0 %</span>
          <span id="imp-file" class="truncate"></span>
        </div>
      </section>
    </div>
  `;

  const $ = (selector) => container.querySelector(selector);

  function validPackages() {
    return packages.filter((pkg) => pkg.valid && pkg.models && pkg.models.length);
  }

  function activeImport() {
    return activeJobs.find((job) => job.type === 'import' && ['queued', 'running', 'cancelling'].includes(job.status));
  }

  function conflictCount() {
    return packages
      .filter((pkg) => selected.has(pkg.file))
      .reduce((sum, pkg) => sum + (pkg.models || []).filter((model) => model.conflict === 'different').length, 0);
  }

  function updateSummary() {
    const count = selected.size;
    const bytes = packages
      .filter((pkg) => selected.has(pkg.file))
      .reduce((sum, pkg) => sum + (pkg.tarBytes || 0), 0);
    const models = packages
      .filter((pkg) => selected.has(pkg.file))
      .reduce((sum, pkg) => sum + (pkg.models ? pkg.models.length : 0), 0);
    $('#imp-count').textContent = `${count} paquete(s)`;
    $('#imp-size').textContent = fmtBytes(bytes);
    $('#imp-models').textContent = `${models} modelo(s)`;
    $('#imp-conflicts').textContent = `${conflictCount()} conflicto(s)`;
    $('#imp-active').textContent = activeImport() ? 'Importación activa' : '';
    $('#imp-start').disabled = running || Boolean(activeImport()) || count === 0;
    const valid = validPackages();
    const all = valid.length > 0 && valid.every((pkg) => selected.has(pkg.file));
    $('#imp-all').checked = all;
    $('#imp-all').indeterminate = !all && valid.some((pkg) => selected.has(pkg.file));
  }

  function statusBadge(pkg) {
    if (pkg.error) return `<span class="pill pill-danger" title="${escapeHtml(pkg.error)}"><i class="fa-solid fa-circle-xmark"></i> Error</span>`;
    if (pkg.unsafe && pkg.unsafe.length) return `<span class="pill pill-danger" title="${escapeHtml(pkg.unsafe.map((entry) => `${entry.path}: ${entry.reason}`).join('; '))}"><i class="fa-solid fa-shield-halved"></i> Ruta insegura</span>`;
    if (!pkg.models || !pkg.models.length) return '<span class="pill pill-warning"><i class="fa-solid fa-triangle-exclamation"></i> Sin modelos</span>';
    const conflicts = pkg.models.filter((model) => model.conflict === 'different').length;
    if (conflicts) return `<span class="pill pill-warning"><i class="fa-solid fa-code-compare"></i> ${conflicts} existente(s)</span>`;
    return '<span class="pill pill-success"><i class="fa-solid fa-circle-check"></i> Válido</span>';
  }

  function modelSummary(pkg) {
    const models = pkg.models || [];
    if (!models.length) return '<span class="soft">—</span>';
    const visible = models.slice(0, 3).map((model) => {
      const suffix = model.conflict === 'different' ? ' *' : '';
      return `${escapeHtml(model.name)}:${escapeHtml(model.tag)}${suffix}`;
    }).join(', ');
    const extra = models.length > 3 ? ` +${models.length - 3}` : '';
    const conflictHint = models.some((model) => model.conflict === 'different') ? '<div class="tiny soft">* ya existe con otro contenido</div>' : '';
    return `${visible}${extra}${conflictHint}`;
  }

  function render() {
    const body = $('#imp-body');
    if (!packages.length) {
      body.innerHTML = `<tr><td colspan="6"><div class="empty"><i class="fa-solid fa-inbox"></i><strong>Sin paquetes escaneados</strong><p>Elige una carpeta o añade archivos .tar exportados por OllamaNeitor.</p></div></td></tr>`;
      updateSummary();
      return;
    }
    body.innerHTML = packages.map((pkg) => {
      const isSelected = selected.has(pkg.file);
      return `
        <tr class="${isSelected ? 'selected' : ''}">
          <td class="check">
            <input type="checkbox" class="check" data-select="${escapeHtml(pkg.file)}" ${isSelected ? 'checked' : ''} ${pkg.valid ? '' : 'disabled'} />
          </td>
          <td><strong>${escapeHtml(pkg.fileName || pkg.file)}</strong></td>
          <td class="tiny">${modelSummary(pkg)}</td>
          <td class="nowrap">${escapeHtml(pkg.tarLabel || fmtBytes(pkg.tarBytes))}</td>
          <td>${statusBadge(pkg)}</td>
          <td class="tiny muted truncate" style="max-width:300px" title="${escapeHtml(pkg.file)}">${escapeHtml(pkg.file)}</td>
        </tr>
      `;
    }).join('');
    updateSummary();
  }

  async function scanFolder() {
    const folder = $('#imp-folder').value.trim();
    if (!folder) {
      toast.warning('Falta la carpeta', 'Indica la carpeta que contiene los .tar.');
      return;
    }
    const button = $('#imp-scan');
    button.disabled = true;
    const original = button.innerHTML;
    button.innerHTML = '<span class="spinner"></span> Escaneando…';
    $('#imp-status').textContent = 'Leyendo índices de paquetes…';
    try {
      const scanned = await call(bridge.transfer.scanFolder, folder);
      if (disposed) return;
      packages = scanned;
      selected = new Set(validPackages().map((pkg) => pkg.file));
      render();
      $('#imp-status').textContent = `${packages.length} paquete(s) escaneado(s).`;
      toast.info('Escaneo completado', `${packages.length} paquete(s), ${validPackages().length} válido(s).`);
    } catch (error) {
      if (!disposed) await errorDialog('No se pudo escanear la carpeta', error);
    } finally {
      if (!disposed) {
        button.disabled = false;
        button.innerHTML = original;
      }
    }
  }

  async function addFiles() {
    try {
      const files = await call(bridge.dialogs.pickTarFiles);
      if (!files || !files.length) return;
      $('#imp-status').textContent = 'Escaneando archivos seleccionados…';
      for (const file of files) {
        if (packages.some((pkg) => pkg.file === file)) continue;
        try {
          const pkg = await call(bridge.transfer.scanTar, file);
          packages.push(pkg);
          if (pkg.valid) selected.add(pkg.file);
        } catch (error) {
          packages.push({
            file,
            fileName: file.split(/[\\/]/).pop(),
            tarBytes: 0,
            tarLabel: '—',
            models: [],
            unsafe: [],
            valid: false,
            error: error.message
          });
        }
      }
      if (disposed) return;
      render();
      $('#imp-status').textContent = `${packages.length} paquete(s) en la lista.`;
    } catch (error) {
      toast.error('No se pudieron añadir archivos', error.message);
    }
  }

  async function start() {
    if (running || !selected.size) return;
    if (activeImport()) {
      toast.warning('Importación en curso', 'Espera a que termine la operación actual.');
      return;
    }
    running = true;
    jobId = null;
    $('#imp-start').disabled = true;
    $('#imp-cancel').classList.remove('hidden');
    $('#imp-bar').style.width = '0%';
    $('#imp-percent').textContent = '0 %';
    $('#imp-file').textContent = '';
    $('#imp-status').textContent = 'Preparando importación…';

    try {
      const result = await call(bridge.transfer.startImport, {
        files: [...selected],
        conflict: $('#imp-conflict').value,
        verify: $('#imp-verify').checked
      });
      jobId = result.jobId;
      if (disposed) return;
      toast.info(result.queued ? 'Importación en cola' : 'Importación iniciada', `${result.taskCount} paquete(s).`);
      setTimeout(() => refreshJobs({ adopt: true }), 150);
    } catch (error) {
      running = false;
      if (disposed) return;
      $('#imp-start').disabled = false;
      $('#imp-cancel').classList.add('hidden');
      await errorDialog('No se pudo iniciar la importación', error);
    }
  }

  function applyProgress(progress) {
    if (!progress) return;
    const percent = Number(progress.percent) || 0;
    $('#imp-bar').style.width = `${percent}%`;
    $('#imp-percent').textContent = `${percent} %`;
    const phase = progress.phase === 'extract' ? 'Extrayendo'
      : progress.phase === 'verify' ? 'Verificando'
        : progress.phase === 'commit' ? 'Confirmando' : 'Procesando';
    $('#imp-status').textContent = `${phase}${progress.taskIndex ? ` ${progress.taskIndex}/${progress.taskCount}` : ''}`;
    $('#imp-file').textContent = progress.file || '';
    if (progress.model) $('#imp-file').textContent = `${progress.model.name || ''}:${progress.model.tag || ''}`;
  }

  async function refreshJobs({ adopt = false } = {}) {
    try {
      const list = await listJobs();
      activeJobs = Array.isArray(list) ? list : [];
      if (adopt) {
        const active = activeImport();
        if (active && !running) {
          jobId = active.id;
          running = true;
          $('#imp-start').disabled = true;
          $('#imp-cancel').classList.remove('hidden');
          $('#imp-status').textContent = active.status === 'queued' ? 'En cola…' : 'Recuperando progreso…';
          if (active.progress) applyProgress(active.progress);
        }
        if (!active && !running) {
          const last = activeJobs.find((job) => job.type === 'import' && ['done', 'partial', 'error', 'cancelled'].includes(job.status));
          if (last) $('#imp-status').textContent = `Última importación: ${last.status}`;
        }
      }
      updateSummary();
    } catch { /* ignore */ }
  }

  function finish(job) {
    if (!job) return;
    running = false;
    jobId = null;
    $('#imp-cancel').classList.add('hidden');
    refreshJobs();
    const results = job.result && Array.isArray(job.result.results) ? job.result.results : [];
    const ok = results.filter((result) => result.ok && !result.skipped);
    const skipped = results.filter((result) => result.skipped);
    const failed = results.filter((result) => !result.ok);
    const bytes = ok.reduce((sum, result) => sum + (result.bytes || 0), 0);

    if (job.status === 'cancelled') {
      $('#imp-status').textContent = 'Importación cancelada.';
      toast.warning('Importación cancelada');
      return;
    }
    if (job.status === 'error') {
      $('#imp-status').textContent = 'Error en la importación.';
      toast.error('Importación fallida', job.error && job.error.message ? job.error.message : 'Error desconocido');
      return;
    }

    $('#imp-bar').style.width = '100%';
    $('#imp-percent').textContent = '100 %';
    $('#imp-status').textContent = `Completado · ${ok.length} importado(s)`;
    Promise.all([refreshModels(), refreshStatus(), refreshAchievements()]).catch(() => {});
    if (ok.length) {
      import('../lib/confetti.js').then(({ celebrate }) => celebrate()).catch(() => {});
    }
    alert({
      title: failed.length ? 'Importación con incidencias' : 'Importación completada',
      icon: failed.length ? 'warning' : 'success',
      html: `
        <div style="text-align:left">
          <p><strong>${ok.length}</strong> importado(s) · <strong>${skipped.length}</strong> omitido(s) · <strong>${failed.length}</strong> fallido(s)</p>
          <p style="margin-top:6px">${fmtBytes(bytes)} incorporados a la biblioteca.</p>
          <p class="tiny" style="margin-top:6px">La atomicidad es por modelo: los modelos correctos se conservan aunque otro falle.</p>
          ${failed.length ? `<ul style="margin-top:8px;padding-left:18px;font-size:11px">${failed.map((result) => `<li>${escapeHtml(result.fileName || result.file || 'paquete')}${result.model ? ` · ${escapeHtml(result.model.name)}:${escapeHtml(result.model.tag)}` : ''}: ${escapeHtml(result.error?.message || 'error')}</li>`).join('')}</ul>` : ''}
        </div>
      `
    });
  }

  /* ---------------- Eventos de trabajos ---------------- */

  const offProgress = bridge ? bridge.jobs.onProgress((progress) => {
    if (disposed) return;
    if (jobId && progress.jobId !== jobId) return;
    if (!jobId && progress.type === 'import') {
      jobId = progress.jobId;
      running = true;
      $('#imp-cancel').classList.remove('hidden');
    }
    if (progress.type === 'import') applyProgress(progress);
  }) : () => {};

  const offFinished = bridge ? bridge.jobs.onFinished((job) => {
    if (disposed || !job || job.type !== 'import') return;
    if (jobId && job.id !== jobId) return;
    finish(job);
  }) : () => {};

  const offChanged = bridge ? bridge.jobs.onChanged((list) => {
    if (disposed) return;
    activeJobs = Array.isArray(list) ? list : [];
    if (!running) updateSummary();
  }) : () => {};

  /* ---------------- UI ---------------- */

  $('#imp-body').addEventListener('change', (event) => {
    const checkbox = event.target.closest('[data-select]');
    if (!checkbox || checkbox.disabled) return;
    if (checkbox.checked) selected.add(checkbox.dataset.select);
    else selected.delete(checkbox.dataset.select);
    render();
  });

  $('#imp-all').addEventListener('change', (event) => {
    const valid = validPackages();
    if (event.target.checked) valid.forEach((pkg) => selected.add(pkg.file));
    else valid.forEach((pkg) => selected.delete(pkg.file));
    render();
  });

  $('#imp-browse').addEventListener('click', async () => {
    try {
      const folder = await call(bridge.dialogs.pickFolder, { title: 'Seleccionar carpeta con paquetes' });
      if (folder) $('#imp-folder').value = folder;
    } catch (error) {
      toast.error('No se pudo abrir el selector', error.message);
    }
  });

  $('#imp-scan').addEventListener('click', scanFolder);
  $('#imp-folder').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') scanFolder();
  });
  $('#imp-files').addEventListener('click', addFiles);
  $('#imp-start').addEventListener('click', start);
  $('#imp-cancel').addEventListener('click', async () => {
    if (!jobId) return;
    try {
      await call(bridge.jobs.cancel, jobId);
      $('#imp-status').textContent = 'Cancelando…';
    } catch (error) {
      toast.error('No se pudo cancelar', error.message);
    }
  });

  render();
  refreshJobs({ adopt: true });

  return () => {
    disposed = true;
    offProgress();
    offFinished();
    offChanged();
  };
}
