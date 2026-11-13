// @ts-check
(/** @param {typeof globalThis} root */ function (root) {
  'use strict';
  /** LRU map whose entries expire after `ttl` ms. @template K, V */
  class MemoryCache {
    /** @param {{ ttl?: number, max?: number, clock?: () => number }} [options] */
    constructor({ ttl = 300000, max = 200, clock = Date.now } = {}) {
      this.ttl = ttl;
      this.max = max;
      this.clock = clock;
      /** @type {Map<K, { value: V, expires: number }>} */
      this.items = new Map();
    }
    purge() {
      const now = this.clock();
      for (const [k, v] of this.items) if (v.expires <= now) this.items.delete(k);
    }
    /** @param {K} k @param {V} value @param {number} [ttl] */
    set(k, value, ttl = this.ttl) {
      this.purge();
      this.items.delete(k);
      this.items.set(k, { value, expires: this.clock() + ttl });
      while (this.items.size > this.max) this.items.delete(/** @type {K} */ (this.items.keys().next().value));
      return this;
    }
    /** @param {K} k @returns {V | undefined} */
    get(k) {
      this.purge();
      const e = this.items.get(k);
      if (!e) return undefined;
      this.items.delete(k);
      this.items.set(k, e);
      return e.value;
    }
    /** @param {K} k */
    has(k) {
      this.purge();
      return this.items.has(k);
    }
    /** @param {K} k */
    delete(k) {
      return this.items.delete(k);
    }
    clear() {
      this.items.clear();
    }
    get size() {
      this.purge();
      return this.items.size;
    }
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { MemoryCache };
  else root.JptCache = { MemoryCache };
})(globalThis);
