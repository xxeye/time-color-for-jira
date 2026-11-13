// @ts-check
/** @import { Preferences } from './types/domain' */
/** @import { BarClasses, IssueData, IssueKind, Progress, ProgressBadge, ProgressTier, Translate } from './types/model' */
// What each Timeline bar should look like, as plain data. No DOM here; timeline_color.js applies the result.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.JptModel = api;
})(globalThis, function () {
  'use strict';
  const DAY_MS = 86400000;
  const calendar = () => globalThis.JptCalendar || require('./calendar.js');

  // Which style each bar gets, from its issue type (JptRules.classifyIssue) and the user's settings.
  /** @param {IssueKind} type @param {Partial<Pick<IssueData, 'epicHighlight'>> | null | undefined} data @param {Preferences} s @returns {BarClasses} */
  function barClasses(type, data, s) {
    const planning = type === 'planning',
      milestone = type === 'milestone',
      epic = type === 'epic';
    return {
      planning,
      milestone,
      diamond: milestone && !!s.msDiamond,
      epic,
      epicHighlight: epic && !!s.epicStripe && !!data?.epicHighlight,
    };
  }

  /** @param {number} pct @returns {ProgressTier} */
  function progressTier(pct) {
    if (pct >= 100) return 'done';
    if (pct >= 50) return 'mid';
    if (pct > 0) return 'low';
    return 'zero';
  }
  // Milestone badge: "done/total pct%" and/or "DUE mm/dd". null when there is nothing to show.
  // The numerator is the done count; pct uses the project's in-progress weight (JptRules.computeProgress).
  /** @param {Progress | null | undefined} progress @param {string | null | undefined} dueDate @param {{ weight?: number, t: Translate }} options @returns {ProgressBadge | null} */
  function progressBadge(progress, dueDate, { weight = 0, t }) {
    const due = calendar().monthDay(dueDate);
    const p = progress;
    const hasProgress = !!p && [p.pct, p.total, p.done, p.wip].every(Number.isFinite) && p.total > 0;
    // hasProgress implies p is set; tsc cannot follow that through the boolean.
    if (!hasProgress && !due) return null;
    const text = [hasProgress && p ? `${p.done}/${p.total} ${p.pct}%` : '', due ? `DUE ${due}` : '']
      .filter(Boolean)
      .join(' · ');
    const progressTitle = !hasProgress || !p
      ? ''
      : p.wip > 0
        ? t('progressTitleWip', { done: p.done, wip: p.wip, weight, total: p.total, pct: p.pct })
        : t('progressTitle', { done: p.done, total: p.total, pct: p.pct });
    const title = [progressTitle, due ? t('progressTitleDue', { date: dueDate }) : '']
      .filter(Boolean)
      .join(t('titleSeparator'));
    return { text, title, tier: hasProgress && p ? progressTier(p.pct) : 'zero' };
  }

  // Planning Task shading after its target end: the target's position along the bar, 0..1.
  // null unless start <= target <= due are all valid dates.
  /** @param {Partial<Pick<IssueData, 'startDate' | 'targetEndDate' | 'dueDate'>>} [dates] @returns {number | null} */
  function targetEndRatio({ startDate, targetEndDate, dueDate } = {}) {
    const { dateOnlyMs } = calendar();
    const start = dateOnlyMs(startDate),
      target = dateOnlyMs(targetEndDate),
      due = dateOnlyMs(dueDate);
    if (![start, target, due].every(Number.isFinite) || !(start <= target && target <= due)) return null;
    const totalDays = Math.floor((due - start) / DAY_MS) + 1;
    return Math.max(0, Math.min(1, Math.floor((target - start) / DAY_MS) / totalDays));
  }

  return Object.freeze({ barClasses, progressBadge, progressTier, targetEndRatio });
});
