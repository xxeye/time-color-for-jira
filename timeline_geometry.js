// @ts-check
/** @import { ScaleCell, TimelineMode, TimelineScale } from './types/model' */
/** @typedef {typeof import('./timeline_dates.js')} Dates */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.JptGeometry = api;
})(globalThis, function () {
  'use strict';
  const DAY = 86400000;
  const WEEK_DAYS = 'span[data-testid^="timeline.ui.timeline-table-kit.header.chart.calendar-cells.week.day-"]';
  /** @param {string} iso */
  function nextDay(iso) {
    return new Date(Date.parse(iso + 'T00:00:00Z') + DAY).toISOString().slice(0, 10);
  }
  /** @param {string | null | undefined} text @param {Dates} dates @param {number} referenceYear @returns {string[] | null} */
  function weekMonths(text, dates, referenceYear) {
    const token = dates.MONTH_TOKEN;
    const split = text?.match(new RegExp(String.raw`^(${token})\s*/\s*(${token})(?:\s+(\d{4}|['’]\d{2}))?$`, 'i'));
    if (!split) {
      const period = dates.parsePeriodLabel(text, referenceYear);
      return period ? [period.start.slice(0, 7)] : null;
    }
    const suffix = split[3] ? ' ' + split[3] : '';
    const first = dates.parsePeriodLabel(split[1] + suffix, referenceYear);
    if (!first) return null;
    let last = dates.parsePeriodLabel(split[2], Number(first.start.slice(0, 4)));
    if (!last) return null;
    if (last.start < first.start) last = dates.parsePeriodLabel(split[2], Number(first.start.slice(0, 4)) + 1);
    // TODO(type review): the retry above can return null, and then this line throws (unchanged from before typing).
    const end = /** @type {NonNullable<typeof last>} */ (last);
    if (first.endExclusive !== end.start) return null;
    return [first.start.slice(0, 7), end.start.slice(0, 7)];
  }
  /** @param {ScaleCell[]} entries @param {Dates} dates @returns {TimelineScale | null} */
  function normalizedScale(entries, dates) {
    const cells = entries.map((cell) => ({ ...cell })).sort((a, b) => a.left - b.left);
    for (let index = 1; index < cells.length; index++) {
      const previous = cells[index - 1],
        current = cells[index];
      const overlap = previous.right - current.left;
      if (overlap > 0 && overlap <= 0.05 && previous.endExclusive === current.start) previous.right = current.left;
    }
    return dates.createScale(cells);
  }
  // Reads layout (getBoundingClientRect), so it needs a rendered page; jsdom tests stub the rects.
  /** @param {Element | null} table @param {Dates} dates @param {TimelineMode | null} mode @param {number} [referenceYear] @returns {TimelineScale | null} */
  function readScale(table, dates, mode, referenceYear = new Date().getFullYear()) {
    const header = table?.querySelector('thead tr')?.lastElementChild;
    if (!header) return null;
    /** @type {ScaleCell[]} */
    const entries = [],
      /** @type {ScaleCell[]} */
      days = [];
    let hasWeeklyDays = false;
    // Read leaf date labels, never the aggregate text of a wrapping header container.
    const labels = [...header.querySelectorAll('small,time,[datetime],[data-date]')];
    // Header labels always sit inside a cell; a label without a parent throws here, as before typing.
    const parentOf = (/** @type {Element} */ el) => /** @type {Element} */ (el.parentElement);
    labels.sort((a, b) => parentOf(a).getBoundingClientRect().left - parentOf(b).getBoundingClientRect().left);
    for (const [labelIndex, label] of labels.entries()) {
      const text = label.getAttribute('datetime') || label.getAttribute('data-date') || label.textContent?.trim();
      if (mode === 'WEEKS') {
        const spans = Array.from(label.parentElement?.querySelectorAll?.(WEEK_DAYS) || []);
        if (spans.length) {
          hasWeeklyDays = true;
          let year = referenceYear;
          // Day numbers are text-width spans; the week cell divided evenly gives the real day columns.
          const week = parentOf(label).getBoundingClientRect();
          if (!week || week.width <= 0 || week.height <= 0) return null;
          const dayWidth = week.width / spans.length;
          const previous = days[days.length - 1];
          const adjacent = previous && Math.abs(previous.right - week.left) <= 0.05;
          if (adjacent) year = Number(previous.endExclusive.slice(0, 4));
          else if (!/(?:['’]\d{2}|\d{4})\s*$/.test(text || '')) {
            // A clipped boundary can start with yearless Dec / Jan followed by Jan '27.
            const following = labels[labelIndex + 1]?.textContent?.trim();
            if (following && /(?:['’]\d{2}|\d{4})\s*$/.test(following)) {
              const anchor = weekMonths(following, dates, referenceYear);
              const current = weekMonths(text, dates, referenceYear);
              if (anchor && current)
                year = Number(anchor[0].slice(0, 4)) - (current[0].slice(5) > anchor[0].slice(5) ? 1 : 0);
            }
          }
          const months = weekMonths(text, dates, year);
          if (!months) return null;
          if (
            adjacent &&
            months[0] + '-' + String(Number(/** @type {string} */ (spans[0].textContent).trim())).padStart(2, '0') !== previous.endExclusive
          )
            return null;
          let monthIndex = 0,
            /** @type {number | null} */
            previousDay = null,
            /** @type {string | null} */
            previousDate = null;
          for (const [spanIndex, span] of spans.entries()) {
            const value = span.textContent?.trim(),
              day = Number(value);
            if (!/^\d{1,2}$/.test(value || '') || day < 1 || day > 31) return null;
            if (previousDay !== null && day < previousDay) monthIndex++;
            if (!months[monthIndex]) return null;
            const start = months[monthIndex] + '-' + String(day).padStart(2, '0');
            if (dates.parseDateLabel(start) !== start || (previousDate && nextDay(previousDate) !== start)) return null;
            const left = week.left + spanIndex * dayWidth,
              right = spanIndex === spans.length - 1 ? week.right : left + dayWidth;
            if (!days.some((cell) => cell.start === start && Math.abs(cell.left - left) < 0.05))
              days.push({ start, endExclusive: nextDay(start), left, right });
            previousDay = day;
            previousDate = start;
          }
          continue;
        }
      }
      let period = dates.parsePeriodLabel(text, referenceYear);
      if (!period) {
        const day = dates.parseDateLabel(text);
        if (day && mode === 'WEEKS')
          period = {
            start: day,
            endExclusive: new Date(Date.parse(day + 'T00:00:00Z') + 7 * DAY).toISOString().slice(0, 10),
          };
      }
      if (!period) continue;
      const cell = label.closest('[role="columnheader"],[data-testid*="header-cell"]') || label.parentElement;
      const rect = cell?.getBoundingClientRect();
      if (!rect || rect.width < 10 || rect.height <= 0) continue;
      if (!entries.some((x) => x.start === period.start && Math.abs(x.left - rect.left) < 1))
        entries.push({ ...period, left: rect.left, right: rect.right });
    }
    if (hasWeeklyDays) return normalizedScale(days, dates);
    return normalizedScale(entries, dates);
  }
  return { readScale };
});
