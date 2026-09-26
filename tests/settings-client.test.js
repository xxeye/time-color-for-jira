const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  vm = require('node:vm');
const { createClient } = require('../settings_client.js');
test('client unwraps envelopes, preserves conflict results, and reports safe failures', async () => {
  const sent = [];
  let reply = { ok: true, value: { configured: false } };
  const client = createClient({
    runtime: {
      async sendMessage(m) {
        sent.push(m);
        return reply;
      },
      onMessage: { addListener() {}, removeListener() {} },
    },
  });
  assert.equal((await client.getContext({ projectId: '12' })).configured, false);
  assert.deepEqual(sent[0], { type: 'jpt:getContext', projectId: '12' });
  reply = { ok: true, value: { ok: false, code: 'conflict', conflicts: [] } };
  assert.equal((await client.importConfig({})).code, 'conflict');
  reply = { ok: false, code: 'storage', message: 'safe' };
  await assert.rejects(client.getAll(), { message: 'safe', code: 'storage' });
});
test('client subscription ignores unrelated messages and unsubscribes', () => {
  const listeners = new Set();
  const client = createClient({
    runtime: { onMessage: { addListener: (f) => listeners.add(f), removeListener: (f) => listeners.delete(f) } },
  });
  let count = 0;
  const off = client.subscribe(() => count++);
  for (const f of listeners) {
    f({ type: 'jpt:status' });
    f({ type: 'jpt:settings-changed' });
  }
  assert.equal(count, 1);
  off();
  assert.equal(listeners.size, 0);
});
test('background never opens a setup page on install or update and brokers asynchronously', async () => {
  let installed, listener, changed;
  const opened = [];
  const context = {
    importScripts() {},
    JptHolidayFeed: {
      createService() {
        return {};
      },
    },
    JptSettingsBroker: {
      createBroker() {
        return {
          async init() {},
          async calendarSources() {
            return [];
          },
          async handle() {
            return { ok: true, value: {} };
          },
          async notify() {},
        };
      },
    },
    chrome: {
      alarms: {
        async get() {
          return {};
        },
        async create() {},
        onAlarm: { addListener() {} },
      },
      runtime: {
        onStartup: { addListener() {} },
        onInstalled: { addListener: (f) => (installed = f) },
        onMessage: { addListener: (f) => (listener = f) },
        getURL: (p) => 'chrome-extension://test/' + p,
      },
      storage: { onChanged: { addListener: (f) => (changed = f) } },
      permissions: { onAdded: { addListener() {} }, onRemoved: { addListener() {} } },
      tabs: {
        async create(p) {
          opened.push(p);
        },
      },
    },
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../background.js'), 'utf8'), context);
  await installed?.({ reason: 'update' });
  await installed?.({ reason: 'install' });
  assert.equal(opened.length, 0);
  assert.equal(
    listener({ type: 'unrelated' }, {}, () => {}),
    false,
  );
  assert.equal(
    listener({ type: 'jpt:getAll' }, {}, () => {}),
    true,
  );
  assert.equal(typeof changed, 'function');
});
