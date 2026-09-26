const test = require('node:test');
const assert = require('node:assert/strict');
const dates = require('../timeline_dates.js');
const geometry = require('../timeline_geometry.js');
function fixture(groups) {
  const labels = groups.map(({ text, left, width = 255, numbers = [] }) => {
    const bounds = { left, right: left + width, width, height: 30 };
    const spans = numbers.map((day, index) => ({
      textContent: String(day),
      getBoundingClientRect: () => ({
        left: left + (index * width) / numbers.length,
        right: left + ((index + 1) * width) / numbers.length,
        width: width / numbers.length,
        height: 20,
      }),
    }));
    const parent = { getBoundingClientRect: () => bounds, querySelectorAll: () => spans };
    return { textContent: text, parentElement: parent, getAttribute: () => null, closest: () => null };
  });
  const header = { querySelectorAll: () => labels };
  return { querySelector: () => ({ lastElementChild: header }) };
}
test('weekly numeric day spans use their own rectangles and explicit label year', () => {
  const scale = geometry.readScale(
    fixture([{ text: "Sep '25", left: 100, numbers: [8, 9, 10, 11, 12, 13, 14] }]),
    dates,
    'WEEKS',
    2026,
  );
  assert.ok(scale);
  assert.equal(scale.start, '2025-09-08');
  assert.equal(scale.cells.length, 7);
  assert.equal(scale.dateToX('2025-09-09'), 100 + 255 / 7);
  assert.equal(scale.endExclusive, '2025-09-15');
});
test('week month bands resolve month and year rollover from trailing year', () => {
  for (const [text, numbers, start, end] of [
    ["Sep / Oct '25", [29, 30, 1, 2, 3, 4, 5], '2025-09-29', '2025-10-06'],
    ["Dec / Jan '27", [28, 29, 30, 31, 1, 2, 3], '2027-12-28', '2028-01-04'],
  ]) {
    const scale = geometry.readScale(fixture([{ text, left: 0, numbers }]), dates, 'WEEKS', 2030);
    assert.ok(scale);
    assert.equal(scale.start, start);
    assert.equal(scale.endExclusive, end);
  }
});
test('yearless cross-year weeks follow adjacent dates instead of the current year', () => {
  for (const year of [2025, 2026, 2027]) {
    const scale = geometry.readScale(
      fixture([
        { text: `Dec '${String(year).slice(2)}`, left: 0, numbers: [22, 23, 24, 25, 26, 27, 28] },
        { text: 'Dec / Jan', left: 255, numbers: [29, 30, 31, 1, 2, 3, 4] },
        { text: `Jan '${String(year + 1).slice(2)}`, left: 510, numbers: [5, 6, 7, 8, 9, 10, 11] },
      ]),
      dates,
      'WEEKS',
      2030,
    );
    assert.ok(scale);
    assert.equal(scale.start, `${year}-12-22`);
    assert.equal(scale.endExclusive, `${year + 1}-01-12`);
  }
});
test('a clipped yearless boundary uses the following explicit January year', () => {
  const scale = geometry.readScale(
    fixture([
      { text: 'Dec / Jan', left: 0, numbers: [29, 30, 31, 1, 2, 3, 4] },
      { text: "Jan '27", left: 255, numbers: [5, 6, 7, 8, 9, 10, 11] },
    ]),
    dates,
    'WEEKS',
    2030,
  );
  assert.ok(scale);
  assert.equal(scale.start, '2026-12-29');
});
test('subpixel month overlaps normalize only within a small tolerance', () => {
  const scale = geometry.readScale(
    fixture([
      { text: 'September 2026', left: 100, width: 255.015625 },
      { text: 'October 2026', left: 355, width: 263.515625 },
    ]),
    dates,
    'MONTHS',
  );
  assert.ok(scale);
  assert.equal(scale.cells[0].right, 355);
  assert.equal(scale.dateToX('2026-10-01'), 355);
  assert.equal(
    geometry.readScale(
      fixture([
        { text: 'September 2026', left: 100, width: 256 },
        { text: 'October 2026', left: 355 },
      ]),
      dates,
      'MONTHS',
    ),
    null,
  );
});
test('unusable weekly days do not fall back to stretching a month across a week', () => {
  assert.equal(
    geometry.readScale(fixture([{ text: "Sep '25", left: 0, numbers: [29, 30, 31, 32, 33, 34, 35] }]), dates, 'WEEKS'),
    null,
  );
});
