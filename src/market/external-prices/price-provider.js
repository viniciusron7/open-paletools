/**
 * Base types for src/market/external-prices/index.js. `ExternalItemPrice` is an immutable record
 * (private fields; getters `definitionId`, `price`, `platform`, `isExtinct`, `isObjective`,
 * `isSbc`). `ExternalPriceProvider` is abstract: constructing it directly throws "PriceProvider is
 * abstract"; subclasses implement `init(platform)` (default no-op) and
 * `getItemPrices(items, platform)` (default throws).
 *
 * Invariants:
 * - `ExternalItemPrice` instances are cached and shared between callers, so they must stay
 *   read-only.
 */
export class ExternalItemPrice {
  #h;
  #m;
  #b;
  #y;
  #f;
  #v;
  constructor(
    definitionId,
    price,
    platform,
    isExtinct = false,
    isObjective = false,
    isSbc = false,
  ) {
    this.#h = definitionId;
    this.#m = price;
    this.#b = platform;
    this.#y = isExtinct;
    this.#f = isObjective;
    this.#v = isSbc;
  }
  get ["definitionId"]() {
    return this.#h;
  }
  get ["price"]() {
    return this.#m;
  }
  get ["platform"]() {
    return this.#b;
  }
  get ["isExtinct"]() {
    return this.#y;
  }
  get ["isObjective"]() {
    return this.#f;
  }
  get ["isSbc"]() {
    return this.#v;
  }
}

export class ExternalPriceProvider {
  constructor() {
    if (this.constructor === ExternalPriceProvider) {
      throw new Error("PriceProvider is abstract");
    }
  }
  async ["init"](platform) {}
  async ["getItemPrices"](requestedItems, platform) {
    throw new Error("Method 'getItemPrices' must be implemented");
  }
}
