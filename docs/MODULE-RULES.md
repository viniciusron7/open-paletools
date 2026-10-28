# Module rules

English | [Português (Brasil)](pt-BR/MODULE-RULES.md) | [Español](es/MODULE-RULES.md)

The build places all modules into a single shared scope in the order defined by [`src/manifest.json`](../src/manifest.json), matching the original bundle. `npm run build` and `npm run check:modules` enforce these rules before writing any output.

- Imports must be named and point to a module listed in the manifest: `import { a, b } from "./file.js"`. Exports must be direct declarations (`export function`, `export const`, `export let` or `export class`). Aliases (`as`), default exports, export lists, re-exports, namespace imports (`* as`) and side-effect-only imports are not allowed.
- Every identifier used by a module must be declared locally, imported from another module or listed in [`src/external-globals.json`](../src/external-globals.json).
- Top-level names, including imported resource identifiers, must be unique across the entire project.
- Import cycles and unused imports or exports are not allowed.
- Imported variables must not be reassigned (except `export let` bindings marked with `@mutable` in their comment). Mutating properties of an exported object is allowed.
- A module's top-level code executes in manifest order and must not read variables, constants or classes declared in modules listed later in the manifest, either directly or through functions called during initialization.
- Do not use `import.meta`, top-level `await` or top-level `this`.
- Static files can be imported as embedded resources: `.css`, `.txt` and `.js.txt` as text, `.svg`/`.png`/`.webp` as data URIs and `.gz` as base64 (`import styles from "./my-feature.css"`). They are embedded byte for byte.
- Changing the order of `src/manifest.json` changes the initialization order of existing code: preserve the sequence unless the change is intentional.

The checks are implemented in [`scripts/check-modules.mjs`](../scripts/check-modules.mjs).
