const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ui = fs.existsSync(require('node:path').join(__dirname, '../ui_helpers.js')) ? require('../ui_helpers.js') : {};
test('safe target permits only selected validated origin and relative entry', () => {
  assert.equal(typeof ui.safeTarget, 'function');
  const config = {
    sites: {
      'https://example.atlassian.net': {
        defaults: { timelinePath: '/jira/software/projects/DEMO/timeline' },
        projects: {},
      },
    },
  };
  assert.equal(
    ui.safeTarget(config, 'https://example.atlassian.net', ''),
    'https://example.atlassian.net/jira/software/projects/DEMO/timeline',
  );
  config.sites['https://example.atlassian.net'].defaults.timelinePath = '//evil.example';
  assert.throws(() => ui.safeTarget(config, 'https://example.atlassian.net', ''));
  assert.throws(() => ui.safeTarget(config, 'https://evil.example', ''));
});
test('import conflict requires explicit replace and cancellation keeps draft', async () => {
  assert.equal(typeof ui.applyImport, 'function');
  const calls = [];
  const client = {
    importConfig: async (c, o) => {
      calls.push(o);
      return o?.replace ? { ok: true } : { ok: false, conflict: true };
    },
    clearDraft: async () => calls.push('clear'),
  };
  assert.equal((await ui.applyImport(client, {}, () => false)).ok, false);
  assert.deepEqual(calls, [{ replace: false }]);
  calls.length = 0;
  assert.equal((await ui.applyImport(client, {}, () => true)).ok, true);
  assert.deepEqual(calls, [{ replace: false }, { replace: true }, 'clear']);
});
test('missing content script is manual reload state, never readiness', async () => {
  assert.equal(typeof ui.tabStatus, 'function');
  const api = {
    tabs: {
      query: async () => [{ id: 2, url: 'https://example.atlassian.net/jira/software/projects/DEMO/timeline' }],
      sendMessage: async () => {
        throw Error('missing');
      },
    },
  };
  const status = await ui.tabStatus(api, true);
  assert.equal(status.state, 'unavailable');
  assert.match(status.message, /Reload/);
});
test('status checks address the top frame and reject unknown states', async () => {
  let options;
  const api = {
    tabs: {
      query: async () => [{ id: 2, url: 'https://example.atlassian.net/jira/software/projects/DEMO/timeline' }],
      sendMessage: async (id, message, opts) => {
        options = opts;
        return { state: 'constructor' };
      },
    },
  };
  assert.equal((await ui.tabStatus(api)).state, 'unavailable');
  assert.deepEqual(options, { frameId: 0 });
});
test('employee import rejects legacy preference blobs and empty configurations', async () => {
  const S = require('../settings.js');
  for (const raw of [{ ptColor: '#123456', customFieldMap: { start: '123' } }, S.emptyConfig()]) {
    await assert.rejects(ui.readConfig({ size: 100, text: async () => JSON.stringify(raw) }, S));
  }
});
test('calendar and source summaries', () => {
  assert.equal(ui.yearRanges([2027, 2025, 2026, 2029]), '2025–2027, 2029');
  assert.match(ui.calendarSummary([2026, 2027]), /2026–2027/);
  assert.match(ui.calendarSummary([]), /only weekends/);
  assert.match(ui.sourceText({ source: 'property', sourceLabel: 'Example Admin Tool', sourceUpdatedAt: '2026-09-25T00:00:00Z' }), /Example Admin Tool/);
  assert.match(ui.sourceText({ source: 'file' }), /imported configuration file/);
  assert.equal(ui.sourceText(null), '');
});
