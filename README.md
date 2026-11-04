# OllamaNeitor

**Alfa v0** · Gestor de modelos de Ollama con interfaz glass, 12 temas y dashboard gamificado.

Aplicación de escritorio para Windows construida con **Electron**, sin bundler en el renderer y con todas las librerías empaquetadas para funcionar sin conexión.

## Descargar

La versión **0.1.0 Alpha** está disponible en [GitHub Releases](https://github.com/genioloko19/OllamaNeitor/releases):

- `OllamaNeitor-0.1.0-alpha.0-x64.exe` — instalador para Windows.
- `OllamaNeitor-0.1.0-alpha.0-portable.exe` — versión portable sin instalación.

> El ejecutable no está firmado: Windows puede mostrar un aviso de SmartScreen. Usa "Más información → Ejecutar de todos modos".

[📘 Manual de usuario completo](docs/MANUAL.md)

![Dashboard de OllamaNeitor](docs/images/dashboard-dark.png)

---

## Funcionalidad

- **Inventario híbrido**: manifiestos en disco + API de Ollama (`/api/tags`), con búsqueda instantánea por nombre, tag, familia, parámetros, quantización y digest.
- **Exportación segura**: staging, comprobación de espacio, copia con sha256 en una pasada, verificación, `.part` + renombrado atómico, cancelación y limpieza.
- **Importación segura**: lectura del índice del tar sin extraer, validación de rutas, verificación de digests, resolución de conflictos (sobrescribir / omitir / nuevo tag), commit atómico con rollback.
- **Dashboard real**: KPIs de nivel, modelos, RAM/VRAM liberada y trofeos; gráficas de familias y tamaños; widget de memoria con `GET /api/ps` y descarga de modelos con `keep_alive: 0`.
- **Chat**: streaming con `/api/chat`, historial persistente, Markdown saneado con DOMPurify, cancelación.
- **12 temas independientes** (paleta + geometría + patrón + orbes) y **3 variantes** (Claro, Oscuro, Alto contraste) + **Auto** según Windows.
- **Gamificación**: XP, niveles, 9 trofeos, confeti y acorde Web Audio de 4 notas.
- **Accesibilidad**: alto contraste real (sin blur ni orbes), foco visible, navegación por teclado, `prefers-reduced-motion` y modo rendimiento.

## Requisitos

- Windows 10/11 (probado en Windows 11).
- Node.js 20 o superior.
- Ollama instalado y en ejecución para las funciones de API (el inventario local funciona sin Ollama).

## Instalación y ejecución

```bash
npm install
npm run vendor:copy   # copia Font Awesome, Chart.js, SweetAlert2, etc.
npm start             # compila temas y abre la app
```

Modo desarrollo con DevTools:

```bash
npm run dev
```

## Pruebas

```bash
npm test              # Vitest: temas, contraste, manifiestos, búsqueda, logros, tar, export
npm run audit:contrast
```

## Compilación a Windows

```bash
npm run build:win     # instalador NSIS + portable en dist/
```

Sin firma de código, SmartScreen puede mostrar un aviso al ejecutar el `.exe`.

## Estructura

```
electron/            main, preload, IPC y workers de transferencia
src/core/            configuración, inventario, exportación, importación, API, logros
src/renderer/
  css/               tokens, glass, layout, componentes y temas generados
  js/                motor de temas, vistas, librerías y utilidades
  themes/            registry.js (fuente de verdad de los 12 temas)
  vendor/            librerías offline
tools/               generador de temas, auditoría de contraste, icono y vendor
tests/               pruebas unitarias
```

## Datos de la aplicación

Todo se guarda en `%APPDATA%\Neitor\OllamaNeitor`:

```
config.json          configuración (escritura atómica + backup)
config.json.bak      copia de seguridad
achievements.json    XP, trofeos y estadísticas
conversations/       historial del chat
logs/app.log         registro rotativo
temp/                staging de importación
```

La apariencia se guarda en `localStorage` (lectura síncrona antes del primer pintado) y se replica en `config.json`.

## Temas

`src/renderer/themes/registry.js` es la única fuente de verdad. Cada tema define:

- paleta de 4 semillas,
- geometría propia (radios, densidad, padding, blur, sombra),
- patrón de fondo y disposición de orbes,
- colores de fondo para variante clara y oscura.

El script `npm run themes:build` genera `css/themes.generated.css` (36 bloques) y `themes/themes.boot.js`, y **falla** si alguna combinación no cumple contraste (4.5:1 texto, 3:1 UI, 7:1 en alto contraste).

## Seguridad

- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`.
- Protocolo propio `app://neitor` (origen estable para localStorage).
- CSP estricta y sin contenido remoto.
- Validación de entradas de tar (sin rutas absolutas, `..` ni entradas ajenas).
- IPC con validación de payloads y respuestas `{ ok, data | error }`.

## Limitaciones conocidas de la alfa v0

- Sin firma de código ni actualizador automático.
- La limpieza de blobs huérfanos es solo informativa (no destructiva).
- El acrílico nativo depende de Windows 11 y del driver; si falla, se usa el glass CSS.
- Los paquetes `.tar` son el formato propio de OllamaNeitor (manifiestos + blobs).
