(function (root) {
  'use strict';
  const DAY = 86400000;
  const MONTHS = [
    'january',
    'february',
    'march',
    'april',
    'may',
    'june',
    'july',
    'august',
    'september',
    'october',
    'november',
    'december',
  ];

  function isoDate(year, month, day) {
    if (!Number.isInteger(year) || year < 1000 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31)
      return null;
    const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const stamp = Date.parse(iso + 'T00:00:00Z');
    return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === iso ? iso : null;
  }

  function stamp(iso) {
    if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
    const [year, month, day] = iso.split('-').map(Number);
    return isoDate(year, month, day) === iso ? Date.parse(iso + 'T00:00:00Z') : null;
  }

  function monthNumber(label) {
    const normalized = label.toLowerCase().replace(/\.$/, '');
    if (normalized === 'sept') return 9;
    const index = MONTHS.findIndex((month) => month === normalized || month.slice(0, 3) === normalized);
    return index < 0 ? null : index + 1;
  }

  function parseDateLabel(text) {
    if (typeof text !== 'string') return null;
    const value = text.trim();
    let match =
      value.match(/^(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日$/) ||
      value.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/) ||
      value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) return isoDate(+match[1], +match[2], +match[3]);
    match = value.match(/^([a-z]+\.?)\s+(\d{1,2}),\s*(\d{4})$/i);
    if (!match) return null;
    const month = monthNumber(match[1]);
    return month === null ? null : isoDate(+match[3], month, +match[2]);
  }

  function period(year, month, length) {
    const start = isoDate(year, month, 1);
    const endMonth = month + length;
    const endExclusive = isoDate(year + Math.floor((endMonth - 1) / 12), ((endMonth - 1) % 12) + 1, 1);
    return start && endExclusive ? { start, endExclusive } : null;
  }

  function parsePeriodLabel(text, referenceYear) {
    if (typeof text !== 'string') return null;
    const value = text.trim().replace(/\s+/g, ' ');
    const reference = Number.isInteger(referenceYear) ? referenceYear : null;
    let match = value.match(/^([a-z]+\.?)\s*[-–]\s*([a-z]+\.?)(?:\s+(\d{4}|['’]\d{2}))?$/i);
    if (match) {
      const startMonth = monthNumber(match[1]),
        endMonth = monthNumber(match[2]);
      const year = match[3] ? (/^['’]/.test(match[3]) ? 2000 + Number(match[3].slice(1)) : +match[3]) : reference;
      if (startMonth === null || endMonth === null || (startMonth - 1) % 3 !== 0 || endMonth !== startMonth + 2)
        return null;
      return period(year, startMonth, 3);
    }
    match = value.match(/^(?:(\d{4})年\s*)?(\d{1,2})月$/);
    if (match) return period(match[1] ? +match[1] : reference, +match[2], 1);
    match = value.match(/^([a-z]+\.?)(?:\s+(\d{4}|['’]\d{2}))?$/i);
    if (match) {
      const month = monthNumber(match[1]);
      const year = match[2] ? (/^['’]/.test(match[2]) ? 2000 + Number(match[2].slice(1)) : +match[2]) : reference;
      return month === null ? null : period(year, month, 1);
    }
    match = value.match(/^Q([1-4])(?:\s+(\d{4}))?$/i);
    if (match) return period(match[2] ? +match[2] : reference, (+match[1] - 1) * 3 + 1, 3);
    match = value.match(/^(\d{4})\s+Q([1-4])$/i);
    if (match) return period(+match[1], (+match[2] - 1) * 3 + 1, 3);
    match = value.match(/^第([1-4])季(?:\s+(\d{4}))?$/);
    if (match) return period(match[2] ? +match[2] : reference, (+match[1] - 1) * 3 + 1, 3);
    match = value.match(/^(\d{4})年\s*第([1-4])季$/);
    return match ? period(+match[1], (+match[2] - 1) * 3 + 1, 3) : null;
  }

  // Dates describe half-open cells. Inverse mapping snaps to the nearest day
  // boundary for drag operations. Missing or ambiguous cells never extrapolate.
  function createScale(cells) {
    if (!Array.isArray(cells) || !cells.length) return null;
    const segments = [];
    for (const cell of cells) {
      if (!cell || !Number.isFinite(cell.left) || !Number.isFinite(cell.right) || cell.right <= cell.left) return null;
      const start = stamp(cell.start),
        end = stamp(cell.endExclusive);
      if (start === null || end === null || end <= start) return null;
      segments.push({ left: cell.left, right: cell.right, start, end });
    }
    segments.sort((a, b) => a.left - b.left);
    for (let index = 1; index < segments.length; index++) {
      const previous = segments[index - 1],
        current = segments[index];
      if (current.left < previous.right || current.start < previous.end) return null;
    }
    const last = segments[segments.length - 1];
    const normalized = Object.freeze(
      segments.map((cell) =>
        Object.freeze({
          left: cell.left,
          right: cell.right,
          start: new Date(cell.start).toISOString().slice(0, 10),
          endExclusive: new Date(cell.end).toISOString().slice(0, 10),
        }),
      ),
    );
    return Object.freeze({
      cells: normalized,
      start: normalized[0].start,
      endExclusive: normalized[normalized.length - 1].endExclusive,
      left: segments[0].left,
      right: last.right,
      dateToX(iso) {
        const date = stamp(iso);
        if (date === null) return null;
        const segment = segments.find((cell) => date >= cell.start && date < cell.end);
        if (!segment) return date === last.end ? last.right : null;
        return segment.left + ((date - segment.start) / (segment.end - segment.start)) * (segment.right - segment.left);
      },
      xToDate(x) {
        if (!Number.isFinite(x)) return null;
        const segment = segments.find((cell) => x >= cell.left && x < cell.right);
        if (!segment) return x === last.right ? new Date(last.end).toISOString().slice(0, 10) : null;
        const days = (segment.end - segment.start) / DAY;
        const day = Math.min(days, Math.round(((x - segment.left) / (segment.right - segment.left)) * days));
        return new Date(segment.start + day * DAY).toISOString().slice(0, 10);
      },
    });
  }

  // Jira view-switcher labels in the UI languages handled so far. Unknown labels return null
  // so no date geometry is guessed.
  const MODE_LABELS = Object.freeze({
    週: 'WEEKS',
    周: 'WEEKS',
    Weeks: 'WEEKS',
    Week: 'WEEKS',
    月: 'MONTHS',
    Months: 'MONTHS',
    Month: 'MONTHS',
    季: 'QUARTERS',
    Quarters: 'QUARTERS',
    Quarter: 'QUARTERS',
  });
  function modeFromLabel(text) {
    const label = typeof text === 'string' ? text.trim() : '';
    return Object.hasOwn(MODE_LABELS, label) ? MODE_LABELS[label] : null;
  }
  // Jira appends a duration to bar date labels, e.g. "(8 天)" or "(8 days)".
  const DURATION_LABEL = /\(\s*[+-]?\d+\s*(?:天|days?)\s*\)/i;

  const api = { parseDateLabel, parsePeriodLabel, createScale, modeFromLabel, DURATION_LABEL };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.JptDates = api;
})(globalThis);
