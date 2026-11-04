# Seguridad

OllamaNeitor es una aplicación local. No envía telemetría ni contenido a Internet.

## Modelo de amenaza

- Paquetes `.tar` de origen desconocido.
- Manifiestos o nombres de modelo maliciosos.
- Rutas con `..`, unidades, UNC, NUL, symlinks o hardlinks.
- Suplantación de la carpeta de datos o del destino de exportación.

## Medidas

- `contextIsolation`, `sandbox` y `nodeIntegration: false`.
- CSP estricta y protocolo `app://neitor`.
- Validación de rutas con `tar-safety` y `assertInside`.
- Rechazo de tipos de entrada distintos de archivo regular y directorio.
- Verificación SHA-256 de blobs.
- Escritura atómica `.part` + renombrado.
- Backups de manifiestos en sobrescritura y rollback por modelo.
- Diálogos nativos para elegir rutas.
- Los errores no exponen stack al renderer.

## Reportar una vulnerabilidad

Abre un issue privado en el repositorio o contacta con el mantenedor
(`genioloko19`). Incluye:

- versión,
- sistema operativo,
- pasos de reproducción,
- impacto,
- evidencia (sin datos personales).

No publiques exploits antes de que exista una corrección.
