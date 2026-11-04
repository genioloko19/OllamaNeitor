# Firma de código

La 1.1.0 se publica sin firma. Para distribuir sin avisos de SmartScreen y
permitir una cadena de actualización verificable, configura un certificado de
firma de código en el entorno de compilación.

## Requisitos

- Certificado `.pfx` (o almacén de Windows) con clave privada.
- Contraseña del certificado.
- `electron-builder` ya soporta las variables `CSC_LINK` y `CSC_KEY_PASSWORD`.

## GitHub Actions

Añade estos secrets al repositorio:

| Secret | Valor |
|---|---|
| `CSC_LINK` | ruta o base64 del `.pfx` |
| `CSC_KEY_PASSWORD` | contraseña del certificado |

Después, en `.github/workflows/release.yml`, dentro del paso de compilación,
expón los secrets:

```yaml
      - name: Build Windows installer and portable
        run: npm run build:win
        env:
          CSC_LINK: ${{ secrets.CSC_LINK }}
          CSC_KEY_PASSWORD: ${{ secrets.CSC_KEY_PASSWORD }}
```

Si los secrets no existen, electron-builder omite la firma y genera artefactos
sin firmar, como hasta ahora.

## Comprobación local

```powershell
$env:CSC_LINK = "C:\ruta\certificado.pfx"
$env:CSC_KEY_PASSWORD = "contraseña"
npm run build:win
Get-AuthenticodeSignature .\dist\OllamaNeitor-1.1.0-x64.exe
```

El estado debe ser `Valid` y el firmante debe coincidir con el certificado.

## Notas

- La firma no cambia el código ni el formato de los paquetes.
- Para autoactualización en Windows se recomienda firmar también las versiones
  futuras con el mismo certificado.
- No subas el `.pfx` ni la contraseña al repositorio.
