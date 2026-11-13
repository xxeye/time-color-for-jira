// Page runtime state: what RuntimeSession.load() decides and what the page reports as its status.
import type { PreferencePatch, Preferences, Profile } from './domain';

/** Every status the popup and toolbar can show (ui_helpers labels). */
export type StatusState =
  | 'needs-config'
  | 'checking'
  | 'ready'
  | 'partial'
  | 'login'
  | 'unavailable'
  | 'unsupported'
  | 'disabled';

/** The subset RuntimeSession.load() returns; the page adds checking / login / unsupported itself. */
export type SessionState = Extract<StatusState, 'needs-config' | 'unavailable' | 'disabled' | 'partial' | 'ready'>;

/** Where the profile came from: the Jira project property, an imported file, or neither. */
export type ProfileSource = 'property' | 'file' | null;

/** What timeline_color.js shares with the toolbar on the same page (page_bridge.js). */
export interface PageState {
  projectId: string | null;
  configured: boolean;
  /** null until settings have loaded */
  enabled: boolean | null;
}
export interface PageProvider {
  read(): PageState;
  refresh?(): Promise<{ delivered: number }>;
}

/** One status detail line: plain text, or a feature the page could not confirm. */
export type StatusDetail = string | { feature?: string; message?: string };

/** What the page replies to `jpt:status` and the popup renders (ui_helpers.renderStatus). */
export interface PageStatus {
  state: StatusState;
  message?: string;
  details?: StatusDetail[];
}

/** What the page replies to `jpt:context`: where its settings came from, for the popup. */
export interface PageContext {
  projectId: string | null;
  source: ProfileSource;
  sourceLabel: string;
  sourceUpdatedAt: string;
  years: number[];
  /** The project's own settings when they come from the property; otherwise null. */
  profileSettings: PreferencePatch | null;
}

export interface SessionResult {
  state: SessionState;
  message: string;
  details: string[];
  projectId: string | null;
  /** The profile with unusable issue types and fields removed; null when nothing can be drawn. */
  profile: Profile | null;
  settings: Preferences;
  /** JSON of the chosen profile and settings before adjustments, to detect real input changes. */
  inputSignature: string;
  source?: ProfileSource;
  sourceLabel?: string;
  sourceUpdatedAt?: string;
}
