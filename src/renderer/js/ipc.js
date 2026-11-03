/** Puente seguro con el proceso principal. */

export const bridge = window.neitor || null;

export class IpcError extends Error {
  constructor(error) {
    super((error && error.message) || 'Error de comunicación con el proceso principal');
    this.name = 'IpcError';
    this.code = (error && error.code) || 'E_UNKNOWN';
    this.details = (error && error.details) || null;
  }
}

export async function call(fn, ...args) {
  if (!bridge) throw new IpcError({ code: 'E_PRELOAD', message: 'El puente de Electron no está disponible' });
  if (typeof fn !== 'function') throw new IpcError({ code: 'E_CHANNEL', message: 'Canal no disponible' });
  const response = await fn(...args);
  if (!response) throw new IpcError({ code: 'E_EMPTY', message: 'Respuesta vacía del proceso principal' });
  if (response.ok === false) throw new IpcError(response.error);
  return response.data;
}

export function isAvailable() {
  return Boolean(bridge);
}
