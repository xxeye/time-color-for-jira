(/** @param {typeof globalThis} root */ function (root) {
  'use strict';
  function classifyIssue(issue, p) {
    const id = String(issue?.fields?.issuetype?.id ?? '');
    return ['planning', 'milestone', 'epic'].find((role) => p?.issueTypes?.[role]?.includes(id)) || 'other';
  }
  function peers(links, p) {
    if (!Array.isArray(links) || !p?.progress?.enabled) return [];
    const found = new Map(),
      { linkTypeIds = [], direction = 'both' } = p.progress;
    for (const link of links) {
      if (!linkTypeIds.includes(String(link?.type?.id))) continue;
      for (const prop of direction === 'inward'
        ? ['inwardIssue']
        : direction === 'outward'
          ? ['outwardIssue']
          : ['inwardIssue', 'outwardIssue']) {
        const peer = link[prop],
          id = peer?.id || peer?.key;
        if (id && !found.has(String(id))) found.set(String(id), peer);
      }
    }
    return [...found.values()];
  }
  function computeProgress(links, p) {
    const items = peers(links, p);
    if (!items.length) return null;
    let done = 0,
      wip = 0,
      partial = false;
    for (const item of items) {
      const cat = item.fields?.status?.statusCategory?.key;
      if (cat === 'done') done++;
      else if (cat === 'indeterminate') wip++;
      else if (cat !== 'new') partial = true;
    }
    const weight = p.progress.inProgressWeight === 0.5 ? 0.5 : 0;
    return { done, wip, total: items.length, pct: Math.round(((done + wip * weight) / items.length) * 100), partial };
  }
  function requiredFields(p, s) {
    const fields = ['issuetype'],
      f = p?.fields || {};
    if (f.role) fields.push(f.role);
    if (s.epicStripe && f.epicHighlight) fields.push(f.epicHighlight);
    if (s.msShowProgress && p?.progress?.enabled) fields.push('issuelinks', 'duedate', f.startDate);
    if (s.showWorkingDays) fields.push('duedate', f.startDate);
    if (s.ptTargetEndShade) fields.push('duedate', f.startDate, f.targetEnd);
    return [...new Set(fields.filter(Boolean))];
  }
  function highlight(raw, rule) {
    const wanted = String(rule?.value ?? '');
    if (!wanted) return false;
    return (Array.isArray(raw) ? raw : [raw]).some(
      (v) =>
        v != null &&
        (typeof v === 'object'
          ? [v.id, v.value, v.name].some((x) => x != null && String(x) === wanted)
          : String(v) === wanted),
    );
  }
  function safeIcon(value, origin) {
    if (typeof value !== 'string' || !value.trim()) return '';
    try {
      const u = new URL(value, origin);
      return u.protocol === 'https:' && u.origin === origin && !u.username && !u.password ? u.href : '';
    } catch {
      return '';
    }
  }
  // Tooltip order for linked issues: in progress, to do, done; then type, summary, key (natural sort).
  // Applied when the list is built and again when it is shown, so cached lists cannot keep an old order.
  const STATUS_ORDER = { indeterminate: 0, new: 1, done: 2 };
  const natural = (a, b) => (a || '').localeCompare(b || '', undefined, { numeric: true, sensitivity: 'base' });
  function sortRelates(items) {
    return items
      .slice()
      .sort(
        (a, b) =>
          (STATUS_ORDER[a.statusCat] ?? 0) - (STATUS_ORDER[b.statusCat] ?? 0) ||
          natural(a.typeName, b.typeName) ||
          natural(a.summary, b.summary) ||
          natural(a.key, b.key),
      );
  }
  function relatesList(links, p, origin) {
    return sortRelates(
      peers(links, p)
        .map((peer) => ({
          key: /^[A-Z][A-Z0-9_]*-\d+$/i.test(peer.key || '') ? peer.key : '',
          summary: typeof peer.fields?.summary === 'string' ? peer.fields.summary.slice(0, 2000) : '',
          statusCat: peer.fields?.status?.statusCategory?.key || '',
          typeIconUrl: safeIcon(peer.fields?.issuetype?.iconUrl || '', origin),
          typeName: typeof peer.fields?.issuetype?.name === 'string' ? peer.fields.issuetype.name.slice(0, 100) : '',
        }))
        .filter((peer) => peer.key),
    );
  }
  // Role field may be a string, a single option or a multi-select; keep up to 30 short names.
  function roleNames(raw) {
    return (Array.isArray(raw) ? raw : raw == null ? [] : [raw])
      .map((value) => (typeof value === 'string' ? value : value?.value || value?.name))
      .filter((value) => typeof value === 'string')
      .slice(0, 30)
      .map((value) => value.slice(0, 100));
  }
  // One Jira issue → what the page caches: `data` drives coloring, `detail` only the hover card.
  // Links are read only for Milestones with progress turned on. Invalid dates become null.
  function toIssueRecord(issue, p, s, origin) {
    const calendar = root.JptCalendar || require('./calendar.js');
    const fields = issue?.fields || {},
      f = p?.fields || {},
      type = classifyIssue(issue, p),
      withLinks = type === 'milestone' && !!s.msShowProgress;
    const date = (value) => (calendar.parseDate(value) !== null ? value : null);
    return {
      type,
      data: {
        epicHighlight: highlight(fields[f.epicHighlight], p?.highlightRule),
        progress: withLinks ? computeProgress(fields.issuelinks, p) : null,
        startDate: date(fields[f.startDate]),
        dueDate: date(fields.duedate),
        targetEndDate: date(fields[f.targetEnd]),
      },
      detail: {
        relates: withLinks ? relatesList(fields.issuelinks, p, origin) : [],
        roles: roleNames(fields[f.role]),
      },
    };
  }
  const api = {
    classifyIssue,
    peers,
    computeProgress,
    requiredFields,
    highlight,
    safeIcon,
    sortRelates,
    toIssueRecord,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.JptRules = api;
})(globalThis);
