'use strict';

/** Taxonomía de errores de OllamaNeitor. */

const CODES = {
  E_UNKNOWN: 'Error inesperado',
  E_CONFIG: 'Error de configuración',
  E_PATH_INVALID: 'Ruta inválida',
  E_PATH_MISSING: 'La ruta no existe',
  E_NO_OLLAMA: 'Ollama no está disponible',
  E_NO_SPACE: 'Espacio insuficiente en disco',
  E_DIGEST_MISMATCH: 'La verificación de integridad ha fallado',
  E_TAR_UNSAFE: 'El archivo contiene rutas no permitidas',
  E_TAR_INVALID: 'El archivo no es un paquete válido de OllamaNeitor',
  E_CONFLICT: 'El modelo ya existe',
  E_CANCELLED: 'Operación cancelada',
  E_PERMISSION: 'Permiso denegado',
  E_NOT_FOUND: 'No se encontró el recurso',
  E_BUSY: 'Ya hay una operación en curso'
};

class NeitorError extends Error {
  constructor(code, message, details) {
    super(message || CODES[code] || CODES.E_UNKNOWN);
    this.name = 'NeitorError';
    this.code = CODES[code] ? code : 'E_UNKNOWN';
    this.details = details || null;
  }

  toJSON() {
    return { code: this.code, message: this.message, details: this.details };
  }
}

function fail(code, message, details) {
  throw new NeitorError(code, message, details);
}

function wrap(error) {
  if (error instanceof NeitorError) return error;
  const message = error && error.message ? error.message : String(error);
  return new NeitorError('E_UNKNOWN', message, { cause: error && error.code });
}

function serialize(error) {
  const wrapped = wrap(error);
  return wrapped.toJSON();
}

module.exports = { CODES, NeitorError, fail, wrap, serialize };
