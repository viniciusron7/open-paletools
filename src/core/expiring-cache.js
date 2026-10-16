/**
 * In-memory key/value cache with optional expiry per entry (`ExpiringCache`; entries are the
 * private `ExpiringCacheEntry`). Used by the lowest-price cache, the FUT.GG and external-price
 * caches and the unassigned-count and what's-new plugins.
 *
 * Invariants:
 * - The constructor TTL is in seconds (added with `setSeconds`) and applies only to entries
 *   without their own expiration; without a TTL entries never expire. Callers pass 300, 3600
 *   and 300000 (about 83 hours).
 * - Expired entries are purged lazily at the start of every accessor (`keys`, `isEmpty`, `all`,
 *   `set`, `get`, `remove`); there is no timer.
 * - `set(key, data[, expirationDate])`; `get` returns null for a missing or expired key.
 *
 * Known issues (kept as-is):
 * - `set` with one argument that is not an `ExpiringCacheEntry` dereferences null (TypeError).
 */
class ExpiringCacheEntry {
  #t;
  #i;
  #n;
  constructor(cacheKey, cachedData, expirationDateUtc) {
    this.#t = cacheKey;
    this.#i = cachedData;
    this.#n = expirationDateUtc;
  }
  get ["key"]() {
    return this.#t;
  }
  get ["data"]() {
    return this.#i;
  }
  get ["expirationDateUtc"]() {
    return this.#n;
  }
  set ["expirationDateUtc"](expirationDateUtc) {
    this.#n = expirationDateUtc;
  }
  get ["isExpired"]() {
    return !!this.#n && new Date() > this.#n;
  }
}

export class ExpiringCache {
  #s = {};
  #a;
  constructor(ttlSeconds) {
    this.#a = ttlSeconds;
  }
  get ["keys"]() {
    this.#r();
    return Object.keys(this.#s);
  }
  ["isEmpty"]() {
    this.#r();
    return Object.keys(this.#s).length === 0;
  }
  ["all"]() {
    this.#r();
    return Object.values(this.#s).map((cacheEntry) => cacheEntry.data);
  }
  ["set"](...entryArguments) {
    if (entryArguments.length === 0) {
      return;
    }
    let cacheEntry = null;
    if (entryArguments[0] instanceof ExpiringCacheEntry) {
      cacheEntry = entryArguments[0];
    } else if (entryArguments.length === 2) {
      cacheEntry = new ExpiringCacheEntry(entryArguments[0], entryArguments[1]);
    } else if (entryArguments.length > 2) {
      cacheEntry = new ExpiringCacheEntry(entryArguments[0], entryArguments[1], entryArguments[2]);
    }
    this.#r();
    if (!cacheEntry.expirationDateUtc && this.#a) {
      const expirationDateUtc = new Date();
      expirationDateUtc.setSeconds(expirationDateUtc.getSeconds() + this.#a);
      cacheEntry.expirationDateUtc = expirationDateUtc;
    }
    this.#s[cacheEntry.key] = cacheEntry;
  }
  ["get"](cacheKey) {
    this.#r();
    return this.#s[cacheKey] ? this.#s[cacheKey].data : null;
  }
  ["remove"](cacheKey) {
    this.#r();
    if (this.#s[cacheKey]) {
      delete this.#s[cacheKey];
    }
  }
  #r() {
    for (let cacheEntry of Object.values(this.#s)) {
      if (cacheEntry.isExpired) {
        delete this.#s[cacheEntry.key];
      }
    }
  }
}
