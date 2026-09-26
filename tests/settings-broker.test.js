const test = require('node:test'),
  assert = require('node:assert/strict');
const S = require('../settings.js'),
  { createBroker } = require('../settings_broker.js');
const ui = { id: 'test', url: 'chrome-extension://test/options.html' };
const content = {
  id: 'test',
  url: 'https://alpha.atlassian.net/jira/software/projects/A/boards/1/timeline',
  origin: 'https://alpha.atlassian.net',
  frameId: 0,
  tab: { id: 1, url: 'https://alpha.atlassian.net/jira/software/projects/A/boards/1/timeline' },
};
function chromeFixture(seed = {}) {
  const sync = { ...seed },
    local = {},
    access = [];
  let fail = false;
  const area = (store, name) => ({
    async setAccessLevel(v) {
      access.push([name, v.accessLevel]);
    },
    async get() {
      return structuredClone(store);
    },
    async set(patch) {
      if (fail && name === 'sync') throw Error('quota SECRET');
      Object.assign(store, structuredClone(patch));
    },
    async remove(keys) {
      for (const k of [].concat(keys)) delete store[k];
    },
  });
  return {
    runtime: { id: 'test', getURL: (p) => 'chrome-extension://test/' + p, async sendMessage() {} },
    storage: { sync: area(sync, 'sync'), local: area(local, 'local') },
    tabs: {
      async query() {
        return [
          { id: 1, url: content.url },
          { id: 2, url: content.url },
        ];
      },
      async sendMessage(id) {
        if (id === 2) throw Error('closed');
        return {};
      },
    },
    sync,
    local,
    access,
    setFail(v) {
      fail = v;
    },
  };
}
function cfg(origin = 'https://alpha.atlassian.net', pid = null) {
  const c = S.emptyConfig();
  c.sites[origin] = {
    defaults: pid === null ? S.createProfile() : null,
    projects: pid === null ? {} : { [pid]: S.createProfile() },
  };
  return c;
}
test('page context carries personal preferences so the project property can be combined with them', async () => {
  const ch = chromeFixture(),
    b = createBroker(ch);
  await call(b, 'savePreferences', { patch: { ptColor: '#abcdef' } }, content);
  const ctx = (await call(b, 'getContext', {}, content)).value;
  assert.deepEqual(ctx.preferences, { ptColor: '#abcdef' });
  assert.equal('calendarData' in ctx, false);
  for (const method of ['getCalendars', 'refreshCalendar', 'getCalendarStatus'])
    assert.equal((await call(b, method)).code, 'invalid', method);
});
async function call(b, method, args = {}, sender = ui) {
  return b.handle({ type: 'jpt:' + method, ...args }, sender);
}
test('isolates origin and frame while allowing content preference writes only', async () => {
  const ch = chromeFixture(),
    b = createBroker(ch);
  assert.equal((await call(b, 'importConfig', { config: cfg() })).ok, true);
  assert.equal((await call(b, 'getContext', {}, content)).value.configured, true);
  assert.equal((await call(b, 'getAll', {}, content)).code, 'forbidden');
  assert.equal((await call(b, 'getContext', { origin: 'https://other.atlassian.net' }, content)).code, 'forbidden');
  assert.equal((await call(b, 'getContext', {}, { ...content, frameId: 1 })).code, 'forbidden');
  assert.equal((await call(b, 'getContext', { projectId: 'bad' }, content)).code, 'invalid');
  assert.equal((await call(b, 'savePreferences', { patch: { enabled: false } }, content)).ok, true);
  assert.deepEqual(ch.access, [
    ['local', 'TRUSTED_CONTEXTS'],
    ['sync', 'TRUSTED_CONTEXTS'],
  ]);
});
test('context reports whether the site has any configuration, including project-only scopes', async () => {
  const ch = chromeFixture(),
    b = createBroker(ch);
  assert.equal((await call(b, 'getContext', {}, content)).value.siteConfigured, false);
  await call(b, 'importConfig', { config: cfg('https://alpha.atlassian.net', '22') });
  const site = (await call(b, 'getContext', {}, content)).value;
  assert.equal(site.configured, false);
  assert.equal(site.siteConfigured, true);
  assert.equal((await call(b, 'getContext', { projectId: '22' }, content)).value.configured, true);
  assert.equal((await call(b, 'getContext', { origin: 'https://other.atlassian.net' })).value.siteConfigured, false);
  assert.equal((await call(b, 'getContext')).value.siteConfigured, false);
});
test('merges scopes, confirms conflicts, serializes writes and survives restart', async () => {
  const ch = chromeFixture(),
    b = createBroker(ch);
  await call(b, 'importConfig', { config: cfg() });
  await call(b, 'importConfig', { config: cfg('https://alpha.atlassian.net', '22') });
  assert.equal((await call(b, 'importConfig', { config: cfg() })).value.code, 'conflict');
  await Promise.all([
    call(b, 'savePreferences', { patch: { hideIssueKey: true } }),
    call(b, 'savePreferences', { patch: { epicStripe: true } }),
  ]);
  const all = (await call(createBroker(ch), 'getAll')).value;
  assert.equal(all.preferences.hideIssueKey, true);
  assert.equal(all.preferences.epicStripe, true);
  assert.ok(all.config.sites['https://alpha.atlassian.net'].projects['22']);
  assert.ok(Object.keys(ch.sync).filter((k) => k.startsWith('jpt:profile:')).length === 2);
  for (const [k, v] of Object.entries(ch.sync))
    assert.ok(Buffer.byteLength(k) + Buffer.byteLength(JSON.stringify(v)) < 8192);
});
test('storage errors preserve prior mappings and do not disclose exceptions', async () => {
  const ch = chromeFixture(),
    b = createBroker(ch);
  await call(b, 'importConfig', { config: cfg() });
  ch.setFail(true);
  const r = await call(b, 'importConfig', { config: cfg('https://beta.atlassian.net') });
  assert.equal(r.ok, false);
  assert.equal(JSON.stringify(r).includes('SECRET'), false);
  ch.setFail(false);
  assert.equal((await call(b, 'getAll')).value.config.sites['https://beta.atlassian.net'], undefined);
});
test('migrates only valid preferences once and validates incoming raw sync', async () => {
  const ch = chromeFixture({
      hideIssueKey: true,
      ptColor: '#112233',
      summary: 'SECRET',
      customFieldMap: { secret: 1 },
    }),
    b = createBroker(ch);
  const all = (await call(b, 'getAll')).value;
  assert.equal(all.preferences.hideIssueKey, true);
  assert.deepEqual(all.config.sites, {});
  assert.equal(ch.sync.hideIssueKey, undefined);
  assert.equal(JSON.stringify(ch.sync['jpt:preferences']).includes('SECRET'), false);
  ch.sync['jpt:preferences'] = { summary: 'SECRET' };
  assert.equal((await call(b, 'getContext', {}, content)).ok, false);
});
test('draft/restore/export contain validated config and refresh counts failures', async () => {
  const ch = chromeFixture(),
    b = createBroker(ch);
  await call(b, 'saveDraft', { config: cfg() });
  assert.deepEqual((await call(b, 'getDraft')).value, cfg());
  await call(b, 'importConfig', { config: cfg() });
  await call(b, 'importConfig', { config: cfg('https://beta.atlassian.net') });
  await call(b, 'restoreConfig');
  const exp = (await call(b, 'exportConfig')).value;
  assert.deepEqual(Object.keys(exp.sites), ['https://alpha.atlassian.net']);
  assert.deepEqual((await call(b, 'refresh')).value, { delivered: 1, undelivered: 1 });
  assert.equal((await call(b, 'savePosition', { position: { side: 'right', ratio: 2 } })).ok, false);
});

test('reset preserves explicit enabled and administrator configuration', async () => {
  const ch = chromeFixture(),
    b = createBroker(ch);
  await call(b, 'importConfig', { config: cfg() });
  await call(b, 'savePreferences', { patch: { enabled: false, ptColor: '#123456' } });
  await call(b, 'resetPreferences');
  const all = (await call(b, 'getAll')).value;
  assert.deepEqual(all.preferences, { enabled: false });
  assert.ok(all.config.sites['https://alpha.atlassian.net']);
});
test('a failed import preserves the last successful restore checkpoint', async () => {
  const ch = chromeFixture(),
    b = createBroker(ch);
  await call(b, 'importConfig', { config: cfg() });
  await call(b, 'importConfig', { config: cfg('https://beta.atlassian.net') });
  ch.setFail(true);
  assert.equal((await call(b, 'importConfig', { config: cfg('https://gamma.atlassian.net') })).ok, false);
  ch.setFail(false);
  await call(b, 'restoreConfig');
  assert.deepEqual(Object.keys((await call(b, 'exportConfig')).value.sites), ['https://alpha.atlassian.net']);
});
test('removing a site clears retired profile records after atomic replacement', async () => {
  const ch = chromeFixture(),
    b = createBroker(ch);
  await call(b, 'importConfig', { config: cfg() });
  await call(b, 'removeSite', { origin: 'https://alpha.atlassian.net' });
  assert.equal(
    Object.keys(ch.sync).some((k) => k.startsWith('jpt:profile:')),
    false,
  );
  await call(b, 'restoreConfig');
  assert.equal((await call(b, 'getContext', {}, content)).value.configured, true);
});

test('sync quota preflight rejects excess items before changing restore checkpoint', async () => {
  const ch = chromeFixture(),
    b = createBroker(ch);
  await call(b, 'importConfig', { config: cfg() });
  const checkpoint = structuredClone(ch.local['jpt:restore']);
  for (let i = 0; i < 520; i++)
    ch.sync['jpt:profile:' + encodeURIComponent('https://old' + i + '.atlassian.net') + ':defaults'] = null;
  const r = await call(b, 'importConfig', { config: cfg('https://beta.atlassian.net') });
  assert.equal(r.ok, false);
  assert.deepEqual(ch.local['jpt:restore'], checkpoint);
  assert.equal((await call(b, 'getAll')).value.config.sites['https://beta.atlassian.net'], undefined);
});

test('import appearance remains a fallback to explicit profile settings', async () => {
  const ch = chromeFixture(),
    b = createBroker(ch),
    c = cfg();
  c.appearance = { ptColor: '#123456' };
  c.sites['https://alpha.atlassian.net'].defaults.settings.ptColor = '#654321';
  await call(b, 'importConfig', { config: c });
  assert.equal((await call(b, 'getContext', {}, content)).value.settings.ptColor, '#654321');
});

test('total sync byte quota rejects a valid profile without writing its checkpoint', async () => {
  const ch = chromeFixture(),
    b = createBroker(ch);
  await call(b, 'importConfig', { config: cfg() });
  for (let i = 0; i < 14; i++) ch.sync['legacy-' + i] = 'x'.repeat(7100);
  const c = cfg('https://beta.atlassian.net'),
    p = c.sites['https://beta.atlassian.net'].defaults;
  for (const [offset, role] of ['planning', 'milestone', 'epic'].entries())
    p.issueTypes[role] = Array.from({ length: 50 }, (_, i) => String(10000000000000000000n + BigInt(offset * 50 + i)));
  p.fields.startDate = 'customfield_1';
  p.progress.linkTypeIds = ['1'];
  assert.equal(S.validateConfig(c).ok, true);
  const checkpoint = structuredClone(ch.local['jpt:restore']);
  assert.equal((await call(b, 'importConfig', { config: c })).ok, false);
  assert.deepEqual(ch.local['jpt:restore'], checkpoint);
  assert.equal((await call(b, 'getAll')).value.config.sites['https://beta.atlassian.net'], undefined);
});
