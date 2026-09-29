'use strict';
JptI18n.apply(document);
const t = JptI18n.t;
const $ = (id) => document.getElementById(id);
const controls = {
  ptColorEnabled: 'pt-color-enabled',
  ptColor: 'pt-color',
  msColorEnabled: 'ms-color-enabled',
  msColor: 'ms-color',
  msDiamond: 'ms-diamond',
  msShowProgress: 'ms-show-progress',
  ptTargetEndShade: 'pt-target-end-shade',
  ptLockDrag: 'pt-lock-drag',
  epicStripe: 'epic-stripe',
  epicLockDrag: 'epic-lock-drag',
  hideCurrentMonth: 'hide-current-month',
  hideIssueKey: 'hide-issue-key',
  showWeekends: 'show-weekends',
  showHolidays: 'show-holidays',
  showWorkingDays: 'show-working-days',
};
let tabContext = {};
let loading = false;
function notice(text, error = false) {
  $('status').textContent = text;
  $('status').classList.add('show');
  $('status').classList.toggle('error', error);
}
async function load() {
  loading = true;
  try {
    const tab = (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
    tabContext = {};
    // What the Timeline tab actually uses: the project property may replace the imported file.
    let page = null;
    if (tab?.url && JptSettings.normalizeOrigin(new URL(tab.url).origin)) {
      const url = new URL(tab.url);
      tabContext.origin = url.origin;
      const match = url.pathname.match(/\/projects\/(\d+)(?:\/|$)/);
      if (match) tabContext.projectId = match[1];
      try {
        page = await chrome.tabs.sendMessage(tab.id, { type: 'jpt:context' }, { frameId: 0 });
        if (JptSettings.isProjectId(page?.projectId)) tabContext.projectId = page.projectId;
      } catch (_) {}
    }
    const context = await JptClient.getContext(tabContext);
    const fromProperty = page?.source === 'property';
    // Project defaults come from the page; personal preferences always come from storage (never stale).
    const cfg =
      fromProperty && page.profileSettings
        ? JptSettings.effectiveSettings({ settings: page.profileSettings }, context.preferences || {})
        : context.settings || JptSettings.DEFAULTS;
    for (const [key, id] of Object.entries(controls)) {
      if ($(id).type === 'checkbox') $(id).checked = !!cfg[key];
      else {
        $(id).value = cfg[key];
        $(id + '-text').value = cfg[key];
      }
    }
    const source = JptUI.sourceText(page);
    $('config-source').hidden = !source;
    $('config-source').textContent = source;
    // Project-managed settings need no import: hide the button (still reachable from the extension's Options menu).
    $('manage-settings').hidden = fromProperty;
    $('managed-note').hidden = !fromProperty;
    $('managed-note').textContent = fromProperty
      ? t('popupManagedByProject') + (context.configured ? ' ' + t('popupFileOverridden') : '')
      : '';
    $('calendar-status').textContent = page?.source ? JptUI.calendarSummary(page.years) : '';
    if (context.configured || fromProperty) {
      const status = await JptUI.tabStatus(chrome, false);
      if (['partial', 'login', 'unavailable', 'needs-config'].includes(status.state)) JptUI.renderStatus(status);
      else {
        $('runtime-title').textContent =
          status.state === 'disabled' ? t('statusDisabledTitle') : fromProperty ? t('statusProjectReady') : t('statusSiteSaved');
        $('runtime-message').textContent = tabContext.origin || '';
        $('runtime-details').parentElement.hidden = true;
      }
    } else if (tabContext.origin)
      JptUI.renderStatus({ state: 'needs-config', message: t('popupImportPrompt'), details: [] });
    else {
      $('runtime-title').textContent = t('popupDefaultTitle');
      $('runtime-message').textContent = t('popupDefaultMessage');
    }
  } catch (_) {
    notice(t('settingsLoadFailed'), true);
  } finally {
    loading = false;
  }
}
async function save(key, value) {
  if (loading) return;
  try {
    await JptClient.savePreferences({ [key]: value });
    notice(t('saved'));
  } catch (_) {
    notice(t('saveFailed'), true);
  }
}
for (const [key, id] of Object.entries(controls)) {
  const input = $(id);
  if (input.type === 'checkbox') input.addEventListener('change', () => save(key, input.checked));
  else {
    input.addEventListener('input', () => {
      $(id + '-text').value = input.value;
    });
    input.addEventListener('change', () => save(key, input.value));
    $(id + '-text').addEventListener('change', () => {
      const value = $(id + '-text').value.trim();
      if (!/^#[\da-f]{6}$/i.test(value)) {
        $(id + '-text').setAttribute('aria-invalid', 'true');
        notice(t('invalidColor'), true);
        return;
      }
      $(id + '-text').removeAttribute('aria-invalid');
      input.value = value;
      save(key, value);
    });
  }
}
$('reset').addEventListener('click', async () => {
  try {
    await JptClient.resetPreferences();
    await load();
    notice(t('preferencesReset'));
  } catch (_) {
    notice(t('resetFailed'), true);
  }
});
$('manage-settings').addEventListener('click', () => chrome.runtime.openOptionsPage());
JptClient.subscribe(() => load());
load();
