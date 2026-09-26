const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../settings.js');
const config = () => ({
  schemaVersion: 1,
  template: { id: 'planning-timeline', version: 1 },
  sites: { 'https://alpha.atlassian.net': { defaults: S.createProfile(), projects: {} } },
});
test('resolves project overrides without leaking across sites', () => {
  const c = config();
  c.sites['https://alpha.atlassian.net'].projects['20'] = S.createProfile();
  c.sites['https://alpha.atlassian.net'].projects['20'].fields.role = 'customfield_123';
  assert.equal(S.validateConfig(c).ok, true);
  assert.equal(S.resolveProfile(c, 'https://alpha.atlassian.net', '20').fields.role, 'customfield_123');
  assert.equal(S.resolveProfile(c, 'https://beta.atlassian.net', '20'), null);
  assert.equal(S.resolveProfile(c, 'https://alpha.atlassian.net', '21').fields.role, null);
});
test('rejects pollution, unknown versions, fields and malformed values', () => {
  for (const mutate of [
    (c) => (c.schemaVersion = 2),
    (c) => (c.sites['https://alpha.atlassian.net'].defaults.settings.ptColor = 'red'),
    (c) => (c.sites['https://alpha.atlassian.net'].defaults.issueTypes.planning = ['name']),
    (c) => (c.sites['https://alpha.atlassian.net'].defaults.fields.role = '123'),
    (c) => (c.sites['https://alpha.atlassian.net'].defaults.calendar.weekendDays = [7]),
    (c) => (c.sites['https://alpha.atlassian.net'].defaults.timelinePath = '//evil.test/'),
    (c) => (c.sites['https://alpha.atlassian.net'].defaults.progress.inProgressWeight = 2),
  ]) {
    const c = config();
    mutate(c);
    assert.equal(S.validateConfig(c).ok, false);
  }
  assert.equal(S.validateConfig(JSON.parse('{"__proto__":{}}')).ok, false);
  let x = {};
  for (let i = 0; i < 30; i++) x = { x };
  assert.equal(S.validateConfig(x).ok, false);
});
test('forward compatibility: unknown keys are dropped and reported, known keys stay strict', () => {
  const c = config(),
    p = c.sites['https://alpha.atlassian.net'].defaults;
  c.issueData = [];
  p.future = { deep: [1, { x: true }] };
  p.settings.sparkles = true;
  p.progress.mode = 'x';
  p.fields.future = 'duedate';
  const r = S.validateConfig(c);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.deepEqual(r.ignored.sort(), [
    '$.issueData',
    'sites.https://alpha.atlassian.net.defaults.fields.future',
    'sites.https://alpha.atlassian.net.defaults.future',
    'sites.https://alpha.atlassian.net.defaults.progress.mode',
    'sites.https://alpha.atlassian.net.defaults.settings.sparkles',
  ]);
  const kept = r.value.sites['https://alpha.atlassian.net'].defaults;
  assert.equal('issueData' in r.value, false);
  assert.equal('future' in kept, false);
  assert.equal('sparkles' in kept.settings, false);
  assert.equal('mode' in kept.progress, false);
  assert.equal('future' in kept.fields, false);
  assert.equal(c.issueData.length, 0, 'the input is not modified');
  assert.equal(S.validateConfig(config()).ignored.length, 0);
  p.settings.ptColor = 'red';
  assert.equal(S.validateConfig(c).ok, false, 'a known key with a wrong type still fails');
  const q = config();
  q.sites['https://alpha.atlassian.net'].defaults.future = JSON.parse('{"__proto__": 1}');
  assert.equal(S.validateConfig(q).ok, false, 'unsafe keys fail even inside unknown sections');
});
test('origin and preference boundaries reject unsafe data and preserve defaults', () => {
  assert.equal(S.normalizeOrigin('https://ALPHA.atlassian.net/'), 'https://alpha.atlassian.net');
  for (const url of [
    'http://a.atlassian.net',
    'https://a.atlassian.net.evil.test',
    'https://u:p@a.atlassian.net',
    'https://a.atlassian.net/path',
    'https://a.atlassian.net:444',
  ])
    assert.equal(S.normalizeOrigin(url), null);
  assert.equal(S.effectiveSettings(S.createProfile(), { hideIssueKey: true, summary: 'secret' }).hideIssueKey, true);
  assert.equal(S.effectiveSettings(null, {}).enabled, true);
  assert.equal('summary' in S.effectiveSettings(null, { summary: 'secret' }), false);
});
test('profile validation rejects conflicting types, oversized profiles and bad dependencies', () => {
  const c = config(),
    p = c.sites['https://alpha.atlassian.net'].defaults;
  p.issueTypes.planning = ['1'];
  p.issueTypes.milestone = ['1'];
  assert.equal(S.validateConfig(c).ok, false);
  p.issueTypes.milestone = [];
  p.fields.startDate = 'customfield_10';
  p.fields.targetEnd = 'customfield_11';
  assert.equal(S.validateConfig(c).ok, true);
  p.highlightRule.value = 'x'.repeat(9000);
  assert.equal(S.validateConfig(c).ok, false);
});

test('only accepts runtime supported highlight comparisons', () => {
  for (const operator of ['contains', 'truthy']) {
    const c = config();
    c.sites['https://alpha.atlassian.net'].defaults.highlightRule.operator = operator;
    assert.equal(S.validateConfig(c).ok, false);
  }
});
test('requires fields only for selected features and configured issue types', () => {
  const c = config(),
    p = c.sites['https://alpha.atlassian.net'].defaults;
  p.issueTypes.milestone = ['1'];
  p.settings.msShowProgress = false;
  p.settings.showWorkingDays = false;
  assert.equal(S.validateConfig(c).ok, true, 'milestone marker uses built-in due date');
  p.settings.showWorkingDays = true;
  assert.equal(S.validateConfig(c).ok, false);
  p.fields.startDate = 'customfield_1';
  assert.equal(S.validateConfig(c).ok, true);
  p.settings.msShowProgress = true;
  assert.equal(S.validateConfig(c).ok, false, 'progress needs configured links');
  p.progress.linkTypeIds = ['3'];
  assert.equal(S.validateConfig(c).ok, true);
  p.issueTypes.planning = ['2'];
  p.settings.ptTargetEndShade = true;
  assert.equal(S.validateConfig(c).ok, false);
  p.fields.targetEnd = 'customfield_2';
  assert.equal(S.validateConfig(c).ok, true);
  p.issueTypes.epic = ['4'];
  p.settings.epicStripe = true;
  assert.equal(S.validateConfig(c).ok, false);
  p.fields.epicHighlight = 'customfield_3';
  assert.equal(S.validateConfig(c).ok, true);
});
test('rejects non-JSON numbers and oversized sparse arrays', () => {
  const c = config();
  c.sites['https://alpha.atlassian.net'].defaults.revision = NaN;
  assert.equal(S.validateConfig(c).ok, false);
  c.sites['https://alpha.atlassian.net'].defaults.issueTypes.planning = new Array(10001);
  assert.equal(S.validateConfig(c).ok, false);
});
test('project property: accepted shape, size limit and invalid days', () => {
  const p = S.createProfile();
  p.issueTypes.planning = ['1'];
  p.fields.startDate = 'customfield_1';
  p.calendar.holidays = [{ date: '2027-01-01', name: 'New Year' }];
  const value = { schemaVersion: 1, template: { id: 'planning-timeline', version: 1 }, profile: p, generatedBy: 'Example Admin Tool' };
  const ok = S.validateProperty(value);
  assert.equal(ok.ok, true, JSON.stringify(ok.errors));
  assert.equal(ok.value.generatedBy, 'Example Admin Tool');
  const extra = S.validateProperty({ ...value, sites: {} });
  assert.equal(extra.ok, true);
  assert.deepEqual(extra.ignored, ['$.sites']);
  const big = JSON.parse(JSON.stringify(value));
  big.profile.calendar.holidays = Array.from({ length: 300 }, (_, i) => ({
    date: new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10),
    name: 'x'.repeat(50),
  }));
  assert.equal(S.validateProperty(big).ok, false);
  const bad = JSON.parse(JSON.stringify(value));
  bad.profile.calendar.holidays = [{ date: '2027-01-01', name: '<b>' }];
  assert.equal(S.validateProperty(bad).ok, false);
});
test('retired drag-lock preferences are tolerated and ignored', () => {
  assert.equal(S.validatePreferences({ ptLockDrag: true, epicLockDrag: false }), true);
  assert.equal('ptLockDrag' in S.effectiveSettings(null, { ptLockDrag: true }), false);
  const c = S.emptyConfig(),
    p = S.createProfile();
  p.settings = { ptLockDrag: true };
  c.sites['https://alpha.atlassian.net'] = { defaults: p, projects: {} };
  const r = S.validateConfig(c);
  assert.equal(r.ok, true);
  assert.deepEqual(r.value.sites['https://alpha.atlassian.net'].defaults.settings, {});
});
