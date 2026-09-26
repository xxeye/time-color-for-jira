const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  vm = require('node:vm');
const source = () => fs.readFileSync(require('node:path').join(__dirname, '../timeline_color.js'), 'utf8');
test('runtime cannot persist or expose task caches and has no tenant field defaults', () => {
  const js = source();
  assert.doesNotMatch(js, /sessionStorage\.(setItem|getItem)|chrome\.storage|window\.__jptDebug\s*=/);
  assert.doesNotMatch(js, /customfield_\d+/);
  assert.doesNotMatch(js, /stripDurationSuffix/);
  assert.doesNotMatch(js, /persistDataCache\s*\(/);
});
test('runtime installs safe status receiver and stays inert without matching timeline', async () => {
  const callbacks = [],
    timers = [],
    classes = new Set();
  let apiCalls = 0;
  const body = {
    classList: {
      add: (...xs) => xs.forEach((x) => classes.add(x)),
      remove: (...xs) => xs.forEach((x) => classes.delete(x)),
      toggle: (x, on) => (on ? classes.add(x) : classes.delete(x)),
    },
    contains: () => false,
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  const dom = {
    body,
    documentElement: { style: { setProperty() {}, removeProperty() {} }, getAttribute: () => 'light' },
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    removeEventListener() {},
    visibilityState: 'visible',
  };
  const context = {
    console,
    URL,
    AbortController,
    DOMException,
    Date,
    Map,
    Set,
    Promise,
    document: dom,
    location: { origin: 'https://demo.atlassian.net', pathname: '/issues', href: 'https://demo.atlassian.net/issues' },
    sessionStorage: { removeItem() {} },
    chrome: {
      runtime: { id: 'extension-id', onMessage: { addListener: (fn) => callbacks.push(fn), removeListener() {} } },
    },
    setTimeout: (fn) => (timers.push(fn), timers.length),
    clearTimeout() {},
    setInterval: () => 1,
    clearInterval() {},
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    addEventListener() {},
    removeEventListener() {},
    JptSettings: { DEFAULTS: { enabled: true } },
    JptClient: { subscribe: () => () => {}, getContext: async () => ({ profile: null, settings: { enabled: false } }) },
    JptSession: {
      RuntimeSession: class {
        clear() {}
        async load() {
          apiCalls++;
          return { profile: null, settings: { enabled: false }, state: 'needs-config', details: [] };
        }
      },
    },
    JptCache: require('../issue_cache.js'),
    JptRules: require('../issue_rules.js'),
    JptCalendar: require('../calendar.js'),
    JptDates: require('../timeline_dates.js'),
    JptI18n: require('../i18n.js').forLocale('en'),
    JptTimeline: {
      isJiraApp: () => true,
      isTimelinePage: () => false,
      getTable: () => null,
      getProjectKey: () => null,
      findTodayMarker: () => null,
    },
    JiraApi: {},
  };
  context.window = context;
  context.globalThis = context;
  vm.runInNewContext(source(), context);
  await new Promise((r) => setImmediate(r));
  assert.ok(callbacks.length > 0);
  let reply;
  callbacks[0]({ type: 'jpt:status' }, { id: 'extension-id' }, (v) => (reply = v));
  assert.equal(reply.state, 'unsupported');
  assert.equal(apiCalls, 0);
  assert.equal(classes.has('jpt-active'), false);
  context.JptTimeline.isTimelinePage = () => true;
  dom.visibilityState = 'hidden';
  await new Promise((resolve) =>
    callbacks[0]({ type: 'jpt:status', recheck: true }, { id: 'extension-id' }, (value) => {
      reply = value;
      resolve();
    }),
  );
  assert.equal(reply.state, 'checking');
  assert.equal(apiCalls, 0);
  assert.equal(classes.has('jpt-active'), false);
});
