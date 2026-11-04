# OllamaNeitor 1.1.1

Parche de chat multimodal.

## Corrección principal

La 1.1.0 enviaba el historial completo de imágenes a todos los modelos. Un modelo
de solo texto respondía:

```
Multimodal data provided, but model does not support multimodal requests.
```

La 1.1.1 lo corrige:

- Detecta la capacidad `vision` de cada modelo con `/api/show`.
- Deshabilita el botón de imagen en modelos sin visión.
- Omite las imágenes del historial al enviar a modelos de texto, conservando el texto.
- Mantiene las imágenes para modelos multimodales como `moondream` o `llava`.
- Al cambiar a un modelo sin visión, retira los adjuntos pendientes y avisa.
- Muestra el mensaje legible de Ollama en lugar del JSON crudo.
- Fuerza el render final del asistente al terminar el streaming.

## Descargas

- `OllamaNeitor-1.1.1-x64.exe` — instalador para Windows.
- `OllamaNeitor-1.1.1-portable.exe` — versión portable sin instalación.
- `SHA256SUMS.txt` — hashes de verificación.

## Instalación

1. Descarga el instalador o el portable.
2. Ejecuta el archivo. Windows puede mostrar SmartScreen porque el binario no está firmado: **Más información → Ejecutar de todos modos**.
3. Requiere Ollama instalado y en ejecución para chat, descargas y telemetría.

## Verificación

```powershell
Get-FileHash .\OllamaNeitor-1.1.1-x64.exe -Algorithm SHA256
```

## Notas

- Incluye todas las funciones de la 1.1.0: backup/restore, bandeja, autoactualización, operaciones de modelo, chat con imágenes, `.tar.gz`, acciones masivas y reintento.
- Los releases 0.1.0-alpha.0, 1.0.0 y 1.1.0 se conservan.

Código fuente: https://github.com/genioloko19/OllamaNeitor
