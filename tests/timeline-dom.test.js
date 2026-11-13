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
const load = (extra = '') => new JSDOM(`<!doctype html><body>${extra}${fixture}</body>`).window.document;

test('the issue table and its rows are found from the key cells', () => {
  const doc = load();
  const table = A.getTable(doc);
  assert.ok(table, 'table');
  assert.equal(table.tagName, 'TABLE');
  assert.equal(A.getRows(table).length, 8);
  assert.deepEqual(A.getRows(null), []);
});

test('another table on the page is not mistaken for the Timeline', () => {
  const doc = load('<table><thead><tr><th>other</th></tr></thead><tbody><tr><td>row</td></tr></tbody></table>');
  assert.ok(A.getTable(doc).querySelector(A.SEL.KEY), 'picked the table that holds issue keys');
});

test('each bar sits in the same row as its issue key and maps back to that row', () => {
  const doc = load();
  const withBar = A.getRows(A.getTable(doc)).filter((row) => A.getRowBar(row));
  assert.equal(withBar.length, 3);
  for (const row of withBar) {
    assert.match(A.getRowKey(row), /^DEMO-\d+$/);
    const bar = A.getRowBar(row);
    const id = A.issueIdOfBar(bar);
    assert.match(id, /^\d+$/);
    assert.equal(A.findBar(doc, id), bar);
    assert.equal(A.closestBar(bar.firstElementChild || bar), bar);
  }
  assert.equal(A.closestBar(A.getTable(doc)), null);
  assert.equal(A.findBar(doc, '"]'), null);
});

test('the chart overlay used for holiday strips is found and lies outside the table', () => {
  const doc = load();
  const table = A.getTable(doc);
  const overlay = A.getOverlay(table);
  assert.ok(overlay, 'overlay');
  assert.equal(table.contains(overlay), false);
  assert.match(overlay.getAttribute('data-testid'), /chart-overlays\.container$/);
});

test('the scroller and the current-period columns are found', () => {
  const doc = load();
  const scroller = A.getScroller(doc);
  assert.ok(scroller?.contains(A.getTable(doc)), 'scroller wraps the table');
  assert.ok(doc.querySelectorAll(A.SEL.COLUMN_OVERLAY).length > 0, 'column overlays');
});
