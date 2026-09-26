'use strict';
// Legacy entry point: translate the fallback text, then go straight to the settings page.
globalThis.JptI18n?.apply(document);
location.replace(chrome.runtime.getURL('options.html'));
