// Settings domain: what the validators in settings.js accept and return.
// Raw input (files, the Jira project property, chrome.storage) is `unknown` until a validator returns one of these.

/** `#rrggbb`; checked by settings.validPreference. */
export type HexColor = string;

/** Display settings after merging defaults, profile settings and personal preferences. */
export interface Preferences {
  enabled: boolean;
  ptColorEnabled: boolean;
  ptColor: HexColor;
  msColorEnabled: boolean;
  msColor: HexColor;
  msDiamond: boolean;
  msShowProgress: boolean;
  ptLockDrag: boolean;
  ptTargetEndShade: boolean;
  epicStripe: boolean;
  epicLockDrag: boolean;
  hideCurrentMonth: boolean;
  hideIssueKey: boolean;
  showWeekends: boolean;
  showHolidays: boolean;
  showWorkingDays: boolean;
}
export type PreferenceKey = keyof Preferences;
/** What storage, savePreferences and a profile's `settings` hold: any subset of known keys. */
export type PreferencePatch = Partial<Preferences>;
/** Site-wide colors in an imported file. */
export type Appearance = Partial<Pick<Preferences, 'ptColor' | 'msColor'>>;

export type IssueRole = 'planning' | 'milestone' | 'epic';

export interface CalendarDay {
  /** `YYYY-MM-DD` */
  date: string;
  name?: string;
}
/** Calendar after validation: holidays and workdays are always arrays. */
export interface Calendar {
  /** 0 = Sunday … 6 = Saturday */
  weekendDays: number[];
  holidays: CalendarDay[];
  workdays: CalendarDay[];
}

export interface Profile {
  revision: number;
  issueTypes: Record<IssueRole, string[]>;
  fields: {
    role: string | null;
    epicHighlight: string | null;
    startDate: string | null;
    targetEnd: string | null;
  };
  highlightRule: { operator: 'equals'; value: string };
  progress: {
    enabled: boolean;
    linkTypeIds: string[];
    direction: 'both' | 'inward' | 'outward';
    inProgressWeight: number;
  };
  calendar: Calendar;
  settings: PreferencePatch;
  timelinePath: string;
}

export interface Site {
  defaults: Profile | null;
  /** Keyed by numeric Jira project id. A lookup may miss although the type does not say so: check it. */
  projects: Record<string, Profile>;
}

/** An imported file / the stored configuration, after validation. */
export interface Config {
  schemaVersion: 1;
  template: { id: 'planning-timeline'; version: 1 };
  /** Keyed by normalized origin (`https://<site>.atlassian.net`). A lookup may miss: check it. */
  sites: Record<string, Site>;
  appearance?: Appearance;
}

/** The Jira project property after validation (schemaVersion and template are checked, then dropped). */
export interface PropertyValue {
  profile: Profile;
  generatedBy: string;
  updatedAt: string;
}

export interface ValidationError {
  path: string;
  message: string;
}
export type ValidationResult<T> =
  | { ok: true; value: T; errors: []; ignored: string[] }
  | { ok: false; value: null; errors: ValidationError[]; ignored?: string[] };

export interface Position {
  side: 'right' | 'top';
  /** 0..1 along the side */
  ratio: number;
}

/** A profile with its settings filled in from defaults and appearance (settings.resolveProfile). */
export type ResolvedProfile = Omit<Profile, 'settings'> & { settings: Preferences };
