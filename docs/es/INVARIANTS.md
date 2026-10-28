# Invariantes y comportamientos sensibles

[English](../INVARIANTS.md) | [Português](../pt/INVARIANTS.md) | Español

Este documento reúne las reglas y comportamientos que una modificación puede romper inadvertidamente. Los detalles específicos de cada módulo se encuentran en el comentario de cabecera de su propio archivo en `src/`.

## 1. Estructura e inicialización

- **Ámbito (scope) único, orden del manifiesto.** El build concatena los módulos de `src/manifest.json` dentro del módulo 723 del runtime original de webpack. El orden del manifiesto define el orden de inicialización del bundle original: las instrucciones de nivel superior con efectos secundarios (parches de prototipo, `JSUtils.inherits`, `new ...()`) dependen de él. Las declaraciones de función se elevan (hoisting) y pueden ubicarse en cualquier módulo.
- **Runtime de webpack** (`src/runtime/webpack-runtime.js`, no editar), incluidos los módulos vacíos 491 y 831: `importModule(491)` y `getEmptyModule831Default()` se ejecutan durante el arranque y deben conservarse.
- **Arranque / Boot** (`src/bootstrap/boot.js`): `bootWhenWebAppReady` se ejecuta de inmediato si existe `document.body` (o en `DOMContentLoaded`) y reintenta cada 1 s hasta que no exista `.ut-login` y estén disponibles `services.Localization` y `services.Authentication.utasSession.url`. A continuación: creación de un iframe oculto para restaurar `console`, ajuste de clases de dispositivo móvil (`phone`), llamada única a `applyWebAppPatches()`, inicialización de la base de datos IndexedDB y llamada a `initializePluginsWhenReady` (si falta `.ut-tab-bar`, inicia un temporizador de reintento de 1 s y retorna). `getAppMain()._ptBooted` se establece al finalizar `bootWhenWebAppReady`, lo que puede ocurrir antes de la ejecución de los plugins: cualquier intento iniciado después de establecer la marca no tiene efecto, pero otra instancia del script (como el Paletools oficial) cuyo intento haya comenzado antes también completará el arranque.
- **Lista de plugins.** La lista literal de plugins integrados en `initializePluginsWhenReady`, la entrada `getEmptyModule831Default()` (un `{}`), el comparador `left.order - right.order` y `Array.prototype.sort` deben permanecer inalterados: algunas entradas carecen de `order`, por lo que el comparador devuelve `NaN` y el orden resultante depende de la posición original en la lista. Reordenar, añadir o eliminar entradas en la lista integrada, o modificar el comparador, altera el orden de ejecución de los plugins y el encadenamiento de hooks. Los plugins nuevos deben registrarse exclusivamente en `src/custom-plugins.js`, cuya lista se concatena tras ordenar los integrados y se ejecuta antes del plugin de configuración.
- **Sin aislamiento de errores.** Si el método `run()` de un plugin lanza una excepción, los plugins siguientes, el menú de configuración y los eventos `APP_LOADED`/`APP_STARTED` no llegan a ejecutarse.
- **Encadenamiento de hooks.** Varios plugins sobrescriben un mismo método (por ejemplo, `UTMarketSearchFiltersView.prototype._generate`), invocando cada uno al anterior. El orden de ejecución de los plugins define el anidamiento. Las sobrescrituras directas deben seguir invocando el método capturado; los hooks en `src/core/prototype-override.js` reutilizan un único wrapper por método (con soporte para prioridad, `cancel`, `setArgs`, `setResult` y `once`).

## 2. Player snipe (`src/plugins/player-snipe/`, `market-automation/`)

- **Confirmación.** El botón permanece habilitado únicamente en la pantalla visible de filtros, con un jugador seleccionado y un `Buy Now Price Max` entero válido (200–14.999.000, alineado a los incrementos de precio). El diálogo muestra el jugador y el precio máximo; al pulsar **Confirm** se vuelven a validar todas las condiciones (controlador visible, mismo jugador, mismo máximo y filtro Player ID compatible). Cada búsqueda repite la comprobación y finaliza la sesión si cambiaron el jugador o el máximo.
- **Identidad.** Se acepta cualquier versión del mismo jugador (mismo `definitionId` o mismo id base mediante `ItemIdMask.DATABASE`); `defId` y el campo Player ID deben compartir el mismo id base.
- **Primera oferta elegible.** Filtra las ofertas activas del jugador con `buyNowPrice` entero en el rango `(0, máximo]` y compra `items[0]` **en el orden devuelto por el servidor** (sin ordenar por precio), deteniéndose tras la primera compra confirmada.
- **Progresión de precios mínimos** (`getNextPlayerSnipePrices`): comienza en `{minBid: 0, minBuy: 0}`; cada ciclo avanza `minBuy` en un incremento de precio del Mercado de Transferencias (`UTCurrencyInputControl.getIncrementAboveVal`); cuando `minBuy` alcanzaría `máximo / 2`, avanza `minBid` e iguala `minBuy` a ese valor. **Se mantiene siempre `minBuy < máximo / 2` (estricto).** Cuando `minBid` ya no puede avanzar, el ciclo se reinicia en 0/0 sin detener la sesión.
- **Pausas variables** (`createPlayerSnipeTiming`): milisegundos enteros — búsqueda (`search`) 80–180, retorno (`return`) 70–160, ajuste (`adjust`) 30–90, compra (`buy`) 15–55 — sin repetir nunca la pausa inmediatamente anterior (global) ni la pausa anterior de la misma acción.
- **Protección frente al evento CHANGE.** Los setters nativos de precio emiten eventos CHANGE y los manejadores `e*PriceChanged` normalizan los mínimos (`minBid < minBuy`). Mientras hay una sesión activa, dichos manejadores se cancelan mediante hooks (`prototypeOverride.cancel()`); la búsqueda escribe los precios en el DTO, invoca los setters y vuelve a escribir los valores en el DTO. La cancelación depende exclusivamente de `activePlayerSnipeSession`; `triggeringSearch` solo distingue la búsqueda de la sesión de una manual, y `applyingFilters` se asigna pero nunca se lee.
- **Captura de la búsqueda.** El wrapper de `services.Item.searchTransferMarket` entrega el observable a la búsqueda pendiente solo si aún no ha sido capturado y coinciden `maxBuy`, `minBid` y `minBuy`. Debe permanecer como el wrapper más externo (instalado en el orden 10010).
- **Stop (Detener).** Aborta la señal (`signal`), impidiendo nuevas búsquedas o compras. **Una compra ya enviada continúa observándose sin la señal de aborto** (sujeta únicamente al tiempo de espera de 30 s) y, si se confirma, se contabiliza. Una búsqueda manual (`eSearchSelected` no disparado por la sesión), un restablecimiento de filtros o la desactivación de Paletools también detienen la sesión.

## 3. Bulk Buy — Compra masiva (`src/plugins/bulk-buy/`, `market-automation/`)

- **Plan** (`validateBulkBuyPlan`): compuesto por filas de OVR (1–99), precio máximo (200–14.999.000, múltiplo del incremento de su rango: ≤1.000→50, ≤10.000→100, ≤50.000→250, ≤100.000→500, superior→1.000) y cantidad (entero positivo). **La suma de los costes máximos debe ser estrictamente menor que el saldo de monedas.**
- **Revalidación del presupuesto.** Se ejecuta en el diálogo en cada cambio y en cada evento `USER_CURRENCY_UPDATE`; al pulsar **Run**, valida el plan, actualiza el saldo desde el servidor, vuelve a validar, cierra el diálogo y revalida en `startBulkBuy`. Antes de cada puja, el coste máximo de las unidades restantes debe ser estrictamente menor que `min(saldo actual, saldo inicial − gastado)`.
- **Contabilización.** Solo cuentan las compras confirmadas con un precio entero dentro de `(0, máximo de la fila]`.
- **OVR exacto con paginación.** El Mercado de Transferencias no filtra por OVR exacto en el servidor: cada página busca jugadores hasta el precio máximo con `disableOverrides: true` y comprueba `rating === OVR` localmente; las páginas sin candidatos también se recorren; el tamaño de página proviene de la configuración de EA y la página extra (lookahead) indica si existen más resultados. Tras cada compra confirmada, la fila se reinicia desde la primera página.
- **Deduplicación.** Cada subasta (`tradeId`) se intenta como máximo una vez por ejecución, registrándose la clave antes de enviar la puja.
- **Ofertas perdidas.** Las respuestas 462/478/479 de EA (con sus códigos HTTP correspondientes) se omiten sin contabilizar; cualquier otro fallo finaliza la ejecución con error.
- **Stop (Detener).** Mismo comportamiento que en el sniping: no se inicia ninguna compra nueva y la compra en curso se observa hasta completarse.

## 4. Exclusión mutua entre ambas automatizaciones

`src/plugins/market-automation/sessions.js` centraliza el estado `activePlayerSnipeSession`, `playerSnipeConfirmation`, `activeBulkBuySession` y `bulkBuyConfirmation`. Mientras cualquiera de ellos esté activo, ninguna de las dos automatizaciones abre un diálogo ni inicia una sesión, manteniendo ambos botones deshabilitados. Centralizar el estado y sus funciones de asignación en un único módulo evita ciclos de importación.

## 5. Automatizaciones upstream que realizan compras (Paletools 27.2.1)

Provenientes de la versión oficial, **no** forman parte de la exclusión mutua de la sección 4 y comparten los límites del Mercado de Transferencias de la cuenta:

- **Auto Snipe** (`src/plugins/auto-snipe/`): desactivado por defecto; su activación solicita confirmación (`plugins.dangerous`). Se ejecuta únicamente en su propia pantalla (mosaico en la central de Transferencias) mientras Paletools y Auto Snipe estén habilitados, deteniéndose al salir de la pantalla o al desactivarlo. Cada búsqueda y cada compra cuentan como un intento (`maxSnipes`), y las cartas compradas cuentan para `maxCards`; compra todas las ofertas activas con precio igual o inferior al máximo, empezando por la más barata. Sus filtros incrustados ejecutan los hooks de `market-search-filters` y reciben también los botones Snipe Player y Bulk Buy, que su propia hoja de estilos oculta.
- **Botón de compra de álbum y galería** (`src/plugins/album/album-view-controller.js`): desactivado por defecto (`album.buyEnabled`, `gallery.buyEnabled`, confirmado con `plugins.dangerous`); realiza una compra a la vez de la oferta activa más barata de esa carta exacta, previa confirmación en un diálogo y siempre que el precio no haya cambiado.

## 6. Datos persistidos e identificadores externos

No deben renombrarse: claves de `localStorage` (p. ej., `paletools:settings`, `paletools:searchFilters`), nombres de bases de datos y almacenes (stores) de IndexedDB, claves de configuración (`configuration.plugins.<nombre>`), claves de traducción, nombres de eventos (`paletools:*`), ids/clases CSS utilizados por estilos o atajos, y métodos añadidos a los prototipos de la Web App invocados por su nombre desde otros módulos.

## 7. Defectos conocidos heredados del script original

Los defectos preexistentes en el Paletools original se conservaron deliberadamente para mantener un comportamiento idéntico. La lista completa figura en la sección `"Known issues (kept as-is)"` del comentario de cabecera de cada módulo. Corregir cualquiera de ellos constituye un cambio de comportamiento y requiere ejecutar `npm test`.

- Identificadores no declarados — `saveConfiguration`, `updateConfiguration`, `addStyles`, `removeStyles`, `remove`, `i`, `info` y un `response` — lanzan `ReferenceError` cuando se ejecuta ese código (listados en `src/external-globals.json`, `undeclaredInOriginal`).
- `hasClass("phone")` en el arranque se invoca sin elemento.
- El comparador de la lista de plugins devuelve `NaN` para las entradas sin propiedad `order` (ver sección 1).
- Los transformadores de resultados del mercado (`src/webapp/patches.js`) se aplican a las búsquedas del Player Snipe (que no usan `disableOverrides`). Con la opción de ocultar duplicados (`marketSearchFilters.hideDuplicates`) activada, las ofertas cuyo `definitionId` ya está en el club se filtran antes de llegar al sniping. Desde la versión 27.2.1 ocurre lo mismo con las ofertas fuera del rango de OVR de `marketSearchFilters.playerRating`. Bulk Buy y Auto Snipe no se ven afectados al usar `disableOverrides: true`.

Defectos de la versión 27.2.1 de Paletools, portados tal cual por la actualización:

- Club Analyzer: la versión 27.2.1 eliminó `counters.rare` pero sigue contabilizando jugadores raros (`rareflag` 1) en él, por lo que el primer jugador raro del club que no sea de préstamo lanza un `TypeError` durante el análisis e impide que termine.
- Filtros de búsqueda del mercado: el transformador de resultados holográfico/OVR se ejecuta incluso con Paletools desactivado, y `handlePlayerIdChange` asigna `defId = []` en el controlador activo incluso cuando no es un controlador de filtros de mercado.
