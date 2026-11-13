// Page runtime state: what RuntimeSession.load() decides and what the page reports as its status.
import type { Preferences, Profile } from './domain';

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
