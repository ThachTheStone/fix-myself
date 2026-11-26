// Schedule logic for block rules (BLK-02, BLK-05, BLK-06, BLK-07).
// The planner app (app/model.js) and the Chrome extension (extension/worker.js)
// both import this file, so both decide which rules apply at the same moment,
// with or without the desktop app running. Keep it free of Chrome and DOM APIs.

export const DAY_MINUTES = 1440;
export const WEEK_MINUTES = 7 * DAY_MINUTES;
export const DAY_MS = 86_400_000;

const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/;
const formatters = new Map();

export function parseClock(text) {
  const match = CLOCK.exec(String(text ?? ''));
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

const clockFormatter = (timeZone) => {
  const key = timeZone ?? '';
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timeZone || undefined,
      hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    formatters.set(key, formatter);
  }
  return formatter;
};

// The calendar day and the minute of that day in the planning time zone.
export function localDayParts(date = new Date(), timeZone = null) {
  const parts = {};
  for (const part of clockFormatter(timeZone).formatToParts(date)) parts[part.type] = part.value;
  const seconds = Number(parts.second) || 0;
  return {
    day: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: (Number(parts.hour) % 24) * 60 + Number(parts.minute) + seconds / 60
  };
}

const weekdayOf = (day) => new Date(day + 'T00:00:00Z').getUTCDay();

function addDaysToDay(day, count) {
  return new Date(new Date(day + 'T00:00:00Z').getTime() + count * DAY_MS).toISOString().slice(0, 10);
}

function zoneOffsetMs(timeZone, date) {
  const { day, minutes } = localDayParts(date, timeZone);
  const [year, month, dateOfMonth] = day.split('-').map(Number);
  const whole = Math.floor(minutes);
  const seconds = Math.round((minutes - whole) * 60);
  return Date.UTC(year, month - 1, dateOfMonth, 0, whole, seconds) - (date.getTime() - date.getMilliseconds());
}

// Midnight at the start of a calendar day in the planning time zone.
export function startOfDay(day, timeZone = null) {
  const [year, month, date] = day.split('-').map(Number);
  if (!timeZone) return new Date(year, month - 1, date).getTime();
  const guess = Date.UTC(year, month - 1, date);
  let stamp = guess - zoneOffsetMs(timeZone, new Date(guess));
  stamp = guess - zoneOffsetMs(timeZone, new Date(stamp));
  return stamp;
}

export function minutesOfWeek(date = new Date(), timeZone = null) {
  const { day, minutes } = localDayParts(date, timeZone);
  return weekdayOf(day) * DAY_MINUTES + minutes;
}

// The moment a minute of the week happens next to a reference moment.
// Days run from Sunday (0) to Saturday (6), like the stored rule days.
export function instantOfWeekMinute(minute, reference = new Date(), timeZone = null) {
  const { day } = localDayParts(reference, timeZone);
  const days = Math.floor(minute / DAY_MINUTES);
  const rest = minute % DAY_MINUTES;
  return startOfDay(addDaysToDay(day, days - weekdayOf(day)), timeZone) + rest * 60_000;
}

function mergeIntervals(ranges) {
  const sorted = ranges.filter(([start, end]) => end > start).sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([...range]);
  }
  return merged;
}

// Minutes of the week covered by a schedule, as merged [start, end) ranges.
// A window belongs to the day it starts (BLK-02), so a window that crosses
// midnight spills into the next day and, on Saturday, into the next week.
export function scheduleIntervals(schedule) {
  if (!schedule || schedule.type === 'always') return [[0, WEEK_MINUTES]];
  if (schedule.type !== 'scheduled' || !Array.isArray(schedule.windows)) return [];
  const ranges = [];
  for (const window of schedule.windows) {
    const start = parseClock(window?.start);
    const end = parseClock(window?.end);
    if (start === null || end === null || start === end) continue;
    const length = end > start ? end - start : DAY_MINUTES - start + end;
    const days = Array.isArray(window?.days) ? window.days : [];
    for (const day of days) {
      if (!Number.isInteger(day) || day < 0 || day > 6) continue;
      const begin = day * DAY_MINUTES + start;
      const finish = begin + length;
      if (finish > WEEK_MINUTES) {
        ranges.push([begin, WEEK_MINUTES]);
        ranges.push([0, finish - WEEK_MINUTES]);
      } else {
        ranges.push([begin, finish]);
      }
    }
  }
  return mergeIntervals(ranges);
}

// True when every moment of `inner` is also covered by `outer`.
export function coversIntervals(outer, inner) {
  return inner.every(([start, end]) => outer.some(([outerStart, outerEnd]) => outerStart <= start && outerEnd >= end));
}

// Rules that apply at `now`, with the moment each one stops applying.
// An always-on rule stops only when the user changes or disables it (null).
export function activeRules(rules, now = new Date(), timeZone = null) {
  const date = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(date.getTime())) return [];
  const minute = minutesOfWeek(date, timeZone);
  const active = [];
  for (const rule of Array.isArray(rules) ? rules : []) {
    if (!rule || rule.enabled === false) continue;
    const intervals = scheduleIntervals(rule.schedule);
    const match = intervals.find(([start, end]) => minute >= start && minute < end);
    if (!match) continue;
    active.push({
      rule,
      until: rule.schedule?.type === 'always' ? null : instantOfWeekMinute(match[1], date, timeZone)
    });
  }
  return active;
}

// Rules with the pending changes that are due applied on top, plus the changes
// that are still waiting. A change is never applied before its moment, so the
// old protection stays in force until the delay passes (BLK-06). A planning
// time zone change waits too, because schedules and "next day" depend on it;
// `zoneChanged` tells callers to use `timeZone` (which may be null, meaning the
// device zone) instead of the plan's current zone.
export function effectiveRules(rules = [], pendingChanges = [], now = new Date()) {
  const time = (now instanceof Date ? now : new Date(now)).getTime();
  let list = Array.isArray(rules) ? [...rules] : [];
  const waiting = [];
  let changeDelay;
  let timeZone = null;
  let zoneChanged = false;
  for (const change of Array.isArray(pendingChanges) ? pendingChanges : []) {
    const at = new Date(change?.effectiveAt ?? NaN).getTime();
    if (!Number.isFinite(at) || at > time) {
      waiting.push(change);
      continue;
    }
    const kind = change?.change?.type;
    if (kind === 'delete') list = list.filter((rule) => rule.id !== change.ruleId);
    else if (kind === 'update' && change.change.rule) {
      const rule = change.change.rule;
      if (list.some((item) => item.id === rule.id)) list = list.map((item) => (item.id === rule.id ? rule : item));
    } else if (kind === 'delay') {
      changeDelay = change.change.changeDelay;
    } else if (kind === 'timeZone') {
      timeZone = change.change.timeZone ?? null;
      zoneChanged = true;
    }
  }
  return { rules: list, pendingChanges: waiting, changeDelay, timeZone, zoneChanged };
}

// The planning zone with a due zone change applied.
export function effectiveTimeZone(currentZone, result) {
  return result.zoneChanged ? result.timeZone : (currentZone ?? null);
}
