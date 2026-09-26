(function (root) {
  'use strict';
  class MemoryCache {
    constructor({ ttl = 300000, max = 200, clock = Date.now } = {}) {
      this.ttl = ttl;
      this.max = max;
      this.clock = clock;
      this.items = new Map();
    }
    purge() {
      const now = this.clock();
      for (const [k, v] of this.items) if (v.expires <= now) this.items.delete(k);
    }
    set(k, value, ttl = this.ttl) {
      this.purge();
      this.items.delete(k);
      this.items.set(k, { value, expires: this.clock() + ttl });
      while (this.items.size > this.max) this.items.delete(this.items.keys().next().value);
      return this;
    }
    get(k) {
      this.purge();
      const e = this.items.get(k);
      if (!e) return undefined;
      this.items.delete(k);
      this.items.set(k, e);
      return e.value;
    }
    has(k) {
      this.purge();
      return this.items.has(k);
    }
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
    *entries() {
      this.purge();
      for (const [k, e] of this.items) yield [k, e.value];
    }
    *values() {
      for (const [, v] of this.entries()) yield v;
    }
    [Symbol.iterator]() {
      return this.entries();
    }
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { MemoryCache };
  else root.JptCache = { MemoryCache };
})(globalThis);
