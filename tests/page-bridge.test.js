const test = require('node:test'),
  assert = require('node:assert/strict');
const { create } = require('../page_bridge.js');

test('before the page runtime starts the toolbar reads "not known yet" and falls back for refresh', () => {
  const page = create();
  assert.equal(page.read(), null);
  assert.equal(page.refresh(), null);
});

test('the runtime provides its state and refresh, and withdraws them when it goes away', async () => {
  const page = create();
  const undo = page.provide({
    read: () => ({ projectId: '1', configured: true, enabled: false }),
    refresh: async () => ({ delivered: 1 }),
  });
  assert.deepEqual(page.read(), { projectId: '1', configured: true, enabled: false });
  assert.deepEqual(await page.refresh(), { delivered: 1 });
  undo();
  assert.equal(page.read(), null);
  const second = page.provide({ read: () => ({ projectId: '2' }) });
  undo(); // an old runtime withdrawing late must not remove the new one
  assert.equal(page.read().projectId, '2');
  second();
});

test('subscribers hear each notify until they unsubscribe; one failing subscriber does not stop the rest', () => {
  const page = create();
  const heard = [];
  page.subscribe(() => {
    throw Error('broken');
  });
  const stop = page.subscribe(() => heard.push('a'));
  page.notify();
  stop();
  page.notify();
  assert.deepEqual(heard, ['a']);
  page.provide({
    read: () => {
      throw Error('x');
    },
  });
  assert.equal(page.read(), null);
});
