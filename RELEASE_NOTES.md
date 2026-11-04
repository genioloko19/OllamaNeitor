# OllamaNeitor 1.1.0

Continuidad, operaciones de modelo y distribución.

## Novedades principales

- **Backup/restore integrado**: configuración, logros y conversaciones en `.tar.gz`, con backup automático previo a cada restauración.
- **Bandeja del sistema**: menú contextual, cierre a bandeja y notificaciones nativas al terminar trabajos.
- **Autoactualización** con `electron-updater` desde GitHub Releases, con estados y botones en Ajustes.
- **Operaciones de modelo**: copiar/renombrar, push, crear desde Modelfile y ver Modelfile.
- **Acciones masivas**: descargar, eliminar y liberar de RAM varios modelos.
- **Chat con imágenes**: hasta 4 adjuntos por mensaje, además de system prompt y parámetros de generación.
- **Compresión**: exportación `.tar` o `.tar.gz`; importación `.tar`, `.tar.gz` y `.tgz`.
- **Reintento** de exportaciones e importaciones fallidas desde el historial de trabajos.

## Descargas

- `OllamaNeitor-1.1.0-x64.exe` — instalador para Windows.
- `OllamaNeitor-1.1.0-portable.exe` — versión portable sin instalación.
- `SHA256SUMS.txt` — hashes de verificación.

## Instalación

1. Descarga el instalador o el portable.
2. Ejecuta el archivo. Windows puede mostrar SmartScreen porque el binario no está firmado: **Más información → Ejecutar de todos modos**.
3. Requiere Ollama instalado y en ejecución para chat, descargas y telemetría. El inventario local funciona sin conexión.

## Verificación

Descarga `SHA256SUMS.txt` y compara:

```powershell
Get-FileHash .\OllamaNeitor-1.1.0-x64.exe -Algorithm SHA256
```

## Limitaciones conocidas

- Sin certificado de firma configurado; la autoactualización funciona, pero SmartScreen puede avisar.
- `asar` desactivado para que los workers carguen `tar` desde disco.
- La reanudación real de transferencias `.tar` queda para 1.2; se ofrece reintento. Las descargas de Ollama sí se reanudan por digest.
- `.tar.zst` queda para 1.2.
- i18n base preparada; la interfaz sigue mayoritariamente en español.

Código fuente: https://github.com/genioloko19/OllamaNeitor
