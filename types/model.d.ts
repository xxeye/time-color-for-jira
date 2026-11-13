// What the page derives from Jira issues and settings: cached per issue, then turned into bar styles.

export type IssueKind = 'planning' | 'milestone' | 'epic' | 'other';

/** Linked-issue progress of a Milestone (issue_rules.computeProgress). */
export interface Progress {
  done: number;
  wip: number;
  total: number;
  /** 0..100, in-progress items weighted by the profile */
  pct: number;
  /** some linked issue had a status category other than new / indeterminate / done */
  partial: boolean;
}

/** One linked issue in the Milestone hover card; every string is safe to show as text. */
export interface Relate {
  key: string;
  summary: string;
  /** Jira status category key, or '' */
  statusCat: string;
  /** same-site https URL, or '' */
  typeIconUrl: string;
  typeName: string;
}

/** What coloring needs; dates are `YYYY-MM-DD` strings that passed calendar.parseDate, else null. */
export interface IssueData {
  epicHighlight: boolean;
  progress: Progress | null;
  startDate: string | null;
  dueDate: string | null;
  targetEndDate: string | null;
}

/** What only the hover card needs. */
export interface IssueDetail {
  relates: Relate[];
  roles: string[];
}

export interface IssueRecord {
  type: IssueKind;
  data: IssueData;
  detail: IssueDetail;
}

export interface BarClasses {
  planning: boolean;
  milestone: boolean;
  diamond: boolean;
  epic: boolean;
  epicHighlight: boolean;
}

export type ProgressTier = 'done' | 'mid' | 'low' | 'zero';

export interface ProgressBadge {
  text: string;
  title: string;
  tier: ProgressTier;
}

export type DayKind = 'holiday' | 'workday' | 'weekend' | 'normal';

/** calendar.dayInfo: the profile calendar prepared for lookups. */
export interface CalendarInfo {
  weekendDays: number[];
  holidays: Set<string>;
  workdays: Set<string>;
  /** years that appear in either list, ascending */
  years: number[];
  hasList: boolean;
}

export interface WorkingDays {
  days: number;
  /** false when the range reaches a year the lists do not cover */
  complete: boolean;
}

/** A header period: `start` included, `endExclusive` not (both `YYYY-MM-DD`). */
export interface DatePeriod {
  start: string;
  endExclusive: string;
}
/** A measured Timeline header cell: its period and its x range in pixels. */
export interface ScaleCell extends DatePeriod {
  left: number;
  right: number;
}
/** timeline_dates.createScale: maps dates to x and back over contiguous header cells. */
export interface TimelineScale extends DatePeriod {
  cells: readonly Readonly<ScaleCell>[];
  left: number;
  right: number;
  dateToX(iso: unknown): number | null;
  xToDate(x: number): string | null;
}
export type TimelineMode = 'WEEKS' | 'MONTHS' | 'QUARTERS';

/** Translate function shared by i18n.js instances. */
export type Translate = (key: string, params?: Record<string, unknown>) => string;
