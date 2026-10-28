# Pruebas

[English](../TESTING.md) | [Português (Brasil)](../pt-BR/TESTING.md) | Español

`npm test` compila una copia temporal del userscript (sin modificar `dist/` ni incrementar el [número de build](BUILD.md#versión-y-número-de-build)) y ejecuta:

- `tests/*.test.cjs`: pruebas de Player Snipe, Bulk Buy y su integración con la Web App utilizando objetos simulados (fakes), ejecutadas tanto contra `src/` como contra el userscript generado.
- `tests/userscript/boot.test.mjs`: ejecuta el userscript completo en una Web App simulada (sin red y sin cuenta de EA) y compara cada llamada, hook, listener, hoja de estilo y petición del arranque con `tests/userscript/boot-fingerprint.snapshot.json`.
- `tests/tooling/`: pruebas del build, de las comprobaciones de módulos y de las herramientas de actualización upstream (desofuscador, utilidades de versión, verificador de equivalencia y motor de fusión). Algunas pruebas upstream utilizan las versiones locales en `versoes_paletools/` cuando esa carpeta existe, omitiéndose en caso contrario.

## Snapshot de arranque (boot snapshot)

Cualquier cambio en el comportamiento de inicio del script (un plugin, hook u hoja de estilo nuevo o modificado) hace fallar la prueba de arranque. Cuando el cambio sea intencionado:

1. Ejecutar `npm run update:boot-snapshot`.
2. Revisar el diff de `tests/userscript/boot-fingerprint.snapshot.json`. Un plugin nuevo solo debe añadir líneas; si una línea existente cambia o se desplaza, indica que la modificación afecta a otro código.
3. Incluir el snapshot actualizado en el commit.

El snapshot registra las operaciones realizadas durante el arranque, pero no sustituye la validación funcional en la Web App.

Una actualización upstream vuelve a registrar el snapshot automáticamente al finalizar (`npm run upstream:update` cuando no quedan tareas pendientes, o `npm run upstream:verify -- --finish`).

Las pruebas nunca acceden a la Web App real ni a cuentas de EA. Los defectos conocidos heredados del script original se conservaron intencionadamente y están documentados en las cabeceras de los módulos y en [Invariantes](INVARIANTS.md).
