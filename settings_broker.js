(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./settings.js') : root.JptSettings, root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.JptSettingsBroker = api;
})(globalThis, function (S, root) {
  'use strict';
  const t = (key) => (root.JptI18n || require('./i18n.js').forLocale()).t(key);
  const PREFIX = 'jpt:profile:',
    PREF = 'jpt:preferences',
    META = 'jpt:meta',
    POS = 'jpt:position',
    MIG = 'jpt:migrated',
    DRAFT = 'jpt:draft',
    BACKUP = 'jpt:restore';
  const messageKeys = {
    forbidden: 'errForbidden',
    invalid: 'errInvalid',
    storage: 'errStorage',
    corrupt: 'errCorrupt',
    missing: 'errMissing',
  };
  function failure(code, errors) {
    return Object.assign(new Error(t(messageKeys[code])), { code, errors });
  }
  const key = (origin, pid) => PREFIX + encodeURIComponent(origin) + ':' + (pid === null ? 'defaults' : pid);
  function checked(raw, code = 'invalid') {
    const r = S.validateConfig(raw);
    if (!r.ok) throw failure(code, r.errors);
    return r.value;
  }
  function createBroker(chrome) {
    let ready,
      tail = Promise.resolve();
    const serial = (fn) => {
      const work = tail.then(fn, fn);
      tail = work.catch(() => {});
      return work;
    };
    async function init() {
      if (!ready)
        ready = (async () => {
          await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
          await chrome.storage.sync.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
          const raw = await chrome.storage.sync.get(null);
          if (raw[MIG] !== 1) {
            const prefs = {};
            for (const k of Object.keys(S.DEFAULTS))
              if (Object.hasOwn(raw, k) && S.validatePreferences({ [k]: raw[k] })) prefs[k] = raw[k];
            if (raw[PREF] !== undefined) {
              if (!S.validatePreferences(raw[PREF])) throw failure('corrupt');
              Object.assign(prefs, raw[PREF]);
            }
            await chrome.storage.sync.set({ [PREF]: prefs, [MIG]: 1 });
            await chrome.storage.sync.remove(Object.keys(S.DEFAULTS).filter((k) => Object.hasOwn(raw, k)));
          }
        })().catch((e) => {
          ready = null;
          throw e;
        });
      return ready;
    }
    async function read() {
      const raw = await chrome.storage.sync.get(null);
      const config = S.emptyConfig();
      const preferences = raw[PREF] === undefined ? {} : raw[PREF];
      if (!S.validatePreferences(preferences)) throw failure('corrupt');
      if (raw[META] !== undefined) {
        const m = raw[META];
        if (!m || Object.keys(m).some((k) => !['schemaVersion', 'template', 'appearance'].includes(k)))
          throw failure('corrupt');
        Object.assign(config, m);
      }
      for (const [k, p] of Object.entries(raw)) {
        if (!k.startsWith(PREFIX) || p === null) continue;
        const rest = k.slice(PREFIX.length),
          at = rest.lastIndexOf(':');
        let origin;
        try {
          origin = decodeURIComponent(rest.slice(0, at));
        } catch {
          throw failure('corrupt');
        }
        const scope = rest.slice(at + 1);
        if (
          S.normalizeOrigin(origin) !== origin ||
          (scope !== 'defaults' && !S.isProjectId(scope)) ||
          key(origin, scope === 'defaults' ? null : scope) !== k
        )
          throw failure('corrupt');
        if (!config.sites[origin]) config.sites[origin] = { defaults: null, projects: {} };
        if (scope === 'defaults') config.sites[origin].defaults = p;
        else config.sites[origin].projects[scope] = p;
      }
      const normalized = checked(config, 'corrupt');
      const position = raw[POS] === undefined ? { side: 'right', ratio: 0.92 } : raw[POS];
      if (!S.validatePosition(position)) throw failure('corrupt');
      return { config: normalized, preferences, position, raw };
    }
    function trust(sender) {
      if (!sender || sender.id !== chrome.runtime.id) throw failure('forbidden');
      let u;
      try {
        u = new URL(sender.url);
      } catch {
        throw failure('forbidden');
      }
      const own = new URL(chrome.runtime.getURL(''));
      if (
        u.protocol === own.protocol &&
        u.host === own.host &&
        ['/popup.html', '/options.html', '/onboarding.html'].includes(u.pathname) &&
        (!sender.frameId || sender.frameId === 0)
      )
        return { ui: true, origin: null };
      if (sender.frameId !== 0 || !sender.tab || !Number.isInteger(sender.tab.id)) throw failure('forbidden');
      const origin = S.normalizeOrigin(u.origin);
      let top;
      try {
        top = new URL(sender.tab.url).origin;
      } catch {
        throw failure('forbidden');
      }
      if (!origin || top !== origin || (sender.origin && sender.origin !== origin)) throw failure('forbidden');
      return { ui: false, origin };
    }
    async function notify(type = 'jpt:settings-changed') {
      try {
        await chrome.runtime.sendMessage({ type });
      } catch {}
      const tabs = await chrome.tabs.query({ url: 'https://*.atlassian.net/*' });
      let delivered = 0,
        undelivered = 0;
      await Promise.all(
        tabs.map(async (tab) => {
          let origin;
          try {
            origin = S.normalizeOrigin(new URL(tab.url).origin);
          } catch {}
          if (!origin) return;
          try {
            await chrome.tabs.sendMessage(tab.id, { type }, { frameId: 0 });
            delivered++;
          } catch {
            undelivered++;
          }
        }),
      );
      return { delivered, undelivered };
    }
    async function writeConfig(config, old, backup = true) {
      checked(config);
      const patch = {};
      // Null records make removal part of the same commit as profile replacement.
      for (const k of Object.keys(old.raw)) if (k.startsWith(PREFIX)) patch[k] = null;
      for (const [origin, site] of Object.entries(config.sites)) {
        if (site.defaults) patch[key(origin, null)] = site.defaults;
        for (const [pid, p] of Object.entries(site.projects)) patch[key(origin, pid)] = p;
      }
      patch[META] = {
        schemaVersion: config.schemaVersion,
        template: config.template,
        ...(config.appearance ? { appearance: config.appearance } : {}),
      };
      const resulting = { ...old.raw, ...patch };
      let total = 0;
      for (const [k, v] of Object.entries(resulting)) {
        const size = new TextEncoder().encode(k + JSON.stringify(v)).length;
        if (size > 8192) throw failure('invalid');
        total += size;
      }
      if (total > 102400 || Object.keys(resulting).length > 512) throw failure('invalid');
      const previous = backup ? await chrome.storage.local.get(BACKUP) : null;
      if (backup) await chrome.storage.local.set({ [BACKUP]: old.config });
      try {
        await chrome.storage.sync.set(patch);
      } catch (error) {
        if (backup) {
          if (previous[BACKUP] === undefined) await chrome.storage.local.remove(BACKUP);
          else await chrome.storage.local.set({ [BACKUP]: previous[BACKUP] });
        }
        throw error;
      }
      // A cleanup failure leaves harmless null records; the completed config is valid.
      const retired = Object.keys(patch).filter((k) => patch[k] === null);
      if (retired.length) await chrome.storage.sync.remove(retired).catch(() => {});
    }
    const shapes = {
      getContext: ['origin', 'projectId'],
      getAll: [],
      importConfig: ['config', 'replace'],
      savePreferences: ['patch'],
      resetPreferences: [],
      savePosition: ['position'],
      removeSite: ['origin'],
      restoreConfig: [],
      exportConfig: [],
      getDraft: [],
      saveDraft: ['config'],
      clearDraft: [],
      refresh: [],
    };
    async function execute(message, sender) {
      const access = trust(sender);
      if (!message || typeof message !== 'object' || Array.isArray(message) || typeof message.type !== 'string')
        throw failure('invalid');
      const method = message.type.slice(4);
      if (
        message.type !== 'jpt:' + method ||
        !Object.hasOwn(shapes, method) ||
        Object.keys(message).some((k) => k !== 'type' && !shapes[method].includes(k))
      )
        throw failure('invalid');
      if (!access.ui && !['getContext', 'savePreferences', 'savePosition'].includes(method)) throw failure('forbidden');
      await init();
      if (method === 'getDraft') {
        const raw = await chrome.storage.local.get(DRAFT);
        return raw[DRAFT] === undefined ? null : checked(raw[DRAFT], 'corrupt');
      }
      if (method === 'saveDraft') {
        await chrome.storage.local.set({ [DRAFT]: checked(message.config) });
        return { ok: true };
      }
      if (method === 'clearDraft') {
        await chrome.storage.local.remove(DRAFT);
        return { ok: true };
      }
      if (method === 'refresh') return notify('jpt:refresh');
      const all = await read();
      if (method === 'getAll') return { config: all.config, preferences: all.preferences };
      if (method === 'exportConfig') return all.config;
      if (method === 'getContext') {
        let origin = access.origin;
        if (access.ui) {
          origin = message.origin === undefined ? null : S.normalizeOrigin(message.origin);
          if (message.origin !== undefined && !origin) throw failure('invalid');
        } else if (message.origin !== undefined && message.origin !== origin) throw failure('forbidden');
        if (message.projectId !== undefined && message.projectId !== null && !S.isProjectId(message.projectId))
          throw failure('invalid');
        const projectId = message.projectId || null,
          profile = origin ? S.resolveProfile(all.config, origin, projectId) : null;
        return {
          origin,
          projectId,
          profile,
          settings: S.effectiveSettings(profile, all.preferences),
          // The page may replace the profile with the Jira project property and re-apply these.
          preferences: all.preferences,
          configured: !!profile,
          siteConfigured: !!(origin && all.config.sites[origin]),
          position: all.position,
        };
      }
      if (method === 'savePreferences') {
        if (!S.validatePreferences(message.patch)) throw failure('invalid');
        await chrome.storage.sync.set({ [PREF]: { ...all.preferences, ...message.patch } });
      } else if (method === 'resetPreferences')
        await chrome.storage.sync.set({
          [PREF]: Object.hasOwn(all.preferences, 'enabled') ? { enabled: all.preferences.enabled } : {},
        });
      else if (method === 'savePosition') {
        if (!S.validatePosition(message.position)) throw failure('invalid');
        await chrome.storage.sync.set({ [POS]: message.position });
      } else if (method === 'importConfig') {
        if (message.replace !== undefined && typeof message.replace !== 'boolean') throw failure('invalid');
        const incoming = checked(message.config),
          merged = structuredClone(all.config),
          conflicts = [];
        for (const [origin, site] of Object.entries(incoming.sites)) {
          const dest = merged.sites[origin] || (merged.sites[origin] = { defaults: null, projects: {} });
          if (site.defaults) {
            if (dest.defaults) conflicts.push({ origin, projectId: null });
            dest.defaults = site.defaults;
          }
          for (const [pid, p] of Object.entries(site.projects)) {
            if (dest.projects[pid]) conflicts.push({ origin, projectId: pid });
            dest.projects[pid] = p;
          }
        }
        if (incoming.appearance) {
          for (const site of Object.values(incoming.sites))
            for (const p of [site.defaults, ...Object.values(site.projects)].filter(Boolean))
              p.settings = { ...incoming.appearance, ...p.settings };
          for (const [origin, site] of Object.entries(incoming.sites)) {
            if (site.defaults) merged.sites[origin].defaults = site.defaults;
            Object.assign(merged.sites[origin].projects, site.projects);
          }
        }
        if (conflicts.length && !message.replace) return { ok: false, code: 'conflict', conflicts };
        await writeConfig(merged, all);
      } else if (method === 'removeSite') {
        const origin = S.normalizeOrigin(message.origin);
        if (!origin) throw failure('invalid');
        delete all.config.sites[origin];
        await writeConfig(all.config, await read());
      } else if (method === 'restoreConfig') {
        const raw = await chrome.storage.local.get(BACKUP);
        if (!raw[BACKUP]) throw failure('missing');
        await writeConfig(checked(raw[BACKUP], 'corrupt'), all, false);
      }
      await notify().catch(() => {});
      return { ok: true };
    }
    function handle(message, sender) {
      return serial(async () => {
        try {
          return { ok: true, value: await execute(message, sender) };
        } catch (e) {
          const code = Object.hasOwn(messageKeys, e.code) ? e.code : 'storage';
          return { ok: false, code, message: t(messageKeys[code]), ...(e.errors ? { errors: e.errors } : {}) };
        }
      });
    }
    return { handle, init: () => serial(init), notify };
  }
  return { createBroker };
});
