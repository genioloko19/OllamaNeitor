/** Vista Modelos: inventario, búsqueda instantánea, descarga y borrado. */

import { getState, subscribe, setSelected, selectMany, selectedModels, clearSelection } from '../store.js';
import { bridge, call } from '../ipc.js';
import { refreshModels, refreshStatus, refreshAchievements } from '../services.js';
import { fmtBytes, fmtDate, escapeHtml, debounce } from '../lib/format.js';
import { toast } from '../lib/toast.js';
import { confirm, errorDialog } from '../lib/swal.js';
import { openModal } from '../lib/modal.js';

function matches(model, query) {
  const tokens = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;
  const haystack = [
    model.name, model.tag, `${model.name}:${model.tag}`, model.family,
    ...(model.families || []), model.parameterSize, model.quantization, model.format, model.digest
  ].join(' ').toLowerCase();
  return tokens.every((token) => haystack.includes(token));
}

export function mount(container) {
  let disposed = false;
  let query = '';
  let family = '';
  let sort = 'name';
  let pulling = null;
  let lastModels = null;

  container.innerHTML = `
    <div class="view-inner">
      <header class="page-head">
        <div>
          <h1><i class="fa-solid fa-layer-group"></i> Modelos</h1>
          <p class="page-sub">Inventario híbrido: manifiestos en disco y API de Ollama, con búsqueda instantánea.</p>
        </div>
        <div class="page-actions">
          <button class="btn btn-ghost btn-sm" id="models-refresh"><i class="fa-solid fa-rotate"></i> Refrescar</button>
          <button class="btn btn-primary btn-sm" id="models-export"><i class="fa-solid fa-box-open"></i> Exportar selección</button>
        </div>
      </header>

      <section class="glass-panel" style="padding:12px 14px">
        <div class="row-wrap">
          <div class="search">
            <i class="fa-solid fa-magnifying-glass"></i>
            <input id="models-search" class="input" type="search" placeholder="Buscar por nombre, tag, familia, quantización o digest…" autocomplete="off" />
          </div>
          <select id="models-family" class="select" style="width:180px" aria-label="Filtrar por familia">
            <option value="">Todas las familias</option>
          </select>
          <select id="models-sort" class="select" style="width:180px" aria-label="Ordenar">
            <option value="name">Ordenar: nombre</option>
            <option value="size">Ordenar: tamaño</option>
            <option value="modified">Ordenar: modificado</option>
            <option value="family">Ordenar: familia</option>
          </select>
          <span class="pill" id="models-count">0 modelos</span>
        </div>

        <div class="row-wrap" style="margin-top:10px">
          <div class="input-row grow" style="max-width:520px">
            <input id="pull-input" class="input" placeholder="Descargar modelo, ej. llama3.2:3b, qwen2.5-coder:7b" />
            <button id="pull-btn" class="btn btn-sm"><i class="fa-solid fa-cloud-arrow-down"></i> Descargar</button>
            <button id="pull-cancel" class="btn btn-sm btn-ghost hidden"><i class="fa-solid fa-stop"></i> Cancelar</button>
          </div>
          <span id="pull-status" class="tiny muted"></span>
        </div>
      </section>

      <div id="bulk-bar" class="glass-soft hidden" style="display:flex;align-items:center;gap:10px;padding:9px 12px">
        <span id="bulk-count" class="pill pill-accent">0 seleccionados</span>
        <span class="grow"></span>
        <button class="btn btn-sm btn-ghost" id="bulk-clear"><i class="fa-solid fa-xmark"></i> Limpiar</button>
        <button class="btn btn-sm btn-primary" id="bulk-export"><i class="fa-solid fa-box-open"></i> Exportar</button>
      </div>

      <div class="table-wrap">
        <table class="data">
          <thead>
            <tr>
              <th class="check"><input type="checkbox" class="check" id="select-all" aria-label="Seleccionar todo" /></th>
              <th>Modelo</th>
              <th>Familia</th>
              <th>Parámetros</th>
              <th>Quant</th>
              <th>Tamaño</th>
              <th>Modificado</th>
              <th>Origen</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="models-body"></tbody>
        </table>
      </div>
    </div>
  `;

  const $ = (selector) => container.querySelector(selector);

  function visibleModels() {
    const state = getState();
    let list = state.models.filter((model) => matches(model, query));
    if (family) list = list.filter((model) => (model.family || 'desconocida') === family);
    const direction = sort === 'size' || sort === 'modified' ? -1 : 1;
    const collator = new Intl.Collator('es', { numeric: true, sensitivity: 'base' });
    return [...list].sort((a, b) => {
      if (sort === 'size') return ((a.sizeBytes || 0) - (b.sizeBytes || 0)) * direction;
      if (sort === 'modified') return (new Date(a.modifiedAt || 0) - new Date(b.modifiedAt || 0)) * direction;
      if (sort === 'family') return collator.compare(a.family || '', b.family || '');
      return collator.compare(`${a.name}:${a.tag}`, `${b.name}:${b.tag}`);
    });
  }

  function familyOptions() {
    const state = getState();
    const families = [...new Set(state.models.map((model) => model.family || 'desconocida'))].sort();
    const select = $('#models-family');
    const current = select.value;
    select.innerHTML = `<option value="">Todas las familias</option>${families.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('')}`;
    if (families.includes(current)) select.value = current;
  }

  function sourcePill(model) {
    if (model.source === 'both') return '<span class="pill pill-success"><i class="fa-solid fa-circle-check"></i> disco + API</span>';
    if (model.source === 'api') return '<span class="pill pill-accent"><i class="fa-solid fa-cloud"></i> API</span>';
    return '<span class="pill"><i class="fa-solid fa-hard-drive"></i> disco</span>';
  }

  function renderRows() {
    const state = getState();
    const list = visibleModels();
    const body = $('#models-body');
    $('#models-count').textContent = `${list.length} modelo(s)`;

    if (!list.length) {
      body.innerHTML = `
        <tr><td colspan="9">
          <div class="empty">
            <i class="fa-solid fa-inbox"></i>
            <strong>No hay modelos que coincidan</strong>
            <p>Ajusta la búsqueda o revisa la ruta base en el Panel de control.</p>
          </div>
        </td></tr>`;
      updateBulkBar();
      return;
    }

    body.innerHTML = list.map((model) => {
      const selected = state.selection.has(model.id);
      const missing = model.missingBlobs > 0
        ? `<span class="pill pill-danger" title="Faltan blobs"><i class="fa-solid fa-triangle-exclamation"></i> ${model.missingBlobs}</span>`
        : '';
      return `
        <tr data-id="${escapeHtml(model.id)}" class="${selected ? 'selected' : ''}">
          <td class="check">
            <input type="checkbox" class="check" data-select="${escapeHtml(model.id)}" ${selected ? 'checked' : ''} aria-label="Seleccionar ${escapeHtml(model.id)}" />
          </td>
          <td>
            <div class="row" style="gap:6px">
              <strong>${escapeHtml(model.name)}</strong>
              <span class="pill">${escapeHtml(model.tag)}</span>
              ${missing}
            </div>
          </td>
          <td>${model.family ? `<span class="pill pill-accent">${escapeHtml(model.family)}</span>` : '<span class="soft">—</span>'}</td>
          <td>${model.parameterSize ? escapeHtml(model.parameterSize) : '<span class="soft">—</span>'}</td>
          <td>${model.quantization ? `<span class="mono">${escapeHtml(model.quantization)}</span>` : '<span class="soft">—</span>'}</td>
          <td class="nowrap">${fmtBytes(model.sizeBytes)}</td>
          <td class="nowrap tiny muted">${fmtDate(model.modifiedAt)}</td>
          <td>${sourcePill(model)}</td>
          <td>
            <div class="row-actions">
              <button class="icon-btn" data-details="${escapeHtml(model.id)}" title="Detalles"><i class="fa-solid fa-circle-info"></i></button>
              <button class="icon-btn" data-export="${escapeHtml(model.id)}" title="Exportar"><i class="fa-solid fa-box-open"></i></button>
              <button class="icon-btn" data-delete="${escapeHtml(model.id)}" title="Eliminar"><i class="fa-solid fa-trash-can"></i></button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    const allVisible = list.every((model) => state.selection.has(model.id));
    $('#select-all').checked = allVisible && list.length > 0;
    $('#select-all').indeterminate = !allVisible && list.some((model) => state.selection.has(model.id));
    updateBulkBar();
  }

  function updateBulkBar() {
    const state = getState();
    const count = state.selection.size;
    const bar = $('#bulk-bar');
    bar.classList.toggle('hidden', count === 0);
    $('#bulk-count').textContent = `${count} seleccionado(s)`;
    const total = state.models
      .filter((model) => state.selection.has(model.id))
      .reduce((sum, model) => sum + (model.sizeBytes || 0), 0);
    $('#bulk-count').title = `Tamaño estimado: ${fmtBytes(total)}`;
  }

  async function showDetails(id) {
    const model = getState().models.find((item) => item.id === id);
    if (!model) return;
    let remote = null;
    try {
      const result = await call(bridge.models.details, id);
      remote = result && result.remote ? result.remote : null;
    } catch (error) { /* offline */ }

    const rows = [
      ['ID', id],
      ['Familia', model.family || '—'],
      ['Parámetros', model.parameterSize || '—'],
      ['Quantización', model.quantization || '—'],
      ['Formato', model.format || '—'],
      ['Tamaño', fmtBytes(model.sizeBytes)],
      ['Blobs', String(model.blobCount || 0)],
      ['Blobs faltantes', String(model.missingBlobs || 0)],
      ['Modificado', fmtDate(model.modifiedAt)],
      ['Origen', model.source || '—'],
      ['Digest', model.digest || '—'],
      ['Manifiesto', model.manifestPath || '—']
    ];

    const detailsHtml = rows.map(([label, value]) => `
      <div class="detail-item ${label === 'Manifiesto' || label === 'Digest' ? 'full' : ''}">
        <span>${escapeHtml(label)}</span>
        <strong class="mono">${escapeHtml(value)}</strong>
      </div>
    `).join('');

    const remoteHtml = remote ? `
      <h3 style="margin:16px 0 8px"><i class="fa-solid fa-cloud" style="color:var(--accent);margin-right:6px"></i> Información de Ollama</h3>
      <pre class="log-view" style="height:190px">${escapeHtml(JSON.stringify(remote, null, 2).slice(0, 6000))}</pre>
    ` : `<div class="alert" style="margin-top:14px"><i class="fa-solid fa-plug-circle-xmark"></i> Ollama no está disponible; se muestra solo la información del manifiesto local.</div>`;

    openModal({
      title: escapeHtml(id),
      icon: 'fa-circle-info',
      wide: true,
      body: `<div class="detail-grid">${detailsHtml}</div>${remoteHtml}`,
      footer: `<button class="btn btn-ghost" data-close-modal>Volver</button>`
    });
    const modal = document.querySelector('.modal-backdrop:last-child');
    if (modal) {
      modal.querySelector('[data-close-modal]')?.addEventListener('click', () => modal.remove());
    }
  }

  async function deleteModel(id) {
    const ok = await confirm({
      title: 'Eliminar modelo',
      html: `Se eliminará <strong>${escapeHtml(id)}</strong> y sus blobs no compartidos.<br><br>Esta acción no se puede deshacer.`,
      confirmText: 'Eliminar',
      icon: 'warning',
      danger: true
    });
    if (!ok) return;
    try {
      const result = await call(bridge.models.delete, id);
      toast.success('Modelo eliminado', `${id} · ${fmtBytes(result.freedBytes || 0)} liberados`);
      setSelected(id, false);
      await Promise.all([refreshModels(), refreshStatus(), refreshAchievements()]);
      window.dispatchEvent(new CustomEvent('neitor:refresh-data'));
    } catch (error) {
      await errorDialog('No se pudo eliminar el modelo', error);
    }
  }

  async function runPull() {
    if (pulling) return;
    const input = $('#pull-input');
    const name = input.value.trim();
    if (!name) {
      input.focus();
      return;
    }
    pulling = name;
    $('#pull-btn').disabled = true;
    $('#pull-cancel').classList.remove('hidden');
    $('#pull-status').textContent = `Iniciando descarga de ${name}…`;
    try {
      await call(bridge.ollama.pull, name);
      if (disposed) return;
      toast.success('Modelo descargado', name);
      input.value = '';
      await Promise.all([refreshModels(), refreshStatus()]);
      window.dispatchEvent(new CustomEvent('neitor:refresh-data'));
    } catch (error) {
      if (!disposed) toast.error('No se pudo descargar el modelo', error.message);
    } finally {
      pulling = null;
      if (!disposed) {
        $('#pull-btn').disabled = false;
        $('#pull-cancel').classList.add('hidden');
        $('#pull-status').textContent = '';
      }
    }
  }

  /* ---------------- Eventos ---------------- */

  const onSearch = debounce(() => {
    query = $('#models-search').value;
    renderRows();
  }, 80);
  $('#models-search').addEventListener('input', onSearch);
  $('#models-family').addEventListener('change', () => {
    family = $('#models-family').value;
    renderRows();
  });
  $('#models-sort').addEventListener('change', () => {
    sort = $('#models-sort').value;
    renderRows();
  });

  $('#select-all').addEventListener('change', (event) => {
    const list = visibleModels();
    selectMany(list.map((model) => model.id), event.target.checked);
    renderRows();
  });

  $('#models-body').addEventListener('change', (event) => {
    const checkbox = event.target.closest('[data-select]');
    if (!checkbox) return;
    setSelected(checkbox.dataset.select, checkbox.checked);
    renderRows();
  });

  $('#models-body').addEventListener('click', (event) => {
    const details = event.target.closest('[data-details]');
    if (details) { showDetails(details.dataset.details); return; }
    const del = event.target.closest('[data-delete]');
    if (del) { deleteModel(del.dataset.delete); return; }
    const exp = event.target.closest('[data-export]');
    if (exp) {
      setSelected(exp.dataset.export, true);
      window.location.hash = '#/export';
    }
  });

  $('#bulk-clear').addEventListener('click', () => {
    clearSelection();
    renderRows();
  });
  $('#bulk-export').addEventListener('click', () => { window.location.hash = '#/export'; });
  $('#models-export').addEventListener('click', () => {
    if (!selectedModels().length) {
      toast.warning('Sin selección', 'Marca al menos un modelo para exportar.');
      return;
    }
    window.location.hash = '#/export';
  });

  $('#models-refresh').addEventListener('click', async () => {
    const button = $('#models-refresh');
    button.disabled = true;
    try {
      await Promise.all([refreshModels(), refreshStatus(), refreshAchievements()]);
      familyOptions();
      renderRows();
      toast.info('Inventario actualizado');
    } catch (error) {
      toast.error('No se pudo refrescar', error.message);
    } finally {
      button.disabled = false;
    }
  });

  $('#pull-btn').addEventListener('click', runPull);
  $('#pull-input').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') runPull();
  });
  $('#pull-cancel').addEventListener('click', async () => {
    try { await call(bridge.ollama.cancelPull); } catch { /* ignore */ }
  });

  const offPull = bridge ? bridge.ollama.onPullProgress((event) => {
    if (disposed) return;
    if (pulling && event.model && event.model !== pulling) return;
    const total = Number(event.total) || 0;
    const completed = Number(event.completed) || 0;
    const percent = total ? Math.round((completed / total) * 100) : null;
    const status = event.status || 'descargando';
    $('#pull-status').textContent = percent !== null ? `${status} · ${percent}%` : `${status}…`;
    if (event.error) $('#pull-status').textContent = event.error;
  }) : () => {};

  const unsubscribe = subscribe(() => {
    if (disposed) return;
    const state = getState();
    if (state.models !== lastModels) {
      lastModels = state.models;
      familyOptions();
      renderRows();
    } else {
      updateBulkBar();
    }
  });

  familyOptions();
  renderRows();
  lastModels = getState().models;

  return () => {
    disposed = true;
    unsubscribe();
    offPull();
  };
}
