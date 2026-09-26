/* The worker persists settings only; never task data. */
importScripts('i18n.js', 'settings.js', 'settings_broker.js');
const broker = JptSettingsBroker.createBroker(chrome);
broker.init().catch(() => {});
const settingsMethods = new Set([
  'getContext',
  'getAll',
  'importConfig',
  'savePreferences',
  'resetPreferences',
  'savePosition',
  'removeSite',
  'restoreConfig',
  'exportConfig',
  'getDraft',
  'saveDraft',
  'clearDraft',
  'refresh',
]);
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (
    !message ||
    typeof message.type !== 'string' ||
    !message.type.startsWith('jpt:') ||
    !settingsMethods.has(message.type.slice(4))
  )
    return false;
  broker.handle(message, sender).then(sendResponse);
  return true;
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && Object.keys(changes).some((key) => key.startsWith('jpt:'))) {
    // Receivers re-read through the validator; synced values are never forwarded.
    broker.notify().catch(() => {});
  }
});
