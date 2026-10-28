# Actualización

[English](../UPDATING.md) | [Português](../pt/UPDATING.md) | Español

Existen dos tipos de actualización:

- **Nueva versión oficial de Paletools** (publicada por Paleta en `https://pale.tools/fifa/dist/latest/paletools.user.js`): portar los cambios a `src/` con las herramientas upstream descritas a continuación.
- **Nueva versión de este proyecto** (nuevos commits en el repositorio): `git pull`, consultar [Obtención de una nueva versión de este proyecto](#obtención-de-una-nueva-versión-de-este-proyecto).

## Nueva versión oficial de Paletools

`src/` sigue una versión oficial concreta, su **base**: `upstream/base.user.js` contiene esa versión exactamente como fue publicada, byte por byte, y `upstream/base.json` registra su número de versión. Cuando Paletools publica una versión más reciente, las herramientas de actualización portan cada cambio a `src/`, conservan todas las modificaciones de este proyecto (Player Snipe, Bulk Buy, plugins en `src/custom-plugins.js` y ediciones en módulos integrados) y verifican la equivalencia estructural del resultado.

### Con Claude Code (recomendado)

Ejecutar `/update-paletools` en Claude Code dentro de la carpeta del proyecto. El comando ejecuta las herramientas descritas abajo, resuelve los conflictos pendientes, mueve el código nuevo de la versión a módulos apropiados con nombres descriptivos y comentarios, ejecuta todas las comprobaciones y resume los cambios. Es necesario hacer commit del trabajo local antes de comenzar (incluido `upstream/`): la actualización rechaza ejecutarse mientras los archivos que modifica (`src/`, `upstream/`, `package.json`, `package-lock.json`, `README.md`, `tests/userscript/`) tengan cambios sin confirmar, garantizando que `git diff` muestre únicamente lo modificado por el port.

### Desde la línea de comandos

```sh
npm run upstream:check     # comprueba si hay una versión más reciente (-- --exit-code devuelve 10 cuando la hay)
npm run upstream:update    # porta la última versión a src/
npm run upstream:verify    # comprueba src/ contra el resultado esperado (ejecutar tras cada edición)
```

`npm run upstream:update` imprime un resumen y escribe `.upstream/<versión>/report.md`. Cuando termina con "done", el port está completo y verificado: la nueva versión pasa a ser la base y el snapshot de arranque se vuelve a registrar. Cuando termina con "ported, with work left" (código de salida 2: conflictos, errores de reglas de módulos, diferencias, cambios en el runtime de webpack u otros problemas), el informe lista las tareas pendientes: resolverlas, ejecutar `npm run upstream:verify` hasta obtener "equivalent" y luego `npm run upstream:verify -- --finish` para registrar la nueva base (añadir `--conflicts-resolved` cuando el port haya tenido conflictos, tras revisar cada uno de ellos). Hasta entonces, `npm run upstream:update` impide iniciar otro port.

El código nuevo añadido por la versión oficial llega con los identificadores originales (`_0x...`), y los bloques nuevos grandes se ubican en módulos nuevos bajo `src/upstream-new/<versión>/`. El userscript ya se comporta exactamente igual que la versión oficial; renombrar y mover ese código a módulos definitivos tiene como fin mantener la legibilidad (proceso automatizado por `/update-paletools`; para realizarlo manualmente, seguir los pasos de la sección 3 de [.claude/skills/update-paletools/SKILL.md](../../.claude/skills/update-paletools/SKILL.md)). Por último, ejecutar `npm run verify`, `npm run build` e instalar el nuevo `dist/paletools.user.js`.

Opciones de `npm run upstream:update -- <opciones>` (el `--` es necesario para pasar las opciones al script). Las opciones desconocidas se rechazan (código de salida 64).

| Opción          | Efecto                                                                                              |
| --------------- | --------------------------------------------------------------------------------------------------- |
| `--file <ruta>` | Porta un archivo de versión descargado localmente en lugar de descargar la más reciente por red.    |
| `--url <url>`   | Descarga la versión desde otra dirección.                                                           |
| `--dry-run`     | Calcula el port y escribe el informe en `.upstream/<versión>/dry-run/`, sin modificar el proyecto.  |
| `--force`       | Ejecuta el port incluso si la versión no es más reciente que la base o si hay un port sin terminar. |
| `--allow-dirty` | Permite ejecutar con cambios sin confirmar en `src/` (perdiendo un `git diff` limpio del port).     |

`npm run upstream:status` lista todos los puntos donde `src/` difiere de su versión base: las modificaciones propias de este proyecto.

### Funcionamiento del port

1. La base y la nueva versión se desofuscan (`scripts/upstream/deobfuscate.mjs`): la tabla de cadenas se decodifica estáticamente (sin ejecutar nada de la versión), y los números hexadecimales, `!0`/`!1` y accesos `obj["nombre"]` se normalizan. Todo Paletools vive en un único módulo webpack de la versión oficial, cuyo id e identificadores (`_0x...`) cambian en cada lanzamiento.
2. Se compila `src/` y los tres programas (base, nueva versión y build de `src/`) se alinean instrucción por instrucción (`scripts/upstream/lib/align.mjs`). La comparación ignora nombres y construcciones del minificador (`a && b()` equivale a `if (a) b();`), asociando automáticamente cada identificador `_0x...` con el nombre correspondiente en `src/`.
3. Una fusión de tres vías (`scripts/upstream/lib/merge.mjs`) aplica los cambios de la nueva versión (con respecto a la base) al build de `src/`, llegando hasta expresiones individuales, elementos de listas y propiedades de objetos. Donde la versión oficial y este proyecto modificaron el mismo código de forma incompatible, se registra un **conflicto** y se conserva la versión de este proyecto en ese punto (aplicando el resto de los cambios alrededor).
4. El resultado se escribe en los módulos de `src/` (`scripts/upstream/lib/apply-src.mjs`): el código modificado se parchea localmente conservando nombres, comentarios y formato; el código nuevo se emite con los nombres de `src/` para los enlaces existentes; el CSS, las imágenes y los archivos de datos modificados se actualizan; los cambios de traducción van a `src/i18n/`; las instrucciones se colocan según el orden de evaluación de la versión oficial (un bloque nuevo grande genera un módulo nuevo listado en esa posición en `src/manifest.json`; un módulo reordenado por la versión se mueve en el manifiesto); las funciones nuevas se asignan al módulo que requiere menos imports adicionales sin crear ciclos. A continuación, se ajustan imports y exports (`scripts/upstream/lib/fix-links.mjs`), se añaden nuevas variables globales de la Web App a `src/external-globals.json`, se actualiza la versión en todos los archivos correspondientes, se añaden nuevas líneas de metadatos (p. ej., `@connect`) a `src/userscript-header.js` y se formatea el código.
5. **Verificación.** La misma fusión, aplicada en sentido inverso (los cambios de este proyecto sobre la nueva versión oficial), produce el programa esperado. El build de `src/` debe ser estructuralmente equivalente a él (`scripts/upstream/lib/equivalence.mjs`: mismas instrucciones en el mismo orden, mismos operadores, propiedades y literales, renombrado consistente de enlaces, permitiendo el movimiento de declaraciones de función). En los conflictos, el programa esperado también conserva la versión de este proyecto para evitar falsos fallos.
6. Cuando el build es equivalente y no quedan tareas pendientes (sin conflictos, errores de reglas de módulos ni cambios en el runtime de webpack), la nueva versión se registra como base y el snapshot de arranque (`tests/userscript/boot-fingerprint.snapshot.json`) se actualiza automáticamente.

### Alcance de la verificación

- Demuestra que el build de `src/` equivale a la nueva versión oficial más los cambios de este proyecto, instrucción por instrucción, excepto en las instrucciones de nivel superior que contienen un conflicto: estas quedan fuera de la comparación automática y son listadas por `npm run upstream:verify` para su revisión manual.
- El código fuera del módulo principal de Paletools (el runtime de webpack) también se compara; si la versión oficial lo modificó, el informe indica que debe portarse manualmente a `src/runtime/webpack-runtime.js`.
- Al igual que el resto de las pruebas, la verificación nunca ejecuta el script en la Web App real.
- Los defectos presentes en la versión oficial se portan tal cual, de forma intencionada, y se documentan en [Invariantes](INVARIANTS.md).

### Código personalizado

- Los plugins listados en `src/custom-plugins.js` y los módulos exclusivos de este proyecto no son modificados por el port. Si la versión oficial elimina una función o un valor integrado utilizado por un módulo personalizado, la actualización lo conserva y reporta un conflicto `"removed-but-used"`. Mantener las funcionalidades propias en módulos aislados (según [Adición de funcionalidades](ADDING-A-FEATURE.md)) garantiza su conservación en cada actualización.
- Las ediciones realizadas sobre módulos integrados se conservan; si la versión oficial modifica el mismo fragmento, se genera un conflicto en el informe mostrando la base, el código local y la nueva versión.
- Los ajustes, las claves de `localStorage` y las claves de traducción no se renombran en una actualización.

### Archivos utilizados

| Ruta                         | Descripción                                                                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `upstream/base.user.js`      | Versión oficial que sigue `src/` (confirmada en git y reemplazada en cada actualización completada).                                              |
| `upstream/base.json`         | Número de versión y hash SHA-256 de la base actual.                                                                                               |
| `.upstream/<versión>/`       | Archivos temporales de trabajo de un port (no confirmados en git): versiones desofuscadas, programa esperado, build previo, `report.md` y estado. |
| `src/upstream-new/<versión>` | Código nuevo de una versión oficial pendiente de ser organizado en módulos definitivos.                                                           |

### Solución de problemas

- **"src/ has uncommitted changes"**: hacer commit o guardar los cambios en el stash (`git stash`) antes de volver a ejecutar la actualización.
- **Revertir un port**: `git restore -- src upstream tests/userscript package.json package-lock.json README.md` restaura los archivos confirmados; `git clean -fd src` elimina los archivos creados por el port (ejecutar antes `git clean -nd src` para revisar la lista). Eliminar también `.upstream/<versión>/`.
- **"the port to ... is not finished"**: finalizarlo con `npm run upstream:verify -- --finish` o revertirlo como se indica arriba.
- **"upstream/base.user.js is not the release recorded"**: se modificó la base; restaurarla con `git restore upstream`.
- **Fallo en la descarga**: descargar la versión manualmente y usar `--file <ruta>`.
- **`upstream:verify` reporta diferencias tras ediciones manuales**: alguna edición alteró el comportamiento o el orden de evaluación. El mensaje muestra la instrucción divergente en el programa esperado y en el build actual, junto con su módulo.

## Obtención de una nueva versión de este proyecto

```sh
git pull
npm ci          # necesario únicamente cuando cambia package-lock.json
npm run build
```

A continuación, actualizar el contenido del script en Tampermonkey con el nuevo `dist/paletools.user.js`.

El script generado no incluye `@updateURL` ni `@downloadURL`, por lo que Tampermonkey nunca reemplaza el build local automáticamente.

## Coexistencia con el Paletools oficial

- El metadato `@name` está definido como `open-paletools` (diferente del `Paletools` oficial), lo que permite a Tampermonkey mantenerlos como dos scripts independientes. Si se cambia el nombre en [`src/userscript-header.js`](../../src/userscript-header.js), mantener un identificador distinto del oficial.
- Mantener desactivado el Paletools oficial mientras se utilice este script para evitar duplicación de botones y hooks.
- Ambos comparten la misma configuración guardada en la entrada `paletools:settings` del `localStorage` de la Web App (consultar [Configuración predeterminada](SETTINGS.md)).
- El aviso de actualización dentro de la Web App (plugin Check for Updates) hace referencia al lanzamiento oficial en `pale.tools`: instalar desde ese aviso instalará el script oficial, sirviendo únicamente como notificación de que existe una nueva versión lista para ser portada mediante `/update-paletools` o `npm run upstream:update`.
