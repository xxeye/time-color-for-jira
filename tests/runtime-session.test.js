const test = require('node:test'),
  assert = require('node:assert/strict');
let Session;
try {
  Session = require('../runtime_session.js').RuntimeSession;
} catch {}
test('session verifies metadata without storing task data and reports unavailable mapping', async () => {
  assert.equal(typeof Session, 'function');
  const profile = {
    issueTypes: { planning: ['10'], milestone: [], epic: [] },
    fields: { role: 'customfield_1' },
    progress: { enabled: false, linkTypeIds: [] },
  };
  const api = {
    getMyself: async () => ({ accountId: 'memory-only' }),
    getFields: async () => [],
    getTypes: async () => [{ id: '10' }],
    getProject: async () => ({ id: '9' }),
    getProjectProperty: async () => null,
  };
  const client = {
    getContext: async () => ({ profile, settings: { enabled: true }, configured: true, siteConfigured: true }),
  };
  const s = new Session({ api, client });
  const r = await s.load('https://demo.atlassian.net', 'TEST');
  assert.equal(r.state, 'partial');
  assert.equal(r.projectId, '9');
  assert.equal(r.settings.enabled, true);
  assert.equal(r.profile.fields.role, null);
  assert.equal(JSON.stringify(r).includes('memory-only'), false);
});
test('without a file or project property only the project and its property are read', async () => {
  const called = [];
  const api = new Proxy(
    {
      getProject: async (key) => (called.push('project:' + key), { id: '9' }),
      getProjectProperty: async (id) => (called.push('property:' + id), null),
    },
    {
      get: (target, name) =>
        target[name] ||
        (() => {
          throw Error('Jira must not be called: ' + String(name));
        }),
    },
  );
  const calls = [],
    client = {
      getContext: async (args) => {
        calls.push(args);
        return { profile: null, settings: { enabled: true }, preferences: {}, configured: false, siteConfigured: false };
      },
    };
  const r = await new Session({ api, client }).load('https://other.atlassian.net', 'ABC');
  assert.equal(r.state, 'needs-config');
  assert.equal(r.settings.enabled, false);
  assert.deepEqual(called, ['project:ABC', 'property:9']);
  assert.deepEqual(calls, [{ origin: 'https://other.atlassian.net', projectId: '9' }]);
});
function propertyValue(profile) {
  return { key: 'time-color-for-jira', value: { schemaVersion: 1, template: { id: 'planning-timeline', version: 1 }, profile, generatedBy: 'Example Admin Tool', updatedAt: '2026-09-25T00:00:00Z' } };
}
function propertyProfile(extra = {}) {
  const S = require('../settings.js');
  const p = S.createProfile();
  p.issueTypes.planning = ['1'];
  p.fields.startDate = 'customfield_1';
  p.calendar.holidays = [{ date: '2027-01-01', name: 'New Year' }];
  p.calendar.workdays = [{ date: '2027-02-20' }];
  p.settings = { ptColor: '#123456', showWorkingDays: true };
  return Object.assign(p, extra);
}
function propertyFixture(property, fileProfile = null, preferences = {}) {
  const api = {
    getProject: async () => ({ id: '9' }),
    getProjectProperty: async () => property,
    getMyself: async () => ({ accountId: 'private' }),
    getFields: async () => [{ id: 'customfield_1', schema: { type: 'date' } }],
    getTypes: async () => [{ id: '1' }],
  };
  const client = {
    getContext: async () => ({
      profile: fileProfile,
      settings: { enabled: true, ...(fileProfile?.settings || {}), ...preferences },
      preferences,
      configured: !!fileProfile,
      siteConfigured: !!fileProfile,
    }),
  };
  return new Session({ api, client });
}
test('the project property configures the page and personal preferences still apply on top', async () => {
  const r = await propertyFixture(propertyValue(propertyProfile()), null, { ptColor: '#abcdef' }).load(
    'https://demo.atlassian.net',
    'ABC',
  );
  assert.equal(r.state, 'ready');
  assert.equal(r.source, 'property');
  assert.equal(r.sourceLabel, 'Example Admin Tool');
  assert.equal(r.settings.ptColor, '#abcdef');
  assert.equal(r.settings.showWorkingDays, true);
  assert.deepEqual(r.profile.calendar.workdays, [{ date: '2027-02-20' }]);
});
test('the project property wins over an imported file for the same project', async () => {
  const file = propertyProfile({ calendar: { weekendDays: [0, 6], holidays: [], workdays: [] } });
  const r = await propertyFixture(propertyValue(propertyProfile()), file).load('https://demo.atlassian.net', 'ABC');
  assert.equal(r.source, 'property');
  assert.equal(r.profile.calendar.holidays.length, 1);
});
test('an invalid project property falls back to the imported file and says why', async () => {
  const bad = propertyValue(propertyProfile());
  bad.value.profile.calendar.holidays = [{ date: '2027-02-30' }];
  const file = propertyProfile();
  const r = await propertyFixture(bad, file).load('https://demo.atlassian.net', 'ABC');
  assert.equal(r.source, 'file');
  assert.equal(r.state, 'partial');
  assert.equal(r.details.length, 1);
});
test('a property from a newer admin tool still applies; unknown options are skipped and noted', async () => {
  const newer = propertyValue(propertyProfile());
  newer.value.profile.settings.sparkles = true;
  newer.value.profile.future = { mode: 'x' };
  const r = await propertyFixture(newer).load('https://demo.atlassian.net', 'ABC');
  assert.equal(r.source, 'property');
  assert.equal(r.state, 'partial');
  assert.equal(r.details.length, 1);
  assert.equal('sparkles' in r.settings, false);
  assert.equal('future' in r.profile, false);
});
test('stale session result cannot activate after clear', async () => {
  assert.equal(typeof Session, 'function');
  let finish;
  const api = { getMyself: () => new Promise((r) => (finish = r)) };
  const s = new Session({
    api,
    client: {
      getContext: async () => ({
        profile: { issueTypes: { planning: ['1'], milestone: [], epic: [] }, fields: {}, progress: { enabled: false } },
        settings: { enabled: true },
        siteConfigured: true,
      }),
    },
  });
  const loading = s.load('https://demo.atlassian.net', null);
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  s.clear();
  finish({ accountId: 'memory-only' });
  await assert.rejects(loading, (e) => e.name === 'AbortError');
});
function runtimeFixture(profile, settings, fields = []) {
  let linkCalls = 0;
  const api = {
    getMyself: async () => ({ accountId: 'private' }),
    getFields: async () => fields,
    getTypes: async () => [{ id: '1' }, { id: '2' }, { id: '3' }],
    getLinkTypes: async () => {
      linkCalls++;
      return { issueLinkTypes: [{ id: '4' }] };
    },
  };
  return {
    session: new Session({
      api,
      client: { getContext: async () => ({ profile, settings: { enabled: true, ...settings }, siteConfigured: true }) },
    }),
    get linkCalls() {
      return linkCalls;
    },
  };
}
test('enabled personal preferences cannot activate features whose field mappings were omitted', async () => {
  const profile = {
    issueTypes: { planning: ['1'], milestone: ['2'], epic: ['3'] },
    fields: { role: null, startDate: null, targetEnd: null, epicHighlight: null },
    progress: { enabled: true, linkTypeIds: ['4'] },
  };
  const f = runtimeFixture(profile, {
    showWorkingDays: true,
    ptTargetEndShade: true,
    msShowProgress: true,
    epicStripe: true,
  });
  const r = await f.session.load('https://demo.atlassian.net');
  assert.equal(r.state, 'partial');
  for (const key of ['showWorkingDays', 'ptTargetEndShade', 'msShowProgress', 'epicStripe'])
    assert.equal(r.settings[key], false, key);
  assert.equal(f.linkCalls, 0);
});
test('unavailable start date disables milestone progress before checking links', async () => {
  const profile = {
    issueTypes: { planning: [], milestone: ['2'], epic: [] },
    fields: { startDate: 'customfield_1' },
    progress: { enabled: true, linkTypeIds: ['4'] },
  };
  const f = runtimeFixture(profile, { msShowProgress: true }, [{ id: 'customfield_1', schema: { type: 'string' } }]);
  const r = await f.session.load('https://demo.atlassian.net');
  assert.equal(r.state, 'partial');
  assert.equal(r.settings.msShowProgress, false);
  assert.equal(f.linkCalls, 0);
});
test('unused feature mappings do not degrade a usable planning-only configuration', async () => {
  const profile = {
    issueTypes: { planning: ['1'], milestone: [], epic: [] },
    fields: { startDate: 'customfield_1', targetEnd: 'customfield_2', epicHighlight: 'customfield_3' },
    progress: { enabled: true, linkTypeIds: ['4'] },
  };
  const f = runtimeFixture(profile, {
    showWorkingDays: false,
    ptTargetEndShade: false,
    msShowProgress: true,
    epicStripe: true,
  });
  const r = await f.session.load('https://demo.atlassian.net');
  assert.equal(r.state, 'ready');
  assert.deepEqual(r.details, []);
  assert.equal(f.linkCalls, 0);
  assert.equal(r.settings.msShowProgress, false);
  assert.equal(r.settings.epicStripe, false);
});
test('omitted link mappings disable newly enabled progress without requesting link metadata', async () => {
  const profile = {
    issueTypes: { planning: [], milestone: ['2'], epic: [] },
    fields: { startDate: 'customfield_1' },
    progress: { enabled: true, linkTypeIds: [] },
  };
  const f = runtimeFixture(profile, { msShowProgress: true }, [{ id: 'customfield_1', schema: { type: 'date' } }]);
  const r = await f.session.load('https://demo.atlassian.net');
  assert.equal(r.state, 'partial');
  assert.equal(r.settings.msShowProgress, false);
  assert.equal(f.linkCalls, 0);
});
test('every returned session state retains the raw settings signature before feature filtering', async () => {
  const base = {
    issueTypes: { planning: ['1'], milestone: [], epic: [] },
    fields: { startDate: 'customfield_1' },
    progress: { enabled: false, linkTypeIds: [] },
  };
  const cases = [
    { profile: null, settings: { enabled: true }, state: 'needs-config' },
    {
      profile: { ...base, issueTypes: { planning: ['999'], milestone: [], epic: [] } },
      settings: { enabled: true },
      state: 'unavailable',
    },
    { profile: base, settings: { enabled: true, showWorkingDays: true }, state: 'partial' },
    { profile: base, settings: { enabled: true, showWorkingDays: false }, state: 'ready' },
    { profile: base, settings: { enabled: false, showWorkingDays: false }, state: 'disabled' },
  ];
  for (const { profile, settings, state } of cases) {
    const expected = JSON.stringify({ profile, settings });
    const r = await runtimeFixture(profile, settings).session.load('https://demo.atlassian.net');
    assert.equal(r.state, state);
    assert.equal(r.inputSignature, expected, state);
    assert.equal(JSON.stringify({ profile, settings }), expected, 'source settings must remain unchanged');
  }
});
