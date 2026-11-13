// Type contract tests for ui_helpers.js. Nothing here runs.
import type { PageStatus } from '../types/runtime';

const ui = globalThis.JptUI;

// tabStatus gives a page status the popup can render.
async function status() {
  const result: PageStatus = await ui.tabStatus(chrome);
  ui.renderStatus(result);
  // @ts-expect-error the state must be one the popup knows
  ui.renderStatus({ state: 'loading' });
}
void status;

// applyImport may come back cancelled, conflicting or done.
async function importing() {
  const result = await ui.applyImport(globalThis.JptClient, {}, () => true);
  if (!result.ok && 'cancelled' in result) {
    const cancelled: true = result.cancelled;
    void cancelled;
  }
  // @ts-expect-error confirmReplace must answer yes or no
  await ui.applyImport(globalThis.JptClient, {}, () => 'yes');
}
void importing;

// @ts-expect-error yearRanges takes numbers
ui.yearRanges(['2026']);
