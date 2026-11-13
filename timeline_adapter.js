(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.JptTimeline = api;
})(globalThis, function () {
  'use strict';
  const SEL_KEY = '[data-testid="native-issue-table.common.ui.issue-cells.issue-key.issue-key-cell"]';
  const SEL_ROOT = '[data-testid="software-board.timeline"]';
  // Jira dropped the "timeline." prefix in late 2026; keep both forms.
  const SEL_OVERLAY = '[data-testid="timeline.chart-overlays.container"], [data-testid="chart-overlays.container"]';
  function getTable(doc) {
    return doc.querySelector(SEL_KEY)?.closest('table') || null;
  }
  function getProjectKey(location) {
    const match = (location.pathname || '').match(/\/(?:projects|project-config)\/([A-Za-z][A-Za-z0-9_]*|\d+)(?:\/|$)/);
    if (match) return match[1];
    const numeric = new URLSearchParams(location.search || '').get('projectId');
    return numeric && /^\d+$/.test(numeric) ? numeric : null;
  }
  // Confluence is served from the same atlassian.net origin but never hosts a Jira Timeline.
  function isJiraApp(location) {
    return !/^\/wiki(?:\/|$)/.test(location.pathname || '');
  }
  function isTimelinePage(location, doc) {
    const path = location.pathname || '';
    // Board and project Timelines are supported; Plans (Advanced Roadmaps) is a different interface.
    if (!isJiraApp(location) || /\/plans(?:\/|$)/.test(path) || !/\/(?:boards|projects)\/[^/]+/.test(path))
      return false;
    return (
      /(?:^|\/)timeline(?:\/|$)/.test(location.pathname || '') ||
      new URLSearchParams(location.search || '').has('timeline') ||
      /(?:^#|\/)timeline(?:[/?=&]|$)/.test(location.hash || '') ||
      !!doc.querySelector(`${SEL_ROOT}, [data-testid^="aais-timeline-toolbar."]`)
    );
  }
  function getOverlay(table) {
    if (!table) return null;
    const scope = table.closest('[data-testid="scroll-container.scroll-container"]') || table.parentElement;
    const explicit = scope?.querySelector(SEL_OVERLAY);
    if (explicit && !table.contains(explicit)) return explicit;
    const candidates = [
      ...new Set(
        [...scope.querySelectorAll('[data-testid^="timeline.chart-overlays.columns-overlay.column-"]')]
          .filter((el) => !table.contains(el) && el.getBoundingClientRect().height > 40)
          .map((el) => el.parentElement),
      ),
    ];
    return candidates.length === 1 ? candidates[0] : null;
  }
  return Object.freeze({ SEL_KEY, getTable, getProjectKey, isJiraApp, isTimelinePage, getOverlay });
});
