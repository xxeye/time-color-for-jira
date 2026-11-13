// Runs timeline_color.js on the de-identified Timeline fixture in jsdom, with Jira, settings and timers faked.
// Covers page-level behaviour that the adapter tests cannot: status self-check and clean-up when disabled.
const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path');
const { JSDOM } = require('jsdom');

const read = (name) => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const fixture = fs.readFileSync(path.join(__dirname, 'fixtures/timeline.html'), 'utf8');
const runtimeSource = read('timeline_color.js');
const URL_TIMELINE = 'https://demo.atlassian.net/jira/software/projects/DEMO/boards/1/timeline';
const profile = {
  issueTypes: { planning: ['10'], milestone: ['20'], epic: ['30'] },
  fields: {},
  progress: { enabled: false, linkTypeIds: [], direction: 'both', inProgressWeight: 0.5 },
  highlightRule: null,
  calendar: { holidays: [], workdays: [] },
};

// Every issue on the page is a Planning Task, so its bar gets colored.
const allPlanning = async (keys) => keys.map((key) => ({ key, fields: { issuetype: { id: '10' } } }));

function start({ body = fixture, searchByKeys = allPlanning } = {}) {
  const dom = new JSDOM(`<!doctype html><body>${body}</body>`, { url: URL_TIMELINE, runScripts: 'outside-only' });
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
  const listeners = [];
  win.chrome = {
    runtime: {
      id: 'extension-id',
      onMessage: {
        addListener: (fn) => listeners.push(fn),
        removeListener: (fn) => listeners.splice(listeners.indexOf(fn), 1),
      },
    },
  };
  const S = require('../settings.js');
  Object.assign(win, {
    JptSettings: S,
    JptClient: { subscribe: () => () => {}, getContext: async () => ({}) },
    JptSession: {
      RuntimeSession: class {
        clear() {}
        effective() {
          return {};
        }
        async load() {
          const settings = { ...S.DEFAULTS, enabled: true };
          return {
            state: 'ready',
            message: 'ready',
            details: [],
            projectId: '1',
            profile,
            settings,
            inputSignature: JSON.stringify({ settings }),
            source: 'property',
          };
        }
      },
    },
    JptCache: require('../issue_cache.js'),
    JptRules: require('../issue_rules.js'),
    JptCalendar: require('../calendar.js'),
    JptDates: require('../timeline_dates.js'),
    JptGeometry: require('../timeline_geometry.js'),
    JptTimeline: require('../timeline_adapter.js'),
    JptI18n: require('../i18n.js').forLocale('en'),
    JiraApi: { maxBatch: 50, searchByKeys, sleep: async () => {} },
  });
  win.eval(runtimeSource);
  const settle = async (rounds = 20) => {
    for (let i = 0; i < rounds; i++) {
      await new Promise((r) => setImmediate(r));
      const due = [...timers];
      timers.clear();
      for (const [, fn] of due) fn();
    }
  };
  const status = () => {
    let reply;
    listeners[0]?.({ type: 'jpt:status' }, { id: 'extension-id' }, (v) => (reply = v));
    return reply;
  };
  const recheck = () =>
    new Promise((resolve) => listeners[0]({ type: 'jpt:status', recheck: true }, { id: 'extension-id' }, resolve));
  const tickRoute = () => [...intervals.values()].forEach((fn) => fn());
  return { win, doc: win.document, settle, status, recheck, tickRoute };
}

const added = (doc) =>
  [...doc.querySelectorAll('*')].filter(
    (el) => /^jpt-/.test(el.id) || [...el.classList].some((c) => c.startsWith('jpt-')),
  );

test('a Timeline with issue rows reports ready and colors each bar once, however often it rescans', async () => {
  const page = start();
  await page.settle();
  assert.equal(page.status().state, 'ready');
  const colored = () =>
    [...page.doc.querySelectorAll(page.win.JptTimeline.SEL.BAR)].filter((b) => b.className.includes('jpt-'));
  assert.equal(colored().length, 3);
  const before = added(page.doc).length;
  page.doc.body.append(page.doc.createElement('div')); // any DOM change triggers a rescan
  await page.settle();
  assert.equal(added(page.doc).length, before);
});

test('when no issue rows can be found the status says so, and recovers once rows appear', async () => {
  const page = start({ body: '<div data-testid="software-board.timeline"></div>' });
  await page.settle();
  const missing = page.status();
  assert.equal(missing.state, 'partial');
  assert.match(missing.message, /No issues found/);
  page.doc.body.insertAdjacentHTML('beforeend', fixture);
  await page.settle();
  assert.equal(page.status().state, 'ready');
});

test('the missing-rows notice comes back after the settings are checked again', async () => {
  const page = start({ body: '<div data-testid="software-board.timeline"></div>' });
  await page.settle();
  assert.equal(page.status().state, 'partial');
  assert.equal((await page.recheck()).state, 'ready');
  await page.settle();
  assert.match(page.status().message, /No issues found/);
});

test('a Jira error while rows are missing is still shown after the rows come back', async () => {
  let fail;
  const page = start({ searchByKeys: () => new Promise((_, reject) => (fail = reject)) });
  await page.settle();
  const table = page.win.JptTimeline.getTable(page.doc);
  const holder = table.parentElement;
  table.remove();
  await page.settle();
  assert.match(page.status().message, /No issues found/);
  fail(Object.assign(new Error('unavailable'), { status: 503 }));
  await page.settle();
  holder.append(table);
  await page.settle();
  const after = page.status();
  assert.equal(after.state, 'partial');
  assert.doesNotMatch(after.message, /No issues found/);
});

test('after the extension goes away nothing it added is left on the page', async () => {
  const page = start();
  await page.settle();
  assert.ok(added(page.doc).length > 0, 'the page was drawn on first');
  delete page.win.chrome.runtime.id;
  page.tickRoute();
  await page.settle();
  assert.deepEqual(
    added(page.doc).map((el) => el.id || el.className),
    [],
  );
  assert.deepEqual(
    [...page.doc.documentElement.style].filter((p) => p.startsWith('--jpt-')),
    [],
  );
});
