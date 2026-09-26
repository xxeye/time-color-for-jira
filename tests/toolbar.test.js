const test = require('node:test');
const assert = require('node:assert/strict');
let T;
try {
  T = require('../floating_toolbar.js');
} catch {
  T = {};
}
class Node extends EventTarget {
  constructor(tag = 'div') {
    super();
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.style = {};
    this.attributes = {};
    this.dataset = {};
    this.classes = new Set();
    this.classList = {
      add: (v) => this.classes.add(v),
      remove: (v) => this.classes.delete(v),
      contains: (v) => this.classes.has(v),
      toggle: (v, on) => (on ? this.classes.add(v) : this.classes.delete(v)),
    };
  }
  appendChild(n) {
    this.children.push(n);
    n.parent = this;
    return n;
  }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter((n) => n !== this);
  }
  setAttribute(k, v) {
    this.attributes[k] = String(v);
  }
  getBoundingClientRect() {
    return { width: 160, height: 40, top: 50, left: 800, right: 960, bottom: 90 };
  }
}
const tick = () => new Promise(setImmediate);
function fixture(overrides = {}, windowOverrides = {}) {
  const win = new EventTarget();
  Object.assign(win, {
    innerWidth: 1000,
    innerHeight: 700,
    __jptGetProjectId: () => '10001',
    location: new URL('https://acme.atlassian.net/jira/software/projects/ABC/boards/1/timeline'),
  });
  Object.assign(win, windowOverrides);
  const doc = new EventTarget();
  doc.body = new Node('body');
  doc.createElement = (t) => new Node(t);
  let subscribed = 0,
    notify;
  const writes = [];
  const client = {
    getContext: async () => ({
      configured: true,
      settings: { enabled: true },
      position: { side: 'right', ratio: 0.92 },
    }),
    savePreferences: async (p) => writes.push(p),
    savePosition: async (p) => writes.push(p),
    refresh: async () => ({ delivered: 1, undelivered: 0 }),
    subscribe: (fn) => {
      notify = fn;
      subscribed++;
      return () => subscribed--;
    },
    ...overrides,
  };
  const timers = new Set(),
    intervals = new Set();
  const env = {
    window: win,
    document: doc,
    client,
    adapter: { isTimelinePage: (l) => l.pathname.endsWith('/timeline'), getProjectKey: () => 'ABC' },
    isAlive: () => true,
    setTimeout: (fn) => {
      timers.add(fn);
      return fn;
    },
    clearTimeout: (fn) => timers.delete(fn),
    setInterval: (fn) => {
      intervals.add(fn);
      return fn;
    },
    clearInterval: (fn) => intervals.delete(fn),
  };
  const api = T.createToolbar(env);
  api.start();
  const action = (name) => doc.body.children[0].children.find((n) => n.dataset.jptAction === name);
  return {
    win,
    doc,
    api,
    writes,
    action,
    intervals,
    timers,
    expire: () => {
      for (const fn of [...timers]) {
        timers.delete(fn);
        fn();
      }
    },
    status: () => doc.body.children[0].children.at(-1),
    notify: () => notify(),
    get subscribed() {
      return subscribed;
    },
  };
}
test('toggle persists through client and failed save keeps previous state visible', async () => {
  assert.equal(typeof T.createToolbar, 'function');
  const f = fixture({
    savePreferences: async () => {
      throw Error('quota reached');
    },
  });
  await tick();
  const toggle = f.action('toggle');
  assert.equal(toggle.tagName, 'BUTTON');
  assert.equal(toggle.attributes['aria-pressed'], 'true');
  toggle.dispatchEvent(new Event('click'));
  await tick();
  assert.equal(toggle.attributes['aria-pressed'], 'true');
  assert.match(f.doc.body.children[0].children.at(-1).textContent, /quota/);
  f.api.destroy();
});
test('refresh reports a request, not completion, and handles no receivers', async () => {
  assert.equal(typeof T.createToolbar, 'function');
  const f = fixture({ refresh: async () => ({ delivered: 0, undelivered: 1 }) });
  await tick();
  f.action('refresh').dispatchEvent(new Event('click'));
  await tick();
  assert.match(f.doc.body.children[0].children.at(-1).textContent, /not delivered/);
  f.api.destroy();
});
test('keyboard position changes save valid positions without toggling enabled', async () => {
  assert.equal(typeof T.createToolbar, 'function');
  const f = fixture();
  await tick();
  const e = new Event('keydown', { cancelable: true });
  Object.defineProperty(e, 'key', { value: 'Home' });
  f.action('move').dispatchEvent(e);
  await tick();
  assert.deepEqual(f.writes, [{ side: 'right', ratio: 0 }]);
  f.api.destroy();
});
test('route exit removes bar and pagehide releases subscriptions and polling', async () => {
  assert.equal(typeof T.createToolbar, 'function');
  const f = fixture();
  await tick();
  assert.equal(f.doc.body.children.length, 1);
  f.win.location = new URL('https://acme.atlassian.net/jira/software/projects/ABC/boards/1/backlog');
  await f.api.sync();
  assert.equal(f.doc.body.children.length, 0);
  f.win.dispatchEvent(new Event('pagehide'));
  assert.equal(f.subscribed, 0);
  assert.equal(f.intervals.size, 0);
});
test('pending context cannot inject toolbar after navigation or pagehide', async () => {
  assert.equal(typeof T.createToolbar, 'function');
  let resolve;
  const f = fixture({
    getContext: () =>
      new Promise((r) => {
        resolve = r;
      }),
  });
  f.win.dispatchEvent(new Event('pagehide'));
  resolve({ configured: true, settings: { enabled: true } });
  await tick();
  assert.equal(f.doc.body.children.length, 0);
});
test('resolved numeric project from runtime selects project configuration and context event reloads it', async () => {
  assert.equal(typeof T.createToolbar, 'function');
  let project = '10001';
  const calls = [];
  const f = fixture(
    {
      getContext: async (args) => {
        calls.push(args);
        return { configured: true, settings: { enabled: args.projectId === '10001' } };
      },
    },
    { __jptGetProjectId: () => project },
  );
  await tick();
  assert.equal(calls[0].projectId, '10001');
  assert.equal(f.action('toggle').attributes['aria-pressed'], 'true');
  project = '10002';
  f.win.dispatchEvent(new Event('jpt:context-ready'));
  await tick();
  assert.equal(calls.at(-1).projectId, '10002');
  assert.equal(f.action('toggle').attributes['aria-pressed'], 'false');
  f.api.destroy();
});
test('BFCache suspension releases live resources and restores exactly one subscription and timer', async () => {
  assert.equal(typeof T.createToolbar, 'function');
  const f = fixture();
  await tick();
  const hide = new Event('pagehide');
  Object.defineProperty(hide, 'persisted', { value: true });
  f.win.dispatchEvent(hide);
  assert.equal(f.doc.body.children.length, 0);
  assert.equal(f.subscribed, 0);
  assert.equal(f.intervals.size, 0);
  f.win.dispatchEvent(new Event('pageshow'));
  await tick();
  assert.equal(f.doc.body.children.length, 1);
  assert.equal(f.subscribed, 1);
  assert.equal(f.intervals.size, 1);
  f.win.dispatchEvent(new Event('pageshow'));
  await tick();
  assert.equal(f.subscribed, 1);
  assert.equal(f.intervals.size, 1);
  f.api.destroy();
});
test('old context response cannot roll back a subsequently saved toggle', async () => {
  let resolveRead,
    resolveSave,
    reads = 0;
  const f = fixture({
    getContext: () =>
      ++reads === 1
        ? Promise.resolve({ configured: true, settings: { enabled: true } })
        : new Promise((r) => {
            resolveRead = r;
          }),
    savePreferences: () =>
      new Promise((r) => {
        resolveSave = r;
      }),
  });
  await tick();
  f.notify();
  f.action('toggle').dispatchEvent(new Event('click'));
  resolveSave();
  await tick();
  assert.equal(f.action('toggle').attributes['aria-pressed'], 'false');
  resolveRead({ configured: true, settings: { enabled: true } });
  await tick();
  assert.equal(f.action('toggle').attributes['aria-pressed'], 'false');
  f.api.destroy();
});
test('refresh uses the local Timeline runtime instead of requesting a privileged broadcast', async () => {
  const f = fixture(
    {
      refresh: async () => {
        throw Error('forbidden broadcast');
      },
    },
    { __jptRefresh: async () => ({ delivered: 1 }) },
  );
  await tick();
  f.action('refresh').dispatchEvent(new Event('click'));
  await tick();
  assert.match(f.doc.body.children[0].children.at(-1).textContent, /Rescan requested/);
  f.api.destroy();
});
test('successful position changes remain silent', async () => {
  const f = fixture();
  await tick();
  const e = new Event('keydown', { cancelable: true });
  Object.defineProperty(e, 'key', { value: 'Home' });
  f.action('move').dispatchEvent(e);
  await tick();
  assert.equal(f.status().textContent || '', '');
  assert.equal(f.timers.size, 0);
  f.api.destroy();
});
test('refresh request and action errors expire from the accessible status', async () => {
  const f = fixture({
    savePosition: async () => {
      throw Error('quota');
    },
  });
  await tick();
  f.action('refresh').dispatchEvent(new Event('click'));
  await tick();
  assert.equal(f.status().attributes['aria-live'], 'polite');
  assert.match(f.status().textContent, /Rescan requested/);
  f.expire();
  assert.equal(f.status().textContent, '');
  const e = new Event('keydown', { cancelable: true });
  Object.defineProperty(e, 'key', { value: 'Home' });
  f.action('move').dispatchEvent(e);
  await tick();
  assert.match(f.status().textContent, /Moving the toolbar.*quota/);
  f.expire();
  assert.equal(f.status().textContent, '');
  f.api.destroy();
});
test('site defaults cannot flash missing-config or enabled before the project is resolved', async () => {
  let project = null,
    configured = false;
  const f = fixture(
    { getContext: async () => ({ configured, settings: { enabled: true } }) },
    { __jptGetProjectId: () => project },
  );
  await tick();
  assert.equal(f.action('toggle').disabled, true);
  assert.equal(f.action('toggle').attributes['aria-pressed'], 'false');
  assert.equal(f.status().textContent || '', '');
  configured = true;
  f.notify();
  await tick();
  assert.equal(f.action('toggle').disabled, true);
  assert.equal(f.action('toggle').attributes['aria-pressed'], 'false');
  assert.equal(f.status().textContent || '', '');
  project = '10001';
  f.win.dispatchEvent(new Event('jpt:context-ready'));
  await tick();
  assert.equal(f.action('toggle').disabled, false);
  assert.equal(f.action('toggle').attributes['aria-pressed'], 'true');
  assert.equal(f.status().textContent || '', '');
  f.api.destroy();
});
test('confirmed missing-config prompt points to settings management and clears when configured', async () => {
  let configured = false;
  const f = fixture({ getContext: async () => ({ configured, settings: { enabled: true } }) });
  await tick();
  assert.match(f.status().textContent, /Manage settings/);
  assert.equal(f.action('toggle').attributes['aria-pressed'], 'false');
  configured = true;
  f.notify();
  await tick();
  assert.equal(f.status().textContent, '');
  assert.equal(f.action('toggle').disabled, false);
  f.api.destroy();
});
test('leaving the page cancels pending feedback expiry', async () => {
  const f = fixture();
  await tick();
  f.action('refresh').dispatchEvent(new Event('click'));
  await tick();
  assert.equal(f.timers.size, 1);
  f.win.dispatchEvent(new Event('pagehide'));
  assert.equal(f.timers.size, 0);
  assert.equal(f.doc.body.children.length, 0);
});
test('a project configured only by the Jira project property is shown as set up', async () => {
  const f = fixture(
    { getContext: async () => ({ configured: false, settings: { enabled: true }, position: null }) },
    { __jptPageState: () => ({ configured: true, enabled: true }) },
  );
  await tick();
  const toggle = f.action('toggle');
  assert.equal(toggle.attributes['aria-pressed'], 'true');
  assert.doesNotMatch(f.status().textContent || '', /not set up|Set up/i);
  f.api.destroy();
});
