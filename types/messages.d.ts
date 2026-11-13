// Messages between the extension's pages, content scripts and the settings worker (settings_broker.js).
import type { Config, Position, PreferencePatch, Preferences, ResolvedProfile, ValidationError } from './domain';

/** getContext: what a page needs to draw, for one origin and project. */
export interface SettingsContext {
  origin: string | null;
  projectId: string | null;
  profile: ResolvedProfile | null;
  settings: Preferences;
  /** The page may replace the profile with the Jira project property and re-apply these. */
  preferences: PreferencePatch;
  configured: boolean;
  siteConfigured: boolean;
  position: Position;
}

export interface Done {
  ok: true;
}
/** importConfig without `replace` when profiles already exist: a normal reply, not an error. */
export interface ImportConflict {
  ok: false;
  code: 'conflict';
  conflicts: { origin: string; projectId: string | null }[];
}
/** refresh and settings-changed: how many Jira tabs got the message. */
export interface Delivery {
  delivered: number;
  undelivered: number;
}

/** Every settings request (`jpt:<method>`): the fields it may carry and what the worker replies. */
export interface SettingsRpc {
  getContext: { args: { origin?: string; projectId?: string | null }; reply: SettingsContext };
  getAll: { args: {}; reply: { config: Config; preferences: PreferencePatch } };
  importConfig: { args: { config: unknown; replace?: boolean }; reply: Done | ImportConflict };
  savePreferences: { args: { patch: PreferencePatch }; reply: Done };
  resetPreferences: { args: {}; reply: Done };
  savePosition: { args: { position: Position }; reply: Done };
  removeSite: { args: { origin: string }; reply: Done };
  restoreConfig: { args: {}; reply: Done };
  exportConfig: { args: {}; reply: Config };
  getDraft: { args: {}; reply: Config | null };
  saveDraft: { args: { config: unknown }; reply: Done };
  clearDraft: { args: {}; reply: Done };
  refresh: { args: {}; reply: Delivery };
}
export type SettingsMethod = keyof SettingsRpc;
export type SettingsReply = SettingsRpc[SettingsMethod]['reply'];

export type BrokerErrorCode = 'forbidden' | 'invalid' | 'storage' | 'corrupt' | 'missing';
/** What broker.handle() sends back over chrome messaging; settings_client unwraps it. */
export type BrokerResponse<T = SettingsReply> =
  | { ok: true; value: T }
  | { ok: false; code: BrokerErrorCode; message: string; errors?: ValidationError[] };

/** Errors thrown by settings_client: broker codes plus `disconnected` when the worker did not answer. */
export type ClientError = Error & { code: BrokerErrorCode | 'disconnected'; errors?: ValidationError[] };

/** Broadcast by the worker after any settings change; receivers re-read through getContext. */
export interface SettingsChanged {
  type: 'jpt:settings-changed';
}
