# Configuración predeterminada

[English](../SETTINGS.md) | [Português (Brasil)](../pt-BR/SETTINGS.md) | Español

El valor predeterminado de cada ajuste se define en [`src/config/defaults.js`](../../src/config/defaults.js) (`plugins.<nombre>` almacena los ajustes de cada plugin).

Modificar un valor predeterminado existente solo afecta a los navegadores que aún no han guardado ese ajuste. Paletools guarda toda su configuración en la primera ejecución, dentro de la entrada `paletools:settings` del `localStorage` de la Web App (compartida con el Paletools oficial), y los valores guardados prevalecen sobre los predeterminados del código. Las nuevas claves de configuración siempre se aplican en instalaciones existentes, ya que los ajustes guardados se fusionan sobre los valores predeterminados.

Para aplicar un valor predeterminado modificado en un navegador que ya ejecutó Paletools:

- cambiar el ajuste directamente en la pantalla de configuración de Paletools dentro de la Web App, o
- eliminar la entrada `paletools:settings` del `localStorage` de `https://www.ea.com` (desde las herramientas de desarrollador del navegador) y recargar la Web App, restableciendo toda la configuración.

El proceso de carga y persistencia de la configuración se describe al inicio de [`src/config/configuration.js`](../../src/config/configuration.js).
