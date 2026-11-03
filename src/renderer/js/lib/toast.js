/** Toasts glass. */

const ICONS = {
  info: 'fa-circle-info',
  success: 'fa-circle-check',
  error: 'fa-circle-exclamation',
  warning: 'fa-triangle-exclamation'
};

function container() {
  return document.getElementById('toast-root');
}

export function toast({ type = 'info', title = '', message = '', timeout = 4600 } = {}) {
  const root = container();
  if (!root) return null;
  const node = document.createElement('div');
  node.className = `toast ${type}`;
  node.setAttribute('role', type === 'error' ? 'alert' : 'status');
  node.innerHTML = `
    <i class="fa-solid ${ICONS[type] || ICONS.info}"></i>
    <div class="toast-body">
      ${title ? `<strong>${escape(title)}</strong>` : ''}
      ${message ? `<span>${escape(message)}</span>` : ''}
    </div>
    <button class="icon-btn" style="width:24px;height:24px;font-size:10px" aria-label="Cerrar">
      <i class="fa-solid fa-xmark"></i>
    </button>
  `;
  const close = () => {
    if (!node.isConnected || node.classList.contains('out')) return;
    node.classList.add('out');
    setTimeout(() => node.remove(), 240);
  };
  node.querySelector('button').addEventListener('click', close);
  root.appendChild(node);
  if (timeout > 0) setTimeout(close, timeout);
  return node;
}

function escape(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

toast.success = (title, message, timeout) => toast({ type: 'success', title, message, timeout });
toast.error = (title, message, timeout) => toast({ type: 'error', title, message, timeout });
toast.warning = (title, message, timeout) => toast({ type: 'warning', title, message, timeout });
toast.info = (title, message, timeout) => toast({ type: 'info', title, message, timeout });
