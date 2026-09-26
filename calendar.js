(function (root) {
  'use strict';
  function parseDate(v) {
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
    const stamp = Date.parse(v + 'T00:00:00Z');
    return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === v ? stamp : null;
  }
  // Holidays are days off on a normal weekday; workdays are make-up working days on a weekend.
  // Years that appear in either list count as complete; with no lists at all only weekends apply.
  function dayInfo(calendar = {}) {
    const holidays = new Set((calendar.holidays || []).map((e) => e.date)),
      workdays = new Set((calendar.workdays || []).map((e) => e.date)),
      years = [...new Set([...holidays, ...workdays].map((d) => Number(d.slice(0, 4))))].sort();
    return { weekendDays: calendar.weekendDays || [0, 6], holidays, workdays, years, hasList: years.length > 0 };
  }
  function kindOf(iso, info) {
    if (info.holidays.has(iso)) return 'holiday';
    if (info.workdays.has(iso)) return 'workday';
    return info.weekendDays.includes(new Date(iso + 'T00:00:00Z').getUTCDay()) ? 'weekend' : 'normal';
  }
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
  const api = { parseDate, dayInfo, kindOf, countWorkingDays };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.JptCalendar = api;
})(globalThis);
