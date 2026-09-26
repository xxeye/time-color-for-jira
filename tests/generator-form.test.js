const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const S = require('../settings.js');

function fixture() {
  const elements = {},
    fields = [],
    settingInputs = [],
    downloads = [];
  function node(tag = 'div') {
    const n = {
      tagName: tag.toUpperCase(),
      type: 'text',
      value: '',
      checked: false,
      dataset: {},
      children: [],
      handlers: {},
      append(...items) {
        this.children.push(...items);
        for (const item of items) if (item?.dataset?.setting) settingInputs.push(item);
      },
      replaceChildren(...items) {
        this.children = items;
      },
      addEventListener(k, fn) {
        this.handlers[k] = fn;
      },
      setAttribute() {},
      removeAttribute() {},
      insertAdjacentElement() {},
      focus() {},
      remove() {},
      click() {},
    };
    return n;
  }
  const html = fs.readFileSync(path.join(__dirname, '../config-generator/index.html'), 'utf8');
  for (const match of html.matchAll(/<(\w+)([^>]*\bid="([^"]+)"[^>]*)>/g)) {
    const n = (elements[match[3]] = node(match[1])),
      attrs = match[2];
    n.id = match[3];
    n.type = attrs.match(/type="([^"]+)"/)?.[1] || 'text';
    n.value = attrs.match(/value="([^"]*)"/)?.[1] || '';
    n.checked = /\bchecked\b/.test(attrs);
    if (attrs.includes('data-field')) fields.push(n);
    if (match[1] === 'select') {
      const rest = html.slice(match.index + match[0].length).split('</select>')[0];
      n.options = [...rest.matchAll(/<option value="([^"]+)"/g)].map((m) => ({ value: m[1] }));
      n.value = n.options[0]?.value || '';
    }
  }
  elements.generatorForm.querySelectorAll = (selector) =>
    selector === '[data-field]' ? fields : selector === '[data-setting]' ? settingInputs : [];
  const doc = {
    getElementById: (id) => elements[id] || settingInputs.find((n) => n.id === id),
    createElement: node,
    createTextNode: (text) => ({ text }),
    querySelectorAll: () => [],
    body: node(),
    addEventListener(event, fn) {
      if (event === 'DOMContentLoaded') fn();
    },
  };
  const context = vm.createContext({
    document: doc,
    URL: class extends URL {
      static createObjectURL(blob) {
        downloads.push(blob);
        return 'blob:test';
      }
      static revokeObjectURL() {}
    },
    Blob,
    TextEncoder,
    addEventListener() {},
    confirm: () => true,
    JptI18n: require('../i18n.js').forLocale('en'),
    setTimeout: (fn) => fn(),
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../settings.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../config-generator/generator.js'), 'utf8'), context);
  return {
    elements,
    settingInputs,
    downloads,
    async import(config) {
      await elements.importFile.handlers.change({
        target: { files: [{ size: 100, text: async () => JSON.stringify(config) }], value: 'file' },
      });
    },
    submit() {
      elements.generatorForm.handlers.submit({ preventDefault() {} });
    },
  };
}
test('generator form preserves omitted administrator preferences when importing and downloading', async () => {
  const f = fixture(),
    config = S.emptyConfig(),
    p = S.createProfile();
  p.settings = { ptColor: '#123456' };
  config.sites['https://sample.atlassian.net'] = { defaults: p, projects: {} };
  await f.import(config);
  assert.equal(f.settingInputs.find((n) => n.dataset.setting === 'msDiamond').checked, true);
  assert.equal(f.settingInputs.find((n) => n.dataset.setting === 'msColor').value, '#FF8B00');
  f.submit();
  assert.equal(f.downloads.length, 1);
  assert.deepEqual(JSON.parse(await f.downloads[0].text()), config);
});
test('Epic stripe options are not offered, but imported values are kept', async () => {
  const f = fixture(),
    config = S.emptyConfig(),
    p = S.createProfile();
  assert.equal(f.settingInputs.some((n) => n.dataset.setting === 'epicStripe'), false);
  assert.equal(f.elements.highlightOperator.type, 'hidden');
  p.issueTypes.epic = ['13'];
  p.fields.epicHighlight = 'customfield_22';
  p.fields.startDate = 'customfield_23';
  p.highlightRule = { operator: 'equals', value: 'on' };
  p.settings = { epicStripe: true };
  config.sites['https://sample.atlassian.net'] = { defaults: p, projects: {} };
  await f.import(config);
  f.submit();
  assert.deepEqual(JSON.parse(await f.downloads[0].text()), config);
});
test('holidays and make-up workdays round-trip through the form', async () => {
  const f = fixture(),
    config = S.emptyConfig(),
    p = S.createProfile();
  p.calendar.holidays = [{ date: '2027-01-01', name: 'New Year' }, { date: '2027-04-04' }];
  p.calendar.workdays = [{ date: '2027-02-20', name: 'Make-up day' }];
  config.sites['https://sample.atlassian.net'] = { defaults: p, projects: {} };
  await f.import(config);
  assert.equal(f.elements.holidays.value, '2027-01-01 New Year\n2027-04-04');
  f.submit();
  assert.deepEqual(JSON.parse(await f.downloads[0].text()), config);
});
