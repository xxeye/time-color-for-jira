const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
function optional(name) {
  try {
    return require(path.join('..', name));
  } catch (e) {
    if (e.code === 'MODULE_NOT_FOUND') return {};
    throw e;
  }
}
const rules = optional('issue_rules.js');
const cache = optional('issue_cache.js');
const calendar = optional('calendar.js');
const api = optional('jiraApi.js');
const profile = {
  issueTypes: { planning: ['10'], milestone: ['20'], epic: ['30'] },
  fields: {
    role: 'customfield_1',
    startDate: 'customfield_2',
    targetEnd: 'customfield_3',
    epicHighlight: 'customfield_4',
  },
  progress: { enabled: true, linkTypeIds: ['40'], direction: 'both', inProgressWeight: 0.5 },
  highlightRule: { operator: 'equals', value: 'yes' },
};
test('classifies by configured IDs despite renamed types', () => {
  assert.equal(typeof rules.classifyIssue, 'function');
  assert.equal(rules.classifyIssue({ fields: { issuetype: { id: '20', name: 'Changed' } } }, profile), 'milestone');
  assert.equal(rules.classifyIssue({ fields: { issuetype: { id: '99', name: 'Milestone' } } }, profile), 'other');
});
test('progress deduplicates peers, respects direction and does not count missing status as done', () => {
  assert.equal(typeof rules.computeProgress, 'function');
  const peer = (id, cat) => ({ id, key: 'DEMO-' + id, fields: { status: { statusCategory: { key: cat } } } });
  const links = [
    { type: { id: '40' }, outwardIssue: peer('1', 'done') },
    { type: { id: '40' }, inwardIssue: peer('1', 'done') },
    { type: { id: '40' }, outwardIssue: peer('2', 'indeterminate') },
    { type: { id: '40' }, outwardIssue: peer('3', null) },
  ];
  assert.deepEqual(rules.computeProgress(links, profile), { done: 1, wip: 1, total: 3, pct: 50, partial: true });
  assert.equal(
    rules.computeProgress(links, { ...profile, progress: { ...profile.progress, direction: 'inward' } }).total,
    1,
  );
  assert.equal(rules.computeProgress([], profile), null);
});
test('required fields omit disabled dependencies and image URLs cannot cause third-party requests', () => {
  assert.equal(typeof rules.requiredFields, 'function');
  assert.deepEqual(rules.requiredFields(profile, {}), ['issuetype', 'customfield_1']);
  assert.equal(rules.safeIcon('https://outside.example/icon', 'https://demo.atlassian.net'), '');
  assert.equal(rules.safeIcon('/icon', 'https://demo.atlassian.net'), 'https://demo.atlassian.net/icon');
  assert.equal(rules.highlight([{ id: 'yes' }], profile.highlightRule), true);
});
test('missing icon values do not resolve to a Jira page request', () => {
  for (const value of ['', '   ', null, undefined])
    assert.equal(rules.safeIcon(value, 'https://demo.atlassian.net'), '');
});
test('memory cache expires values physically and evicts least recently used', () => {
  assert.equal(typeof cache.MemoryCache, 'function');
  let now = 0;
  const c = new cache.MemoryCache({ ttl: 10, max: 2, clock: () => now });
  c.set('a', { summary: 'private' });
  c.set('b', 2);
  c.get('a');
  c.set('c', 3);
  assert.equal(c.has('b'), false);
  now = 11;
  c.purge();
  assert.equal(c.size, 0);
});
test('working days count inclusive days, skip holidays and count make-up workdays', () => {
  assert.equal(typeof calendar.countWorkingDays, 'function');
  // Only weekends without a holiday list; every year is complete.
  assert.deepEqual(calendar.countWorkingDays('2026-03-06', '2026-03-09', calendar.dayInfo({ weekendDays: [0, 6] })), {
    days: 2,
    complete: true,
  });
  assert.equal(calendar.countWorkingDays('2026-02-30', '2026-03-01'), null);
  const info = calendar.dayInfo({
    weekendDays: [0, 6],
    holidays: [{ date: '2027-02-15' }],
    workdays: [{ date: '2027-02-20' }],
  });
  // Mon 15 (holiday) .. Sat 20 (make-up workday): 16, 17, 18, 19, 20.
  assert.deepEqual(calendar.countWorkingDays('2027-02-15', '2027-02-20', info), { days: 5, complete: true });
  assert.equal(calendar.kindOf('2027-02-20', info), 'workday');
  assert.equal(calendar.kindOf('2027-02-21', info), 'weekend');
  assert.equal(calendar.kindOf('2027-02-15', info), 'holiday');
  // A year without any listed days is incomplete once a list exists.
  assert.equal(calendar.countWorkingDays('2027-12-31', '2028-01-03', info).complete, false);
});
test('search consumes every page and uses only fixed same-origin endpoints', async () => {
  assert.equal(typeof api.createApi, 'function');
  const calls = [];
  const client = api.createApi({
    origin: 'https://demo.atlassian.net',
    fetchImpl: async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return {
        ok: true,
        status: 200,
        json: async () =>
          calls.length === 1
            ? { issues: [{ id: '1' }], nextPageToken: 'next' }
            : { issues: [{ id: '2' }], isLast: true },
      };
    },
  });
  assert.equal((await client.searchByKeys(['DEMO-1', 'DEMO-2'], ['issuetype'])).length, 2);
  assert.equal(calls[1].body.nextPageToken, 'next');
  await assert.rejects(() => client.searchByKeys(['bad" OR true'], ['issuetype']));
});
test('API respects Retry-After and never retries permission errors', async () => {
  assert.equal(typeof api.createApi, 'function');
  const waits = [];
  let count = 0;
  const client = api.createApi({
    origin: 'https://demo.atlassian.net',
    wait: async (ms) => waits.push(ms),
    fetchImpl: async () =>
      ++count === 1
        ? { ok: false, status: 429, headers: { get: () => '90' } }
        : { ok: true, status: 200, json: async () => ({ issues: [] }) },
  });
  await client.searchByKeys(['DEMO-1']);
  assert.equal(waits[0], 90000);
  count = 0;
  const forbidden = api.createApi({
    origin: 'https://demo.atlassian.net',
    fetchImpl: async () => {
      count++;
      return { ok: false, status: 403 };
    },
  });
  await assert.rejects(
    () => forbidden.getIssue('DEMO-1'),
    (e) => e.status === 403,
  );
  assert.equal(count, 1);
});
