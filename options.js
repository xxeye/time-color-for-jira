// @ts-check
/** @import { Config, Profile } from './types/domain' */
'use strict';
JptI18n.apply(document);
const t = JptI18n.t;
const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const $input = (/** @type {string} */ id) => /** @type {HTMLInputElement} */ ($(id));
const $button = (/** @type {string} */ id) => /** @type {HTMLButtonElement} */ ($(id));
/** @type {Config | null} */
let draft = null,
  importing = false;
/** @param {string} message */
function notice(message, error = false) {
  $('notice').textContent = message;
  $('notice').classList.toggle('error', error);
  if (error) $('notice').focus();
}
/** @param {unknown} thrown */
function errorMessage(thrown) {
  const e = /** @type {{ code?: unknown, message?: string } | null | undefined} */ (thrown);
  return e?.code === 'invalid'
    ? t('errInvalidConfigFile')
    : e?.code === 'missing'
      ? t('errNothingToRestore')
      : e?.message || t('errActionIncomplete');
}
/** @param {HTMLButtonElement} button @param {() => Promise<void>} task */
async function run(button, task) {
  button.disabled = true;
  try {
    await task();
  } catch (e) {
    notice(errorMessage(e), true);
  } finally {
    button.disabled = false;
    // 對話框關閉時瀏覽器要把焦點還給按鈕，但按鈕當下是停用的，焦點會掉到 body；等按鈕恢復再補回。
    const active = document.activeElement;
    if ((!active || active === document.body) && button.isConnected !== false) button.focus();
  }
}
// 取代 window.confirm：原生 <dialog> 的 showModal()，預設焦點在取消；只有按下確認鈕才算同意（Esc、取消都不算）。
/** @param {string} message @param {string} actionLabel @returns {Promise<boolean>} */
function ask(message, actionLabel) {
  const dialog = /** @type {HTMLDialogElement} */ ($('confirm-dialog'));
  if (dialog.open) return Promise.resolve(false);
  $('confirm-message').textContent = message;
  $('confirm-ok').textContent = actionLabel;
  dialog.returnValue = '';
  return new Promise((resolve) => {
    dialog.addEventListener(
      'close',
      () => {
        const ok = dialog.returnValue === 'ok';
        dialog.returnValue = '';
        resolve(ok);
      },
      { once: true },
    );
    dialog.showModal();
  });
}
/** @param {Config} config */
function scopes(config) {
  return Object.entries(config.sites).flatMap(([origin, site]) => [
    ...(site.defaults ? [{ origin, project: '', profile: site.defaults }] : []),
    ...Object.entries(site.projects).map(([project, profile]) => ({ origin, project, profile })),
  ]);
}
/** @param {Profile} profile */
function features(profile) {
  const settings = JptSettings.effectiveSettings(profile, {}),
    names = [];
  if (profile.issueTypes.planning.length) names.push(t('featurePlanning'));
  if (profile.issueTypes.milestone.length) names.push(t('featureMilestone'));
  if (profile.issueTypes.epic.length) names.push(t('featureEpic'));
  if (profile.issueTypes.milestone.length && profile.progress.enabled && settings.msShowProgress)
    names.push(t('featureProgress'));
  if (settings.showWorkingDays) names.push(t('featureWorkingDays'));
  return names.join(t('listSeparator')) || t('featureDefault');
}
/** @param {{ origin: string, project: string, profile: Profile }} item */
function scopeRow(item) {
  const row = document.createElement('div');
  row.className = 'scope-row';
  const heading = document.createElement('strong');
  heading.textContent = item.project ? t('scopeProject', { id: item.project }) : t('scopeSiteDefault');
  row.append(heading);
  const summary = document.createElement('p');
  summary.textContent = t('scopeSummary', { features: features(item.profile), revision: item.profile.revision });
  row.append(summary);
  const calendar = document.createElement('p');
  calendar.className = 'scope-origin';
  calendar.textContent = JptUI.calendarSummary(JptCalendar.dayInfo(item.profile.calendar).years);
  row.append(calendar);
  return row;
}
/** @param {Config} value */
function showDraft(value) {
  draft = value;
  $('preview-list').replaceChildren();
  for (const item of scopes(value)) {
    const row = scopeRow(item),
      origin = document.createElement('p');
    origin.className = 'scope-origin';
    origin.textContent = item.origin;
    row.append(origin);
    $('preview-list').append(row);
  }
  $('preview').hidden = false;
}
function hideDraft() {
  draft = null;
  $('preview').hidden = true;
  $('preview-list').replaceChildren();
  $input('config-file').value = '';
}
async function load() {
  const { config } = await JptClient.getAll();
  $('sites').replaceChildren();
  const entries = config ? scopes(config) : [];
  $button('export').disabled = !entries.length;
  if (!entries.length) {
    $('sites').textContent = t('noSavedConfig');
    return;
  }
  for (const [origin, site] of Object.entries(config.sites)) {
    const row = document.createElement('div');
    row.className = 'site-row';
    const heading = document.createElement('h3');
    heading.textContent = origin;
    row.append(heading);
    for (const item of entries.filter((entry) => entry.origin === origin)) {
      const scope = scopeRow(item);
      if (item.profile.timelinePath) {
        const open = document.createElement('button');
        open.textContent = t('openTimeline');
        open.addEventListener('click', () =>
          run(open, async () => {
            const current = JptSettings.validateConfig((await JptClient.getAll()).config);
            if (!current.ok) throw Error(t('configChanged'));
            const selected = scopes(current.value).find(
              (entry) => entry.origin === origin && entry.project === item.project,
            );
            if (!selected?.profile.timelinePath) throw Error(t('noTimelineUrl'));
            await chrome.tabs.create({ url: JptUI.safeTarget(current.value, origin, item.project) });
          }),
        );
        scope.append(open);
      } else {
        const hint = document.createElement('p');
        hint.className = 'muted';
        hint.textContent = t('openTimelineFromJira');
        scope.append(hint);
      }
      row.append(scope);
    }
    const details = document.createElement('details'),
      label = document.createElement('summary'),
      pre = document.createElement('pre');
    label.textContent = t('viewFieldMapping');
    pre.textContent = JSON.stringify(site, null, 2);
    details.append(label, pre);
    row.append(details);
    const remove = document.createElement('button');
    remove.textContent = t('removeSite');
    remove.setAttribute('aria-label', t('removeSiteLabel', { origin }));
    remove.addEventListener('click', () =>
      run(remove, async () => {
        if (!(await ask(t('confirmRemoveSite', { origin }), t('removeAction')))) return;
        await JptClient.removeSite(origin);
        await load();
        notice(t('siteRemoved'));
        $('saved-heading').focus(); // 原按鈕已隨 load() 移除
      }),
    );
    row.append(remove);
    $('sites').append(row);
  }
}
/** @param {File | undefined} file */
async function chooseFile(file) {
  if (!file || importing) return;
  importing = true;
  $input('config-file').disabled = true;
  $button('apply').disabled = true;
  try {
    const value = await JptUI.readConfig(file, JptSettings);
    await JptClient.saveDraft(value);
    showDraft(value);
    $('preview-heading').focus();
    notice(t('reviewBeforeSave'));
  } catch (e) {
    notice(errorMessage(e), true);
  } finally {
    importing = false;
    $input('config-file').disabled = false;
    $button('apply').disabled = false;
  }
}
$input('config-file').addEventListener('change', (event) => chooseFile(/** @type {FileList} */ (/** @type {HTMLInputElement} */ (event.target).files)[0]));
$('drop-zone').addEventListener('dragover', (event) => {
  event.preventDefault();
  $('drop-zone').classList.add('dragging');
});
$('drop-zone').addEventListener('dragleave', () => $('drop-zone').classList.remove('dragging'));
$('drop-zone').addEventListener('drop', (event) => {
  event.preventDefault();
  $('drop-zone').classList.remove('dragging');
  return chooseFile(/** @type {DataTransfer} */ (event.dataTransfer).files[0]);
});
$button('apply').addEventListener('click', () =>
  run($button('apply'), async () => {
    if (!draft || importing) return;
    importing = true;
    $input('config-file').disabled = true;
    $button('discard').disabled = true;
    try {
      const result = await JptUI.applyImport(JptClient, draft, () => ask(t('confirmReplace'), t('replaceAction')));
      if (/** @type {{ cancelled?: boolean }} */ (result).cancelled) {
        notice(t('replaceCancelled'));
        return;
      }
      if (!result.ok) throw Error(t('configNotSaved'));
      hideDraft();
      await load();
      notice(t('configSaved'));
      $('saved-heading').focus();
    } finally {
      importing = false;
      $input('config-file').disabled = false;
      $button('discard').disabled = false;
    }
  }),
);
$button('discard').addEventListener('click', () =>
  run($button('discard'), async () => {
    if (importing) return;
    await JptClient.clearDraft();
    hideDraft();
    notice(t('importCancelled'));
    $input('config-file').focus();
  }),
);
$button('export').addEventListener('click', () =>
  run($button('export'), async () => {
    JptUI.download(await JptClient.exportConfig());
    notice(t('configDownloaded'));
  }),
);
$button('restore').addEventListener('click', () =>
  run($button('restore'), async () => {
    if (!(await ask(t('confirmRestore'), t('restoreAction')))) return;
    await JptClient.restoreConfig();
    await load();
    notice(t('configRestored'));
  }),
);
$button('reset').addEventListener('click', () =>
  run($button('reset'), async () => {
    if (!(await ask(t('confirmResetAppearance'), t('resetAction')))) return;
    await JptClient.resetPreferences();
    notice(t('appearanceReset'));
  }),
);
$button('refresh').addEventListener('click', () =>
  run($button('refresh'), async () => {
    const result = await JptClient.refresh();
    notice(
      result.delivered
        ? t(result.undelivered ? 'tabsRefreshedSome' : 'tabsRefreshed', { count: result.delivered })
        : t('noTabsToRefresh'),
    );
  }),
);
JptClient.subscribe(() => load().catch((e) => notice(errorMessage(e), true)));
(async () => {
  try {
    await load();
    const savedDraft = await JptClient.getDraft();
    if (savedDraft) showDraft(savedDraft);
  } catch (e) {
    notice(errorMessage(e), true);
  }
})();
