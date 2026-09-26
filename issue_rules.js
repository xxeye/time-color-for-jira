(function (root) {
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
  const api = { classifyIssue, peers, computeProgress, requiredFields, highlight, safeIcon };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.JptRules = api;
})(globalThis);
