// Type contract tests for the pure modules (calendar, dates, rules, model, cache). Nothing here runs.
import type { Preferences, Profile } from '../types/domain';
import type { IssueKind, IssueRecord, ProgressTier, TimelineMode } from '../types/model';

declare const profile: Profile;
declare const prefs: Preferences;
declare const issue: unknown;

// Jira issues are records the rules turn into a known kind.
const record: IssueRecord = globalThis.JptRules.toIssueRecord({ key: 'A-1', fields: {} }, profile, prefs, 'https://x');
const kind: IssueKind = record.type;
// @ts-expect-error not an issue kind
const wrongKind: IssueKind = 'story';
// @ts-expect-error raw JSON must be shaped like a Jira issue before it reaches the rules
globalThis.JptRules.toIssueRecord(issue as number, profile, prefs, 'https://x');

// Badge tiers and Timeline modes are literal unions, not strings.
const tier: ProgressTier = globalThis.JptModel.progressTier(50);
const badge = globalThis.JptModel.progressBadge(record.data.progress, record.data.dueDate, { t: (k) => k });
if (badge) {
  const t: ProgressTier = badge.tier;
  void t;
}
const mode: TimelineMode | null = globalThis.JptDates.modeFromLabel('Weeks');
// @ts-expect-error the translate function is required
globalThis.JptModel.progressBadge(null, null, {});

// The cache keeps its value type.
const cache = new globalThis.JptCache.MemoryCache<string, IssueRecord>();
cache.set('A-1', record);
const hit: IssueRecord | undefined = cache.get('A-1');
// @ts-expect-error wrong value type for this cache
cache.set('A-2', 'not a record');

// Calendar results are typed, not any.
const working = globalThis.JptCalendar.countWorkingDays('2026-01-01', '2026-01-31');
if (working) {
  const days: number = working.days;
  // @ts-expect-error no such field
  working.hours;
  void days;
}

void [kind, wrongKind, tier, mode, hit];
