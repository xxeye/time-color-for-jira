// Generates tests/fixtures/project-property.json (committed as static data). Add cases here, then run:
//   node tests/fixtures/make-project-property.mjs tests/fixtures
import { writeFileSync, mkdirSync } from 'node:fs';
const base = {
  schemaVersion: 1,
  template: { id: 'planning-timeline', version: 1 },
  profile: {
    revision: 3,
    issueTypes: { planning: ['10200'], milestone: ['10201'], epic: ['10000'] },
    fields: { role: 'customfield_10100', epicHighlight: 'customfield_10101', startDate: 'customfield_10015', targetEnd: 'customfield_10102' },
    highlightRule: { operator: 'equals', value: '啟用' },
    progress: { enabled: true, linkTypeIds: ['10003', '10004'], direction: 'both', inProgressWeight: 0.5 },
    calendar: {
      weekendDays: [0, 6],
      holidays: [{ date: '2026-10-10', name: '國慶日' }, { date: '2027-01-01' }],
      workdays: [{ date: '2027-02-20', name: '補行上班' }],
    },
    settings: { enabled: true, ptColorEnabled: true, ptColor: '#6a9a23', msColorEnabled: false, msColor: '#FF8B00', ptTargetEndShade: true },
    timelinePath: '',
  },
  generatedBy: 'Example Admin Tool',
  updatedAt: '2026-09-26T00:00:00.000Z',
};
const clone = () => JSON.parse(JSON.stringify(base));
const bytes = (x) => new TextEncoder().encode(JSON.stringify(x)).length;
const days = (year, n) => Array.from({ length: n }, (_, i) => ({ date: new Date(Date.UTC(year, 0, 1 + i)).toISOString().slice(0, 10) }));
// Pad the holiday list with ASCII names until the profile is exactly `target` bytes
// (the last two names are shortened to hit the exact size).
function sized(v, target) {
  v.profile.calendar.workdays = [];
  const all = days(2026, 300);
  for (let n = 2; n <= 300; n++) {
    const list = all.slice(0, n).map((d) => ({ ...d, name: 'x'.repeat(50) }));
    v.profile.calendar.holidays = list;
    list[n - 1].name = '';
    list[n - 2].name = '';
    const low = bytes(v.profile);
    if (low > target) break;
    if (low + 100 < target) continue;
    const need = target - low;
    list[n - 2].name = 'x'.repeat(Math.min(50, need));
    list[n - 1].name = 'x'.repeat(need - Math.min(50, need));
    if (bytes(v.profile) !== target) throw new Error('size mismatch');
    return;
  }
  throw new Error('cannot reach ' + target);
}
const make = (description, mutate, extension, forge = extension) => {
  const value = clone();
  mutate(value);
  return { description, extension, forge, value };
};
const cases = [
  make('valid: full profile with holidays and make-up workdays', () => {}, true),
  make('valid: no holiday lists, only weekends', (v) => { delete v.profile.calendar.holidays; delete v.profile.calendar.workdays; }, true),
  make('valid: without generatedBy and updatedAt', (v) => { delete v.generatedBy; delete v.updatedAt; }, true),
  make('valid: Epic stripe with a flag field', (v) => { v.profile.settings.epicStripe = true; }, true),
  make('valid: settings may be empty (defaults apply)', (v) => { v.profile.settings = {}; }, true),
  make('invalid: numeric issue type ID', (v) => { v.profile.issueTypes.planning = [10200]; }, false),
  make('invalid: numeric link type ID', (v) => { v.profile.progress.linkTypeIds = [10003]; }, false),
  make('invalid: same issue type in two roles', (v) => { v.profile.issueTypes.milestone = ['10200']; }, false),
  make('invalid: missing key in progress', (v) => { delete v.profile.progress.inProgressWeight; }, false),
  make('invalid: same day as holiday and workday', (v) => { v.profile.calendar.workdays = [{ date: '2026-10-10' }]; }, false),
  make('invalid: impossible date', (v) => { v.profile.calendar.holidays = [{ date: '2027-02-30' }]; }, false),
  make('invalid: holiday name with angle brackets', (v) => { v.profile.calendar.holidays[0].name = '<b>'; }, false),
  make('invalid: holiday name longer than 50 characters', (v) => { v.profile.calendar.holidays[0].name = 'x'.repeat(51); }, false),
  make('invalid: weekend day out of range', (v) => { v.profile.calendar.weekendDays = [7]; }, false),
  make('invalid: color is not #RRGGBB', (v) => { v.profile.settings.ptColor = 'green'; }, false),
  make('invalid: working days need a start date field', (v) => { v.profile.fields.startDate = null; }, false),
  make('invalid: target end shade needs a target end field', (v) => { v.profile.fields.targetEnd = null; }, false),
  make('invalid: Epic stripe needs a flag field', (v) => { v.profile.settings.epicStripe = true; v.profile.fields.epicHighlight = null; }, false),
  make('invalid: highlight value with angle brackets', (v) => { v.profile.highlightRule.value = '<x>'; }, false),
  make('invalid: weight above 1', (v) => { v.profile.progress.inProgressWeight = 2; }, false),
  make('invalid: schemaVersion 2', (v) => { v.schemaVersion = 2; }, false),
  make('invalid: unknown template', (v) => { v.template.id = 'other'; }, false),
  make('invalid: revision 0', (v) => { v.profile.revision = 0; }, false),
  make('invalid: generatedBy with angle brackets', (v) => { v.generatedBy = '<script>'; }, false),
  make('invalid: profile larger than 16,000 bytes', (v) => {
    v.profile.calendar.holidays = Array.from({ length: 300 }, (_, i) => ({ date: new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10), name: 'x'.repeat(50) }));
    v.profile.calendar.workdays = [];
  }, false),
  // Type and boundary cases (re-review of ea41527)
  make('invalid: color given as an array', (v) => { v.profile.settings.ptColor = ['#112233']; }, false),
  make('invalid: holidays is null (omit it instead)', (v) => { v.profile.calendar.holidays = null; }, false),
  make('invalid: holiday date is null', (v) => { v.profile.calendar.holidays = [{ date: null }]; }, false),
  make('invalid: revision given as a string', (v) => { v.profile.revision = '3'; }, false),
  make('invalid: fields object missing', (v) => { delete v.profile.fields; }, false),
  make('valid: 20-digit issue type ID', (v) => { v.profile.issueTypes.epic = ['12345678901234567890']; }, true),
  make('invalid: 21-digit issue type ID', (v) => { v.profile.issueTypes.epic = ['123456789012345678901']; }, false),
  make('valid: exactly 300 holidays', (v) => { v.profile.calendar.holidays = days(2026, 300); }, true),
  make('invalid: 301 holidays', (v) => { v.profile.calendar.holidays = days(2026, 301); }, false),
  make('valid: exactly 100 make-up workdays', (v) => { v.profile.calendar.workdays = days(2028, 100); }, true),
  make('invalid: 101 make-up workdays', (v) => { v.profile.calendar.workdays = days(2028, 101); }, false),
  make('valid: profile of exactly 16,000 bytes', (v) => sized(v, 16000), true),
  make('invalid: profile of 16,001 bytes', (v) => sized(v, 16001), false),
  make('valid: minimal profile with features off and no fields', (v) => {
    v.profile.fields = { role: null, epicHighlight: null, startDate: null, targetEnd: null };
    v.profile.progress = { enabled: false, linkTypeIds: [], direction: 'both', inProgressWeight: 0 };
    v.profile.settings = { showWorkingDays: false, msShowProgress: false, ptTargetEndShade: false };
    delete v.profile.calendar.holidays;
    delete v.profile.calendar.workdays;
  }, true),
  // Hardening cases suggested in the re-review of 306e7a0
  make('valid: custom Timeline path', (v) => { v.profile.timelinePath = '/jira/software/c/projects/DEMO/boards/1/timeline'; }, true),
  make('invalid: Timeline path is an external URL', (v) => { v.profile.timelinePath = 'https://example.com/timeline'; }, false),
  make('invalid: Timeline path starts with //', (v) => { v.profile.timelinePath = '//example.com/timeline'; }, false),
  make('invalid: Timeline path longer than 500 characters', (v) => { v.profile.timelinePath = '/' + 'a'.repeat(500); }, false),
  make('invalid: boolean setting given as a string', (v) => { v.profile.settings.enabled = 'true'; }, false),
  make('invalid: progress switch given as a string', (v) => { v.profile.progress.enabled = 'yes'; }, false),
  make('invalid: __proto__ key in settings', (v) => { v.profile.settings = JSON.parse('{"__proto__": true}'); }, false),
  make('invalid: constructor key in settings', (v) => { v.profile.settings = { constructor: true }; }, false),
  // Intentional difference: the admin tool refuses to publish a profile that configures nothing.
  make('differs: no issue types at all', (v) => { v.profile.issueTypes = { planning: [], milestone: [], epic: [] }; }, true, false),
  // Forward compatibility: a newer admin tool may add keys. The published extension ignores keys it
  // doesn't know (and reports them) instead of rejecting the whole property; the admin tool writes
  // only known keys. Breaking changes raise schemaVersion (still rejected above).
  make('forward: extra key in fields', (v) => { v.profile.fields.other = null; }, true, false),
  make('forward: extra key in a holiday entry', (v) => { v.profile.calendar.holidays[0].type = 'x'; }, true, false),
  make('forward: unknown display setting', (v) => { v.profile.settings.sparkles = true; }, true, false),
  make('forward: unknown top-level key', (v) => { v.sites = {}; }, true, false),
  make('forward: unknown profile section with nested data', (v) => { v.profile.future = { list: [1, 'a', null], deep: { x: true } }; }, true, false),
  make('forward: unknown key in progress and template', (v) => { v.profile.progress.mode = 'x'; v.template.variant = 2; }, true, false),
  make('invalid: known setting with a wrong type next to an unknown one', (v) => { v.profile.settings.sparkles = true; v.profile.settings.msColor = 'red'; }, false),
  make('invalid: __proto__ key in an unknown section', (v) => { v.profile.future = JSON.parse('{"__proto__": 1}'); }, false),
  // Older files and storage may still carry these; the extension accepts and ignores them, the admin tool never writes them.
  make('legacy: retired drag-lock setting', (v) => { v.profile.settings.ptLockDrag = true; }, true, false),
  make('legacy: retired ICS address', (v) => { v.profile.calendar.sourceUrl = ''; }, true, false),
];
const dir = process.argv[2];
mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}/project-property.json`, JSON.stringify({
  about: 'Shared contract cases for the project property time-color-for-jira (PROJECT_PROFILE.md). extension/forge: whether each side must accept the value. Used by tests here and by the admin tool that writes the property.',
  cases,
}, null, 2) + '\n');
console.log(cases.length, 'cases');
