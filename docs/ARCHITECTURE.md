# Arquitectura

OllamaNeitor separa el proceso principal (Node/Electron), el puente seguro y el
renderer (Chromium sin Node).

```
electron/
├─ main.js              ventana, protocolo app://, ciclo de vida, cierre seguro
├─ preload.js           contextBridge → window.neitor
├─ ipc/index.js         canales validados y eventos
└─ workers/             transfer.worker.js e import.worker.js (worker_threads)

src/core/
├─ config.js            esquema, saneado, escritura atómica y backup
├─ paths.js             rutas, contención, validación de nombres y portable
├─ manifest.js          manifiestos, digests, metadatos y formato
├─ inventory.js         escaneo local, merge API, estadísticas, verificación
├─ exporter.js          plan de exportación, nombres y worker
├─ importer.js          escaneo de tar, conflictos y worker
├─ tar-safety.js        validación compartida de rutas y tipos de entrada
├─ jobs.js              cola, concurrencia, progreso, historial y poda
├─ ollama-api.js        tags, ps, show, pull, chat, unload, delete
├─ achievements.js      XP, niveles, trofeos y estadísticas
├─ conversations.js     historial del chat
├─ logger.js            log rotativo y niveles
└─ errors.js            taxonomía de errores

src/renderer/
├─ index.html           CSP y orden de carga
├─ css/                 tokens, temas generados, glass, layout y componentes
├─ themes/registry.js   12 temas autocontenidos
└─ js/
   ├─ app.js            arranque, router, cabecera y eventos globales
   ├─ theme-engine.js   aplicar/persistir tema/variante
   ├─ services.js       acceso a datos y estado compartido
   ├─ store.js          estado + suscripciones
   └─ views/            dashboard, modelos, exportar, importar, chat, ajustes
```

## Flujo de una transferencia

1. El renderer llama `export:start` o `import:start`.
2. El core valida rutas, modelos y espacio, y encola un trabajo.
3. `jobs` arranca el worker cuando hay hueco (concurrencia configurable).
4. El worker emite progreso y resultados; `jobs` los guarda y los retransmite.
5. El renderer se suscribe a `jobs:*`; si se navega o recarga, `jobs:list`
   permite reenganchar el progreso.
6. Al terminar, `jobs:finish` actualiza el historial y dispara logros.

## Atomicidad de importación

Cada manifiesto es una transacción:

1. Se verifican todos los blobs del modelo.
2. Si el destino existe y la política es `skip`, no se toca nada.
3. Los blobs se copian a `.part-<uuid>`, se verifican y se renombran.
4. El manifiesto se copia a `.part-<uuid>`. En `overwrite`, el anterior se guarda
   como `.bak-<uuid>`.
5. Se renombra el manifiesto y se elimina el backup.
6. Si algo falla, se borran solo los archivos creados por ese modelo, se
   restauran sus backups y se limpian los temporales.

Los modelos ya confirmados no se tocan.

## Decisiones

- **Sin bundler en el renderer**: menos dependencias y arranque directo.
- **`app://neitor`**: origen estable para `localStorage` y CSP.
- **`asar: false`**: los workers requieren `tar` desde disco; se revisará en 1.1.
- **Datos**: `%APPDATA%\Neitor\OllamaNeitor` o `OllamaNeitorData` junto al portable.
- **Temas**: 12 registros autocontenidos → 36 bloques CSS generados y auditados.
