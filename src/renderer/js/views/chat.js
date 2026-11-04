/** Vista Chat: streaming con Ollama, historial persistente y Markdown saneado. */

import { getState } from '../store.js';
import { bridge, call } from '../ipc.js';
import { refreshAchievements } from '../services.js';
import { escapeHtml, fmtTime } from '../lib/format.js';
import { renderMarkdown } from '../lib/markdown.js';
import { toast } from '../lib/toast.js';
import { confirm, errorDialog, prompt as promptDialog } from '../lib/swal.js';

const MODEL_KEY = 'neitor.chat.model';

export function mount(container) {
  let disposed = false;
  let conversations = [];
  let currentId = null;
  let messages = [];
  let streaming = false;
  let streamId = null;
  let assistantBuffer = '';
  let assistantNode = null;
  let assistantBody = null;
  let pendingFrame = null;
  let pendingImages = [];
  let modelVision = false;
  let capabilitySeq = 0;

  const state = getState();
  const installed = state.models;

  container.innerHTML = `
    <div class="view-inner">
      <header class="page-head">
        <div>
          <h1><i class="fa-solid fa-comments"></i> Chat</h1>
          <p class="page-sub">Conversaciones locales con el modelo que elijas. Nada sale de tu equipo.</p>
        </div>
        <div class="page-actions">
          <button class="btn btn-primary btn-sm" id="chat-new"><i class="fa-solid fa-plus"></i> Nueva conversación</button>
        </div>
      </header>

      <div class="chat-layout">
        <aside class="glass-panel chat-sidebar">
          <div class="field">
            <label>Historial</label>
            <div class="search">
              <i class="fa-solid fa-magnifying-glass"></i>
              <input id="conv-search" class="input" placeholder="Filtrar conversaciones…" />
            </div>
          </div>
          <div id="conv-list" class="chat-conversations"></div>
          <div class="tiny soft" id="conv-count"></div>
        </aside>

        <section class="glass-panel chat-main">
          <div class="chat-head">
            <i class="fa-solid fa-robot" style="color:var(--accent)"></i>
            <select id="chat-model" class="select" style="max-width:290px" aria-label="Modelo">
              ${installed.length
                ? installed.map((model) => `<option value="${escapeHtml(model.id)}">${escapeHtml(model.id)}</option>`).join('')
                : '<option value="">Sin modelos instalados</option>'}
            </select>
            <span class="grow"></span>
            <span class="pill" id="chat-vision" title="Capacidad del modelo">comprobando…</span>
            <span class="pill" id="chat-state">listo</span>
            <button class="btn btn-sm btn-ghost hidden" id="chat-rename"><i class="fa-solid fa-pen"></i> Renombrar</button>
            <button class="btn btn-sm btn-danger hidden" id="chat-stop"><i class="fa-solid fa-stop"></i> Detener</button>
          </div>

          <div id="chat-messages" class="chat-messages"></div>

          <div id="chat-attachments" class="chat-attachments hidden"></div>
          <div class="chat-composer">
            <button id="chat-attach" class="icon-btn" title="Adjuntar imagen" aria-label="Adjuntar imagen" disabled>
              <i class="fa-solid fa-image"></i>
            </button>
            <textarea id="chat-input" class="textarea" rows="1" placeholder="Escribe tu mensaje… (Enter envía, Shift+Enter salto de línea)" ${installed.length ? '' : 'disabled'}></textarea>
            <button id="chat-send" class="btn btn-primary" ${installed.length ? '' : 'disabled'}>
              <i class="fa-solid fa-paper-plane"></i> Enviar
            </button>
          </div>
        </section>
      </div>
    </div>
  `;

  const $ = (selector) => container.querySelector(selector);
  const modelSelect = $('#chat-model');
  const savedModel = window.localStorage.getItem(MODEL_KEY);
  if (savedModel && installed.some((model) => model.id === savedModel)) modelSelect.value = savedModel;

  function renderConversations() {
    const list = $('#conv-list');
    const filter = $('#conv-search').value.toLowerCase();
    const visible = conversations.filter((conv) => !filter || conv.title.toLowerCase().includes(filter) || conv.model.toLowerCase().includes(filter));
    $('#conv-count').textContent = `${visible.length} de ${conversations.length}`;
    if (!visible.length) {
      list.innerHTML = `<div class="empty" style="padding:22px 6px"><i class="fa-solid fa-comment-slash"></i><strong>Sin conversaciones</strong><p>Empieza una nueva para verla aquí.</p></div>`;
      return;
    }
    list.innerHTML = visible.map((conv) => `
      <div class="row" style="gap:4px">
        <button class="conv-item ${conv.id === currentId ? 'active' : ''}" data-conv="${escapeHtml(conv.id)}">
          <i class="fa-solid fa-message"></i>
          <span title="${escapeHtml(conv.title)}">${escapeHtml(conv.title)}</span>
        </button>
        <button class="icon-btn" data-del-conv="${escapeHtml(conv.id)}" title="Eliminar" style="width:26px;height:26px"><i class="fa-solid fa-xmark"></i></button>
      </div>
    `).join('');
  }

  function scrollBottom(force = false) {
    const box = $('#chat-messages');
    if (!box) return;
    const near = box.scrollHeight - box.scrollTop - box.clientHeight < 140;
    if (force || near) box.scrollTop = box.scrollHeight;
  }

  function messageNode(message) {
    const node = document.createElement('div');
    node.className = `msg ${message.role === 'user' ? 'user' : 'assistant'}`;
    node.innerHTML = `
      <span class="msg-role">${message.role === 'user' ? 'Tú' : 'Modelo'}</span>
      <div class="msg-body"></div>
    `;
    const body = node.querySelector('.msg-body');
    if (message.role === 'user') {
      if (Array.isArray(message.images) && message.images.length) {
        const gallery = document.createElement('div');
        gallery.className = 'msg-images';
        for (const image of message.images.slice(0, 4)) {
          const img = document.createElement('img');
          img.src = image.startsWith('data:') ? image : `data:image/png;base64,${image}`;
          img.alt = 'Imagen adjunta';
          img.loading = 'lazy';
          gallery.appendChild(img);
        }
        body.appendChild(gallery);
      }
      const text = document.createElement('div');
      text.innerHTML = escapeHtml(message.content).replace(/\n/g, '<br>');
      body.appendChild(text);
    } else {
      body.innerHTML = message.content ? renderMarkdown(message.content) : '<span class="msg-typing"><span></span><span></span><span></span></span>';
      enhanceCodeBlocks(body);
    }
    return node;
  }

  function enhanceCodeBlocks(root) {
    root.querySelectorAll('pre').forEach((pre) => {
      if (pre.querySelector('.code-copy')) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'code-copy';
      button.innerHTML = '<i class="fa-solid fa-copy"></i>';
      button.title = 'Copiar código';
      button.addEventListener('click', async () => {
        const text = pre.querySelector('code')?.innerText || pre.innerText;
        try {
          await navigator.clipboard.writeText(text);
          toast.success('Código copiado');
        } catch {
          toast.error('No se pudo copiar');
        }
      });
      pre.appendChild(button);
    });
  }

  function renderAttachments() {
    const box = $('#chat-attachments');
    if (!box) return;
    box.classList.toggle('hidden', pendingImages.length === 0);
    box.innerHTML = '';
    pendingImages.forEach((image, index) => {
      const item = document.createElement('div');
      item.className = 'chat-attachment';
      const img = document.createElement('img');
      img.src = `data:${image.mime};base64,${image.data}`;
      img.alt = image.name;
      const remove = document.createElement('button');
      remove.className = 'icon-btn';
      remove.title = 'Quitar imagen';
      remove.innerHTML = '<i class="fa-solid fa-xmark"></i>';
      remove.addEventListener('click', () => {
        pendingImages.splice(index, 1);
        renderAttachments();
      });
      item.appendChild(img);
      item.appendChild(remove);
      box.appendChild(item);
    });
  }

  async function refreshCapabilities() {
    const model = modelSelect.value;
    const seq = ++capabilitySeq;
    const pill = $('#chat-vision');
    const attach = $('#chat-attach');
    if (pill) {
      pill.textContent = 'comprobando…';
      pill.className = 'pill';
    }
    if (!model) {
      modelVision = false;
      if (attach) attach.disabled = true;
      if (pill) pill.textContent = 'sin modelo';
      return;
    }
    try {
      const result = await call(bridge.chat.capabilities, model);
      if (seq !== capabilitySeq) return;
      modelVision = Boolean(result && result.vision);
      if (pill) {
        pill.textContent = modelVision ? 'visión' : 'solo texto';
        pill.className = `pill ${modelVision ? 'pill-success' : ''}`;
        pill.title = modelVision
          ? 'El modelo acepta imágenes'
          : 'El modelo no acepta imágenes; se omitirán del historial al enviar';
      }
      if (attach) {
        attach.disabled = !modelVision;
        attach.title = modelVision ? 'Adjuntar imagen' : 'Este modelo no admite imágenes';
      }
      if (!modelVision && pendingImages.length) {
        pendingImages = [];
        renderAttachments();
        toast.warning('Modelo sin visión', 'Se han quitado las imágenes adjuntas.');
      }
    } catch {
      if (seq !== capabilitySeq) return;
      modelVision = false;
      if (pill) { pill.textContent = 'sin datos'; pill.className = 'pill'; }
      if (attach) attach.disabled = true;
    }
  }

  function renderMessages() {
    const box = $('#chat-messages');
    box.innerHTML = '';
    if (!messages.length) {
      box.innerHTML = `
        <div class="empty" style="margin:auto">
          <i class="fa-solid fa-wand-magic-sparkles"></i>
          <strong>¿Sobre qué hablamos?</strong>
          <p>El modelo se ejecuta en tu Ollama local. Prueba una de estas ideas:</p>
          <div class="row-wrap" style="justify-content:center;margin-top:6px">
            <button class="pill" data-suggestion="Resume las diferencias entre estos modelos y para qué sirve cada uno.">Comparar modelos</button>
            <button class="pill" data-suggestion="Escribe un script en Python para listar archivos grandes de una carpeta.">Ayuda con código</button>
            <button class="pill" data-suggestion="Explícame en 5 puntos cómo funciona un cuantizado Q4_K_M.">Explicar quantización</button>
          </div>
        </div>
      `;
      return;
    }
    for (const message of messages) box.appendChild(messageNode(message));
    scrollBottom(true);
  }

  function scheduleAssistantRender() {
    if (pendingFrame) return;
    pendingFrame = requestAnimationFrame(() => {
      pendingFrame = null;
      if (!assistantBody) return;
      assistantBody.innerHTML = renderMarkdown(assistantBuffer);
      enhanceCodeBlocks(assistantBody);
      scrollBottom();
    });
  }

  async function loadConversations() {
    try {
      conversations = await call(bridge.chat.list);
      renderConversations();
    } catch (error) {
      conversations = [];
      renderConversations();
    }
  }

  async function openConversation(id) {
    if (streaming) {
      toast.warning('Respuesta en curso', 'Detén la respuesta antes de cambiar de conversación.');
      return;
    }
    try {
      const data = await call(bridge.chat.get, id);
      if (!data) return;
      currentId = data.id;
      messages = Array.isArray(data.messages) ? data.messages : [];
      if (data.model && installed.some((model) => model.id === data.model)) {
        modelSelect.value = data.model;
      }
      renderMessages();
      renderConversations();
      $('#chat-state').textContent = `${messages.length} mensajes`;
      $('#chat-rename').classList.remove('hidden');
      $('#chat-input').focus();
    } catch (error) {
      toast.error('No se pudo abrir la conversación', error.message);
    }
  }

  function newConversation() {
    if (streaming) {
      toast.warning('Respuesta en curso', 'Detén la respuesta antes de crear otra conversación.');
      return;
    }
    currentId = null;
    messages = [];
    assistantBuffer = '';
    assistantNode = null;
    assistantBody = null;
    pendingImages = [];
    renderAttachments();
    $('#chat-state').textContent = 'listo';
    $('#chat-rename').classList.add('hidden');
    renderMessages();
    renderConversations();
    $('#chat-input').focus();
  }

  async function persistConversation() {
    if (!messages.length) return;
    try {
      const saved = await call(bridge.chat.save, {
        id: currentId || undefined,
        model: modelSelect.value,
        messages
      });
      currentId = saved.id;
      await loadConversations();
      renderConversations();
    } catch (error) {
      console.warn('No se pudo guardar la conversación', error);
    }
  }

  async function send() {
    if (streaming || disposed) return;
    const input = $('#chat-input');
    const text = input.value.trim();
    const model = modelSelect.value;
    if (!text && !pendingImages.length) return;
    if (!model) {
      toast.warning('Sin modelo', 'Descarga o selecciona un modelo para chatear.');
      return;
    }
    if (pendingImages.length && !modelVision) {
      toast.warning('Modelo sin visión', 'Este modelo no acepta imágenes. Quita los adjuntos o elige un modelo multimodal.');
      return;
    }

    const outgoingImages = pendingImages.map((image) => image.data);
    messages.push({
      role: 'user',
      content: text,
      ...(outgoingImages.length ? { images: outgoingImages } : {})
    });
    pendingImages = [];
    renderAttachments();
    input.value = '';
    input.style.height = 'auto';
    renderMessages();

    assistantBuffer = '';
    messages.push({ role: 'assistant', content: '' });
    const box = $('#chat-messages');
    assistantNode = messageNode(messages[messages.length - 1]);
    box.appendChild(assistantNode);
    assistantBody = assistantNode.querySelector('.msg-body');
    assistantBody.innerHTML = '<span class="msg-typing"><span></span><span></span><span></span></span>';
    scrollBottom(true);

    streaming = true;
    $('#chat-send').disabled = true;
    $('#chat-stop').classList.remove('hidden');
    $('#chat-state').textContent = 'generando…';

    try {
      const started = await call(bridge.chat.send, {
        model,
        messages: (() => {
          const chatConfig = getState().config?.chat || {};
          const maxHistory = Math.max(2, Number(chatConfig.maxHistory) || 40);
          const recent = messages
            .filter((message) => message.role === 'user' || message.content)
            .slice(-maxHistory)
            .map((message) => {
              const item = { role: message.role, content: message.content };
              if (modelVision && Array.isArray(message.images) && message.images.length) {
                item.images = message.images;
              }
              return item;
            });
          if (chatConfig.systemPrompt && chatConfig.systemPrompt.trim()) {
            return [{ role: 'system', content: chatConfig.systemPrompt.trim() }, ...recent];
          }
          return recent;
        })()
      });
      streamId = started.streamId;
    } catch (error) {
      streaming = false;
      $('#chat-send').disabled = false;
      $('#chat-stop').classList.add('hidden');
      $('#chat-state').textContent = 'error';
      messages.pop();
      if (assistantNode) assistantNode.remove();
      await errorDialog('No se pudo enviar el mensaje', error);
    }
  }

  function finalizeStream({ cancelled = false, stats = null } = {}) {
    if (!streaming) return;
    streaming = false;
    streamId = null;
    $('#chat-send').disabled = false;
    $('#chat-stop').classList.add('hidden');
    const last = messages[messages.length - 1];
    if (last && last.role === 'assistant') {
      last.content = assistantBuffer;
      if (!assistantBuffer) {
        last.content = cancelled ? '(cancelado)' : '(sin respuesta)';
        if (assistantBody) assistantBody.innerHTML = `<span class="soft">${escapeHtml(last.content)}</span>`;
      } else if (assistantBody) {
        assistantBody.innerHTML = renderMarkdown(assistantBuffer);
        enhanceCodeBlocks(assistantBody);
      }
    }
    const evalCount = stats && stats.eval_count ? ` · ${stats.eval_count} tokens` : '';
    $('#chat-state').textContent = cancelled ? 'detenido' : `completado${evalCount}`;
    persistConversation();
    refreshAchievements().catch(() => {});
    scrollBottom();
  }

  /* ---------------- Eventos IPC ---------------- */

  const offChunk = bridge ? bridge.chat.onChunk((event) => {
    if (disposed || !streaming) return;
    if (streamId && event.streamId && event.streamId !== streamId) return;
    assistantBuffer += event.delta || '';
    scheduleAssistantRender();
    scrollBottom();
  }) : () => {};

  const offDone = bridge ? bridge.chat.onDone((event) => {
    if (disposed || !streaming) return;
    if (streamId && event.streamId && event.streamId !== streamId) return;
    finalizeStream({ stats: event.stats });
  }) : () => {};

  const offError = bridge ? bridge.chat.onError((event) => {
    if (disposed || !streaming) return;
    if (streamId && event.streamId && event.streamId !== streamId) return;
    const message = event.error?.message || 'Error del modelo';
    const last = messages[messages.length - 1];
    if (last && last.role === 'assistant' && !last.content) messages.pop();
    if (assistantNode) assistantNode.remove();
    streaming = false;
    streamId = null;
    $('#chat-send').disabled = false;
    $('#chat-stop').classList.add('hidden');
    $('#chat-state').textContent = 'error';
    toast.error('El modelo no respondió', message);
  }) : () => {};

  /* ---------------- UI ---------------- */

  $('#chat-send').addEventListener('click', send);
  $('#chat-attach').addEventListener('click', async () => {
    try {
      const files = await call(bridge.dialogs.pickImages);
      if (!files || !files.length) return;
      if (pendingImages.length + files.length > 4) {
        toast.warning('Demasiadas imágenes', 'Puedes adjuntar hasta 4 imágenes por mensaje.');
        return;
      }
      const images = await call(bridge.files.readBase64, files);
      pendingImages.push(...images);
      renderAttachments();
    } catch (error) {
      toast.error('No se pudieron adjuntar las imágenes', error.message);
    }
  });
  $('#chat-stop').addEventListener('click', async () => {
    try { await call(bridge.chat.cancel); } catch { /* ignore */ }
    finalizeStream({ cancelled: true });
  });

  const input = $('#chat-input');
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  });
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = `${Math.min(160, input.scrollHeight)}px`;
  });

  modelSelect.addEventListener('change', () => {
    window.localStorage.setItem(MODEL_KEY, modelSelect.value);
    refreshCapabilities();
  });

  $('#chat-new').addEventListener('click', newConversation);
  $('#conv-search').addEventListener('input', renderConversations);

  $('#chat-rename').addEventListener('click', async () => {
    if (!currentId) return;
    const current = conversations.find((conv) => conv.id === currentId);
    const title = await promptDialog({
      title: 'Renombrar conversación',
      inputValue: current ? current.title : '',
      placeholder: 'Nuevo título',
      confirmText: 'Guardar',
      validator: (value) => (String(value || '').trim() ? undefined : 'El título no puede estar vacío')
    });
    if (title === null) return;
    try {
      const saved = await call(bridge.chat.save, {
        id: currentId,
        title: String(title).trim().slice(0, 80),
        model: modelSelect.value,
        messages
      });
      currentId = saved.id;
      await loadConversations();
      toast.success('Conversación renombrada');
    } catch (error) {
      toast.error('No se pudo renombrar', error.message);
    }
  });

  $('#conv-list').addEventListener('click', async (event) => {
    const del = event.target.closest('[data-del-conv]');
    if (del) {
      const id = del.dataset.delConv;
      const ok = await confirm({
        title: 'Eliminar conversación',
        text: 'Se borrará del disco. Esta acción no se puede deshacer.',
        confirmText: 'Eliminar',
        icon: 'warning',
        danger: true
      });
      if (!ok) return;
      try {
        await call(bridge.chat.remove, id);
        if (currentId === id) newConversation();
        await loadConversations();
        toast.success('Conversación eliminada');
      } catch (error) {
        toast.error('No se pudo eliminar', error.message);
      }
      return;
    }
    const button = event.target.closest('[data-conv]');
    if (button) openConversation(button.dataset.conv);
  });

  $('#chat-messages').addEventListener('click', (event) => {
    const suggestion = event.target.closest('[data-suggestion]');
    if (suggestion) {
      input.value = suggestion.dataset.suggestion;
      input.focus();
    }
  });

  if (savedModel) window.localStorage.setItem(MODEL_KEY, modelSelect.value);

  renderMessages();
  loadConversations();
  refreshCapabilities();
  input.focus();

  return () => {
    disposed = true;
    if (streaming) {
      try { bridge.chat.cancel(); } catch { /* ignore */ }
    }
    if (pendingFrame) cancelAnimationFrame(pendingFrame);
    offChunk();
    offDone();
    offError();
  };
}
