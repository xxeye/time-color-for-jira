(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root.chrome && root.chrome.runtime) root.JptClient = api.createClient(root.chrome);
})(globalThis, function (root) {
  'use strict';
  const t = (key) => (root.JptI18n || require('./i18n.js').forLocale()).t(key);
  function createClient(chrome) {
    async function request(method, args = {}) {
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
      getContext: (args = {}) => request('getContext', args),
      getAll: () => request('getAll'),
      importConfig: (config, { replace = false } = {}) => request('importConfig', { config, replace }),
      savePreferences: (patch) => request('savePreferences', { patch }),
      resetPreferences: () => request('resetPreferences'),
      savePosition: (position) => request('savePosition', { position }),
      removeSite: (origin) => request('removeSite', { origin }),
      restoreConfig: () => request('restoreConfig'),
      exportConfig: () => request('exportConfig'),
      getDraft: () => request('getDraft'),
      saveDraft: (config) => request('saveDraft', { config }),
      clearDraft: () => request('clearDraft'),
      refresh: () => request('refresh'),
      subscribe(callback) {
        const listener = (message) => {
          if (message && message.type === 'jpt:settings-changed') callback();
        };
        chrome.runtime.onMessage.addListener(listener);
        return () => chrome.runtime.onMessage.removeListener(listener);
      },
    });
  }
  return { createClient };
});
