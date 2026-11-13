// @ts-check
/** @import { Position, PreferencePatch } from './types/domain' */
/** @import { SettingsMethod, SettingsRpc } from './types/messages' */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root.chrome && root.chrome.runtime) root.JptClient = api.createClient(root.chrome);
})(globalThis, /** @param {typeof globalThis} root */ function (root) {
  'use strict';
  const t = (/** @type {string} */ key) => (root.JptI18n || require('./i18n.js').forLocale()).t(key);
  /** @param {typeof globalThis.chrome} chrome */
  function createClient(chrome) {
    /**
     * @template {SettingsMethod} M
     * @param {M} method
     * @param {SettingsRpc[M]['args']} [args]
     * @returns {Promise<SettingsRpc[M]['reply']>}
     */
    async function request(method, args = /** @type {SettingsRpc[M]['args']} */ ({})) {
      // Whatever the worker sent (broker.handle); checked field by field below.
      /** @type {any} */
      let response;
      try {
        response = await chrome.runtime.sendMessage({ type: 'jpt:' + method, ...args });
      } catch {
        throw Object.assign(new Error(t('errDisconnected')), {
          code: 'disconnected',
        });
      }
      if (!response || typeof response.ok !== 'boolean')
        throw Object.assign(new Error(t('errNoResponse')), { code: 'disconnected' });
      if (!response.ok)
        throw Object.assign(new Error(response.message || t('errActionFailed')), {
          code: response.code || 'storage',
          errors: response.errors || [],
        });
      return response.value;
    }
    return Object.freeze({
      getContext: (/** @type {SettingsRpc['getContext']['args']} */ args = {}) => request('getContext', args),
      getAll: () => request('getAll'),
      importConfig: (/** @type {unknown} */ config, /** @type {{ replace?: boolean }} */ { replace = false } = {}) => request('importConfig', { config, replace }),
      savePreferences: (/** @type {PreferencePatch} */ patch) => request('savePreferences', { patch }),
      resetPreferences: () => request('resetPreferences'),
      savePosition: (/** @type {Position} */ position) => request('savePosition', { position }),
      removeSite: (/** @type {string} */ origin) => request('removeSite', { origin }),
      restoreConfig: () => request('restoreConfig'),
      exportConfig: () => request('exportConfig'),
      getDraft: () => request('getDraft'),
      saveDraft: (/** @type {unknown} */ config) => request('saveDraft', { config }),
      clearDraft: () => request('clearDraft'),
      refresh: () => request('refresh'),
      /** @param {() => void} callback */
      subscribe(callback) {
        const listener = (/** @type {unknown} */ message) => {
          if (message && typeof message === 'object' && /** @type {{ type?: unknown }} */ (message).type === 'jpt:settings-changed')
            callback();
        };
        chrome.runtime.onMessage.addListener(listener);
        return () => chrome.runtime.onMessage.removeListener(listener);
      },
    });
  }
  return { createClient };
});
