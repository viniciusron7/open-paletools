# Comandos

[English](../COMMANDS.md) | [Português](../pt/COMMANDS.md) | Español

Ejecutar `npm ci` una vez tras clonar el repositorio para instalar las herramientas requeridas por los demás comandos.

| Comando                        | Descripción                                                                                                                                                                     |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm ci`                       | Instala las herramientas de build y pruebas fijadas en `package-lock.json`.                                                                                                     |
| `npm run build`                | Comprueba los módulos y genera `dist/paletools.user.js` a partir de `src/` con el siguiente [número de build](BUILD.md#versión-y-número-de-build).                              |
| `npm run check:modules`        | Comprueba únicamente los imports, exports y las [reglas de los módulos](MODULE-RULES.md).                                                                                       |
| `npm test`                     | Compila una copia temporal de prueba (sin modificar `dist/`) y ejecuta todas las [pruebas](TESTING.md) contra `src/` y contra el userscript generado.                           |
| `npm run verify`               | Ejecuta `check:modules` + `format:check` + `npm test`. Recomendado antes de hacer commit.                                                                                       |
| `npm run format`               | Formatea el código con Prettier (`npm run format:check` solo verifica el formato).                                                                                              |
| `npm run update:boot-snapshot` | Actualiza el snapshot de arranque tras un cambio intencionado en la secuencia de inicio (plugins, hooks, CSS).                                                                  |
| `npm run upstream:check`       | Indica si existe una versión oficial de Paletools más reciente que la seguida por `src/` ([actualización](UPDATING.md)).                                                        |
| `npm run upstream:update`      | Porta la última versión oficial a `src/` y verifica la equivalencia del resultado ([actualización](UPDATING.md#desde-la-línea-de-comandos)).                                    |
| `npm run upstream:verify`      | Comprueba que el build de `src/` sigue siendo equivalente al resultado esperado del último port (`-- --finish` registra la nueva base; `--conflicts-resolved` tras conflictos). |
| `npm run upstream:status`      | Lista los puntos donde `src/` difiere de la versión base oficial (modificaciones propias de este proyecto).                                                                     |

Los argumentos adicionales tras `--` se pasan a `node --test` (p. ej., `npm test -- --test-name-pattern=boot`).

En Claude Code, `/update-paletools` automatiza todo el proceso de actualización a una nueva versión de Paletools (consultar [Actualización](UPDATING.md)).
