// Message lookup shared by extension pages, content scripts, the service worker and Node tests.
// Texts live in _locales/<locale>/messages.json; "{name}" placeholders are filled in by t().
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.JptI18n = api.fromChrome(root.chrome);
})(globalThis, function () {
  'use strict';
  const PLACEHOLDER = /\{(\w+)\}/g;

  function create(lookup) {
    function t(key, params) {
      const message = lookup(key);
      if (!message) return key;
      if (!params) return message;
      return message.replace(PLACEHOLDER, (match, name) =>
        Object.hasOwn(params, name) ? String(params[name]) : match,
      );
    }
    function apply(doc) {
      const tag = lookup('localeTag');
      if (tag && doc.documentElement) doc.documentElement.lang = tag;
      doc.querySelectorAll('[data-i18n]').forEach((element) => {
        element.textContent = t(element.getAttribute('data-i18n'));
      });
      doc.querySelectorAll('[data-i18n-attr]').forEach((element) => {
        for (const pair of element.getAttribute('data-i18n-attr').split(';')) {
          const [attribute, key] = pair.split(':').map((part) => part.trim());
          if (attribute && key) element.setAttribute(attribute, t(key));
        }
      });
    }
    return Object.freeze({ t, apply });
  }

  function fromChrome(chrome) {
    return create((key) => chrome?.i18n?.getMessage(key) || '');
  }

  function fromMessages(messages) {
    return create((key) => (Object.hasOwn(messages, key) ? messages[key].message : ''));
  }

  // Node only: tests read the bundled message files directly.
  function forLocale(locale = 'en') {
    return fromMessages(require('./_locales/' + locale + '/messages.json'));
  }

  return Object.freeze({ create, fromChrome, fromMessages, forLocale });
});
