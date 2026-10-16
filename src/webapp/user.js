/**
 * Persona helpers. `getGamePlatform()` maps the selected persona's flags to `GamePlatform` (PC,
 * PSN, XBL, SWI, STADIA, else NONE) for the external price code. `getSelectedPersona()` returns
 * `services.User.getUser()?.selectedPersona`, the id that scopes Paletools storage keys
 * (src/core/storage.js), hidden SBC set ids and the `userId` of the SBC template IndexedDB records.
 *
 * Invariants:
 * - `getSelectedPersona()` is falsy until the user is loaded; src/core/storage.js relies on that
 *   to skip reads and writes. `getGamePlatform()` has no such guard.
 */
export function getGamePlatform() {
  const selectedPersona = services.User.getUser().getSelectedPersona();
  return selectedPersona.isPC
    ? GamePlatform.PC
    : selectedPersona.isPlaystation
      ? GamePlatform.PSN
      : selectedPersona.isXbox
        ? GamePlatform.XBL
        : selectedPersona.isSwitch
          ? GamePlatform.SWI
          : selectedPersona.isStadia
            ? GamePlatform.STADIA
            : GamePlatform.NONE;
}

export function getSelectedPersona() {
  return services.User.getUser()?.selectedPersona;
}
