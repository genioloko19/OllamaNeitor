# Canales IPC

El renderer nunca accede a Node directamente. `electron/preload.js` expone una API
congelada en `window.neitor` y todos los canales devuelven un sobre:

```json
{ "ok": true, "data": { } }
{ "ok": false, "error": { "code": "E_NO_SPACE", "message": "…", "details": {} } }
```

## App y configuración

| Canal | Entrada | Salida |
|---|---|---|
| `app:info` | — | nombre, versión, versiones de Electron/Chrome/Node, rutas, base, config |
| `config:get` | — | configuración saneada |
| `config:set` | parche parcial | configuración actualizada |
| `config:reset` | — | valores por defecto |
| `config:paths` | — | rutas de datos + inspección de la base |
| `appearance:persist` | `{theme, variant, glass, orbs}` | apariencia guardada |
| `system:theme` | — | `{dark}` |

## Modelos

| Canal | Entrada | Salida |
|---|---|---|
| `models:list` | — | modelos, `base`, `ollama`, `summary` con `exportableCount` |
| `models:details` | `id` | modelo local + `/api/show` |
| `models:show` | `id` | respuesta de Ollama |
| `models:delete` | `id` | archivos borrados y bytes liberados |
| `models:blobStats` | — | total, referenciados, faltantes, huérfanos y errores de manifiesto |
| `models:deleteOrphans` | `{names?, dryRun?}` | borrados y bytes liberados |
| `models:verify` | `id` | `{ok, checked, missing, corrupt, bytes}` |

## Transferencias

| Canal | Entrada | Salida |
|---|---|---|
| `export:start` | `{models, destDir, template, verify}` | `{jobId, totalBytes, taskCount, outputs, queued}` |
| `import:scanFolder` | `folder` | paquetes con modelos, conflictos y validez |
| `import:scanTar` | `file` | paquete escaneado |
| `import:start` | `{files, conflict, verify}` | `{jobId, taskCount, files, queued}` |

## Trabajos

| Canal | Entrada | Salida |
|---|---|---|
| `jobs:list` | `{limit?}` | activos + historial reciente |
| `jobs:get` | `id` | trabajo público |
| `jobs:cancel` | `id` | `{cancelled}` |
| `jobs:clearHistory` | — | historial limpiado |

Eventos:

- `jobs:progress` → `{jobId, type, phase, percent, taskIndex, taskCount, …}`
- `jobs:changed` → lista pública
- `jobs:finished` → trabajo con `status`, `result`, `error`
- `transfer:progress`, `transfer:result`, `transfer:error`, `transfer:cancelled` (compatibilidad)

## Ollama

| Canal | Entrada | Salida |
|---|---|---|
| `ollama:status` | `{host?, timeoutMs?}` | estado, versión, modelos, base |
| `ollama:ps` | — | modelos en memoria con RAM/VRAM |
| `ollama:unload` | `id` | bytes liberados + estado de logros |
| `ollama:pull` | `model` | `{jobId, model, queued}` |
| `ollama:cancelPull` | — | cancela descargas activas |

## Backup y actualizaciones

| Canal | Entrada | Salida |
|---|---|---|
| `backup:create` | `{file}` | archivo, tamaño, entradas y manifiesto |
| `backup:list` | — | backups automáticos en `backups/` |
| `backup:restore` | `{file}` | qué se restauró, backup previo y manifiesto |
| `backup:openFolder` | — | carpeta de backups |
| `updater:status` | — | estado, versión actual/disponible y porcentaje |
| `updater:check` | — | comprueba GitHub Releases |
| `updater:download` | — | descarga la actualización |
| `updater:install` | — | instala y reinicia |

Evento: `updater:status`.

## Chat

| Canal | Entrada | Salida |
|---|---|---|
| `chat:send` | `{model, messages}` | `{streamId}` (las imágenes van dentro de cada mensaje) |
| `chat:cancel` | — | `{cancelled}` |
| `chat:list` | — | conversaciones |
| `chat:get` | `id` | conversación completa |
| `chat:save` | `{id?, title?, model, messages}` | conversación guardada |
| `chat:remove` | `id` | `{removed}` |

Eventos: `chat:chunk`, `chat:done`, `chat:error`.

## Diálogos, shell y ventana

| Canal | Entrada |
|---|---|
| `dialog:pickFolder` | `{title?, defaultPath?}` |
| `dialog:pickTarFiles` | — |
| `shell:openPath` | ruta existente |
| `shell:showItem` | ruta existente |
| `shell:openExternal` | URL HTTPS |
| `log:list` / `log:openFolder` | — |
| `window:minimize` / `maximize` / `close` | — |
| `window:setBackground` | color `#rrggbb` |
| `window:setAcrylic` | booleano |

## Seguridad

- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`.
- Validación de payloads y allowlist de rutas.
- Los trabajos no exponen funciones internas (`start`, `cancel`, `worker`).
- Los errores se serializan con código y mensaje, sin stack al renderer.
