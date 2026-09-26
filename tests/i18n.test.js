const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { scanJs, scanHtml } = require('./text-scan.js');
const I18n = require('../i18n.js');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const locales = fs.readdirSync(path.join(root, '_locales'));
const messages = (locale) => JSON.parse(read('_locales/' + locale + '/messages.json'));
const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
const scripts = [...fs.readdirSync(root).filter((file) => file.endsWith('.js')), 'config-generator/generator.js'];
const pages = ['popup.html', 'options.html', 'onboarding.html', 'config-generator/index.html'];
// These files parse Jira's own interface text (dates, month names, view labels) and may contain it.
const JIRA_FORMAT_FILES = new Set(['timeline_dates.js', 'timeline_geometry.js']);

test('English is the default locale and Traditional Chinese is shipped', () => {
  assert.ok(locales.includes('en'));
  assert.ok(locales.includes('zh_TW'));
  assert.equal(JSON.parse(read('manifest.json')).default_locale, 'en');
});

test('every locale has the same messages and placeholders', () => {
  const base = messages('en');
  const keys = Object.keys(base).sort();
  assert.equal(new Set(keys.map((key) => key.toLowerCase())).size, keys.length, 'Chrome message names ignore case');
  for (const locale of locales) {
    const current = messages(locale);
    assert.deepEqual(Object.keys(current).sort(), keys, locale);
    for (const key of keys) {
      const text = current[key].message;
      assert.ok(typeof text === 'string' && text.trim(), locale + '.' + key + ' is empty');
      assert.ok(!text.includes('$'), locale + '.' + key + ' must not use $ placeholders');
      assert.deepEqual(placeholders(text), placeholders(base[key].message), locale + '.' + key + ' placeholders');
    }
  }
});

test('scripts, pages and manifest use only defined messages, and every message is used', () => {
  const defined = new Set(Object.keys(messages('en')));
  const referenced = new Set();
  const literals = new Set();
  for (const file of scripts) {
    const src = read(file);
    for (const match of src.matchAll(/\bt\(\s*['"]([A-Za-z0-9_]+)['"]/g)) referenced.add(match[1]);
    for (const match of src.matchAll(/['"]([A-Za-z][A-Za-z0-9_]*)['"]/g)) literals.add(match[1]);
  }
  for (const file of pages) {
    const src = read(file);
    for (const match of src.matchAll(/data-i18n="([^"]+)"/g)) referenced.add(match[1]);
    for (const match of src.matchAll(/data-i18n-attr="([^"]+)"/g))
      for (const pair of match[1].split(';')) referenced.add(pair.split(':')[1].trim());
  }
  for (const match of read('manifest.json').matchAll(/__MSG_([A-Za-z0-9_]+)__/g)) referenced.add(match[1]);
  for (const key of referenced) assert.ok(defined.has(key), 'missing message: ' + key);
  assert.deepEqual(
    [...defined].filter((key) => !referenced.has(key) && !literals.has(key)),
    [],
    'unused messages',
  );
});

test('user-facing text is not hardcoded in scripts or pages', () => {
  const found = [];
  for (const file of scripts) {
    if (JIRA_FORMAT_FILES.has(file)) continue;
    for (const hit of scanJs(read(file))) found.push(file + ':' + hit.line + ' ' + hit.text);
  }
  for (const file of pages) for (const hit of scanHtml(read(file))) found.push(file + ':' + hit.line + ' ' + hit.text);
  assert.deepEqual(found, []);
});

test('t fills named placeholders and falls back to the key', () => {
  const i18n = I18n.fromMessages({ greeting: { message: 'Hi {name}, {name}! {unknown}' } });
  assert.equal(i18n.t('greeting', { name: 'Ada' }), 'Hi Ada, Ada! {unknown}');
  assert.equal(i18n.t('missing'), 'missing');
});

test('apply translates text, attributes and the page language', () => {
  const zh = I18n.forLocale('zh_TW');
  const heading = {
    attributes: { 'data-i18n': 'manageSettings' },
    textContent: '',
    getAttribute(name) {
      return this.attributes[name];
    },
  };
  const toolbar = {
    attributes: { 'data-i18n-attr': 'aria-label:tbGroupLabel; title:tbRescanTitle' },
    getAttribute(name) {
      return this.attributes[name];
    },
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
  };
  const doc = {
    documentElement: {},
    querySelectorAll: (selector) => (selector === '[data-i18n]' ? [heading] : [toolbar]),
  };
  zh.apply(doc);
  assert.equal(heading.textContent, '設定管理');
  assert.equal(toolbar.attributes['aria-label'], 'Timeline 工具列');
  assert.equal(toolbar.attributes.title, '重新掃描 Timeline');
  assert.equal(doc.documentElement.lang, 'zh-TW');
});
