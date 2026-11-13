// Type contract tests for settings.js (see globals.ts). Nothing here runs.
import type { Config, Preferences, PropertyValue } from '../types/domain';

const S = globalThis.JptSettings;
declare const input: unknown;

// Settings are widened: a color is any string, not the default's literal type.
const prefs: Preferences = S.effectiveSettings(null, {});
prefs.ptColor = '#000000';
// @ts-expect-error a boolean setting does not take a string
prefs.enabled = 'yes';
// @ts-expect-error unknown setting keys are rejected
prefs.noSuchSetting;

// A file validates to Config, the project property to PropertyValue; failures carry errors and no value.
const file = S.validateConfig(input);
if (file.ok) {
  const config: Config = file.value;
  config.sites;
} else {
  file.errors[0]?.message;
  // @ts-expect-error a failed result has no usable value
  file.value.sites;
}
const property = S.validateProperty(input);
if (property.ok) {
  const value: PropertyValue = property.value;
  value.profile.issueTypes.planning;
  // @ts-expect-error the property result has no sites
  property.value.sites;
}

// The boolean validators narrow unknown input.
if (S.validatePreferences(input)) {
  const color: string | undefined = input.ptColor;
  void color;
}
if (S.validatePosition(input)) {
  const side: 'right' | 'top' = input.side;
  void side;
}
// @ts-expect-error unknown input is not usable before validation
input.ptColor;
