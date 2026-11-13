// @ts-check
/** @import { PageProvider, PageState } from './types/runtime' */
// The only interface between the page runtime (timeline_color.js) and the toolbar (floating_toolbar.js).
// The toolbar starts first, so the bridge exists before the runtime provides itself; until then read()
// returns null, which means "not known yet", not "not configured".
//   provide({ read, refresh }) → undo   runtime: read() → { projectId, configured, enabled }; refresh() → { delivered }
//   read()        toolbar: current page state, or null
//   refresh()     toolbar: ask the runtime to reload; null when no runtime is present (fall back to the worker)
//   notify()      runtime: this page finished loading its settings
//   subscribe(fn) → undo   toolbar: called after each notify()
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.JptPage = api.create();
})(globalThis, function () {
  'use strict';
  function create() {
    /** @type {PageProvider | null} */
    let provider = null;
    /** @type {Set<() => void>} */
    const listeners = new Set();
    return Object.freeze({
      /** @param {PageProvider} next @returns {() => void} */
      provide(next) {
        provider = next;
        return () => {
          if (provider === next) provider = null;
        };
      },
      /** @returns {PageState | null} */
      read() {
        try {
          return provider?.read() || null;
        } catch {
          return null;
        }
      },
      /** @returns {Promise<{ delivered: number }> | null} */
      refresh() {
        return provider?.refresh ? provider.refresh() : null;
      },
      notify() {
        for (const fn of [...listeners])
          try {
            fn();
          } catch {}
      },
      /** @param {() => void} fn */
      subscribe(fn) {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
    });
  }
  return { create };
});
