# Funcionamiento del build

[English](../BUILD.md) | [Português (Brasil)](../pt-BR/BUILD.md) | Español

[`scripts/build.mjs`](../../scripts/build.mjs) valida todos los módulos (consultar [Reglas de los módulos](MODULE-RULES.md)) y, a continuación, ensambla el archivo final:

1. escribe el bloque de metadatos de [`src/userscript-header.js`](../../src/userscript-header.js), añadiendo el número de build a `@version` (ver más abajo);
2. inserta, dentro del runtime de webpack de [`src/runtime/webpack-runtime.js`](../../src/runtime/webpack-runtime.js), una constante por cada recurso incrustado (CSS, imágenes, datos) seguida de todos los módulos de [`src/manifest.json`](../../src/manifest.json), en el orden del manifiesto y eliminando `import`/`export`. Cada módulo queda delimitado entre comentarios `// #region <ruta>` y `// #endregion <ruta>`.

El resultado se formatea con Prettier y se escribe en `dist/paletools.user.js` (no confirmado en git).

En tiempo de ejecución, todos los módulos comparten un mismo ámbito (scope) y se evalúan en el orden del manifiesto, reproduciendo el orden de inicialización del bundle original.

El script generado es completamente autónomo: no descarga código externo en tiempo de ejecución (sin `@require`), limitándose a consultar datos (como la comprobación de actualizaciones en `pale.tools` y los precios en `fut.gg`).

## Versión y número de build

`npm run build` escribe el `@version` de `src/userscript-header.js` seguido de un número secuencial de build: el primer build de la versión 27.1.5 es `27.1.5.1`, el décimo es `27.1.5.10`.

- El número de build contabiliza las ejecuciones exitosas de `npm run build` en el entorno local y se almacena en `.build-number.json`, en la raíz del proyecto (no confirmado en git). Eliminar ese archivo reinicia el contador en 1.
- El contador vuelve a empezar en 1 cuando cambia el `@version` de `src/userscript-header.js` (mantener [`src/config/version.js`](../../src/config/version.js) con la misma versión, según verifican las pruebas).
- Un build rechazado por incumplir alguna [regla de módulo](MODULE-RULES.md) no genera ningún archivo ni incrementa el contador.
- `npm test`, `npm run verify` y `npm run update:boot-snapshot` compilan sus propias copias temporales, sin modificar `dist/` ni el número de build.
- Únicamente cambia la línea `@version` de la cabecera del userscript; la versión interna mostrada en la interfaz de Paletools sigue siendo la definida en `src/config/version.js`.
