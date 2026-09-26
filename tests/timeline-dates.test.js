const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../timeline_dates.js');

test('date labels validate real UTC calendar dates across supported languages', () => {
  for (const label of ['2026年9月5日', '2026/9/5', '2026-09-05', 'Sep 5,2026', 'September 5, 2026']) {
    assert.equal(D.parseDateLabel(label), '2026-09-05');
  }
  assert.equal(D.parseDateLabel('2024年2月29日'), '2024-02-29');
  for (const bad of ['2026-02-29', '2026/13/1', 'Sep 31,2026', '1/2/2026', 'Sep 5', '', null, '2026-09-05T12:00:00Z']) {
    assert.equal(D.parseDateLabel(bad), null);
  }
});

test('month labels use explicit year or a required reference without current-time guesses', () => {
  for (const label of [
    'September 2026',
    'Sep 2026',
    'Sept. 2026',
    "Sep '26",
    'Sep ’26',
    '2026年9月',
    '9月',
    'September',
  ]) {
    assert.deepEqual(D.parsePeriodLabel(label, 2026), { start: '2026-09-01', endExclusive: '2026-10-01' });
  }
  assert.deepEqual(D.parsePeriodLabel('Dec 2026', 2030), { start: '2026-12-01', endExclusive: '2027-01-01' });
  assert.deepEqual(D.parsePeriodLabel('February 2024'), { start: '2024-02-01', endExclusive: '2024-03-01' });
  for (const bad of ['Sep', '13月', '2026年0月', 'Sep 26', 'unknown']) assert.equal(D.parsePeriodLabel(bad), null);
});

test('quarters use true month boundaries including leap years and year rollover', () => {
  for (const label of ['Q1 2024', '2024 Q1', '第1季 2024', '2024年第1季', 'Q1']) {
    assert.deepEqual(D.parsePeriodLabel(label, 2024), { start: '2024-01-01', endExclusive: '2024-04-01' });
  }
  assert.deepEqual(D.parsePeriodLabel('Q4 2026'), { start: '2026-10-01', endExclusive: '2027-01-01' });
  assert.equal(D.parsePeriodLabel('Q5 2026'), null);
  assert.equal(D.parsePeriodLabel('Q1'), null);
});

test('quarter month ranges accept Jira header labels with explicit or reference years', () => {
  for (const label of ['july - September', 'July - September 2026', "July – September '26", 'Jul-Sep']) {
    assert.deepEqual(D.parsePeriodLabel(label, 2026), { start: '2026-07-01', endExclusive: '2026-10-01' });
  }
  assert.deepEqual(D.parsePeriodLabel("October – December '26"), { start: '2026-10-01', endExclusive: '2027-01-01' });
  assert.deepEqual(D.parsePeriodLabel('January - March 2024'), { start: '2024-01-01', endExclusive: '2024-04-01' });
  for (const label of [
    'July - September',
    'September - July 2026',
    'July - August 2026',
    'February - April 2026',
    'December - February 2026',
    'Junk - September 2026',
  ]) {
    assert.equal(D.parsePeriodLabel(label), null);
  }
});

test('piecewise scale preserves each day with different month widths', () => {
  const scale = D.createScale([
    { left: 0, right: 310, start: '2024-01-01', endExclusive: '2024-02-01' },
    { left: 310, right: 600, start: '2024-02-01', endExclusive: '2024-03-01' },
    { left: 600, right: 755, start: '2024-03-01', endExclusive: '2024-04-01' },
  ]);
  assert.equal(scale.dateToX('2024-02-29'), 590);
  assert.equal(scale.dateToX('2024-03-02'), 605);
  assert.equal(scale.xToDate(594), '2024-02-29');
  assert.equal(scale.xToDate(599.999), '2024-03-01');
  assert.equal(scale.xToDate(600), '2024-03-01');
  assert.equal(scale.xToDate(755), '2024-04-01');
  assert.equal(scale.dateToX('2024-04-01'), 755);
  assert.equal(scale.dateToX('2023-12-31'), null);
  assert.equal(scale.xToDate(-1), null);
  assert.equal(scale.xToDate(Infinity), null);
  assert.equal(scale.start, '2024-01-01');
  assert.equal(scale.endExclusive, '2024-04-01');
  assert.equal(scale.left, 0);
  assert.equal(scale.right, 755);
  assert.equal(scale.cells.length, 3);
  assert.ok(Object.isFrozen(scale.cells[0]));
});

test('quarter day geometry is leap-aware and independent of display zoom', () => {
  for (const [year, days] of [
    [2023, 90],
    [2024, 91],
  ]) {
    for (const width of [300, 913]) {
      const scale = D.createScale([{ left: 20, right: 20 + width, ...D.parsePeriodLabel(`Q1 ${year}`) }]);
      assert.ok(Math.abs(scale.dateToX(`${year}-01-02`) - (20 + width / days)) < 1e-9);
      assert.equal(scale.xToDate(20 + (width * (days - 0.6)) / days), `${year}-03-31`);
      for (let day = 0; day <= days; day++) {
        const iso = new Date(Date.parse(`${year}-01-01T00:00:00Z`) + day * 86400000).toISOString().slice(0, 10);
        assert.equal(scale.xToDate(scale.dateToX(iso)), iso);
      }
    }
  }
});

test('invalid, overlapping or ambiguous scales fail closed and gaps do not extrapolate', () => {
  const cell = { left: 0, right: 100, start: '2026-01-01', endExclusive: '2026-02-01' };
  for (const cells of [
    [],
    null,
    [{ ...cell, right: 0 }],
    [{ ...cell, start: '2026-02-30' }],
    [cell, { ...cell, left: 50, right: 150 }],
    [cell, { ...cell, left: 100, right: 200 }],
  ]) {
    assert.equal(D.createScale(cells), null);
  }
  const gap = D.createScale([cell, { left: 200, right: 300, start: '2026-03-01', endExclusive: '2026-04-01' }]);
  assert.equal(gap.xToDate(150), null);
  assert.equal(gap.dateToX('2026-02-15'), null);
});
