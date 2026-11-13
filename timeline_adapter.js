// @ts-check
/** @typedef {Pick<Location, 'pathname' | 'search' | 'hash'>} PageLocation */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.JptTimeline = api;
})(globalThis, function () {
  'use strict';
  // Jira DOM selectors live here, so a Jira markup change is fixed in one place. Exception: the date-header
  // parsing in timeline_geometry.js keeps its own header selectors next to the code that reads them.
  // "fixture" = present in tests/fixtures/timeline.html (captured 2026-11-13) and covered by tests/timeline-dom.test.js;
  // the others were last confirmed by hand on a live Timeline on the date given.
  const SEL = Object.freeze({
    // Issue key cell in the left column; finds the Timeline table and each row's key. fixture
    KEY: '[data-testid="native-issue-table.common.ui.issue-cells.issue-key.issue-key-cell"]',
    // Gantt bar; testid ends with "issue/<numeric id>-container" (the middle is a cloud ARI). fixture
    BAR: '[data-testid*="draggable-bar-"][data-testid$="-container"]',
    // Horizontal scroller around the table and chart; arrow keys scroll it. fixture
    SCROLLER: '[data-testid="scroll-container.scroll-container"]',
    // Chart overlay layer where holiday strips are drawn. Jira dropped the "timeline." prefix in late 2026;
    // the unprefixed form is in the fixture, the prefixed one is kept for older pages.
    OVERLAY: '[data-testid="timeline.chart-overlays.container"], [data-testid="chart-overlays.container"]',
    // One column per week/month/quarter; the opaque one is the current-period highlight. fixture
    COLUMN_OVERLAY: '[data-testid^="timeline.chart-overlays.columns-overlay.column-"]',
    // Timeline page markers when the URL does not say "timeline". 2026-11 (1.1.2)
    ROOT: '[data-testid="software-board.timeline"], [data-testid^="aais-timeline-toolbar."]',
    // Week/Month/Quarter switcher: selected radio in the menu, or the toolbar buttons. 2026-11 (1.1.2)
    MODE_RADIO: '[role="radio"][aria-checked="true"]',
    MODE_BUTTON: '[data-testid="aais-timeline-toolbar.ui.timeline-mode-switcher.expand-button"]',
  });
  /** @param {ParentNode} doc @returns {HTMLTableElement | null} */
  function getTable(doc) {
    return doc.querySelector(SEL.KEY)?.closest('table') || null;
  }
  const getRows = (/** @type {HTMLTableElement | null} */ table) => (table ? [...table.querySelectorAll('tbody tr')] : []);
  const getRowKey = (/** @type {Element} */ row) => row.querySelector(SEL.KEY)?.textContent?.trim() || null;
  // Rows without dates have no bar, so no id; those are not colored.
  const getRowBar = (/** @type {Element} */ row) => row.querySelector(SEL.BAR);
  /** @param {EventTarget | Element | null | undefined} node @returns {Element | null} */
  const closestBar = (node) => /** @type {Element | null | undefined} */ (node)?.closest?.(SEL.BAR) || null;
  /** @param {Element | null | undefined} bar @returns {string | null} */
  function issueIdOfBar(bar) {
    const m = (bar?.getAttribute('data-testid') || '').match(/issue\/(\d+)-container$/);
    return m ? m[1] : null;
  }
  const findBar = (/** @type {ParentNode} */ doc, /** @type {string} */ id) => (/^\d+$/.test(id) ? doc.querySelector(`[data-testid$="issue/${id}-container"]`) : null);
  const getScroller = (/** @type {ParentNode} */ doc) => doc.querySelector(SEL.SCROLLER);
  /** @param {PageLocation} location @returns {string | null} */
  function getProjectKey(location) {
    const match = (location.pathname || '').match(/\/(?:projects|project-config)\/([A-Za-z][A-Za-z0-9_]*|\d+)(?:\/|$)/);
    if (match) return match[1];
    const numeric = new URLSearchParams(location.search || '').get('projectId');
    return numeric && /^\d+$/.test(numeric) ? numeric : null;
  }
  // Confluence is served from the same atlassian.net origin but never hosts a Jira Timeline.
  /** @param {PageLocation} location */
  function isJiraApp(location) {
    return !/^\/wiki(?:\/|$)/.test(location.pathname || '');
  }
  /** @param {PageLocation} location @param {ParentNode} doc */
  function isTimelinePage(location, doc) {
    const path = location.pathname || '';
    // Board and project Timelines are supported; Plans (Advanced Roadmaps) is a different interface.
    if (!isJiraApp(location) || /\/plans(?:\/|$)/.test(path) || !/\/(?:boards|projects)\/[^/]+/.test(path))
      return false;
    return (
      /(?:^|\/)timeline(?:\/|$)/.test(location.pathname || '') ||
      new URLSearchParams(location.search || '').has('timeline') ||
      /(?:^#|\/)timeline(?:[/?=&]|$)/.test(location.hash || '') ||
      !!doc.querySelector(SEL.ROOT)
    );
  }
  /** @param {HTMLTableElement | null} table @returns {Element | null} */
  function getOverlay(table) {
    if (!table) return null;
    const scope = table.closest(SEL.SCROLLER) || table.parentElement;
    const explicit = scope?.querySelector(SEL.OVERLAY);
    if (explicit && !table.contains(explicit)) return explicit;
    const candidates = [
      ...new Set(
        // A table on the page always has a parent; a detached one throws here, as it did before typing.
        [.../** @type {Element} */ (scope).querySelectorAll(SEL.COLUMN_OVERLAY)]
          .filter((el) => !table.contains(el) && el.getBoundingClientRect().height > 40)
          .map((el) => el.parentElement),
      ),
    ];
    return candidates.length === 1 ? candidates[0] : null;
  }
  return Object.freeze({
    SEL,
    getTable,
    getRows,
    getRowKey,
    getRowBar,
    closestBar,
    issueIdOfBar,
    findBar,
    getScroller,
    getProjectKey,
    isJiraApp,
    isTimelinePage,
    getOverlay,
  });
});
