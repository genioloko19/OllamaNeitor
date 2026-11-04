# OllamaNeitor 1.0.0

Gestor de modelos de Ollama para Windows con interfaz glass, 12 temas independientes y dashboard gamificado.

## Novedades principales

- **Importación atómica por modelo**: staging, `.part` + renombrado, backup en sobrescritura y rollback aislado.
- **Seguridad de paquetes**: rechazo de symlinks, hardlinks, dispositivos, rutas absolutas, `..`, NUL y unidades.
- **Cola de trabajos**: historial, cancelación, concurrencia configurable y reenganche al navegar.
- **Mantenimiento real**: limpieza de blobs huérfanos, verificación de integridad y detección de blobs faltantes.
- **Portable real**: datos en `OllamaNeitorData` junto al ejecutable, con fallback a AppData.
- **Chat configurable**: system prompt, temperatura, top_p, num_ctx, num_predict, keep_alive e historial.
- **Exportación robusta**: modelos solo API bloqueados, nombres sin colisiones y fecha coherente.
- **Aviso al cerrar** con transferencias activas y limpieza de staging al arrancar.

## Descargas

- `OllamaNeitor-1.0.0-x64.exe` — instalador para Windows.
- `OllamaNeitor-1.0.0-portable.exe` — versión portable sin instalación.
- `SHA256SUMS.txt` — hashes de verificación.

## Instalación

1. Descarga el instalador o el portable.
2. Ejecuta el archivo. Windows puede mostrar SmartScreen porque el binario no está firmado: **Más información → Ejecutar de todos modos**.
3. Requiere Ollama instalado y en ejecución para chat, descargas y telemetría. El inventario local funciona sin conexión.

## Verificación

Descarga `SHA256SUMS.txt` y compara:

```powershell
Get-FileHash .\OllamaNeitor-1.0.0-x64.exe -Algorithm SHA256
```

## Limitaciones conocidas

- Sin firma de código ni actualizador automático.
- `asar` desactivado para que los workers puedan cargar `tar` desde disco.
- Backup/restore integrado, i18n, bandeja del sistema y operaciones avanzadas de modelo quedan para 1.1.
- Los paquetes `.tar` son el formato propio de OllamaNeitor (manifiestos + blobs).

Código fuente: https://github.com/genioloko19/OllamaNeitor
