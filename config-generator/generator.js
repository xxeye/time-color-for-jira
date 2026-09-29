(function (root) {
  'use strict';
  const S = typeof module === 'object' && module.exports ? require('../settings.js') : root.JptSettings;
  const t = (key, params) => (root.JptI18n || require('../i18n.js').forLocale()).t(key, params);
  const ids = (value) => [
    ...new Set(
      String(value || '')
        .trim()
        .split(/[\s,\uFF0C]+/)
        .filter(Boolean),
    ),
  ];
  const field = (value) => {
    const v = String(value || '').trim();
    return v ? (/^\d+$/.test(v) ? 'customfield_' + v : v) : null;
  };
  // One day per line: "2027-01-01 New Year" (a name is optional). Invalid lines are reported by line number.
  function parseDays(value) {
    const days = [],
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
  const daysText = (list) => (list || []).map((d) => (d.name ? d.date + ' ' + d.name : d.date)).join('\n');
  function build(input) {
    const p = S.createProfile(),
      typeErrors = [];
    p.revision = Number(input.revision);
    for (const key of ['planning', 'milestone', 'epic']) {
      p.issueTypes[key] = ids(input[key]);
      if (p.issueTypes[key].length > 1) typeErrors.push({ path: key, message: t('genErrOneId') });
    }
    for (const key of ['role', 'epicHighlight', 'startDate', 'targetEnd']) p.fields[key] = field(input[key]);
    p.highlightRule = { operator: input.highlightOperator || 'equals', value: input.highlightValue };
    p.progress = {
      enabled: input.progressEnabled,
      linkTypeIds: ids(input.linkTypeIds),
      direction: input.direction,
      inProgressWeight: Number(input.inProgressWeight),
    };
    const holidays = parseDays(input.holidays),
      workdays = parseDays(input.workdays);
    for (const [path, list] of [
      ['holidays', holidays],
      ['workdays', workdays],
    ])
      if (list.bad.length) typeErrors.push({ path, message: t('genErrDayLines', { lines: list.bad.join(', ') }) });
    p.calendar = {
      weekendDays: ids(input.weekendDays).map(Number),
      holidays: holidays.days,
      workdays: workdays.days,
    };
    p.settings = { ...input.settings };
    p.timelinePath = String(input.timelinePath || '').trim();
    const origin = S.normalizeOrigin(input.origin);
    if (!origin) return { ok: false, errors: [...typeErrors, { path: 'origin', message: t('genErrSiteUrl') }] };
    const projectId = String(input.projectId || '').trim();
    const site = { defaults: projectId ? null : p, projects: projectId ? { [projectId]: p } : {} };
    const config = { schemaVersion: 1, template: { id: 'planning-timeline', version: 1 }, sites: { [origin]: site } };
    if (input.appearance) config.appearance = { ...input.appearance };
    const checked = S.validateConfig(config);
    return typeErrors.length
      ? { ok: false, value: null, errors: [...typeErrors, ...(checked.ok ? [] : checked.errors)] }
      : checked;
  }
  function readConfig(text) {
    try {
      if (new TextEncoder().encode(text).length > 262144) throw new Error(t('genErrFileTooLarge'));
      const checked = S.validateConfig(JSON.parse(text));
      if (!checked.ok) return checked;
      const entries = Object.entries(checked.value.sites);
      if (entries.length !== 1) throw new Error(t('genErrMultipleSites'));
      const [origin, site] = entries[0];
      const profiles = [...(site.defaults ? [['', site.defaults]] : []), ...Object.entries(site.projects)];
      if (profiles.length !== 1) throw new Error(t('genErrMultipleScopes'));
      const [projectId, p] = profiles[0];
      if (Object.values(p.issueTypes).some((list) => list.length > 1)) throw new Error(t('genErrMultipleIds'));
      return {
        ok: true,
        input: {
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
        },
      };
    } catch (e) {
      return {
        ok: false,
        errors: [{ path: 'importFile', message: e instanceof SyntaxError ? t('genErrInvalidJson') : e.message }],
      };
    }
  }
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
    const $ = (id) => document.getElementById(id),
      form = $('generatorForm');
    let dirty = false,
      appearance,
      importedSettings = null;
    // Color fields first (label above input), then the on/off switches.
    Object.entries(S.DEFAULTS)
      .filter(([key]) => !HIDDEN_SETTINGS.includes(key))
      .sort(([, a], [, b]) => (typeof a === 'boolean') - (typeof b === 'boolean'))
      .forEach(([key, value]) => {
        const label = document.createElement('label'),
          input = document.createElement('input'),
          text = document.createTextNode(labels[key] ? t(labels[key]) : key);
        input.id = 'setting-' + key;
        input.dataset.setting = key;
        input.type = typeof value === 'boolean' ? 'checkbox' : 'text';
        if (input.type === 'checkbox') {
          input.checked = value;
          label.append(input, text);
        } else {
          input.value = value;
          label.append(text, input);
        }
        $('settings').append(label);
      });
    function collect() {
      const data = {};
      form
        .querySelectorAll('[data-field]')
        .forEach((el) => (data[el.id] = el.type === 'checkbox' ? el.checked : el.value));
      data.settings = {};
      form.querySelectorAll('[data-setting]').forEach((el) => {
        const key = el.dataset.setting,
          value = el.type === 'checkbox' ? el.checked : el.value.trim();
        if (!importedSettings || Object.hasOwn(importedSettings, key) || value !== S.DEFAULTS[key])
          data.settings[key] = value;
      });
      for (const key of HIDDEN_SETTINGS)
        if (importedSettings && Object.hasOwn(importedSettings, key)) data.settings[key] = importedSettings[key];
      if (appearance) data.appearance = appearance;
      return data;
    }
    function errorTarget(path) {
      if ($(path)) return $(path);
      const tail = path.split('.').pop();
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
    function showErrors(errors, focus) {
      form.querySelectorAll('[aria-invalid]').forEach((el) => {
        el.removeAttribute('aria-invalid');
        el.removeAttribute('aria-errormessage');
      });
      document.querySelectorAll('.field-error').forEach((el) => el.remove());
      $('errors').replaceChildren();
      errors.forEach((error, i) => {
        const target = errorTarget(error.path),
          msg = document.createElement('p');
        msg.className = 'field-error';
        msg.id = 'error-' + i;
        msg.textContent = error.message;
        target.insertAdjacentElement('afterend', msg);
        target.setAttribute('aria-invalid', 'true');
        target.setAttribute('aria-errormessage', msg.id);
      });
      if (errors.length) {
        $('errors').textContent = t('genErrorsCount', { count: errors.length });
        if (focus) errorTarget(errors[0].path).focus();
      }
    }
    function refresh(show = false) {
      const data = collect(),
        result = build(data);
      $('metadata').replaceChildren();
      metadataLinks(data.origin).forEach((item) => {
        const a = document.createElement('a');
        a.href = item.url;
        a.textContent = item.label;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        $('metadata').append(a);
      });
      const scope = data.projectId ? t('genSummaryScopeProject', { id: data.projectId }) : t('genSummaryScopeSite');
      $('summary').textContent = result.ok
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
    $('importFile').addEventListener('change', async (event) => {
      const file = event.target.files[0];
      if (!file) return;
      try {
        if (file.size > 262144) throw new Error(t('genErrFileTooLarge'));
        const result = readConfig(await file.text());
        if (!result.ok) {
          showErrors(result.errors, true);
          return;
        }
        const data = result.input;
        const unavailable = [...form.querySelectorAll('[data-field]')].find(
          (el) =>
            el.tagName === 'SELECT' &&
            ![...el.options].some((option) => !option.disabled && option.value === String(data[el.id])),
        );
        if (unavailable) {
          showErrors([{ path: unavailable.id, message: t('genErrUnsupportedOption') }], true);
          return;
        }
        if (dirty && !root.confirm(t('genConfirmReplaceForm'))) return;
        form.querySelectorAll('[data-field]').forEach((el) => {
          if (el.type === 'checkbox') el.checked = data[el.id];
          else el.value = data[el.id] ?? '';
        });
        form.querySelectorAll('[data-setting]').forEach((el) => {
          const value = data.settings[el.dataset.setting] ?? S.DEFAULTS[el.dataset.setting];
          if (el.type === 'checkbox') el.checked = value;
          else el.value = value;
        });
        importedSettings = { ...data.settings };
        appearance = data.appearance;
        dirty = false;
        showErrors([], false);
        refresh();
        $('summary').focus();
      } catch (e) {
        showErrors([{ path: 'importFile', message: e.message }], true);
      } finally {
        event.target.value = '';
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
      $('summary').textContent += '\n' + t('genDownloaded');
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
})(typeof globalThis !== 'undefined' ? globalThis : this);
