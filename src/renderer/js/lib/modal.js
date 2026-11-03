/** Modal glass reutilizable. */

export function openModal({ title, body = '', footer = '', wide = false, onClose = null, icon = '' } = {}) {
  const root = document.getElementById('modal-root');
  if (!root) return { close: () => {} };

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal glass-panel ${wide ? 'modal-wide' : ''}" role="dialog" aria-modal="true">
      <div class="modal-head">
        <h2>${icon ? `<i class="fa-solid ${icon}" style="color:var(--accent);margin-right:8px"></i>` : ''}${title}</h2>
        <button class="icon-btn" data-close aria-label="Cerrar"><i class="fa-solid fa-xmark"></i></button>
      </div>
      <div class="modal-body"></div>
      ${footer ? `<div class="modal-foot">${footer}</div>` : ''}
    </div>
  `;

  const bodyNode = backdrop.querySelector('.modal-body');
  if (typeof body === 'string') bodyNode.innerHTML = body;
  else if (body instanceof Node) bodyNode.appendChild(body);

  root.appendChild(backdrop);

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    backdrop.style.opacity = '0';
    backdrop.style.transition = 'opacity 140ms ease';
    setTimeout(() => {
      backdrop.remove();
      if (typeof onClose === 'function') onClose();
    }, 140);
    document.removeEventListener('keydown', onKey);
  };

  const onKey = (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
    }
  };
  document.addEventListener('keydown', onKey);
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) close();
  });
  backdrop.querySelector('[data-close]').addEventListener('click', close);

  const focusable = backdrop.querySelector('input, select, textarea, button:not([data-close])');
  if (focusable) setTimeout(() => focusable.focus(), 30);

  return { close, element: backdrop, body: bodyNode };
}
