# Tests

`npm test` builds a test copy of the userscript in a temporary file (it changes neither `dist/` nor the [build number](BUILD.md#version-and-build-number)), then runs:

- `tests/*.test.cjs`: Player snipe, Bulk Buy and their integration with the Web App, using fake objects. They run against `src/` and against the generated userscript.
- `tests/userscript/boot.test.mjs`: runs the whole userscript in a simulated Web App (no network, no EA account) and compares every call, hook, listener, stylesheet and request of the start-up with `tests/userscript/boot-fingerprint.snapshot.json`.
- `tests/tooling/`: the build and the module checks.

## The boot snapshot

Any change to what the script does while starting (a new or changed plugin, hook or stylesheet) makes the boot test fail. When the change is intended:

1. Run `npm run update:boot-snapshot`.
2. Review the diff of `tests/userscript/boot-fingerprint.snapshot.json`. A new plugin should only add lines; an existing line that changes or moves means your change also affects other code.
3. Commit the snapshot with your change.

The snapshot records what the script does, not whether it is right, so also try your changes in the Web App.

The tests never reach the real Web App or an EA account. Known defects of the original script were kept on purpose; they are listed in the module comments and in [Invariants](INVARIANTS.md).
