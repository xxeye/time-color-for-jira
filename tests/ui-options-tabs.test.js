const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs');
const { createTabs } = require('../options_tabs.js');
function fixture(hash = '') {
  let focused = null;
  const listeners = {},
    nodes = {};
  const html = fs.readFileSync(require.resolve('../options.html'), 'utf8');
  for (const m of html.matchAll(/<\w+[^>]*\bid="([^"]+)"[^>]*>/g)) {
    const attrs = {};
    for (const a of m[0].matchAll(/\s([\w-]+)="([^"]*)"/g)) attrs[a[1]] = a[2];
    const node = {
      id: m[1],
      attrs,
      hidden: /\shidden[\s>]/.test(m[0]),
      tabIndex: 0,
      style: {},
      handlers: {},
      dataset: { src: attrs['data-src'] },
      classes: new Set(),
      setAttribute(k, v) {
        this.attrs[k] = String(v);
      },
      getAttribute(k) {
        return this.attrs[k] ?? null;
      },
      addEventListener(k, fn) {
        this.handlers[k] = fn;
      },
      focus() {
        focused = this.id;
      },
    };
    node.classList = { toggle: (name, on) => (on ? node.classes.add(name) : node.classes.delete(name)) };
    nodes[m[1]] = node;
  }
  const win = {
    location: { hash, pathname: '/options.html' },
    url: null,
    history: {
      replaceState(_, __, url) {
        win.url = url;
      },
    },
    addEventListener(k, fn) {
      listeners[k] = fn;
    },
  };
  createTabs({ getElementById: (id) => nodes[id] }, win);
  return {
    nodes,
    win,
    listeners,
    get focused() {
      return focused;
    },
  };
}
const press = (f, id, key) => f.nodes[id].handlers.keydown({ key, preventDefault() {} });

test('settings tab is shown by default and the admin generator is not loaded for employees', () => {
  const f = fixture();
  assert.equal(f.nodes['panel-settings'].hidden, false);
  assert.equal(f.nodes['panel-generator'].hidden, true);
  assert.equal(f.nodes['tab-settings'].attrs['aria-selected'], 'true');
  assert.equal(f.nodes['tab-generator'].attrs['aria-selected'], 'false');
  assert.equal(f.nodes['generator-frame'].getAttribute('src'), null);
});
test('generator tab loads the bundled generator page once and keeps it while switching back', () => {
  const f = fixture();
  f.nodes['tab-generator'].handlers.click();
  assert.equal(f.nodes['panel-generator'].hidden, false);
  assert.equal(f.nodes['panel-settings'].hidden, true);
  assert.equal(f.nodes['generator-frame'].getAttribute('src'), 'generator.html');
  assert.equal(f.win.url, '#generator');
  f.nodes['tab-settings'].handlers.click();
  assert.equal(f.nodes['panel-generator'].hidden, true);
  assert.equal(f.nodes['generator-frame'].getAttribute('src'), 'generator.html', 'form state survives tab switches');
  assert.equal(f.win.url, '/options.html');
});
test('generator hash deep-links and keyboard moves between tabs', () => {
  const f = fixture('#generator');
  assert.equal(f.nodes['panel-generator'].hidden, false);
  assert.equal(f.win.url, null);
  press(f, 'tab-generator', 'ArrowRight');
  assert.equal(f.nodes['panel-settings'].hidden, false);
  assert.equal(f.focused, 'tab-settings');
  assert.equal(f.nodes['tab-generator'].tabIndex, -1);
  press(f, 'tab-settings', 'End');
  assert.equal(f.focused, 'tab-generator');
  f.win.location.hash = '';
  f.listeners.hashchange();
  assert.equal(f.nodes['panel-settings'].hidden, false);
});
