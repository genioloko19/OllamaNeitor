# Contribuir

## Requisitos

- Windows 10/11
- Node.js 20.19 o superior
- Ollama (opcional para ejecutar la app; necesario para chat y API)

## Puesta en marcha

```bash
npm ci
npm run vendor:copy
npm start
```

`npm ci` ejecuta `postinstall`, que genera temas, copia vendor e icono.

## Verificación antes de un PR

```bash
npm run verify
```

Incluye:

- generación de los 36 bloques de tema,
- auditoría de contraste,
- pruebas Vitest (core, temas, tar, jobs, inventario, transferencias).

## Estilo

- 2 espacios, LF, sin punto y coma opcional; sigue el estilo del archivo.
- Renderer en ES modules; core/electron en CommonJS.
- No añadas dependencias de renderer por CDN: todo debe funcionar offline.
- Cualquier cambio de formato va en un commit separado del cambio funcional.

## Seguridad

- No ejecutes rutas de tar sin validarlas con `src/core/tar-safety.js`.
- Cualquier escritura nueva debe pasar por `assertInside`.
- Los workers deben usar `.part` + renombrado para archivos definitivos.
- Añade un test de regresión para cada corrección de integridad.

## Pull requests

1. Una rama por cambio.
2. Descripción del problema y de la solución.
3. Tests que fallen antes y pasen después.
4. `npm run verify` en verde.
5. Actualiza CHANGELOG si cambia el comportamiento.
