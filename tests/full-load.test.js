// Loads every content script in manifest order into jsdom, with the real settings worker (in-memory storage)
// and the real Jira session. Only fetch, chrome messaging and timers are faked. Complements runtime-dom.test.js,
// which replaces the session and does not load the toolbar.
const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path');
const { JSDOM } = require('jsdom');
const { createBroker } = require('../settings_broker.js');

const root = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const scripts = manifest.content_scripts[0].js.map((f) => fs.readFileSync(path.join(root, f), 'utf8'));
const fixture = fs.readFileSync(path.join(__dirname, 'fixtures/timeline.html'), 'utf8');
const property = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/project-property.json'), 'utf8')).cases.find(
  (c) => c.extension && c.forge,
).value;
const URL_TIMELINE = 'https://demo.atlassian.net/jira/software/projects/DEMO/boards/1/timeline';
const PLANNING = property.profile.issueTypes.planning[0];

// User colors that differ from the defaults, stored the way an older version saved them (top-level keys).
const USER_COLORS = { ptColor: '#123456', msColor: '#654321' };

function storageArea(initial = {}) {
  const store = structuredClone(initial);
  return {
    async setAccessLevel() {},
    async get() {
      return structuredClone(store);
    },
    async set(patch) {
      Object.assign(store, structuredClone(patch));
    },
    async remove(keys) {
      for (const k of [].concat(keys)) delete store[k];
    },
  };
}

function jiraFetch(win, requests) {
  // Parse in the page realm, as a real fetch().json() would (the settings validator checks plain-object prototypes).
  const json = (value, status = 200) => ({
    ok: status < 400,
    status,
    json: async () => win.JSON.parse(JSON.stringify(value)),
    headers: { get: () => null },
  });
  return async (url, init) => {
    const target = new URL(url),
      { pathname } = target;
    requests.push(target.href);
    if (target.origin !== win.location.origin) return json({}, 404);
    if (pathname === '/rest/api/3/project/DEMO') return json({ id: '10001', key: 'DEMO' });
    if (pathname === '/rest/api/3/project/10001/properties/time-color-for-jira')
      return json({ key: 'time-color-for-jira', value: property });
    if (pathname === '/rest/api/3/myself') return json({ accountId: 'demo' });
    if (pathname === '/rest/api/3/field')
      return json(
        Object.entries(property.profile.fields).map(([name, id]) => ({
          id,
          schema: { type: ['startDate', 'targetEnd'].includes(name) ? 'date' : 'option' },
        })),
      );
    if (pathname === '/rest/api/3/issuetype')
      return json(
        Object.values(property.profile.issueTypes)
          .flat()
          .map((id) => ({ id })),
      );
    if (pathname === '/rest/api/3/issueLinkType')
      return json({ issueLinkTypes: property.profile.progress.linkTypeIds.map((id) => ({ id })) });
    if (pathname === '/rest/api/3/search/jql') {
      const keys = JSON.parse(init.body).jql.match(/[A-Z]+-\d+/g) || [];
      return json({ issues: keys.map((key) => ({ key, fields: { issuetype: { id: PLANNING } } })), isLast: true });
    }
    return json({}, 404);
  };
}

function load() {
  const dom = new JSDOM(`<!doctype html><body>${fixture}</body>`, { url: URL_TIMELINE, runScripts: 'outside-only' });
  const win = dom.window;
  const timers = new Map(),
    intervals = new Map();
  let nextId = 1;
  win.setTimeout = (fn) => (timers.set(nextId, fn), nextId++);
  win.clearTimeout = (id) => timers.delete(id);
  win.setInterval = (fn) => (intervals.set(nextId, fn), nextId++);
  win.clearInterval = (id) => intervals.delete(id);
  win.requestAnimationFrame = win.setTimeout;
  win.cancelAnimationFrame = win.clearTimeout;
  win.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const sender = {
    id: 'test',
    url: URL_TIMELINE,
    origin: 'https://demo.atlassian.net',
    frameId: 0,
    tab: { id: 1, url: URL_TIMELINE },
  };
  const listeners = [];
  const workerChrome = {
    runtime: { id: 'test', getURL: (p) => 'chrome-extension://test/' + p, async sendMessage() {} },
    storage: { sync: storageArea(USER_COLORS), local: storageArea() },
    tabs: { query: async () => [], sendMessage: async () => ({}) },
  };
  const broker = createBroker(workerChrome);
  win.chrome = {
    runtime: {
      id: 'test',
      // Chrome serializes messages; rebuild the reply in the page realm so prototype checks see plain objects.
      sendMessage: async (message) => {
        const reply = await broker.handle(JSON.parse(JSON.stringify(message)), sender);
        return reply === undefined ? reply : win.JSON.parse(JSON.stringify(reply));
      },
      onMessage: {
        addListener: (fn) => listeners.push(fn),
        removeListener: (fn) => listeners.splice(listeners.indexOf(fn), 1),
      },
    },
  };
  const requests = [];
  win.fetch = jiraFetch(win, requests);
  for (const source of scripts) win.eval(source);
  const settle = async (rounds = 30) => {
    for (let i = 0; i < rounds; i++) {
      await new Promise((r) => setImmediate(r));
      const due = [...timers];
      timers.clear();
      for (const [, fn] of due) fn();
    }
  };
  const status = () => {
    let reply;
    for (const fn of listeners) fn({ type: 'jpt:status' }, { id: 'test' }, (v) => (reply ??= v));
    return reply;
  };
  const tickIntervals = () => [...intervals.values()].forEach((fn) => fn());
  return { win, doc: win.document, settle, status, requests, tickIntervals };
}

const added = (doc) =>
  [...doc.querySelectorAll('*')].filter(
    (el) => /^jpt-/.test(el.id) || [...el.classList].some((c) => c.startsWith('jpt-')),
  );

test('with only the Jira project property, the page loads it, colors the bars and shows the toolbar as set up', async () => {
  const page = load();
  await page.settle();
  const status = page.status();
  assert.equal(status.state, 'ready', JSON.stringify(status.details));
  assert.equal(status.source, 'property');
  assert.equal(status.projectId, '10001');
  const bars = [...page.doc.querySelectorAll(page.win.JptTimeline.SEL.BAR)];
  assert.equal(bars.filter((b) => b.classList.contains('jpt-pt-bar')).length, 3);
  // The bar CSS reads these variables, so they must carry the user's colors, not the defaults.
  const rootStyle = page.doc.documentElement.style;
  assert.equal(rootStyle.getPropertyValue('--jpt-pt-color'), USER_COLORS.ptColor);
  assert.equal(rootStyle.getPropertyValue('--jpt-ms-color'), USER_COLORS.msColor);
  // The project property alone counts as set up: the toolbar shows "on" and both buttons work.
  const toolbar = page.doc.getElementById('jpt-toolbar');
  assert.ok(toolbar?.classList.contains('jpt-tb-on'), 'toolbar on');
  const button = (name) => toolbar.querySelector(`[data-jpt-action="${name}"]`);
  assert.equal(button('toggle').getAttribute('aria-pressed'), 'true');
  assert.equal(button('toggle').disabled, false);
  assert.equal(button('refresh').disabled, false);
  assert.ok(page.requests.length > 0);
  for (const href of page.requests) {
    const u = new URL(href);
    assert.equal(u.origin, page.win.location.origin, href);
    assert.ok(u.pathname.startsWith('/rest/api/3/'), href);
  }
});

test('when the extension goes away the toolbar and every mark on the page are removed', async () => {
  const page = load();
  await page.settle();
  assert.ok(added(page.doc).length > 0);
  delete page.win.chrome.runtime.id;
  page.tickIntervals();
  await page.settle();
  assert.deepEqual(
    added(page.doc).map((el) => el.id || el.className),
    [],
  );
});
