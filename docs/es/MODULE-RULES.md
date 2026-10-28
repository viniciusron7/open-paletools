# Reglas de los módulos

[English](../MODULE-RULES.md) | [Português](../pt/MODULE-RULES.md) | Español

El build reúne todos los módulos en un único ámbito (scope) compartido, siguiendo el orden de [`src/manifest.json`](../../src/manifest.json), igual que en el bundle original. `npm run build` y `npm run check:modules` validan estas reglas antes de generar cualquier archivo.

- Los imports deben tener nombre y apuntar a un módulo listado en el manifiesto: `import { a, b } from "./file.js"`. Los exports deben ser declaraciones directas (`export function`, `export const`, `export let` o `export class`). No se permiten alias (`as`), `export default`, listas de exportación, reexportaciones, imports de espacio de nombres (`* as`) ni imports únicamente por efectos secundarios.
- Todo identificador utilizado en un módulo debe estar declarado en él, importado o listado en [`src/external-globals.json`](../../src/external-globals.json).
- Los identificadores de nivel superior (top-level), incluidos los nombres de recursos importados, deben ser únicos en todo el proyecto.
- No se permiten ciclos de importación ni imports o exports sin utilizar.
- No se deben reasignar variables importadas (las únicas excepciones son enlaces `export let` marcados con `@mutable` en su comentario). La modificación de propiedades de un objeto exportado sí está permitida.
- El código de nivel superior de un módulo se evalúa en el orden del manifiesto, por lo que no debe leer variables, constantes o clases declaradas en módulos posteriores del manifiesto, ni directamente ni mediante funciones invocadas durante la inicialización.
- No utilizar `import.meta`, ni `await` o `this` en el nivel superior.
- Otros archivos pueden importarse como recursos incrustados: `.css`, `.txt` y `.js.txt` como texto, `.svg`/`.png`/`.webp` como data URIs y `.gz` como base64 (`import styles from "./my-feature.css"`). Se incrustan byte por byte.
- Modificar el orden de `src/manifest.json` altera el orden de inicialización del código existente: mantener la secuencia salvo cuando el cambio sea intencionado.

Las comprobaciones se encuentran implementadas en [`scripts/check-modules.mjs`](../../scripts/check-modules.mjs).
