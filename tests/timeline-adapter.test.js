const test = require('node:test');
const assert = require('node:assert/strict');
let A;
try {
  A = require('../timeline_adapter.js');
} catch {
  A = {};
}
test('overlay resolution excludes header duplicates and accepts the unlabelled body overlay', () => {
  const parent = {},
    header = { parentElement: {}, getBoundingClientRect: () => ({ height: 40 }) },
    body = { parentElement: parent, getBoundingClientRect: () => ({ height: 1962 }) };
  const scope = { querySelector: () => null, querySelectorAll: () => [header, body] };
  const table = { closest: () => scope, contains: (el) => el === header };
  assert.equal(A.getOverlay(table), parent);
  scope.querySelectorAll = () => [header];
  assert.equal(A.getOverlay(table), null);
});
test('table resolution never selects an unrelated table', () => {
  assert.equal(typeof A.getTable, 'function');
  const table = {};
  assert.equal(A.getTable({ querySelector: (s) => (s === A.SEL_KEY ? { closest: () => table } : null) }), table);
  assert.equal(A.getTable({ querySelector: (s) => (s === 'table' ? table : null) }), null);
});
test('project key accepts project paths and numeric project query without accepting board ID', () => {
  assert.equal(typeof A.getProjectKey, 'function');
  assert.equal(
    A.getProjectKey(new URL('https://example.atlassian.net/jira/software/projects/ABC/boards/23/timeline')),
    'ABC',
  );
  assert.equal(A.getProjectKey(new URL('https://example.atlassian.net/plugins/servlet/project-config/12')), '12');
  assert.equal(A.getProjectKey(new URL('https://example.atlassian.net/jira/boards/23?projectId=10001')), '10001');
  assert.equal(A.getProjectKey(new URL('https://example.atlassian.net/jira/boards/23')), null);
});
test('ordinary board issue tables do not establish Timeline context', () => {
  assert.equal(typeof A.isTimelinePage, 'function');
  const doc = { querySelector: (s) => (s === A.SEL_KEY ? {} : null) };
  assert.equal(
    A.isTimelinePage(new URL('https://example.atlassian.net/jira/software/projects/ABC/boards/1'), doc),
    false,
  );
  assert.equal(
    A.isTimelinePage(new URL('https://example.atlassian.net/jira/software/projects/ABC/boards/1/timeline'), doc),
    true,
  );
  assert.equal(A.isTimelinePage(new URL('https://example.atlassian.net/jira/core/projects/ABC/timeline'), doc), true);
  assert.equal(
    A.isTimelinePage(new URL('https://example.atlassian.net/jira/plans/1/scenarios/1/timeline'), doc),
    false,
  );
  assert.equal(
    A.isTimelinePage(new URL('https://example.atlassian.net/wiki/spaces/ABC/projects/X/timeline'), doc),
    false,
  );
});
test('Confluence pages are not treated as the Jira app', () => {
  assert.equal(A.isJiraApp(new URL('https://example.atlassian.net/wiki/home')), false);
  assert.equal(A.isJiraApp(new URL('https://example.atlassian.net/wiki')), false);
  assert.equal(A.isJiraApp(new URL('https://example.atlassian.net/jira/your-work')), true);
  assert.equal(A.isJiraApp(new URL('https://example.atlassian.net/wikipedia')), true);
});
test('today marker search is scoped and declines ambiguous candidates', () => {
  assert.equal(typeof A.findTodayMarker, 'function');
  const marker = () => ({
    getBoundingClientRect: () => ({ width: 2, height: 400, top: 10, bottom: 410, left: 50, right: 52 }),
  });
  const first = marker(),
    second = marker();
  let candidates = [first];
  const scope = { querySelectorAll: () => candidates };
  const table = { closest: () => scope, getBoundingClientRect: () => ({ top: 0, bottom: 500, left: 0, right: 800 }) };
  const doc = {
    querySelectorAll: () => {
      throw Error('must not scan document');
    },
  };
  assert.equal(A.findTodayMarker(doc, table), first);
  candidates = [first, second];
  assert.equal(A.findTodayMarker(doc, table), null);
  assert.equal(A.findTodayMarker(doc, null), null);
});
