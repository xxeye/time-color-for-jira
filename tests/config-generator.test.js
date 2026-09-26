const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const modulePath = path.join(__dirname, '../config-generator/generator.js');
test('generator module is present', () => assert.ok(fs.existsSync(modulePath)));
test('normalization, strict validation and lossless single profile edit', () => {
  const G = require(modulePath),
    S = require('../settings.js');
  const input = {
    origin: 'https://sample.atlassian.net',
    projectId: '42',
    revision: 2,
    planning: ' 11 ',
    milestone: '13',
    epic: '14',
    role: '21',
    epicHighlight: '22',
    startDate: '23',
    targetEnd: '24',
    highlightValue: '啟用',
    linkTypeIds: '31',
    direction: 'both',
    inProgressWeight: 0.5,
    weekendDays: '0,6',
    settings: { ...S.DEFAULTS },
    progressEnabled: true,
    timelinePath: '',
  };
  const result = G.build(input);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const profile = result.value.sites[input.origin].projects['42'];
  assert.deepEqual(profile.issueTypes.planning, ['11']);
  assert.equal(profile.fields.role, 'customfield_21');
  assert.deepEqual(G.build(G.readConfig(JSON.stringify(result.value)).input).value, result.value);
  assert.equal(G.build({ ...input, origin: 'https://evil.com' }).ok, false);
  assert.equal(G.build({ ...input, milestone: '11' }).ok, false);
  assert.equal(G.build({ ...input, role: 'customfield_no' }).ok, false);
  const multi = structuredClone(result.value);
  multi.sites[input.origin].defaults = profile;
  assert.equal(G.readConfig(JSON.stringify(multi)).ok, false);
  assert.equal(G.readConfig(JSON.stringify({ ...result.value, schemaVersion: 999 })).ok, false);
  assert.equal(G.readConfig('{"schemaVersion":1,"__proto__":{}}').ok, false);
  assert.equal(G.readConfig('x'.repeat(300000)).ok, false);
});
test('each issue type accepts a single ID', () => {
  const G = require(modulePath),
    S = require('../settings.js');
  const input = {
    origin: 'https://sample.atlassian.net',
    projectId: '',
    revision: 1,
    planning: '11',
    milestone: '',
    epic: '',
    role: '',
    epicHighlight: '',
    startDate: '23',
    targetEnd: '',
    highlightValue: '啟用',
    linkTypeIds: '31',
    direction: 'both',
    inProgressWeight: 0.5,
    weekendDays: '0,6',
    settings: { ...S.DEFAULTS },
    progressEnabled: true,
    timelinePath: '',
    sourceUrl: '',
  };
  assert.equal(G.build(input).ok, true, JSON.stringify(G.build(input).errors));
  const multiple = G.build({ ...input, planning: '11, 12' });
  assert.equal(multiple.ok, false);
  assert.equal(multiple.errors[0].path, 'planning');
  const config = S.emptyConfig(),
    p = S.createProfile();
  p.issueTypes.planning = ['11', '12'];
  p.fields.startDate = 'customfield_23';
  p.progress.linkTypeIds = ['31'];
  config.sites['https://sample.atlassian.net'] = { defaults: p, projects: {} };
  assert.equal(S.validateConfig(config).ok, true, 'the extension itself still reads older multi-ID files');
  assert.equal(G.readConfig(JSON.stringify(config)).ok, false);
});
test('metadata links only use validated Jira origin and fixed paths', () => {
  const G = require(modulePath);
  assert.deepEqual(G.metadataLinks('javascript:alert(1)'), []);
  assert.deepEqual(
    G.metadataLinks('https://sample.atlassian.net').map((x) => x.url),
    [
      'https://sample.atlassian.net/rest/api/3/field',
      'https://sample.atlassian.net/rest/api/3/issuetype',
      'https://sample.atlassian.net/rest/api/3/issueLinkType',
    ],
  );
});
