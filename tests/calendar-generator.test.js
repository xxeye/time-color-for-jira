const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../config-generator/generator.js');
const S = require('../settings.js');
function input() {
  return {
    origin: 'https://sample.atlassian.net',
    projectId: '',
    revision: 1,
    planning: '11',
    milestone: '12',
    epic: '13',
    role: '21',
    epicHighlight: '',
    startDate: '23',
    targetEnd: '24',
    highlightValue: '',
    linkTypeIds: '31',
    direction: 'both',
    inProgressWeight: 0.5,
    weekendDays: '0,6',
    holidays: '# 2027\n2027-04-04 Children’s Day\n2027-01-01, New Year\n',
    workdays: '2027-02-20',
    settings: { ...S.DEFAULTS },
    progressEnabled: true,
    timelinePath: '',
  };
}
const calendarOf = (built) => built.value.sites['https://sample.atlassian.net'].defaults.calendar;
test('generator writes sorted holidays and make-up workdays into the file', () => {
  const built = G.build(input());
  assert.equal(built.ok, true, JSON.stringify(built.errors));
  assert.deepEqual(calendarOf(built), {
    weekendDays: [0, 6],
    holidays: [{ date: '2027-01-01', name: 'New Year' }, { date: '2027-04-04', name: 'Children’s Day' }],
    workdays: [{ date: '2027-02-20' }],
  });
  const edited = G.readConfig(JSON.stringify(built.value));
  assert.equal(edited.ok, true);
  assert.deepEqual(G.build(edited.input).value, built.value);
});
test('generator reports unreadable and impossible days', () => {
  const bad = G.build({ ...input(), holidays: '2027-01-01\nnext spring\n' });
  assert.equal(bad.ok, false);
  assert.equal(bad.errors[0].path, 'holidays');
  assert.match(bad.errors[0].message, /2/);
  assert.equal(G.build({ ...input(), holidays: '2027-02-30' }).ok, false);
  // The same day cannot be both a holiday and a workday.
  assert.equal(G.build({ ...input(), holidays: '2027-02-20' }).ok, false);
});
test('older files with an ICS address still import, without the address', () => {
  const built = G.build(input()).value;
  built.sites['https://sample.atlassian.net'].defaults.calendar.sourceUrl = 'https://cdn.twholidays.com/ical/tc.ics';
  const checked = S.validateConfig(built);
  assert.equal(checked.ok, true, JSON.stringify(checked.errors));
  assert.equal('sourceUrl' in checked.value.sites['https://sample.atlassian.net'].defaults.calendar, false);
});
