// Type contract tests: `npm run typecheck` fails if these stop holding. Nothing here runs.
// A clean typecheck can also mean "everything became any", so these check that types are really there.

type IsAny<T> = 0 extends 1 & T ? true : false;
type NotAny<T> = IsAny<T> extends true ? never : T;
const notAny = <T>(_value: NotAny<T>): void => {};

// Every global the scripts attach has a real type.
notAny(globalThis.JptI18n);
notAny(globalThis.JptSettings);
notAny(globalThis.JptSettingsBroker);
notAny(globalThis.JptClient);
notAny(globalThis.JiraApi);
notAny(globalThis.JptRules);
notAny(globalThis.JptCache);
notAny(globalThis.JptCalendar);
notAny(globalThis.JptDates);
notAny(globalThis.JptGeometry);
notAny(globalThis.JptModel);
notAny(globalThis.JptSession);
notAny(globalThis.JptTimeline);
notAny(globalThis.JptPage);
notAny(globalThis.JptUI);
notAny(globalThis.JptGenerator);

// Wrong member names are rejected.
// @ts-expect-error not an export of timeline_model.js
globalThis.JptModel.noSuchFunction;
// @ts-expect-error not an export of ui_helpers.js
globalThis.JptUI.noSuchFunction;
// @ts-expect-error not a method of the page bridge instance
globalThis.JptPage.noSuchMethod;

// Modules that reach other modules through `root.X || require(...)` keep those types.
notAny(globalThis.JptSettingsBroker.createBroker);
notAny(globalThis.JptClient.getContext);
