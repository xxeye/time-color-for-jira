// @ts-check
/** @import { PropertyValue, Profile, Preferences } from './types/domain' */
/** @import { JiraField, JiraIssueType } from './types/jira' */
/** @import { SettingsContext } from './types/messages' */
/** @import { ProfileSource, SessionResult } from './types/runtime' */
(/** @param {typeof globalThis} root */ function (root) {
  'use strict';
  const t = (/** @type {string} */ key, /** @type {Record<string, unknown> | undefined} */ params = undefined) => (root.JptI18n || require('./i18n.js').forLocale()).t(key, params);
  const S = () => root.JptSettings || require('./settings.js');
  class RuntimeSession {
    /**
     * @param {{ api: ReturnType<typeof import('./jiraApi.js').createApi>, client: Pick<ReturnType<typeof import('./settings_client.js').createClient>, 'getContext'> }} deps
     */
    constructor({ api, client }) {
      this.api = api;
      this.client = client;
      this.epoch = 0;
      /** @type {AbortController | null} */
      this.controller = null;
      /** @type {{ fields: JiraField[], types: JiraIssueType[], time: number } | null} */
      this.metadata = null;
      /** @type {string | null} */
      this.identity = null;
      /** @type {PropertyValue | null} */
      this.remote = null;
    }
    // The project property wins over an imported file; personal preferences apply on top of either.
    /** @param {SettingsContext} context @returns {{ profile: Profile | null, settings: Preferences, source: ProfileSource }} */
    effective(context) {
      if (this.remote)
        return {
          profile: this.remote.profile,
          settings: S().effectiveSettings(this.remote.profile, context.preferences),
          source: 'property',
        };
      return { profile: context.profile, settings: context.settings, source: context.profile ? 'file' : null };
    }
    clear() {
      this.epoch++;
      this.controller?.abort();
      this.controller = null;
      this.identity = null;
      this.metadata = null;
      this.remote = null;
    }
    /** @param {string} origin @param {string | null} projectKey @returns {Promise<SessionResult>} */
    async load(origin, projectKey) {
      this.controller?.abort();
      this.controller = new AbortController();
      const signal = this.controller.signal,
        epoch = ++this.epoch;
      const check = () => {
        if (epoch !== this.epoch || signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      };
      // Without a project there is no property to read; only an imported file can apply.
      /** @type {string | null} */
      let projectId = null;
      /** @type {string[]} */
      const details = [];
      this.remote = null;
      if (projectKey) {
        const project = await this.api.getProject(projectKey, { signal });
        check();
        if (!/^\d+$/.test(String(project?.id))) throw new Error('Project unavailable');
        projectId = String(project?.id);
        let property = null;
        try {
          property = await this.api.getProjectProperty(projectId, { signal });
        } catch (thrown) {
          const e = /** @type {{ name?: unknown, status?: unknown }} */ (thrown);
          if (e.name === 'AbortError' || e.status === 401) throw e;
          details.push(t('sessionPropertyUnavailable'));
        }
        check();
        if (property) {
          const r = S().validateProperty(property.value);
          if (r.ok) {
            this.remote = r.value;
            if (r.ignored.length) details.push(t('sessionPropertyIgnored'));
          } else details.push(t('sessionPropertyInvalid'));
        }
      }
      const context = await this.client.getContext({ origin, projectId });
      check();
      const chosen = this.effective(context);
      const inputSignature = JSON.stringify({ profile: chosen.profile, settings: chosen.settings });
      if (!chosen.profile)
        return {
          state: 'needs-config',
          message: t('sessionNeedsConfig'),
          details,
          projectId,
          profile: null,
          settings: { ...context.settings, enabled: false },
          inputSignature,
        };
      /** @type {Profile} a deep copy that the checks below may trim */
      const profile = JSON.parse(JSON.stringify(chosen.profile)),
        settings = { ...chosen.settings };
      const user = await this.api.getMyself({ signal });
      check();
      if (!user?.accountId) {
        /** @type {Error & { status?: number }} */
        const e = new Error('Please sign in');
        e.status = 401;
        throw e;
      }
      if (this.identity !== user.accountId) this.metadata = null;
      this.identity = user.accountId;
      let metadata = this.metadata;
      if (!metadata || Date.now() - metadata.time > 300000) {
        const [fields, types] = await Promise.all([this.api.getFields({ signal }), this.api.getTypes({ signal })]);
        check();
        if (!Array.isArray(fields) || !Array.isArray(types)) throw new Error('Metadata unavailable');
        metadata = this.metadata = { fields, types, time: Date.now() };
      }
      let disabledTypes = 0,
        totalTypes = 0;
      for (const role of /** @type {const} */ (['planning', 'milestone', 'epic'])) {
        const configured = profile.issueTypes[role];
        totalTypes += configured.length;
        const usable = configured.filter((id) => metadata.types.some((t) => String(t.id) === id));
        if (usable.length !== configured.length) {
          details.push(t('sessionTypesUnavailable'));
          disabledTypes += configured.length - usable.length;
        }
        profile.issueTypes[role] = usable;
      }
      if (!totalTypes || disabledTypes === totalTypes)
        return {
          state: 'unavailable',
          message: t('sessionCheckTypes'),
          details,
          projectId,
          profile: null,
          settings: { ...settings, enabled: false },
          inputSignature,
        };
      if (!profile.issueTypes.planning.length) settings.ptTargetEndShade = false;
      if (!profile.issueTypes.epic.length) settings.epicStripe = false;
      if (!profile.issueTypes.milestone.length || !profile.progress.enabled) settings.msShowProgress = false;
      /** @type {Record<keyof Profile['fields'], string>} */
      const labels = {
        role: 'fieldRole',
        epicHighlight: 'fieldEpicHighlight',
        startDate: 'fieldStartDate',
        targetEnd: 'fieldTargetEnd',
      };
      const needed = {
        role: !!profile.fields.role,
        epicHighlight: !!settings.epicStripe,
        startDate: !!(settings.showWorkingDays || settings.ptTargetEndShade || settings.msShowProgress),
        targetEnd: !!settings.ptTargetEndShade,
      };
      for (const [key, relevant] of Object.entries(needed)) {
        if (!relevant) continue;
        const name = /** @type {keyof Profile['fields']} */ (key);
        const id = profile.fields[name],
          field = id && metadata.fields.find((f) => f.id === id);
        const date = ['startDate', 'targetEnd'].includes(name);
        if (!field || (date && field.schema?.type !== 'date')) {
          details.push(t('sessionFieldUnavailable', { field: t(labels[name]) }));
          profile.fields[name] = null;
          if (name === 'epicHighlight') settings.epicStripe = false;
          if (name === 'targetEnd') settings.ptTargetEndShade = false;
          if (name === 'startDate') {
            settings.ptTargetEndShade = false;
            settings.showWorkingDays = false;
            settings.msShowProgress = false;
          }
        }
      }
      if (settings.msShowProgress && !profile.progress.linkTypeIds.length) {
        details.push(t('sessionProgressUnavailable'));
        settings.msShowProgress = false;
      }
      if (settings.msShowProgress && profile.progress.enabled) {
        const links = await this.api.getLinkTypes({ signal });
        check();
        if (!Array.isArray(links?.issueLinkTypes)) throw new Error('Link types unavailable');
        const types = links.issueLinkTypes;
        const allowed = profile.progress.linkTypeIds.filter((id) =>
          types.some((x) => String(x.id) === id),
        );
        if (allowed.length !== profile.progress.linkTypeIds.length || !allowed.length) {
          details.push(t('sessionProgressUnavailable'));
          settings.msShowProgress = false;
        }
        profile.progress.linkTypeIds = allowed;
      }
      if (!profile.calendar?.holidays?.length) settings.showHolidays = false;
      check();
      return {
        state: settings.enabled === false ? 'disabled' : details.length ? 'partial' : 'ready',
        message:
          settings.enabled === false ? t('sessionDisabled') : details.length ? t('sessionPartial') : t('sessionReady'),
        details: [...new Set(details)],
        projectId,
        profile,
        settings,
        inputSignature,
        source: chosen.source,
        // effective() picks 'property' only when this.remote is set.
        sourceLabel: chosen.source === 'property' && this.remote ? this.remote.generatedBy : '',
        sourceUpdatedAt: chosen.source === 'property' && this.remote ? this.remote.updatedAt : '',
      };
    }
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { RuntimeSession };
  else root.JptSession = { RuntimeSession };
})(globalThis);
