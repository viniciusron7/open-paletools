# Depuración

[English](../DEBUGGING.md) | [Português](../pt/DEBUGGING.md) | Español

- Los errores de ejecución y la salida de `console.log` se muestran en la consola de las herramientas de desarrollador del navegador en la página de la Web App.
- El script instalado corresponde al archivo generado por el build: cada módulo queda delimitado entre comentarios `// #region src/...` y `// #endregion src/...`, lo que permite localizar directamente el módulo de origen a partir de una línea de la traza de pila (stack trace).
- Una excepción no controlada en `run()` detiene la inicialización de todos los plugins posteriores y de la pantalla de configuración de Paletools. Se recomienda envolver el código experimental en bloques `try`/`catch` durante el desarrollo.
- Los mensajes internos de depuración están desactivados por defecto: cambiar `isDebugLoggingEnabled` a `true` en [`src/core/logger.js`](../../src/core/logger.js) para habilitarlos.
- Si un cambio en un valor predeterminado no se refleja, comprobar si existe un ajuste guardado en el navegador que prevalezca sobre el nuevo valor (consultar [Configuración predeterminada](SETTINGS.md)) y verificar que el Paletools oficial esté desactivado (consultar [Actualización](UPDATING.md)).
- `npm test` ejecuta todo el userscript en una Web App simulada (consultar [Pruebas](TESTING.md)): si el `run()` de un plugin lanza un error, la prueba de arranque falla con `"paletools:appStarted must be dispatched"` antes de instalar el script. Dado que la Web App simulada utiliza objetos sustitutos (fakes), las validaciones que dependen del servidor real requieren probarse en la Web App.
