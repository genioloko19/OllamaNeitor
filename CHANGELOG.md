# Changelog

## 1.0.0

Versión estable centrada en integridad de datos, trabajos reenganchables y entrega.

### Corregido

- Importación atómica por modelo con `.part` + renombrado, backup en overwrite y rollback aislado.
- Validación compartida de tar: symlinks, hardlinks, dispositivos, rutas absolutas, `..`, NUL y unidades.
- Contención de rutas en exportación e importación con `assertInside` y validación de digests.
- `blobStats` ahora distingue blobs existentes, faltantes y huérfanos; `orphanCount` nunca es negativo.
- La ruta base se refresca al guardar y `valid` refleja la estructura real.
- Exportación bloquea modelos solo API o con blobs faltantes y reserva nombres para evitar colisiones.
- Previsualización de `{fecha}` coincide con el nombre final.
- Registro central de trabajos con cola, concurrencia, historial, cancelación, poda y reenganche.
- Aviso al cerrar con transferencias activas y limpieza de staging/.part al arrancar.
- Modo portable real: `OllamaNeitorData` junto al `.exe` con fallback a AppData.
- `corruptions` se incrementa con fallos de digest/conflicto y el trofeo asociado deja de desbloquearse indebidamente.
- El nivel inicial ya no dispara sonido/confeti al arrancar.
- `transfer.maxGb`, `transfer.concurrency`, `chat.maxHistory` y `ui.logLevel` se aplican de verdad.
- Nueva pestaña de Chat con system prompt, temperatura, top_p, num_ctx, num_predict, keep_alive e historial.
- Probar conexión usa el host y timeout escritos, no los guardados.
- Eliminado el doble "seleccionar todo" de importación.
- Markdown fail-closed si DOMPurify no está disponible.
- Nuevas acciones: verificar integridad de un modelo, borrar blobs huérfanos, renombrar conversaciones.
- UI de cola e historial de trabajos en Transferencias.

### Añadido

- Pruebas de tar-safety, jobs, inventario, portable y transacciones de importación.
- `npm run verify`, CI de GitHub Actions y release automatizado.
- LICENSE, THIRD_PARTY_NOTICES, .editorconfig y .gitattributes.
- Manual de usuario con capturas.

### Pendiente para 1.1

- Backup/restore integrado, i18n, bandeja del sistema, firma, autoactualización.
- Operaciones avanzadas de modelo, compresión `.tar.gz`/`.zst`, reanudación y adjuntos multimodales.

## 0.1.0-alpha.0

Primera alfa funcional de OllamaNeitor.

### Añadido

- Shell Electron frameless con protocolo `app://neitor`, CSP y sandbox.
- Motor de temas con 12 temas autocontenidos × 3 variantes + Auto.
- Header con nivel/XP, RAM liberada, sala de trofeos y selector de modo.
- Panel de control con Apariencia, Transferencias, Ollama, Base de datos y Avanzado.
- Inventario híbrido (manifiestos + API) con búsqueda instantánea.
- Exportación con worker, sha256, espacio libre, `.part` y cancelación.
- Importación con escaneo de índice, validación de rutas, conflictos y rollback.
- Dashboard con KPIs, gráficas Chart.js y widget real de RAM/VRAM (`/api/ps`).
- Chat con streaming, historial y Markdown saneado.
- Logros, trofeos, confeti y sintetizador Web Audio.
- Empaquetado con electron-builder (NSIS + portable).
- Auditoría automática de contraste y pruebas Vitest.
