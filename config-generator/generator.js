// @ts-check
/** @import { CalendarDay, PreferenceKey, PreferencePatch, Profile, ValidationError } from '../types/domain' */
(/** @param {typeof globalThis} root */ function (root) {
  'use strict';
  const S = typeof module === 'object' && module.exports ? require('../settings.js') : root.JptSettings;
  /**
   * Raw form values: what collect() reads and readConfig() fills back in. build() hands the profile made from
   * them to validateConfig, which rejects values outside the profile's types.
   * @typedef {object} GeneratorInput
   * @property {string} [origin]
   * @property {string} [projectId]
   * @property {string | number} [revision]
   * @property {string} [timelinePath]
   * @property {string} [planning]
   * @property {string} [milestone]
   * @property {string} [epic]
   * @property {string | null} [role]
   * @property {string | null} [epicHighlight]
   * @property {string | null} [startDate]
   * @property {string | null} [targetEnd]
   * @property {string} [highlightOperator]
   * @property {string} [highlightValue]
   * @property {boolean} [progressEnabled]
   * @property {string} [linkTypeIds]
   * @property {string} [direction]
   * @property {string | number} [inProgressWeight]
   * @property {string} [weekendDays]
   * @property {string} [holidays]
   * @property {string} [workdays]
   * @property {Record<string, string | boolean>} settings
   * @property {unknown} [appearance]
   */
  const t = (/** @type {string} */ key, /** @type {Record<string, unknown> | undefined} */ params = undefined) => (root.JptI18n || require('../i18n.js').forLocale()).t(key, params);
  const ids = (/** @type {unknown} */ value) => [
    ...new Set(
      String(value || '')
        .trim()
        .split(/[\s,\uFF0C]+/)
        .filter(Boolean),
    ),
  ];
  const field = (/** @type {unknown} */ value) => {
    const v = String(value || '').trim();
    return v ? (/^\d+$/.test(v) ? 'customfield_' + v : v) : null;
  };
  // One day per line: "2027-01-01 New Year" (a name is optional). Invalid lines are reported by line number.
  /** @param {unknown} value */
  function parseDays(value) {
    /** @type {CalendarDay[]} */
    const days = [],
      /** @type {number[]} */
      bad = [];
    String(value || '')
      .split(/\r?\n/)
      .forEach((raw, i) => {
        const line = raw.trim();
        if (!line || line.startsWith('#')) return;
        const m = /^(\d{4}-\d{2}-\d{2})(?:[\s,\uFF0C]+(.*))?$/.exec(line);
        if (!m) return bad.push(i + 1);
        const name = (m[2] || '').trim();
        days.push(name ? { date: m[1], name } : { date: m[1] });
      });
    return { days: days.sort((a, b) => a.date.localeCompare(b.date)), bad };
  }
  const daysText = (/** @type {CalendarDay[] | undefined} */ list) => (list || []).map((d) => (d.name ? d.date + ' ' + d.name : d.date)).join('\n');
  /** @param {GeneratorInput} input */
  function build(input) {
    const p = S.createProfile(),
      typeErrors = [];
    p.revision = Number(input.revision);
    for (const key of /** @type {const} */ (['planning', 'milestone', 'epic'])) {
      p.issueTypes[key] = ids(input[key]);
      if (p.issueTypes[key].length > 1) typeErrors.push({ path: key, message: t('genErrOneId') });
    }
    for (const key of /** @type {const} */ (['role', 'epicHighlight', 'startDate', 'targetEnd'])) p.fields[key] = field(input[key]);
    // Unchecked form values; validateConfig below rejects anything outside the profile's types.
    p.highlightRule = /** @type {Profile['highlightRule']} */ ({
      operator: input.highlightOperator || 'equals',
      value: input.highlightValue,
    });
    p.progress = /** @type {Profile['progress']} */ ({
      enabled: input.progressEnabled,
      linkTypeIds: ids(input.linkTypeIds),
      direction: input.direction,
      inProgressWeight: Number(input.inProgressWeight),
    });
    const holidays = parseDays(input.holidays),
      workdays = parseDays(input.workdays);
    for (const [path, list] of /** @type {[string, { days: CalendarDay[], bad: number[] }][]} */ ([
      ['holidays', holidays],
      ['workdays', workdays],
    ]))
      if (list.bad.length) typeErrors.push({ path, message: t('genErrDayLines', { lines: list.bad.join(', ') }) });
    p.calendar = {
      weekendDays: ids(input.weekendDays).map(Number),
      holidays: holidays.days,
      workdays: workdays.days,
    };
    p.settings = /** @type {PreferencePatch} */ ({ ...input.settings });
    p.timelinePath = String(input.timelinePath || '').trim();
    const origin = S.normalizeOrigin(input.origin);
    if (!origin) return { ok: false, errors: [...typeErrors, { path: 'origin', message: t('genErrSiteUrl') }] };
    const projectId = String(input.projectId || '').trim();
    const site = { defaults: projectId ? null : p, projects: projectId ? { [projectId]: p } : {} };
    /** @type {{ schemaVersion: number, template: { id: string, version: number }, sites: Record<string, unknown>, appearance?: unknown }} */
    const config = { schemaVersion: 1, template: { id: 'planning-timeline', version: 1 }, sites: { [origin]: site } };
    if (input.appearance) config.appearance = { ...input.appearance };
    const checked = S.validateConfig(config);
    return typeErrors.length
      ? { ok: false, value: null, errors: [...typeErrors, ...(checked.ok ? [] : checked.errors)] }
      : checked;
  }
  /**
   * @param {string} text
   * @returns {{ ok: false, value?: null, errors: ValidationError[], ignored?: string[] } | { ok: true, input: GeneratorInput }}
   */
  function readConfig(text) {
    try {
      if (new TextEncoder().encode(text).length > 262144) throw new Error(t('genErrFileTooLarge'));
      const checked = S.validateConfig(JSON.parse(text));
      if (!checked.ok) return checked;
      const entries = Object.entries(checked.value.sites);
      if (entries.length !== 1) throw new Error(t('genErrMultipleSites'));
      const [origin, site] = entries[0];
      /** @type {[string, Profile][]} */
      const profiles = [
        ...(site.defaults ? [/** @type {[string, Profile]} */ (['', site.defaults])] : []),
        ...Object.entries(site.projects),
      ];
      if (profiles.length !== 1) throw new Error(t('genErrMultipleScopes'));
      const [projectId, p] = profiles[0];
      if (Object.values(p.issueTypes).some((list) => list.length > 1)) throw new Error(t('genErrMultipleIds'));
      return {
        ok: true,
        input: /** @type {GeneratorInput} */ ({
          origin,
          projectId,
          revision: p.revision,
          timelinePath: p.timelinePath,
          ...Object.fromEntries(Object.entries(p.issueTypes).map(([k, v]) => [k, v.join(', ')])),
          ...p.fields,
          highlightOperator: p.highlightRule.operator,
          highlightValue: p.highlightRule.value,
          progressEnabled: p.progress.enabled,
          linkTypeIds: p.progress.linkTypeIds.join(', '),
          direction: p.progress.direction,
          inProgressWeight: p.progress.inProgressWeight,
          weekendDays: p.calendar.weekendDays.join(', '),
          holidays: daysText(p.calendar.holidays),
          workdays: daysText(p.calendar.workdays),
          settings: { ...p.settings },
          ...(checked.value.appearance ? { appearance: { ...checked.value.appearance } } : {}),
        }),
      };
    } catch (e) {
      return {
        ok: false,
        errors: [{ path: 'importFile', message: e instanceof SyntaxError ? t('genErrInvalidJson') : /** @type {Error} */ (e).message }],
      };
    }
  }
  /** @param {unknown} origin */
  function metadataLinks(origin) {
    const safe = S.normalizeOrigin(origin);
    return safe
      ? [
          ['genLinkFields', 'field'],
          ['genLinkTypes', 'issuetype'],
          ['genLinkLinkTypes', 'issueLinkType'],
        ].map(([key, path]) => ({ label: t(key), url: safe + '/rest/api/3/' + path }))
      : [];
  }
  /** @type {Record<string, string>} */
  const labels = {
    enabled: 'settingEnabled',
    ptColorEnabled: 'settingPtColorEnabled',
    ptColor: 'settingPtColor',
    msColorEnabled: 'settingMsColorEnabled',
    msColor: 'settingMsColor',
    msDiamond: 'settingMsDiamond',
    msShowProgress: 'settingMsShowProgress',
    ptTargetEndShade: 'settingPtTargetEndShade',
    ptLockDrag: 'settingPtLockDrag',
    epicLockDrag: 'settingEpicLockDrag',
    hideCurrentMonth: 'settingHideCurrentMonth',
    hideIssueKey: 'settingHideIssueKey',
    showWeekends: 'settingShowWeekends',
    showHolidays: 'settingShowHolidays',
    showWorkingDays: 'settingShowWorkingDays',
  };
  // Epic stripes need a flag field and a matching rule; the public form leaves them out but keeps imported values.
  const HIDDEN_SETTINGS = ['epicStripe'];
  function mount() {
    root.JptI18n.apply(document);
    const $ = (/** @type {string} */ id) => document.getElementById(id),
      // Elements the page always has.
      need = (/** @type {string} */ id) => /** @type {HTMLElement} */ ($(id)),
      form = /** @type {HTMLFormElement} */ ($('generatorForm'));
    let dirty = false,
      /** @type {unknown} */
      appearance,
      /** @type {Record<string, string | boolean> | null} */
      importedSettings = null;
    // Color fields first (label above input), then the on/off switches.
    Object.entries(S.DEFAULTS)
      .filter(([key]) => !HIDDEN_SETTINGS.includes(key))
      .sort(([, a], [, b]) => Number(typeof a === 'boolean') - Number(typeof b === 'boolean'))
      .forEach(([key, value]) => {
        const label = document.createElement('label'),
          input = document.createElement('input'),
          text = document.createTextNode(labels[key] ? t(labels[key]) : key);
        input.id = 'setting-' + key;
        input.dataset.setting = key;
        input.type = typeof value === 'boolean' ? 'checkbox' : 'text';
        if (input.type === 'checkbox') {
          input.checked = /** @type {boolean} */ (value);
          label.append(input, text);
        } else {
          input.value = /** @type {string} */ (value);
          label.append(text, input);
        }
        need('settings').append(label);
      });
    function collect() {
      const data = /** @type {Record<string, unknown> & { settings: Record<string, string | boolean>, appearance?: unknown }} */ ({});
      // Inputs and selects; only id, type, value and checked are read.
      /** @type {NodeListOf<HTMLInputElement>} */ (form.querySelectorAll('[data-field]')).forEach(
        (el) => (data[el.id] = el.type === 'checkbox' ? el.checked : el.value),
      );
      data.settings = {};
      /** @type {NodeListOf<HTMLInputElement>} */ (form.querySelectorAll('[data-setting]')).forEach((el) => {
        const key = /** @type {PreferenceKey} */ (el.dataset.setting),
          value = el.type === 'checkbox' ? el.checked : el.value.trim();
        if (!importedSettings || Object.hasOwn(importedSettings, key) || value !== S.DEFAULTS[key])
          data.settings[key] = value;
      });
      for (const key of HIDDEN_SETTINGS)
        if (importedSettings && Object.hasOwn(importedSettings, key)) data.settings[key] = importedSettings[key];
      if (appearance) data.appearance = appearance;
      return /** @type {GeneratorInput} */ (data);
    }
    /** @param {string} path */
    function errorTarget(path) {
      if ($(path)) return $(path);
      const tail = /** @type {string} */ (path.split('.').pop());
      /** @type {Record<string, string>} */
      const alias = {
        value: 'highlightValue',
        operator: 'highlightOperator',
        enabled: 'progressEnabled',
        fields: 'startDate',
        issueTypes: 'planning',
        projects: 'projectId',
        settings: 'setting-ptColor',
      };
      if (path.includes('.settings.')) return $('setting-' + tail);
      if (path.includes('.projects.') && !/^\d+$/.test(path.split('.projects.')[1].split('.')[0]))
        return $('projectId');
      return $(alias[tail] || tail) || $('origin');
    }
    /** @param {ValidationError[]} errors @param {boolean} focus */
    function showErrors(errors, focus) {
      form.querySelectorAll('[aria-invalid]').forEach((el) => {
        el.removeAttribute('aria-invalid');
        el.removeAttribute('aria-errormessage');
      });
      document.querySelectorAll('.field-error').forEach((el) => el.remove());
      need('errors').replaceChildren();
      errors.forEach((error, i) => {
        const target = /** @type {HTMLElement} */ (errorTarget(error.path)),
          msg = document.createElement('p');
        msg.className = 'field-error';
        msg.id = 'error-' + i;
        msg.textContent = error.message;
        target.insertAdjacentElement('afterend', msg);
        target.setAttribute('aria-invalid', 'true');
        target.setAttribute('aria-errormessage', msg.id);
      });
      if (errors.length) {
        need('errors').textContent = t('genErrorsCount', { count: errors.length });
        if (focus) /** @type {HTMLElement} */ (errorTarget(errors[0].path)).focus();
      }
    }
    function refresh(show = false) {
      const data = collect(),
        result = build(data);
      need('metadata').replaceChildren();
      metadataLinks(data.origin).forEach((item) => {
        const a = document.createElement('a');
        a.href = item.url;
        a.textContent = item.label;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        need('metadata').append(a);
      });
      const scope = data.projectId ? t('genSummaryScopeProject', { id: data.projectId }) : t('genSummaryScopeSite');
      need('summary').textContent = result.ok
        ? t('genSummaryOk') +
          '\n' +
          [data.origin, scope, t('genSummaryVersion', { revision: data.revision })].join(' · ')
        : t('genSummaryIncomplete');
      if (show) showErrors(result.ok ? [] : result.errors, true);
      return result;
    }
    form.addEventListener('input', () => {
      dirty = true;
      refresh();
    });
    need('importFile').addEventListener('change', async (event) => {
      const file = /** @type {FileList} */ (/** @type {HTMLInputElement} */ (event.target).files)[0];
      if (!file) return;
      try {
        if (file.size > 262144) throw new Error(t('genErrFileTooLarge'));
        const result = readConfig(await file.text());
        if (!result.ok) {
          showErrors(result.errors, true);
          return;
        }
        const data = result.input;
        // The same values looked up by form element id.
        const values = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (data));
        const unavailable = [...form.querySelectorAll('[data-field]')].find(
          (el) =>
            el.tagName === 'SELECT' &&
            ![.../** @type {HTMLSelectElement} */ (el).options].some(
              (option) => !option.disabled && option.value === String(values[el.id]),
            ),
        );
        if (unavailable) {
          showErrors([{ path: unavailable.id, message: t('genErrUnsupportedOption') }], true);
          return;
        }
        if (dirty && !root.confirm(t('genConfirmReplaceForm'))) return;
        /** @type {NodeListOf<HTMLInputElement>} */ (form.querySelectorAll('[data-field]')).forEach((el) => {
          if (el.type === 'checkbox') el.checked = /** @type {boolean} */ (values[el.id]);
          else el.value = /** @type {string} */ (values[el.id] ?? '');
        });
        /** @type {NodeListOf<HTMLInputElement>} */ (form.querySelectorAll('[data-setting]')).forEach((el) => {
          const key = /** @type {PreferenceKey} */ (el.dataset.setting);
          const value = data.settings[key] ?? S.DEFAULTS[key];
          if (el.type === 'checkbox') el.checked = /** @type {boolean} */ (value);
          else el.value = /** @type {string} */ (value);
        });
        importedSettings = { ...data.settings };
        appearance = data.appearance;
        dirty = false;
        showErrors([], false);
        refresh();
        need('summary').focus();
      } catch (e) {
        showErrors([{ path: 'importFile', message: /** @type {Error} */ (e).message }], true);
      } finally {
        /** @type {HTMLInputElement} */ (event.target).value = '';
      }
    });
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const result = refresh(true);
      if (!result.ok) return;
      const blob = new Blob([JSON.stringify(result.value, null, 2) + '\n'], { type: 'application/json' }),
        url = URL.createObjectURL(blob),
        a = document.createElement('a');
      a.href = url;
      a.download = 'time-color-config.json';
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      dirty = false;
      need('summary').textContent += '\n' + t('genDownloaded');
    });
    root.addEventListener('beforeunload', (event) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = '';
      }
    });
    refresh();
  }
  const api = { build, readConfig, metadataLinks };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.JptGenerator = api;
    // Inside the extension settings page the host page supplies the heading and width.
    document.documentElement?.classList.toggle('embedded', root.self !== root.top);
    document.addEventListener('DOMContentLoaded', mount);
  }
})(/** @type {typeof globalThis} */ (typeof globalThis !== 'undefined' ? globalThis : this));
