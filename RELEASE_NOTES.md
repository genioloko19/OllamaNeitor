# OllamaNeitor 0.1.0 Alpha

Gestor de modelos de Ollama para Windows con interfaz glass, 12 temas independientes y dashboard gamificado.

## Incluye

- Inventario híbrido: manifiestos en disco + API de Ollama.
- Exportación e importación de paquetes `.tar` con verificación sha256, staging, cancelación y rollback.
- Dashboard con KPIs reales, RAM/VRAM liberada (`/api/ps`) y gráficas Chart.js.
- 12 temas × 3 variantes (Claro, Oscuro, Alto contraste) + modo Auto según Windows.
- Chat con streaming, historial local y Markdown saneado.
- Logros, trofeos, confeti y acorde Web Audio.
- Datos en `%APPDATA%\Neitor\OllamaNeitor`.

## Descargas

- `OllamaNeitor-0.1.0-alpha.0-x64.exe` — instalador para Windows.
- `OllamaNeitor-0.1.0-alpha.0-portable.exe` — versión portable sin instalación.
- `SHA256SUMS.txt` — hashes de verificación.

## Instalación

1. Descarga el instalador o el portable.
2. Ejecuta el archivo. Windows puede mostrar SmartScreen porque el binario no está firmado: **Más información → Ejecutar de todos modos**.
3. Requiere Ollama instalado y en ejecución para las funciones de API. El inventario local funciona sin conexión.

## Verificación

Descarga `SHA256SUMS.txt` y compara el hash del ejecutable:

```powershell
Get-FileHash .\OllamaNeitor-0.1.0-alpha.0-x64.exe -Algorithm SHA256
```

## Notas de la alfa

- Sin firma de código ni actualizador automático.
- Requisitos: Windows 10/11 x64. Node.js 20+ solo para desarrollo.
- Ollama es necesario para chat, descargas, borrado y telemetría de memoria.
- Código fuente: https://github.com/genioloko19/OllamaNeitor
