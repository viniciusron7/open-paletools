# Tests

English | [Português (Brasil)](pt-BR/TESTING.md) | [Español](es/TESTING.md)

`npm test` builds a temporary test copy of the userscript (without modifying `dist/` or incrementing the [build number](BUILD.md#version-and-build-number)) and runs:

- `tests/*.test.cjs`: Player Snipe, Bulk Buy and Web App integration tests using fake objects, executed against both `src/` and the generated userscript.
- `tests/userscript/boot.test.mjs`: runs the complete userscript in a simulated Web App (no network access and no EA account) and compares every call, hook, listener, stylesheet and request during startup against `tests/userscript/boot-fingerprint.snapshot.json`.
- `tests/tooling/`: tests for the build, module checks and upstream update tools (deobfuscator, release utilities, equivalence checker and merge engine). Some upstream tests use local releases in `versoes_paletools/` when that folder exists, and are skipped otherwise.

## Boot snapshot

Any change to what the script executes during startup (a new or modified plugin, hook or stylesheet) causes the boot test to fail. When the change is intentional:

1. Run `npm run update:boot-snapshot`.
2. Review the diff of `tests/userscript/boot-fingerprint.snapshot.json`. A new plugin should only add lines; changes or shifts in existing lines indicate side effects on other code.
3. Commit the updated snapshot file along with the code changes.

The snapshot verifies startup consistency rather than functional correctness in the live Web App.

An upstream update re-records the snapshot automatically upon completion (`npm run upstream:update` when no manual steps remain, or `npm run upstream:verify -- --finish`).

The tests never connect to the live Web App or an EA account. Known defects inherited from the original script are preserved intentionally and documented in module headers and in [Invariants](INVARIANTS.md).
