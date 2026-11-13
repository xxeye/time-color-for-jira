// Runs the Jira DOM lookups against a real (de-identified) Timeline captured from a test project:
// tests/fixtures/timeline.html. When Jira changes its markup, re-capture the fixture and these tests
// show which lookup broke. Layout-dependent code (bounding boxes) is not covered here; jsdom has no layout.
const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path');
const { JSDOM } = require('jsdom');
const A = require('../timeline_adapter.js');

const fixture = fs.readFileSync(path.join(__dirname, 'fixtures/timeline.html'), 'utf8');
const SEL_BAR_CONTAINER = '[data-testid*="draggable-bar-"][data-testid$="-container"]';
const load = (extra = '') => new JSDOM(`<!doctype html><body>${extra}${fixture}</body>`).window.document;

test('the issue table is found from its key cells', () => {
  const doc = load();
  const table = A.getTable(doc);
  assert.ok(table, 'table');
  assert.equal(table.tagName, 'TABLE');
  assert.equal(table.querySelectorAll('tbody tr').length, 8);
});

test('another table on the page is not mistaken for the Timeline', () => {
  const doc = load('<table><thead><tr><th>other</th></tr></thead><tbody><tr><td>row</td></tr></tbody></table>');
  const table = A.getTable(doc);
  assert.ok(table.querySelector(A.SEL_KEY), 'picked the table that holds issue keys');
});

test('each bar sits in the same row as its issue key and carries a numeric issue id', () => {
  const table = A.getTable(load());
  const rows = [...table.querySelectorAll('tbody tr')];
  const withBar = rows.filter((row) => row.querySelector(SEL_BAR_CONTAINER));
  assert.equal(withBar.length, 3);
  for (const row of withBar) {
    assert.match(row.querySelector(A.SEL_KEY).textContent.trim(), /^DEMO-\d+$/);
    const id = row.querySelector(SEL_BAR_CONTAINER).getAttribute('data-testid').match(/issue\/(\d+)-container$/);
    assert.ok(id, 'bar testid ends with issue/<id>-container');
  }
});

test('the chart overlay used for holiday strips is found and lies outside the table', () => {
  const doc = load();
  const table = A.getTable(doc);
  const overlay = A.getOverlay(table);
  assert.ok(overlay, 'overlay');
  assert.equal(table.contains(overlay), false);
  assert.match(overlay.getAttribute('data-testid'), /chart-overlays\.container$/);
});
