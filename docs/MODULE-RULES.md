# Module rules

The build puts all modules in one shared scope, in the order of [`src/manifest.json`](../src/manifest.json), like the original bundle. That is why these rules exist. `npm run build` and `npm run check:modules` enforce them, and the build writes nothing while one is broken.

- Imports are named and point to a module of the manifest: `import { a, b } from "./file.js"`. Exports are declarations, such as `export function`, `export const`, `export let` or `export class`. No aliases (`as`), default exports, export lists, re-exports, namespace or side-effect imports.
- Anything a module uses must be declared in it, imported, or listed in [`src/external-globals.json`](../src/external-globals.json).
- Top-level names, including the names of imported resources, must be unique across the whole project.
- No import cycles, no unused imports or exports.
- Do not assign an imported variable (the only exceptions are `export let` bindings marked `@mutable` in their comment). Changing the properties of an exported object is fine.
- A module's top-level code runs in manifest order, so it must not read something declared by a module that comes later in the manifest, directly or through a function it calls.
- No `import.meta`, no top-level `await` or `this`.
- Other files can be imported as embedded resources: `.css`, `.txt` and `.js.txt` as text, `.svg`/`.png`/`.webp` as data URIs, `.gz` as base64 (`import styles from "./my-feature.css"`). They are embedded byte for byte.
- Changing the manifest order changes the initialization order of existing code: only do it on purpose.

The checks themselves are in [`scripts/check-modules.mjs`](../scripts/check-modules.mjs).
