const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const settings = require('../settings.js');
function fixture(tabs = [], configured = false, tabReply = { projectId: '42' }) {
  const html = fs.readFileSync(require('node:path').join(__dirname, '../popup.html'), 'utf8');
  const elements = {};
  for (const match of html.matchAll(/<[^>]+id="([^"]+)"[^>]*>/g))
    elements[match[1]] = {
      type: match[0].includes('type="checkbox"') ? 'checkbox' : 'text',
      value: '',
      checked: false,
      parentElement: { hidden: false },
      handlers: {},
      classList: { add() {}, toggle() {} },
      addEventListener(k, fn) {
        this.handlers[k] = fn;
      },
      setAttribute() {},
      removeAttribute() {},
    };
  const patches = [],
    contexts = [],
    statusReads = [],
    tabMessages = [],
    listeners = [];
  let resets = 0,
    preferences = {},
    subscriber = null;
  const copy = (value) => JSON.parse(JSON.stringify(value));
  const client = {
    getContext: async (args) => {
      contexts.push(copy(args));
      if (args.origin && !settings.normalizeOrigin(args.origin)) throw Error('invalid origin');
      return { settings: settings.effectiveSettings(null, preferences), preferences: copy(preferences), configured };
    },
    savePreferences: async (patch) => {
      patches.push(copy(patch));
      preferences = { ...preferences, ...patch };
    },
    resetPreferences: async () => resets++,
    subscribe(fn) {
      subscriber = fn;
    },
  };
  vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname, '../popup.js'), 'utf8'), {
    document: { getElementById: (id) => elements[id], querySelectorAll: () => [] },
    JptI18n: require('../i18n.js').forLocale('en'),
    JptClient: client,
    JptSettings: settings,
    JptUI: {
      ...require('../ui_helpers.js'),
      renderStatus() {},
      tabStatus: async (api, recheck) => {
        statusReads.push(recheck);
        return { state: 'ready', message: 'ok', details: [] };
      },
    },
    chrome: {
      runtime: { id: 'extension-test', onMessage: { addListener: (listener) => listeners.push(listener) } },
      tabs: {
        query: async () => tabs,
        sendMessage: async (id, message) => {
          tabMessages.push(copy(message));
          return copy(tabReply);
        },
      },
    },
    URL,
  });
  return {
    elements,
    patches,
    contexts,
    statusReads,
    tabMessages,
    get resets() {
      return resets;
    },
    reload: () => subscriber(),
    emit(message, sender = { id: 'extension-test' }) {
      for (const listener of listeners) listener(message, sender);
    },
  };
}
test('popup loads preferences while active tab is outside Jira', async () => {
  const f = fixture([{ id: 1, url: 'chrome://extensions/' }]);
  await new Promise(setImmediate);
  assert.deepEqual(f.contexts, [{}]);
  assert.equal(f.elements['pt-color'].value, '#6a9a23');
});
test('opening popup reads status without requesting a recheck', async () => {
  const f = fixture([{ id: 1, url: 'https://demo.atlassian.net/jira/software/projects/DEMO/timeline' }], true);
  await new Promise(setImmediate);
  assert.deepEqual(f.statusReads, [false]);
});
test('checkbox persists only changed key, preserving concurrent settings', async () => {
  const f = fixture();
  await new Promise(setImmediate);
  f.elements['epic-stripe'].checked = true;
  await f.elements['epic-stripe'].handlers.change();
  await new Promise(setImmediate);
  assert.deepEqual(f.patches, [{ epicStripe: true }]);
});
test('popup reset uses broker preference reset and writes no admin configuration', async () => {
  const f = fixture();
  await new Promise(setImmediate);
  await f.elements.reset.handlers.click();
  assert.equal(f.resets, 1);
  assert.deepEqual(f.patches, []);
});
test('invalid color is not persisted', async () => {
  const f = fixture();
  await new Promise(setImmediate);
  f.elements['pt-color-text'].value = 'not-a-color';
  f.elements['pt-color-text'].handlers.change();
  assert.deepEqual(f.patches, []);
  assert.match(f.elements.status.textContent, /hex color/);
});

test('settings from the Jira project property are shown with their source and holiday years', async () => {
  const f = fixture([{ id: 1, url: 'https://demo.atlassian.net/jira/software/projects/DEMO/timeline' }], false, {
    projectId: '42',
    source: 'property',
    sourceLabel: 'Example Admin Tool',
    sourceUpdatedAt: '2026-09-25T00:00:00Z',
    years: [2026, 2027],
    profileSettings: { ptColor: '#123456', msColorEnabled: false, ptTargetEndShade: true },
  });
  await new Promise(setImmediate);
  assert.equal(f.elements['pt-color'].value, '#123456');
  assert.equal(f.elements['ms-color-enabled'].checked, false);
  assert.equal(f.elements['config-source'].hidden, false);
  assert.match(f.elements['config-source'].textContent, /Example Admin Tool/);
  assert.match(f.elements['calendar-status'].textContent, /2026–2027/);
  assert.equal(f.elements['manage-settings'].hidden, true);
  assert.match(f.elements['managed-note'].textContent, /No need to import/);
  assert.doesNotMatch(f.elements['managed-note'].textContent, /no effect/);
  // Configured by the property even without an imported file: status comes from the page, no recheck.
  assert.deepEqual(f.statusReads, [false]);
});

test('with project settings, a switch reflects the saved preference even if the page has not caught up', async () => {
  const f = fixture([{ id: 1, url: 'https://demo.atlassian.net/jira/software/projects/DEMO/timeline' }], false, {
    projectId: '42',
    source: 'property',
    years: [],
    profileSettings: { ptTargetEndShade: true },
  });
  await new Promise(setImmediate);
  assert.equal(f.elements['pt-target-end-shade'].checked, true);
  f.elements['pt-target-end-shade'].checked = false;
  await f.elements['pt-target-end-shade'].handlers.change();
  await f.reload();
  // The page still reports the old project default; the popup shows the saved preference.
  assert.equal(f.elements['pt-target-end-shade'].checked, false);
});

test('an imported file without holidays says only weekends are marked', async () => {
  const f = fixture([{ id: 1, url: 'https://demo.atlassian.net/jira/software/projects/DEMO/timeline' }], true, {
    projectId: '42',
    source: 'file',
    years: [],
  });
  await new Promise(setImmediate);
  assert.match(f.elements['config-source'].textContent, /imported configuration file/);
  assert.equal(f.elements['manage-settings'].hidden, false);
  assert.equal(f.elements['managed-note'].hidden, true);
  assert.match(f.elements['calendar-status'].textContent, /only weekends/);
});

test('color switches save their own preference', async () => {
  const f = fixture();
  await new Promise(setImmediate);
  f.elements['pt-color-enabled'].checked = false;
  await f.elements['pt-color-enabled'].handlers.change();
  assert.deepEqual(f.patches, [{ ptColorEnabled: false }]);
  assert.equal(f.elements['refresh-calendar'], undefined);
});

test('drag-lock switches save their own preference', async () => {
  const f = fixture();
  await new Promise(setImmediate);
  assert.equal(f.elements['pt-lock-drag'].checked, false);
  f.elements['pt-lock-drag'].checked = true;
  await f.elements['pt-lock-drag'].handlers.change();
  f.elements['epic-lock-drag'].checked = true;
  await f.elements['epic-lock-drag'].handlers.change();
  assert.deepEqual(f.patches, [{ ptLockDrag: true }, { epicLockDrag: true }]);
});

test('an imported file that a project setting overrides is called out', async () => {
  const f = fixture([{ id: 1, url: 'https://demo.atlassian.net/jira/software/projects/DEMO/timeline' }], true, {
    projectId: '42',
    source: 'property',
    years: [],
    profileSettings: {},
  });
  await new Promise(setImmediate);
  assert.match(f.elements['managed-note'].textContent, /no effect on this project/);
});
