/** Diálogos SweetAlert2 adaptados al tema actual. */

function swal() {
  if (!window.Swal) throw new Error('SweetAlert2 no está disponible');
  return window.Swal;
}

function base(extra = {}) {
  return {
    background: 'transparent',
    backdrop: true,
    heightAuto: false,
    buttonsStyling: true,
    reverseButtons: true,
    ...extra
  };
}

export async function confirm({
  title,
  text = '',
  html = '',
  confirmText = 'Continuar',
  cancelText = 'Cancelar',
  icon = 'question',
  danger = false
} = {}) {
  const result = await swal().fire(base({
    title,
    text: html ? undefined : text,
    html: html || undefined,
    icon,
    showCancelButton: true,
    confirmButtonText: confirmText,
    cancelButtonText: cancelText,
    confirmButtonColor: danger ? undefined : undefined,
    customClass: { confirmButton: danger ? 'swal2-deny' : 'swal2-confirm' },
    focusCancel: danger
  }));
  return Boolean(result.isConfirmed);
}

export async function alert({ title, text = '', html = '', icon = 'info', confirmText = 'Entendido' } = {}) {
  await swal().fire(base({
    title,
    text: html ? undefined : text,
    html: html || undefined,
    icon,
    confirmButtonText: confirmText
  }));
}

export async function prompt({
  title,
  input = 'text',
  inputValue = '',
  placeholder = '',
  confirmText = 'Aceptar',
  cancelText = 'Cancelar',
  validator
} = {}) {
  const result = await swal().fire(base({
    title,
    input,
    inputValue,
    inputPlaceholder: placeholder,
    showCancelButton: true,
    confirmButtonText: confirmText,
    cancelButtonText: cancelText,
    inputValidator: validator
  }));
  return result.isConfirmed ? result.value : null;
}

export async function errorDialog(title, error) {
  const message = error && error.message ? error.message : String(error);
  const code = error && error.code ? error.code : '';
  const details = error && error.details ? JSON.stringify(error.details, null, 2) : '';
  await alert({
    title,
    icon: 'error',
    html: `
      <div style="text-align:left">
        <p>${escapeHtml(message)}</p>
        ${code ? `<p style="margin-top:8px;opacity:.7;font-size:11px">Código: ${escapeHtml(code)}</p>` : ''}
        ${details ? `<pre style="margin-top:10px;max-height:180px;overflow:auto;text-align:left;font-size:10px;padding:8px;border-radius:8px;background:rgba(0,0,0,.25)">${escapeHtml(details)}</pre>` : ''}
      </div>
    `
  });
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
