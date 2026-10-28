/**
 * `AddMultiplePlayersViewModel`, created for each opening by
 * add-multiple-players-to-squad/index.js: wraps the squad, SBC challenge and set, holds the
 * search source (`club` by default) and the `onSearch`, `onPlayerAdded` and `onPlayerRemoved`
 * observables used by the views and controller.
 *
 * Invariants:
 * - `getPlayers()` yields only non-brick slots.
 * - `addPlayer` ignores items already in the squad (returns undefined), fills the first non-brick
 *   invalid slot and returns true, or returns false when no slot is free; `removePlayer` removes
 *   a contained item. Both notify, then persist immediately with `services.SBC.saveChallenge` (or
 *   `squad.save()` when there is no challenge).
 *
 * Known issues (kept as-is):
 * - The "no free slot" observable (`#ce`) is notified but has no getter, so nothing can react.
 */
export class AddMultiplePlayersViewModel {
  #ae;
  #re;
  #oe;
  #le;
  #ce;
  #ue;
  #pe;
  #X;
  constructor(squad, sbcChallenge, sbcSet) {
    this.#X = sbcSet;
    this.#ae = squad;
    this.#re = sbcChallenge;
    this.#oe = new EAObservable();
    this.#le = new EAObservable();
    this.#ce = new EAObservable();
    this.#ue = "club";
    this.#pe = new EAObservable();
  }
  get ["onSearch"]() {
    return this.#pe;
  }
  get ["squad"]() {
    return this.#ae;
  }
  get ["sbcChallenge"]() {
    return this.#re;
  }
  get ["set"]() {
    return this.#X;
  }
  get ["searchType"]() {
    return this.#ue;
  }
  set ["searchType"](searchType) {
    this.#ue = searchType;
  }
  get ["onPlayerAdded"]() {
    return this.#oe;
  }
  get ["onPlayerRemoved"]() {
    return this.#le;
  }
  *["getPlayers"]() {
    for (let slot of this.#ae.getPlayers()) {
      if (!slot.isBrick()) {
        yield slot;
      }
    }
  }
  ["removePlayer"](item) {
    if (this.#ae.containsItem(item)) {
      this.#ae.removeItem(item);
      this.#le.notify(item);
      if (this.#re) {
        services.SBC.saveChallenge(this.#re);
      } else {
        this.#ae.save();
      }
    }
  }
  ["addPlayer"](item) {
    if (this.#ae.containsItem(item)) {
      return;
    }
    const emptySlot = this.#ae.getPlayers().find((slot) => !slot.isBrick() && !slot.isValid());
    if (emptySlot) {
      this.#ae.addItemToSlot(emptySlot.getIndex(), item);
      this.#oe.notify(item);
      if (this.#re) {
        services.SBC.saveChallenge(this.#re);
      } else {
        this.#ae.save();
      }
      return true;
    } else {
      this.#ce.notify();
      return false;
    }
  }
}
