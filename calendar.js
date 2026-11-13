// @ts-check
/** @import { Calendar } from './types/domain' */
/** @import { CalendarInfo, DayKind, WorkingDays } from './types/model' */
(/** @param {typeof globalThis} root */ function (root) {
  'use strict';
  /** @param {unknown} v @returns {number | null} UTC midnight */
  function parseDate(v) {
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
    const stamp = Date.parse(v + 'T00:00:00Z');
    return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === v ? stamp : null;
  }
  // Holidays are days off on a normal weekday; workdays are make-up working days on a weekend.
  // Years that appear in either list count as complete; with no lists at all only weekends apply.
  /** @param {Partial<Calendar>} [calendar] @returns {CalendarInfo} */
  function dayInfo(calendar = {}) {
    const holidays = new Set((calendar.holidays || []).map((e) => e.date)),
      workdays = new Set((calendar.workdays || []).map((e) => e.date)),
      years = [...new Set([...holidays, ...workdays].map((d) => Number(d.slice(0, 4))))].sort();
    return { weekendDays: calendar.weekendDays || [0, 6], holidays, workdays, years, hasList: years.length > 0 };
  }
  /** @param {string} iso @param {CalendarInfo} info @returns {DayKind} */
  function kindOf(iso, info) {
    if (info.holidays.has(iso)) return 'holiday';
    if (info.workdays.has(iso)) return 'workday';
    return info.weekendDays.includes(new Date(iso + 'T00:00:00Z').getUTCDay()) ? 'weekend' : 'normal';
  }
  /** @param {unknown} start @param {unknown} end @param {CalendarInfo} [info] @returns {WorkingDays | null} */
  function countWorkingDays(start, end, info = dayInfo()) {
    const a = parseDate(start),
      b = parseDate(end);
    if (a === null || b === null || a > b || b - a > 3660 * 86400000) return null;
    let days = 0,
      complete = true;
    for (let t = a; t <= b; t += 86400000) {
      const iso = new Date(t).toISOString().slice(0, 10);
      if (info.hasList && !info.years.includes(Number(iso.slice(0, 4)))) complete = false;
      const kind = kindOf(iso, info);
      if (kind === 'normal' || kind === 'workday') days++;
    }
    return { days, complete };
  }
  // Small display helpers. They read only the leading YYYY-MM-DD, so Jira datetimes work too,
  // and they do not reject impossible dates the way parseDate does.
  const LEADING_DATE = /^(\d{4})-(\d{2})-(\d{2})/;
  // '2026-05-21' -> '5/21'; anything else -> fallback.
  /** @param {string | null | undefined} value @param {string} [fallback] */
  function monthDay(value, fallback = '') {
    const m = LEADING_DATE.exec(value || '');
    return m ? `${Number(m[2])}/${Number(m[3])}` : fallback;
  }
  // UTC midnight of the leading date (overflowing days roll over, e.g. 02-30 -> 03-02); NaN when absent.
  /** @param {string | null | undefined} value */
  function dateOnlyMs(value) {
    const m = LEADING_DATE.exec(value || '');
    return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : NaN;
  }
  // Local calendar date of a Date object as YYYY-MM-DD (not UTC, unlike toISOString).
  const localYmd = (/** @type {Date} */ d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const api = { parseDate, dayInfo, kindOf, countWorkingDays, monthDay, dateOnlyMs, localYmd };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.JptCalendar = api;
})(globalThis);
