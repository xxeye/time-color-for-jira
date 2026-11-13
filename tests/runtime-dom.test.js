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
  fields: { role: 'cf_role' },
  progress: { enabled: true, linkTypeIds: ['40'], direction: 'both', inProgressWeight: 0.5 },
  highlightRule: null,
  calendar: { holidays: [], workdays: [] },
};

// Every issue on the page is a Planning Task, so its bar gets colored.
const allPlanning = async (keys) => keys.map((key) => ({ key, fields: { issuetype: { id: '10' } } }));

function start({ body = fixture, searchByKeys = allPlanning, prefs = {} } = {}) {
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
          const settings = { ...S.DEFAULTS, enabled: true, ...prefs };
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
    JptModel: require('../timeline_model.js'),
    JptPage: require('../page_bridge.js').create(),
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

const hoverFirstBar = async (page) => {
  const bar = page.doc.querySelector(page.win.JptTimeline.SEL.BAR);
  bar.dispatchEvent(new page.win.MouseEvent('mouseover', { bubbles: true }));
  await page.settle();
  return page.doc.getElementById('jpt-hover-tip');
};

test('the hover card lists the roles of a planning task as text, never as markup', async () => {
  const roles = ['<img src=x onerror=alert(1)>', 'QA'];
  const page = start({
    searchByKeys: async (keys) => keys.map((key) => ({ key, fields: { issuetype: { id: '10' }, cf_role: roles } })),
  });
  await page.settle();
  const tip = await hoverFirstBar(page);
  assert.equal(tip.style.display, 'block');
  assert.deepEqual(
    [...tip.querySelectorAll('.jpt-tip-role-chip')].map((chip) => chip.textContent),
    roles,
  );
  assert.equal(tip.querySelector('img'), null);
});

test('the hover card lists the linked issues of a milestone; summaries stay text and only same-site icons load', async () => {
  const peer = (key, summary, iconUrl) => ({
    type: { id: '40' },
    outwardIssue: {
      id: key,
      key,
      fields: { summary, status: { statusCategory: { key: 'done' } }, issuetype: { name: 'Task', iconUrl } },
    },
  });
  const links = [
    peer('DEMO-90', '<b>bold</b>', 'https://demo.atlassian.net/icon.png'),
    peer('DEMO-91', 'plain', 'https://elsewhere.example/icon.png'),
  ];
  const page = start({
    searchByKeys: async (keys) =>
      keys.map((key) => ({
        key,
        fields: { issuetype: { id: '20' }, issuelinks: key.startsWith('DEMO-9') ? [] : links },
      })),
  });
  await page.settle();
  const tip = await hoverFirstBar(page);
  assert.match(tip.querySelector('.jpt-tip-header').textContent, /2/);
  assert.deepEqual(
    [...tip.querySelectorAll('.jpt-tip-summary')].map((s) => s.textContent),
    ['<b>bold</b>', 'plain'],
  );
  assert.equal(tip.querySelector('b'), null);
  assert.deepEqual(
    [...tip.querySelectorAll('img')].map((img) => img.getAttribute('src')),
    ['https://demo.atlassian.net/icon.png'],
  );
});

test('a Jira error keeps the project and source; leaving the Timeline clears them', async () => {
  const failing = start({ searchByKeys: async () => Promise.reject(Object.assign(new Error('x'), { status: 503 })) });
  await failing.settle();
  const partial = failing.status();
  assert.equal(partial.state, 'partial');
  assert.equal(partial.source, 'property');
  assert.equal(partial.projectId, '1');
  failing.win.history.pushState({}, '', '/jira/your-work');
  const left = await failing.recheck();
  assert.equal(left.state, 'unsupported');
  assert.equal(left.projectId, null);
  assert.equal(left.source ?? null, null);
});

// Jira listens for mousedown on an ancestor of the bar (bubble phase); count what reaches it.
const pressBar = (page) => {
  const bar = page.doc.querySelector('.jpt-pt-bar');
  let jiraHeard = 0;
  page.win.JptTimeline.getTable(page.doc).addEventListener('mousedown', () => jiraHeard++);
  return (button) => {
    const before = jiraHeard;
    const event = new page.win.MouseEvent('mousedown', { bubbles: true, cancelable: true, button });
    bar.dispatchEvent(event);
    return { prevented: event.defaultPrevented, reachedJira: jiraHeard > before };
  };
};

test('with drag lock on, a left-button drag on a planning bar is stopped; right-click still reaches Jira', async () => {
  const page = start({ prefs: { ptLockDrag: true } });
  await page.settle();
  const press = pressBar(page);
  assert.deepEqual(press(0), { prevented: true, reachedJira: false });
  assert.deepEqual(press(2), { prevented: false, reachedJira: true });
});

test('with drag lock off, Jira receives the drag', async () => {
  const page = start({ prefs: { ptLockDrag: false } });
  await page.settle();
  assert.deepEqual(pressBar(page)(0), { prevented: false, reachedJira: true });
});

test('moving from one bar to another switches the hover card to the second issue', async () => {
  const page = start({
    searchByKeys: async (keys) =>
      keys.map((key) => ({ key, fields: { issuetype: { id: '10' }, cf_role: [`role of ${key}`] } })),
  });
  await page.settle();
  const T = page.win.JptTimeline;
  const [first, second] = page.doc.querySelectorAll(T.SEL.BAR);
  const keyOf = (bar) => T.getRowKey(bar.closest('tr'));
  assert.notEqual(keyOf(first), keyOf(second));
  const hover = async (bar) => {
    bar.dispatchEvent(new page.win.MouseEvent('mouseover', { bubbles: true }));
    await page.settle();
    return page.doc.getElementById('jpt-hover-tip');
  };
  const shown = (tip) => ({ key: tip.dataset.key, role: tip.querySelector('.jpt-tip-role-chip').textContent });
  assert.deepEqual(shown(await hover(first)), { key: keyOf(first), role: `role of ${keyOf(first)}` });
  first.dispatchEvent(new page.win.MouseEvent('mouseout', { bubbles: true, relatedTarget: second }));
  const tip = await hover(second);
  assert.equal(tip.style.display, 'block');
  assert.deepEqual(shown(tip), { key: keyOf(second), role: `role of ${keyOf(second)}` });
});
