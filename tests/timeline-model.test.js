const test = require('node:test'),
  assert = require('node:assert/strict');
const M = require('../timeline_model.js');
const R = require('../issue_rules.js');
const t = require('../i18n.js').forLocale('en').t;

const profile = {
  issueTypes: { planning: ['10'], milestone: ['20'], epic: ['30'] },
  fields: { role: 'cf_role', startDate: 'cf_start', targetEnd: 'cf_target', epicHighlight: 'cf_hl' },
  progress: { enabled: true, linkTypeIds: ['40'], direction: 'both', inProgressWeight: 0.5 },
  highlightRule: { operator: 'equals', value: 'yes' },
};
const link = (key, cat, extra = {}) => ({
  type: { id: '40' },
  outwardIssue: { id: key, key, fields: { summary: `s ${key}`, status: { statusCategory: { key: cat } }, ...extra } },
});

test('bar styles follow the issue type and the settings', () => {
  const s = { msDiamond: true, epicStripe: true };
  assert.deepEqual(M.barClasses('planning', {}, s), {
    planning: true,
    milestone: false,
    diamond: false,
    epic: false,
    epicHighlight: false,
  });
  assert.equal(M.barClasses('milestone', {}, s).diamond, true);
  assert.equal(M.barClasses('milestone', {}, { msDiamond: false }).diamond, false);
  assert.equal(M.barClasses('epic', { epicHighlight: true }, s).epicHighlight, true);
  assert.equal(M.barClasses('epic', { epicHighlight: true }, { epicStripe: false }).epicHighlight, false);
  assert.deepEqual(Object.values(M.barClasses('other', { epicHighlight: true }, s)), [
    false,
    false,
    false,
    false,
    false,
  ]);
});

test('the milestone badge shows progress and due date, and nothing when there is neither', () => {
  const p = { done: 1, wip: 1, total: 4, pct: 38 };
  const badge = M.progressBadge(p, '2026-11-20', { weight: 0.5, t });
  assert.equal(badge.text, '1/4 38% · DUE 11/20');
  assert.equal(badge.tier, 'low');
  assert.match(badge.title, /1 done \+ 1 in progress/);
  assert.match(badge.title, /2026-11-20/);
  assert.equal(M.progressBadge(null, '2026-11-20', { t }).text, 'DUE 11/20');
  assert.equal(M.progressBadge(null, '2026-11-20', { t }).tier, 'zero');
  assert.equal(M.progressBadge({ done: 0, wip: 0, total: 0, pct: 0 }, null, { t }), null);
  assert.deepEqual(
    [0, 1, 50, 100].map((pct) => M.progressTier(pct)),
    ['zero', 'low', 'mid', 'done'],
  );
});

test('target end shading sits between start and due, and is skipped for impossible dates', () => {
  const d = (startDate, targetEndDate, dueDate) => M.targetEndRatio({ startDate, targetEndDate, dueDate });
  assert.equal(d('2026-11-01', '2026-11-01', '2026-11-10'), 0);
  assert.equal(d('2026-11-01', '2026-11-06', '2026-11-10'), 0.5);
  assert.equal(d('2026-11-01', '2026-11-12', '2026-11-10'), null);
  assert.equal(d('2026-11-01', null, '2026-11-10'), null);
  assert.equal(M.targetEndRatio(), null);
});

test('a Jira issue becomes a cache record; links are read only for milestones with progress on', () => {
  const issue = {
    key: 'DEMO-1',
    fields: {
      issuetype: { id: '20' },
      duedate: '2026-11-20',
      cf_start: '2026-02-30',
      cf_hl: { value: 'yes' },
      cf_role: [{ value: 'Art' }, 'QA', 3],
      issuelinks: [link('DEMO-3', 'done'), link('DEMO-2', 'indeterminate'), link('bad key', 'new')],
    },
  };
  const on = R.toIssueRecord(issue, profile, { msShowProgress: true }, 'https://demo.atlassian.net');
  assert.equal(on.type, 'milestone');
  assert.deepEqual(on.data, {
    epicHighlight: true,
    progress: { done: 1, wip: 1, total: 3, pct: 50, partial: false },
    startDate: null,
    dueDate: '2026-11-20',
    targetEndDate: null,
  });
  assert.deepEqual(
    on.detail.relates.map((r) => r.key),
    ['DEMO-2', 'DEMO-3'],
  );
  assert.deepEqual(on.detail.roles, ['Art', 'QA']);
  const off = R.toIssueRecord(issue, profile, { msShowProgress: false }, 'https://demo.atlassian.net');
  assert.equal(off.data.progress, null);
  assert.deepEqual(off.detail.relates, []);
  assert.equal(R.toIssueRecord({ key: 'X-1' }, profile, {}, '').type, 'other');
});

test('linked issues sort by status, then type, summary and key in natural order', () => {
  const items = [
    { key: 'A-10', statusCat: 'done' },
    { key: 'A-2', statusCat: 'new' },
    { key: 'A-9', statusCat: 'indeterminate', typeName: 'Task' },
    { key: 'A-1', statusCat: 'indeterminate', typeName: 'Bug' },
    { key: 'A-11', statusCat: 'new' },
  ];
  assert.deepEqual(
    R.sortRelates(items).map((i) => i.key),
    ['A-1', 'A-9', 'A-2', 'A-11', 'A-10'],
  );
});
