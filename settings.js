(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.JptSettings = api;
})(globalThis, function (root) {
  'use strict';
  const t = (key) => (root.JptI18n || require('./i18n.js').forLocale()).t(key);
  const DEFAULTS = Object.freeze({
    enabled: true,
    ptColorEnabled: true,
    ptColor: '#6a9a23',
    msColorEnabled: true,
    msColor: '#FF8B00',
    msDiamond: true,
    msShowProgress: true,
    ptTargetEndShade: false,
    epicStripe: false,
    hideCurrentMonth: true,
    hideIssueKey: false,
    showWeekends: true,
    showHolidays: true,
    showWorkingDays: true,
  });
  // Removed preferences (drag locks) are still accepted from older files and storage, then ignored.
  const RETIRED = ['ptLockDrag', 'epicLockDrag'];
  const PROPERTY_KEY = 'time-color-for-jira',
    FILE_PROFILE_BYTES = 7000,
    PROPERTY_PROFILE_BYTES = 16000,
    MAX_HOLIDAYS = 300,
    MAX_WORKDAYS = 100;
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const object = (x) =>
    x !== null &&
    typeof x === 'object' &&
    !Array.isArray(x) &&
    (Object.getPrototypeOf(x) === Object.prototype || Object.getPrototypeOf(x) === null);
  const bytes = (x) => new TextEncoder().encode(JSON.stringify(x)).length;
  const id = (x) => typeof x === 'string' && /^[1-9]\d{0,19}$/.test(x);
  function normalizeOrigin(value) {
    try {
      if (typeof value !== 'string' || value.length > 253) return null;
      const u = new URL(value);
      return u.protocol === 'https:' &&
        /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.atlassian\.net$/.test(u.hostname) &&
        !u.port &&
        !u.username &&
        !u.password &&
        u.pathname === '/' &&
        !u.search &&
        !u.hash
        ? u.origin
        : null;
    } catch {
      return null;
    }
  }
  function createProfile() {
    return {
      revision: 1,
      issueTypes: { planning: [], milestone: [], epic: [] },
      fields: { role: null, epicHighlight: null, startDate: null, targetEnd: null },
      highlightRule: { operator: 'equals', value: '' },
      progress: { enabled: true, linkTypeIds: [], direction: 'both', inProgressWeight: 0.5 },
      calendar: { weekendDays: [0, 6], holidays: [], workdays: [] },
      settings: { ...DEFAULTS },
      timelinePath: '',
    };
  }
  function emptyConfig() {
    return { schemaVersion: 1, template: { id: 'planning-timeline', version: 1 }, sites: {} };
  }
  function validPreference(k, v) {
    if (RETIRED.includes(k)) return typeof v === 'boolean';
    return (
      Object.hasOwn(DEFAULTS, k) &&
      (typeof DEFAULTS[k] === 'boolean' ? typeof v === 'boolean' : typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v))
    );
  }
  function validatePreferences(x) {
    return object(x) && Object.entries(x).every(([k, v]) => validPreference(k, v));
  }
  function validatePosition(x) {
    return (
      object(x) &&
      Object.keys(x).length === 2 &&
      ['right', 'top'].includes(x.side) &&
      typeof x.ratio === 'number' &&
      Number.isFinite(x.ratio) &&
      x.ratio >= 0 &&
      x.ratio <= 1
    );
  }
  // kind 'file': an imported configuration file; kind 'property': the Jira project property
  // (PROJECT_PROFILE.md) holding one profile, read live instead of stored in sync storage.
  function validateConfig(raw, kind = 'file') {
    const property = kind === 'property';
    const errors = [];
    const err = (path, key) => {
      if (errors.length < 30) errors.push({ path, message: t(key) });
    };
    // Forward compatibility (PROJECT_PROFILE.md): keys this version doesn't know are dropped and
    // reported in `ignored`, so a newer admin tool can't switch off an older published extension.
    // Known keys keep their strict checks; breaking changes must raise schemaVersion instead.
    const drop = new Map(),
      ignored = [];
    const ignore = (x, k, path) => {
      if (!drop.has(x)) drop.set(x, new Set());
      drop.get(x).add(k);
      if (ignored.length < 30) ignored.push(path);
    };
    try {
      const seen = new Set();
      let nodes = 0;
      function scan(x, path, depth) {
        if (++nodes > 10000 || depth > 12) throw Error('limit');
        if (x && typeof x === 'object') {
          if (seen.has(x)) throw Error('cycle');
          seen.add(x);
          if (!Array.isArray(x) && !object(x)) throw Error('object');
          for (const k of Object.keys(x)) {
            if (['__proto__', 'prototype', 'constructor'].includes(k)) throw Error('key');
            scan(x[k], path + '.' + k, depth + 1);
          }
          seen.delete(x);
        } else if (!['string', 'number', 'boolean'].includes(typeof x) && x !== null) throw Error('value');
      }
      scan(raw, '', 0);
      if (bytes(raw) > (property ? 32000 : 80000)) throw Error('size');
    } catch {
      return { ok: false, value: null, errors: [{ path: '$', message: t('vConfigInvalid') }] };
    }
    function shape(x, keys, path, required = keys) {
      if (!object(x)) {
        err(path, 'vObjectRequired');
        return false;
      }
      for (const k of Object.keys(x)) if (!keys.includes(k)) ignore(x, k, path + '.' + k);
      for (const k of required) if (!Object.hasOwn(x, k)) err(path + '.' + k, 'vMissingField');
      return true;
    }
    // Display settings: known keys must have the right type; unknown keys are ignored.
    function preferences(x, path) {
      if (!object(x)) return false;
      let ok = true;
      for (const [k, v] of Object.entries(x))
        if (validPreference(k, v)) continue;
        else if (Object.hasOwn(DEFAULTS, k) || RETIRED.includes(k)) ok = false;
        else ignore(x, k, path + '.' + k);
      return ok;
    }
    function ids(x, path) {
      if (!Array.isArray(x) || x.length > 50 || !x.every(id) || new Set(x).size !== x.length) err(path, 'vIds');
    }
    function days(list, path, max, seen) {
      if (list === undefined) return;
      if (!Array.isArray(list) || list.length > max) return err(path, 'vDays');
      for (const e of list) {
        if (!shape(e, ['date', 'name'], path, ['date'])) return;
        if (typeof e.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(e.date) || seen.has(e.date)) return err(path, 'vDays');
        const time = Date.parse(e.date + 'T00:00:00Z');
        if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== e.date) return err(path, 'vDays');
        if (Object.hasOwn(e, 'name') && (typeof e.name !== 'string' || e.name.length > 50 || /[\x00-\x1f<>]/.test(e.name)))
          return err(path, 'vDayName');
        seen.add(e.date);
      }
    }
    function profile(p, path) {
      if (
        !shape(
          p,
          ['revision', 'issueTypes', 'fields', 'highlightRule', 'progress', 'calendar', 'settings', 'timelinePath'],
          path,
        )
      )
        return;
      if (!Number.isInteger(p.revision) || p.revision < 1 || p.revision > 2147483647)
        err(path + '.revision', 'vRevision');
      if (bytes(p) > (property ? PROPERTY_PROFILE_BYTES : FILE_PROFILE_BYTES)) err(path, 'vProfileTooLarge');
      if (shape(p.issueTypes, ['planning', 'milestone', 'epic'], path + '.issueTypes')) {
        const all = [];
        for (const k of ['planning', 'milestone', 'epic']) {
          ids(p.issueTypes[k], path + '.issueTypes.' + k);
          if (Array.isArray(p.issueTypes[k])) all.push(...p.issueTypes[k]);
        }
        if (new Set(all).size !== all.length) err(path + '.issueTypes', 'vDuplicateTypes');
      }
      if (shape(p.fields, ['role', 'epicHighlight', 'startDate', 'targetEnd'], path + '.fields'))
        for (const [k, v] of Object.entries(p.fields))
          if (v !== null && !(typeof v === 'string' && /^customfield_[1-9]\d{0,19}$/.test(v)))
            err(path + '.fields.' + k, 'vFieldId');
      if (shape(p.highlightRule, ['operator', 'value'], path + '.highlightRule')) {
        if (p.highlightRule.operator !== 'equals') err(path + '.highlightRule.operator', 'vOperator');
        if (
          typeof p.highlightRule.value !== 'string' ||
          p.highlightRule.value.length > 100 ||
          /[\x00-\x1f<>]/.test(p.highlightRule.value)
        )
          err(path + '.highlightRule.value', 'vHighlightValue');
      }
      if (shape(p.progress, ['enabled', 'linkTypeIds', 'direction', 'inProgressWeight'], path + '.progress')) {
        if (typeof p.progress.enabled !== 'boolean') err(path + '.progress.enabled', 'vBoolean');
        ids(p.progress.linkTypeIds, path + '.progress.linkTypeIds');
        if (!['both', 'inward', 'outward'].includes(p.progress.direction))
          err(path + '.progress.direction', 'vDirection');
        if (
          typeof p.progress.inProgressWeight !== 'number' ||
          !Number.isFinite(p.progress.inProgressWeight) ||
          p.progress.inProgressWeight < 0 ||
          p.progress.inProgressWeight > 1
        )
          err(path + '.progress.inProgressWeight', 'vWeight');
      }
      // sourceUrl and region belong to the retired ICS subscription: accepted from older files, then dropped.
      if (
        shape(
          p.calendar,
          ['weekendDays', 'holidays', 'workdays', 'sourceUrl', 'region'],
          path + '.calendar',
          ['weekendDays'],
        )
      ) {
        const seen = new Set();
        days(p.calendar.holidays, path + '.calendar.holidays', MAX_HOLIDAYS, seen);
        days(p.calendar.workdays, path + '.calendar.workdays', MAX_WORKDAYS, seen);
        if (
          !Array.isArray(p.calendar.weekendDays) ||
          p.calendar.weekendDays.length > 7 ||
          !p.calendar.weekendDays.every((x) => Number.isInteger(x) && x >= 0 && x <= 6) ||
          new Set(p.calendar.weekendDays).size !== p.calendar.weekendDays.length
        )
          err(path + '.calendar.weekendDays', 'vWeekendDays');
      }
      const settingsOk = preferences(p.settings, path + '.settings');
      if (!settingsOk) err(path + '.settings', 'vPreferences');
      if (
        typeof p.timelinePath !== 'string' ||
        p.timelinePath.length > 500 ||
        (p.timelinePath !== '' && !/^\/[a-zA-Z0-9/_-]+$/.test(p.timelinePath)) ||
        p.timelinePath.startsWith('//') ||
        p.timelinePath.includes('..')
      )
        err(path + '.timelinePath', 'vTimelinePath');
      if (object(p.issueTypes) && object(p.fields) && settingsOk && object(p.progress)) {
        const settings = effectiveSettings(p, {}),
          has = (role) => Array.isArray(p.issueTypes[role]) && p.issueTypes[role].length > 0;
        const shade = has('planning') && settings.ptTargetEndShade;
        const progress = has('milestone') && settings.msShowProgress && p.progress.enabled === true;
        const workingDays = ['planning', 'milestone', 'epic'].some(has) && settings.showWorkingDays;
        if ((shade || progress || workingDays) && !p.fields.startDate)
          err(path + '.fields.startDate', 'vStartDateRequired');
        if (shade && !p.fields.targetEnd) err(path + '.fields.targetEnd', 'vTargetEndRequired');
        if (progress && (!Array.isArray(p.progress.linkTypeIds) || !p.progress.linkTypeIds.length))
          err(path + '.progress.linkTypeIds', 'vLinkTypesRequired');
        if (has('epic') && settings.epicStripe && !p.fields.epicHighlight)
          err(path + '.fields.epicHighlight', 'vEpicFlagRequired');
      }
    }
    const label = (x) => x === undefined || (typeof x === 'string' && x.length <= 100 && !/[\x00-\x1f<>]/.test(x));
    if (property) {
      if (shape(raw, ['schemaVersion', 'template', 'profile', 'generatedBy', 'updatedAt'], '$', ['schemaVersion', 'template', 'profile'])) {
        if (raw.schemaVersion !== 1) err('schemaVersion', 'vSchemaVersion');
        if (
          shape(raw.template, ['id', 'version'], 'template') &&
          (raw.template.id !== 'planning-timeline' || raw.template.version !== 1)
        )
          err('template', 'vTemplate');
        if (!label(raw.generatedBy) || !label(raw.updatedAt)) err('generatedBy', 'vPropertyLabel');
        profile(raw.profile, 'profile');
      }
    } else if (shape(raw, ['schemaVersion', 'template', 'sites', 'appearance'], '$', ['schemaVersion', 'template', 'sites'])) {
      if (raw.schemaVersion !== 1) err('schemaVersion', 'vSchemaVersion');
      if (
        shape(raw.template, ['id', 'version'], 'template') &&
        (raw.template.id !== 'planning-timeline' || raw.template.version !== 1)
      )
        err('template', 'vTemplate');
      if (
        Object.hasOwn(raw, 'appearance') &&
        (!shape(raw.appearance, ['ptColor', 'msColor'], 'appearance', []) || !preferences(raw.appearance, 'appearance'))
      )
        err('appearance', 'vAppearance');
      if (!object(raw.sites)) err('sites', 'vSitesObject');
      else {
        if (Object.keys(raw.sites).length > 20) err('sites', 'vTooManySites');
        let count = 0;
        for (const [origin, site] of Object.entries(raw.sites)) {
          if (normalizeOrigin(origin) !== origin) err('sites', 'vSiteOrigin');
          const path = 'sites.' + origin;
          if (shape(site, ['defaults', 'projects'], path)) {
            if (site.defaults !== null) {
              profile(site.defaults, path + '.defaults');
              count++;
            }
            if (!object(site.projects)) err(path + '.projects', 'vProjectsObject');
            else
              for (const [pid, p] of Object.entries(site.projects)) {
                if (!id(pid)) err(path + '.projects', 'vProjectId');
                profile(p, path + '.projects.' + pid);
                count++;
              }
          }
        }
        if (count > 40) err('sites', 'vTooManyProfiles');
      }
    }
    if (errors.length) return { ok: false, value: null, errors, ignored };
    // The replacer runs with `this` bound to the raw object that holds the key.
    const value = JSON.parse(
      JSON.stringify(raw, function (k, v) {
        return drop.get(this)?.has(k) ? undefined : v;
      }),
    );
    if (property) {
      normalize(value.profile);
      return {
        ok: true,
        value: { profile: value.profile, generatedBy: value.generatedBy || '', updatedAt: value.updatedAt || '' },
        errors: [],
        ignored,
      };
    }
    for (const site of Object.values(value.sites))
      for (const p of [site.defaults, ...Object.values(site.projects)].filter(Boolean)) normalize(p);
    return { ok: true, value, errors: [], ignored };
  }
  function normalize(p) {
    const c = p.calendar;
    p.calendar = { weekendDays: c.weekendDays, holidays: c.holidays || [], workdays: c.workdays || [] };
    for (const k of RETIRED) delete p.settings[k];
  }
  function resolveProfile(config, origin, projectId) {
    const r = validateConfig(config);
    if (!r.ok) return null;
    const site = r.value.sites[normalizeOrigin(origin)];
    if (!site) return null;
    const p = (id(projectId) && site.projects[projectId]) || site.defaults;
    return p ? { ...p, settings: { ...DEFAULTS, ...r.value.appearance, ...p.settings } } : null;
  }
  function effectiveSettings(profile, preferences) {
    const out = { ...DEFAULTS };
    for (const source of [profile && profile.settings, preferences])
      if (object(source))
        for (const [k, v] of Object.entries(source)) if (!RETIRED.includes(k) && validPreference(k, v)) out[k] = v;
    return out;
  }
  return {
    DEFAULTS,
    createProfile,
    emptyConfig,
    normalizeOrigin,
    PROPERTY_KEY,
    validateConfig,
    validateProperty: (raw) => validateConfig(raw, 'property'),
    resolveProfile,
    effectiveSettings,
    validatePreferences,
    validatePosition,
    isProjectId: id,
  };
});
