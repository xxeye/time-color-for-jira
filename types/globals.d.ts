// Globals the content scripts, extension pages and service worker attach to `globalThis`.
// Types come from the implementation (`typeof import`), so there is no second copy to keep in sync.
// Instances are typed by the factory that builds them, not by the module that exports the factory.
// Development only: pack.py ships an explicit file list, which does not include types/.

declare global {
  var JptI18n: ReturnType<typeof import('../i18n.js').fromChrome>;
  var JptSettings: typeof import('../settings.js');
  var JptSettingsBroker: typeof import('../settings_broker.js');
  var JptClient: ReturnType<typeof import('../settings_client.js').createClient>;
  var JiraApi: ReturnType<typeof import('../jiraApi.js').createApi>;
  var JptRules: typeof import('../issue_rules.js');
  var JptCache: typeof import('../issue_cache.js');
  var JptCalendar: typeof import('../calendar.js');
  var JptDates: typeof import('../timeline_dates.js');
  var JptGeometry: typeof import('../timeline_geometry.js');
  var JptModel: typeof import('../timeline_model.js');
  var JptSession: typeof import('../runtime_session.js');
  var JptTimeline: typeof import('../timeline_adapter.js');
  var JptPage: ReturnType<typeof import('../page_bridge.js').create>;
  var JptUI: typeof import('../ui_helpers.js');
  var JptGenerator: typeof import('../config-generator/generator.js');
  // The toolbar keeps a handle to itself so a re-injected copy can remove the old one first.
  var __jptToolbar: ReturnType<typeof import('../floating_toolbar.js').createToolbar> | undefined;
}

export {};
