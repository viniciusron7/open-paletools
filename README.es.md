# open-paletools

[English](README.md) | [Português](README.pt.md) | Español

Código fuente modular y desofuscado del userscript Paletools para la Web App de EA SPORTS FC Ultimate Team.

No oficial: basado en Paletools 27.2.1 de Paleta. No afiliado con Paleta ni con EA.

## 1. Preparación del entorno

Requiere [Git](https://git-scm.com/) y [Node.js](https://nodejs.org/) 22.13 o posterior.

```sh
git clone https://github.com/viniciusron7/open-paletools.git
cd open-paletools
npm ci          # instala las dependencias de build y pruebas
```

## 2. Estructura del código

```
src/
  userscript-header.js   bloque de metadatos ==UserScript==
  custom-plugins.js      plugins personalizados, ejecutados después de los integrados
  manifest.json          todos los módulos, en orden de inicialización (seguido por el build)
  bootstrap/boot.js      espera a la Web App, aplica parches e inicializa los plugins
  plugins/<nombre>/      una carpeta por funcionalidad (index.js define el plugin; .css a su lado)
  config/                configuración predeterminada, carga y persistencia (localStorage)
  i18n/                  tablas de traducción (en, es, it, pt, de, fr) y translate()
  core/                  utilidades genéricas (DOM, eventos, HTTP, objetos, hooks de prototipo)
  ui/                    componentes y controles de interfaz, notificaciones y atajos
  webapp/                integración con la Web App (navegación, pilas de artículos, parches globales)
  market/ club/ sbc/ db/ asistentes del Mercado de Transferencias, club, DCP (SBC) e IndexedDB
  assets/ styles/        imágenes y hoja de estilos global incrustadas por el build
  runtime/               runtime de webpack del bundle original (no editar)
  external-globals.json  APIs de la Web App, del navegador y del userscript permitidas en los módulos
scripts/                 scripts de build, verificación y actualización upstream
upstream/                versión oficial seguida por src/ (base.user.js, base.json)
tests/                   suite de pruebas y Web App simulada
docs/                    documentación técnica
```

| Componente                                               | Ubicación                                                                                                                       |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Nombre del script, directivas `@match`/`@grant`          | [`src/userscript-header.js`](src/userscript-header.js)                                                                          |
| Versión                                                  | `@version` en [`src/userscript-header.js`](src/userscript-header.js) y [`src/config/version.js`](src/config/version.js)         |
| Configuración predeterminada                             | [`src/config/defaults.js`](src/config/defaults.js) ([detalles](docs/es/SETTINGS.md))                                            |
| Textos de la interfaz (UI)                               | [`src/i18n/`](src/i18n/), un archivo por idioma (el inglés es la tabla de referencia)                                           |
| Plugins personalizados                                   | [`src/custom-plugins.js`](src/custom-plugins.js) ([guía de creación](docs/es/ADDING-A-FEATURE.md))                              |
| Player snipe (motor, pausas, precios)                    | [`src/plugins/player-snipe/core.js`](src/plugins/player-snipe/core.js)                                                          |
| Player snipe: búsqueda/compra en la Web App, selección   | [`market.js`](src/plugins/player-snipe/market.js) y [`selection.js`](src/plugins/player-snipe/selection.js) en la misma carpeta |
| Bulk Buy — compra masiva (plan, presupuesto, ejecución)  | [`src/plugins/bulk-buy/core.js`](src/plugins/bulk-buy/core.js)                                                                  |
| Bulk Buy: búsqueda por OVR, candidatos, saldo            | [`src/plugins/bulk-buy/market.js`](src/plugins/bulk-buy/market.js)                                                              |
| Sesiones, diálogos y exclusión mutua de ambos            | [`src/plugins/market-automation/sessions.js`](src/plugins/market-automation/sessions.js)                                        |
| Botones y hooks de ambas automatizaciones                | `index.js` de [`player-snipe`](src/plugins/player-snipe/index.js) y [`bulk-buy`](src/plugins/bulk-buy/index.js)                 |
| Snipe clásico (atajos, cola, confirmación)               | [`src/plugins/snipe/`](src/plugins/snipe/)                                                                                      |
| Auto Snipe (Paletools 27.2.1, mosaico en Transferencias) | [`src/plugins/auto-snipe/`](src/plugins/auto-snipe/)                                                                            |
| Botón de compra de álbum y galería, diálogo de compra    | [`src/plugins/album/album-view-controller.js`](src/plugins/album/album-view-controller.js)                                      |
| Herramientas de actualización upstream                   | [`scripts/upstream/`](scripts/upstream/) y versión base en [`upstream/`](upstream/)                                             |
| Lista de plugins integrados y secuencia de arranque      | [`src/bootstrap/boot.js`](src/bootstrap/boot.js)                                                                                |
| Parches globales de la Web App                           | [`src/webapp/patches.js`](src/webapp/patches.js)                                                                                |
| Motor de hooks de prototipo                              | [`src/core/prototype-override.js`](src/core/prototype-override.js)                                                              |
| Demás funcionalidades                                    | [`src/plugins/`](src/plugins/), una carpeta por funcionalidad (p. ej., `sbc-auto-solver`, `my-packs`)                           |

## 3. Desarrollo y validación

- **Creación de herramientas:** crear un módulo de plugin en `src/plugins/<nombre>/` y registrarlo en [`src/custom-plugins.js`](src/custom-plugins.js) ([guía paso a paso](docs/es/ADDING-A-FEATURE.md)). Los módulos independientes registrados en `custom-plugins.js` se conservan automáticamente al actualizar a nuevas versiones de Paletools.
- **Edición de funcionalidades nativas:** cada módulo en `src/` incluye un comentario de cabecera que describe sus responsabilidades, hooks instalados, invariantes y defectos conocidos. Consultar [Invariantes](docs/es/INVARIANTS.md), [Reglas de los módulos](docs/es/MODULE-RULES.md) y [Configuración predeterminada](docs/es/SETTINGS.md) antes de modificar comportamientos existentes.
- **Validación:**

  ```sh
  npm run verify   # comprueba reglas de módulos, formato y ejecuta la suite de pruebas
  ```

  En caso de cambios intencionados en la secuencia de arranque (nuevos plugins, hooks u hojas de estilo), actualizar el snapshot de arranque con `npm run update:boot-snapshot` ([documentación de pruebas](docs/es/TESTING.md)).

## 4. Build e instalación en Tampermonkey

Generar el archivo final del userscript:

```sh
npm run build   # genera dist/paletools.user.js
```

Para instalar en [Tampermonkey](https://chromewebstore.google.com/detail/dhdgffkkebhmkfjojejmpbldmpobfkfo):

1. Abrir el panel (Dashboard) y hacer clic en **+** para crear un nuevo script.
2. Reemplazar toda la plantilla con el contenido de `dist/paletools.user.js` y guardar.
3. Mantener el Paletools oficial desactivado para evitar conflictos de ejecución.

Tras cada cambio en `src/`, ejecutar `npm run build` de nuevo y actualizar el contenido del script en Tampermonkey ([funcionamiento del build](docs/es/BUILD.md)).

## 5. Actualización

- **Nueva versión oficial de Paletools:** portar una nueva versión publicada por Paleta a `src/` conservando los plugins personalizados y los cambios locales, con verificación instrucción por instrucción:
  - mediante [Claude Code](https://claude.com/claude-code): `/update-paletools`;
  - mediante línea de comandos: `npm run upstream:check` y `npm run upstream:update` ([funcionamiento detallado](docs/es/UPDATING.md)).
- **Nueva versión de este repositorio:** ejecutar `git pull`, generar un nuevo build con `npm run build` y actualizar el script en Tampermonkey ([más detalles](docs/es/UPDATING.md)).

## 6. Documentación

- [Adición de funcionalidades](docs/es/ADDING-A-FEATURE.md): estructura y registro de nuevos plugins.
- [Reglas de los módulos](docs/es/MODULE-RULES.md): restricciones de ámbito e importación exigidas por el build.
- [Invariantes](docs/es/INVARIANTS.md): comportamientos sensibles (sniping, Bulk Buy, arranque) y defectos conocidos.
- [Configuración predeterminada](docs/es/SETTINGS.md): persistencia en `localStorage` y restablecimiento de valores.
- [Depuración](docs/es/DEBUGGING.md): localización de errores y módulos de origen.
- [Pruebas](docs/es/TESTING.md): cobertura de la suite de pruebas y actualización del snapshot de arranque.
- [Funcionamiento del build](docs/es/BUILD.md): ensamblaje del userscript a partir de `src/`.
- [Comandos](docs/es/COMMANDS.md): referencia de los scripts npm del proyecto.
- [Actualización y coexistencia con el Paletools oficial](docs/es/UPDATING.md): port de versiones oficiales y sincronización del repositorio.
