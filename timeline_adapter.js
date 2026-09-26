(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.JptTimeline = api;
})(globalThis, function () {
  'use strict';
  const SEL_KEY = '[data-testid="native-issue-table.common.ui.issue-cells.issue-key.issue-key-cell"]';
  const SEL_ROOT = '[data-testid="software-board.timeline"]';
  const SEL_OVERLAY = '[data-testid="timeline.chart-overlays.container"]';
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
  function findTodayMarker(doc, table) {
    if (!table) return null;
    let scope = table.closest(SEL_ROOT);
    if (!scope) {
      scope = table;
      // Chart overlays can be siblings of the table; never broaden to the whole page.
      let parent = table.parentElement;
      for (
        let depth = 0;
        parent && depth < 4 && parent !== doc.body && parent !== doc.documentElement;
        depth++, parent = parent.parentElement
      ) {
        if (parent.querySelector(SEL_OVERLAY)) {
          scope = parent;
          break;
        }
      }
    }
    const bounds = table.getBoundingClientRect();
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      return (
        r.width > 0 &&
        r.height > 0 &&
        r.bottom > bounds.top &&
        r.top < bounds.bottom &&
        r.right > bounds.left &&
        r.left < bounds.right
      );
    };
    const semantic = [
      ...scope.querySelectorAll('[data-testid*="today-marker"], [data-testid*="today-indicator"]'),
    ].filter(visible);
    if (semantic.length) return semantic.length === 1 ? semantic[0] : null;
    const view = doc.defaultView;
    if (!view?.getComputedStyle) return null;
    const candidates = [...scope.querySelectorAll('div')].filter((el) => {
      if (!visible(el)) return false;
      const r = el.getBoundingClientRect();
      if (r.width > 4 || r.height < 300) return false;
      const bg = view.getComputedStyle(el).backgroundColor;
      return !!bg && bg !== 'transparent' && !/^rgba\([^)]*,\s*0(?:\.0+)?\s*\)$/.test(bg);
    });
    return candidates.length === 1 ? candidates[0] : null;
  }
  function getOverlay(table) {
    if (!table) return null;
    const scope = table.closest('[data-testid="scroll-container.scroll-container"]') || table.parentElement;
    const explicit = scope?.querySelector('[data-testid="timeline.chart-overlays.container"]');
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
  return Object.freeze({ SEL_KEY, getTable, getProjectKey, isJiraApp, isTimelinePage, findTodayMarker, getOverlay });
});
