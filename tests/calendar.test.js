const test = require('node:test'),
  assert = require('node:assert/strict');
const C = require('../calendar.js');

test('monthDay reads the leading date and falls back for anything else', () => {
  assert.equal(C.monthDay('2026-05-21'), '5/21');
  assert.equal(C.monthDay('2026-12-01T09:00:00.000+0800'), '12/1');
  for (const value of ['', null, undefined, 'May 21', '26-05-21']) {
    assert.equal(C.monthDay(value), '', String(value));
    assert.equal(C.monthDay(value, '-'), '-', String(value));
  }
});

test('dateOnlyMs is UTC midnight of the leading date, NaN when absent, and rolls over overflowing days', () => {
  assert.equal(C.dateOnlyMs('2026-05-21'), Date.UTC(2026, 4, 21));
  assert.equal(C.dateOnlyMs('2026-05-21T23:59:00Z'), Date.UTC(2026, 4, 21));
  assert.equal(C.dateOnlyMs('2026-02-30'), Date.UTC(2026, 2, 2));
  for (const value of ['', null, 'not a date']) assert.ok(Number.isNaN(C.dateOnlyMs(value)), String(value));
});

test('localYmd uses the local calendar date, not UTC', () => {
  assert.equal(C.localYmd(new Date(2026, 0, 5)), '2026-01-05');
  assert.equal(C.localYmd(new Date(2026, 11, 31, 23, 59)), '2026-12-31');
});
