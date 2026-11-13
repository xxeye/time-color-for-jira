// @ts-check
/** @import { Config } from './types/domain' */
/** @import { Done, ImportConflict } from './types/messages' */
/** @import { PageContext, PageStatus, StatusState } from './types/runtime' */
(/** @param {typeof globalThis} root */ function (root) {
  'use strict';
  const t = (/** @type {string} */ key, /** @type {Record<string, unknown> | undefined} */ params = undefined) => (root.JptI18n || require('./i18n.js').forLocale()).t(key, params);
  /** @type {Record<StatusState, string>} */
  const labels = {
    'needs-config': 'statusNeedsConfig',
    checking: 'statusChecking',
    ready: 'statusReady',
    partial: 'statusPartial',
    login: 'statusLogin',
    unavailable: 'statusUnavailable',
    unsupported: 'statusUnsupported',
    disabled: 'statusDisabled',
  };
  /** @param {Config} config @param {string} origin @param {string} [projectId] */
  function safeTarget(config, origin, projectId) {
    if (!/^https:\/\/[a-z0-9-]+\.atlassian\.net$/.test(origin) || !Object.hasOwn(config.sites, origin))
      throw Error(t('chooseConfiguredSite'));
    const site = config.sites[origin];
    const profile = projectId ? site.projects[projectId] : site.defaults;
    if (!profile) throw Error(t('projectConfigMissing'));
    const path = profile.timelinePath || '/';
    if (!path.startsWith('/') || path.startsWith('//') || /[\\\s]/.test(path)) throw Error(t('unsafeEntry'));
    const target = new URL(path, origin);
    if (target.origin !== origin) throw Error(t('entrySiteMismatch'));
    return target.href;
  }
  /**
   * @param {Pick<typeof JptClient, 'importConfig' | 'clearDraft'>} client
   * @param {unknown} config
   * @param {() => boolean | Promise<boolean>} confirmReplace
   * @returns {Promise<Done | ImportConflict | { ok: false, cancelled: true }>}
   */
  async function applyImport(client, config, confirmReplace) {
    let result = await client.importConfig(config, { replace: false });
    // `conflict` is not in the reply type; kept as the original check.
    const loose = /** @type {{ ok: boolean, conflict?: unknown, conflicts?: unknown, code?: unknown }} */ (result);
    if (!loose.ok && (loose.conflict || loose.conflicts || loose.code === 'conflict')) {
      if (!(await confirmReplace())) return { ok: false, cancelled: true };
      result = await client.importConfig(config, { replace: true });
    }
    if (result.ok) await client.clearDraft();
    return result;
  }
  /**
   * @param {{ tabs: Pick<typeof chrome.tabs, 'get' | 'query' | 'sendMessage'> }} api
   * @param {boolean} [recheck]
   * @param {number} [tabId]
   * @returns {Promise<PageStatus>}
   */
  async function tabStatus(api, recheck = false, tabId) {
    let tab;
    try {
      tab = tabId ? await api.tabs.get(tabId) : (await api.tabs.query({ active: true, currentWindow: true }))[0];
      if (!tab?.id || !/^https:\/\/[^/]+\.atlassian\.net(?:\/|$)/.test(tab.url || ''))
        return { state: 'unsupported', message: t('openConfiguredTimeline'), details: [] };
      const response = await api.tabs.sendMessage(tab.id, { type: 'jpt:status', recheck }, { frameId: 0 });
      if (!response || !Object.hasOwn(labels, response.state)) throw Error('No status');
      return response;
    } catch (_) {
      return { state: 'unavailable', message: t('reloadJiraTab'), details: [] };
    }
  }
  /** @param {Document} doc @param {string} id */
  const byId = (doc, id) => /** @type {HTMLElement} */ (doc.getElementById(id));
  /** @param {PageStatus} status @param {Document} [doc] */
  function renderStatus(status, doc = document) {
    byId(doc, 'runtime-title').textContent = t(
      Object.hasOwn(labels, status.state) ? labels[status.state] : labels.unavailable,
    );
    byId(doc, 'runtime-message').textContent = status.message || '';
    const details = doc.getElementById('runtime-details');
    if (details) {
      details.replaceChildren();
      for (const item of status.details || []) {
        const li = doc.createElement('li');
        li.textContent = typeof item === 'string' ? item : item.message || item.feature || t('featureNeedsCheck');
        details.append(li);
      }
      /** @type {HTMLElement} */ (details.parentElement).hidden = !details.childElementCount;
    }
  }
  /** @param {File | null | undefined} file @param {Pick<typeof JptSettings, 'validateConfig'>} settings */
  async function readConfig(file, settings) {
    if (!file) throw Error(t('chooseConfigFile'));
    if (file.size > 100000) throw Error(t('configTooLarge'));
    let raw;
    try {
      raw = JSON.parse(await file.text());
    } catch (_) {
      throw Error(t('configUnreadable'));
    }
    const result = settings.validateConfig(raw);
    if (!result.ok) throw Error(t('configIncompatible', { detail: result.errors?.[0]?.message || '' }).trim());
    if (!Object.values(result.value.sites).some((site) => site.defaults || Object.keys(site.projects).length))
      throw Error(t('configEmpty'));
    return result.value;
  }
  // [2025, 2026, 2027, 2029] -> '2025–2027, 2029'
  /** @param {number[]} years */
  function yearRanges(years) {
    /** @type {[number, number][]} */
    const groups = [];
    for (const year of [...years].sort((a, b) => a - b)) {
      const last = groups.at(-1);
      if (last && year === last[1] + 1) last[1] = year;
      else groups.push([year, year]);
    }
    return groups.map(([a, b]) => (a === b ? String(a) : a + '–' + b)).join(t('listSeparator'));
  }
  // Where the settings on this page came from, and which years of holidays they cover.
  /** @param {Partial<PageContext> | null | undefined} info */
  function sourceText(info) {
    if (info?.source === 'property') {
      const date = info.sourceUpdatedAt ? new Date(info.sourceUpdatedAt) : null;
      const when =
        date && Number.isFinite(date.getTime())
          ? date.toLocaleDateString(t('localeTag'), { month: 'numeric', day: 'numeric' })
          : '';
      return t('sourceProperty', { by: info.sourceLabel || t('sourceAdmin'), date: when || '—' });
    }
    return info?.source === 'file' ? t('sourceFile') : '';
  }
  /** @param {number[] | null | undefined} years */
  function calendarSummary(years) {
    return years?.length ? t('calendarCoverage', { years: yearRanges(years) }) : t('calendarWeekendsOnly');
  }
  /** @param {unknown} config */
  function download(config) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'timeline-settings.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  // One local object for both the global and CommonJS, so tsc infers the exports from the implementation.
  const api = {
    safeTarget,
    applyImport,
    tabStatus,
    renderStatus,
    readConfig,
    download,
    yearRanges,
    sourceText,
    calendarSummary,
  };
  root.JptUI = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
