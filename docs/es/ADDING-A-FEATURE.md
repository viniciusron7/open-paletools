# Adición de funcionalidades

[English](../ADDING-A-FEATURE.md) | [Português (Brasil)](../pt-BR/ADDING-A-FEATURE.md) | Español

Una funcionalidad consiste en un plugin: un objeto con una función `run()`, ejecutada una sola vez cuando la Web App está lista para instalar los hooks necesarios, y opcionalmente un bloque `settings` para la pantalla de configuración de Paletools.

1. Crear `src/plugins/my-feature/index.js`:

   ```js
   /**
    * Plugin My Feature (`myFeaturePlugin`): descripción del comportamiento y de los hooks instalados.
    */
   import { configuration, persistConfiguration } from "../../config/configuration.js";
   import { appendToggle } from "../../ui/settings-controls.js";

   const myFeatureSettings = configuration.plugins.myFeature;

   export const myFeaturePlugin = {
     run() {
       // Envuelve un método de la Web App: llama al original, añade el comportamiento y devuelve su resultado.
       const originalSetSquad = UTSBCSquadOverviewView.prototype.setSquad;
       UTSBCSquadOverviewView.prototype.setSquad = function (...args) {
         const result = originalSetSquad.apply(this, args);
         if (configuration.enabled && myFeatureSettings.enabled) {
           // Código personalizado: `this` es la vista, `args[0]` la plantilla.
         }
         return result;
       };
     },
     settings: {
       name: "my-feature",
       title: "plugins.myFeature.settings.title",
       menu() {
         const container = document.createElement("div");
         appendToggle(container, "enabled", myFeatureSettings.enabled, (isEnabled) => {
           myFeatureSettings.enabled = isEnabled;
           persistConfiguration();
         });
         return container;
       },
     },
   };
   ```

2. Añadir la configuración predeterminada al objeto `plugins` de [`src/config/defaults.js`](../../src/config/defaults.js): `myFeature: { enabled: true },`.
3. Añadir los textos en [`src/i18n/en.js`](../../src/i18n/en.js): `"plugins.myFeature.settings.title": "My Feature",`. Los idiomas que no incluyan la clave utilizan el texto en inglés como respaldo.
4. Añadir `"src/plugins/my-feature/index.js"` en [`src/manifest.json`](../../src/manifest.json), después de los módulos que importa y antes de `"src/custom-plugins.js"`.
5. En [`src/custom-plugins.js`](../../src/custom-plugins.js), importar el plugin y añadirlo a la lista: `export const customPlugins = [myFeaturePlugin];`. Los plugins personalizados se ejecutan después de los plugins integrados, en el orden de esa lista (solo el plugin de configuración, que construye la pantalla de ajustes, se ejecuta después de ellos).
6. Ejecutar `npm run update:boot-snapshot` y luego `npm run verify`. Revisar el diff de `tests/userscript/boot-fingerprint.snapshot.json`: solo debe añadir líneas correspondientes al nuevo plugin (sus hooks y hojas de estilo); ninguna línea existente debe cambiar ni moverse. Consultar [Pruebas](TESTING.md).
7. Ejecutar `npm run build` e instalar el nuevo `dist/paletools.user.js` para probar la funcionalidad en la Web App.

## Notas técnicas

- Para estilos, colocar `my-feature.css` junto a `index.js`, importarlo (`import myFeatureCss from "./my-feature.css";`) y aplicarlo en `run()` con `upsertStylesheet("paletools-my-feature", myFeatureCss)` desde [`src/ui/stylesheets.js`](../../src/ui/stylesheets.js).
- Las clases y variables globales de la Web App (como `UTSBCSquadOverviewView` o `services`) solo pueden utilizarse si están listadas en [`src/external-globals.json`](../../src/external-globals.json). El build informa sobre cualquier identificador faltante; añadirlos bajo `webApp`.
- [`src/plugins/refresh-coins/`](../../src/plugins/refresh-coins/) y [`src/plugins/decimal-rating/`](../../src/plugins/decimal-rating/) sirven como ejemplos de plugins sencillos.
- El build valida estrictamente las [reglas de los módulos](MODULE-RULES.md) e indica las correcciones necesarias.
- Un nuevo valor predeterminado para un ajuste existente puede no reflejarse de inmediato en el navegador: consultar [Configuración predeterminada](SETTINGS.md).
- Para el diagnóstico de fallos, consultar [Depuración](DEBUGGING.md).
- Los plugins aislados en sus propios módulos y listados en `src/custom-plugins.js` se conservan intactos al actualizar a nuevas versiones de Paletools. Si una versión oficial elimina una función o un valor integrado utilizado por el plugin, la actualización lo conserva y reporta un conflicto (consultar [Actualización](UPDATING.md#código-personalizado)).
