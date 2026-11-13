// @ts-check
/* The worker persists settings only; never task data. */
importScripts('i18n.js', 'settings.js', 'settings_broker.js');
const broker = JptSettingsBroker.createBroker(chrome);
broker.init().catch(() => {});
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!JptSettingsBroker.accepts(message)) return false;
  broker.handle(message, sender).then(sendResponse);
  return true;
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && Object.keys(changes).some((key) => key.startsWith('jpt:'))) {
    // Receivers re-read through the validator; synced values are never forwarded.
    broker.notify().catch(() => {});
  }
});
