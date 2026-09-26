const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  vm = require('node:vm');
const S = require('../settings.js'),
  UI = require('../ui_helpers.js');
function fixture({ conflict = false, approve = true } = {}) {
  const elements = {},
    opened = [],
    imports = [];
  let config = S.emptyConfig(),
    draft = null;
  function node(tag = 'div') {
    return {
      tagName: tag.toUpperCase(),
      children: [],
      handlers: {},
      hidden: false,
      value: '',
      textContent: '',
      disabled: false,
      classList: { add() {}, remove() {}, toggle() {} },
      append(...children) {
        this.children.push(...children);
      },
      replaceChildren(...children) {
        this.children = children;
        this.textContent = '';
      },
      addEventListener(name, fn) {
        this.handlers[name] = fn;
      },
      setAttribute() {},
      focus() {
        this.focused = true;
      },
    };
  }
  for (const m of fs
    .readFileSync(require.resolve('../options.html'), 'utf8')
    .matchAll(/<\w+[^>]*\bid="([^"]+)"[^>]*>/g)) {
    elements[m[1]] = node();
    elements[m[1]].hidden = /\bhidden\b/.test(m[0]);
  }
  const client = {
    getAll: async () => ({ config }),
    getDraft: async () => draft,
    saveDraft: async (value) => {
      draft = value;
    },
    clearDraft: async () => {
      draft = null;
    },
    importConfig: async (value, opts) => {
      imports.push(opts);
      if (conflict && !opts.replace) return { ok: false, code: 'conflict' };
      config = value;
      return { ok: true };
    },
    subscribe() {},
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../options.js'), 'utf8'), {
    document: { getElementById: (id) => elements[id], createElement: node, querySelectorAll: () => [] },
    JptI18n: require('../i18n.js').forLocale('en'),
    JptSettings: S,
    JptUI: UI,
    JptCalendar: require('../calendar.js'),
    JptClient: client,
    chrome: {
      runtime: { id: 'test', onMessage: { addListener() {} } },
      tabs: {
        create: async (value) => {
          opened.push(value);
        },
      },
    },
    confirm: () => approve,
  });
  return {
    elements,
    imports,
    opened,
    get draft() {
      return draft;
    },
    async choose(value) {
      await elements['config-file'].handlers.change({
        target: { files: [{ size: 100, text: async () => JSON.stringify(value) }], value: 'selected' },
      });
    },
  };
}
function config() {
  const c = S.emptyConfig(),
    p = S.createProfile();
  p.issueTypes.epic = ['3'];
  p.fields.startDate = 'customfield_1';
  p.timelinePath = '/jira/software/projects/DEMO/timeline';
  c.sites['https://demo.atlassian.net'] = { defaults: p, projects: {} };
  return c;
}
test('settings management previews then saves import on the same page without opening Jira', async () => {
  const f = fixture();
  await new Promise(setImmediate);
  await f.choose(config());
  assert.equal(f.elements.preview.hidden, false);
  assert.equal(f.imports.length, 0);
  assert.ok(f.draft);
  assert.match(JSON.stringify(f.elements['preview-list'].children), /demo.atlassian.net/);
  // Holidays live in the configuration now; without a list only weekends are marked.
  assert.match(JSON.stringify(f.elements['preview-list'].children), /only weekends/);
  await f.elements.apply.handlers.click();
  assert.equal(f.imports.length, 1);
  assert.equal(f.draft, null);
  assert.equal(f.elements.preview.hidden, true);
  assert.equal(f.opened.length, 0);
  assert.match(f.elements.notice.textContent, /saved/);
  assert.equal(f.elements.sites.children.length, 1);
  const buttons = f.elements.sites.children[0].children.flatMap((n) => n.children || []);
  const open = buttons.find((n) => n.textContent === 'Open Timeline');
  assert.ok(open);
  await open.handlers.click();
  assert.equal(f.opened[0].url, 'https://demo.atlassian.net/jira/software/projects/DEMO/timeline');
});
test('cancelled replacement keeps the import preview and draft', async () => {
  const f = fixture({ conflict: true, approve: false });
  await new Promise(setImmediate);
  await f.choose(config());
  await f.elements.apply.handlers.click();
  assert.equal(f.imports.length, 1);
  assert.ok(f.draft);
  assert.equal(f.elements.preview.hidden, false);
  assert.equal(f.opened.length, 0);
});
test('legacy onboarding redirects to settings management', () => {
  let target;
  vm.runInNewContext(fs.readFileSync(require.resolve('../onboarding.js'), 'utf8'), {
    location: { replace: (value) => (target = value) },
    chrome: { runtime: { getURL: (path) => 'chrome-extension://test/' + path } },
  });
  assert.equal(target, 'chrome-extension://test/options.html');
});
