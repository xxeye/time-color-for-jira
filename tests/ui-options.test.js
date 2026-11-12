const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  vm = require('node:vm');
const S = require('../settings.js'),
  UI = require('../ui_helpers.js');
// approve: true → 確認鈕、false → 取消鈕、null → 對話框停著，由測試用 answer() 回應。
function fixture({ conflict = false, approve = true, initial = null } = {}) {
  const elements = {},
    opened = [],
    imports = [],
    removed = [],
    calls = [],
    prompts = [];
  let config = initial || S.emptyConfig(),
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
  const dialog = elements['confirm-dialog'];
  Object.assign(dialog, { open: false, returnValue: 'stale' });
  // 照瀏覽器行為：表單按鈕把 value 寫進 returnValue；Esc（value 為 undefined）不改 returnValue。
  function answer(value) {
    assert.equal(dialog.open, true, 'dialog should be open');
    if (value !== undefined) dialog.returnValue = value;
    dialog.open = false;
    dialog.handlers.close();
  }
  dialog.showModal = function () {
    assert.equal(this.open, false, 'showModal on an open dialog throws');
    this.open = true;
    prompts.push({ message: elements['confirm-message'].textContent, action: elements['confirm-ok'].textContent });
    if (approve !== null) queueMicrotask(() => answer(approve ? 'ok' : 'cancel'));
  };
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
    removeSite: async (origin) => {
      removed.push(origin);
      delete config.sites[origin];
    },
    restoreConfig: async () => {
      calls.push('restore');
    },
    resetPreferences: async () => {
      calls.push('reset');
    },
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
    confirm: () => assert.fail('window.confirm should not be used'),
  });
  return {
    elements,
    imports,
    opened,
    removed,
    calls,
    prompts,
    answer,
    dialog,
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
test('replacement waits for the dialog and writes nothing until confirmed', async () => {
  const f = fixture({ conflict: true, approve: null });
  await new Promise(setImmediate);
  await f.choose(config());
  const pending = f.elements.apply.handlers.click();
  await new Promise(setImmediate);
  assert.equal(f.dialog.open, true);
  assert.equal(f.prompts[0].action, 'Replace');
  assert.deepEqual(
    f.imports.map((o) => o.replace),
    [false],
  );
  f.answer('ok');
  await pending;
  assert.deepEqual(
    f.imports.map((o) => o.replace),
    [false, true],
  );
  assert.equal(f.draft, null);
});
function removeButton(f) {
  return f.elements.sites.children[0].children.find((n) => n.textContent === 'Remove this site');
}
test('removing a site asks first; cancel keeps it, confirm removes it', async () => {
  const f = fixture({ approve: null, initial: config() });
  await new Promise(setImmediate);
  let button = removeButton(f);
  let pending = button.handlers.click();
  await new Promise(setImmediate);
  assert.equal(f.prompts[0].action, 'Remove');
  assert.match(f.prompts[0].message, /demo\.atlassian\.net/);
  f.answer('cancel');
  await pending;
  assert.deepEqual(f.removed, []);
  assert.equal(button.disabled, false);
  assert.equal(button.focused, true);
  pending = button.handlers.click();
  await new Promise(setImmediate);
  f.answer('ok');
  await pending;
  assert.deepEqual(f.removed, ['https://demo.atlassian.net']);
  assert.match(f.elements.notice.textContent, /removed/);
  assert.equal(f.elements['saved-heading'].focused, true);
});
test('Escape after an earlier confirmation does not reuse the old answer', async () => {
  const f = fixture({ approve: null });
  await new Promise(setImmediate);
  let pending = f.elements.restore.handlers.click();
  await new Promise(setImmediate);
  assert.equal(f.dialog.returnValue, '');
  f.answer('ok');
  await pending;
  assert.deepEqual(f.calls, ['restore']);
  pending = f.elements.reset.handlers.click();
  await new Promise(setImmediate);
  assert.equal(f.prompts[1].action, 'Reset');
  f.answer(); // Esc
  await pending;
  assert.deepEqual(f.calls, ['restore']);
  assert.equal(f.dialog.open, false);
});
test('restore and reset run once each when confirmed', async () => {
  const f = fixture();
  await new Promise(setImmediate);
  await f.elements.restore.handlers.click();
  await f.elements.reset.handlers.click();
  assert.deepEqual(f.calls, ['restore', 'reset']);
  assert.deepEqual(
    f.prompts.map((p) => p.action),
    ['Restore', 'Reset'],
  );
});
test('legacy onboarding redirects to settings management', () => {
  let target;
  vm.runInNewContext(fs.readFileSync(require.resolve('../onboarding.js'), 'utf8'), {
    location: { replace: (value) => (target = value) },
    chrome: { runtime: { getURL: (path) => 'chrome-extension://test/' + path } },
  });
  assert.equal(target, 'chrome-extension://test/options.html');
});
