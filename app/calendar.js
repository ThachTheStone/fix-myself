// Calendar layout for work blocks (PLAN-01, PLAN-02). Pure functions, no DOM.
// Times are ISO strings; positions are minutes from the start of a planning day.
import { localDayParts, startOfDay } from '../extension/block-schedule.js';
import { addDays, localDate } from './model.js';

export const SNAP_MINUTES = 15;
const MINUTE_MS = 60_000;
const DAY_MINUTES = 1440;

export function snap(minutes) {
  return Math.round(minutes / SNAP_MINUTES) * SNAP_MINUTES;
}

const shifted = (iso, minutes) => new Date(Date.parse(iso) + minutes * MINUTE_MS).toISOString();

export function movedBlock(block, deltaMinutes) {
  const delta = snap(deltaMinutes);
  return { ...block, start: shifted(block.start, delta), end: shifted(block.end, delta) };
}

// Moves a block by whole days and a vertical delta, keeping its wall-clock time in the
// planning zone across clock changes. The length stays the same.
export function shiftBlockDays(block, days, deltaMinutes, timeZone) {
  if (!days) return movedBlock(block, deltaMinutes);
  const start = Date.parse(block.start);
  const original = localDayParts(new Date(start), timeZone);
  const wanted = Math.floor(original.minutes) + snap(deltaMinutes);
  let target = startOfDay(addDays(original.day, days), timeZone) + wanted * MINUTE_MS;
  const expected = ((wanted % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  let off = expected - Math.floor(localDayParts(new Date(target), timeZone).minutes);
  if (off > 720) off -= DAY_MINUTES;
  if (off < -720) off += DAY_MINUTES;
  target += off * MINUTE_MS;
  return { ...block, start: new Date(target).toISOString(), end: new Date(target + Date.parse(block.end) - start).toISOString() };
}

export function resizedBlock(block, deltaMinutes) {
  const earliest = Date.parse(block.start) + SNAP_MINUTES * MINUTE_MS;
  const end = Math.max(earliest, Date.parse(block.end) + snap(deltaMinutes) * MINUTE_MS);
  return { ...block, end: new Date(end).toISOString() };
}

// The length of a calendar day in minutes: 1380 or 1500 when the clocks change.
const dayLength = (day, timeZone) => Math.round((startOfDay(addDays(day, 1), timeZone) - startOfDay(day, timeZone)) / MINUTE_MS);

export function rangeToBlock(day, fromMinutes, toMinutes, timeZone) {
  const length = dayLength(day, timeZone);
  let from = Math.max(0, snap(Math.min(fromMinutes, toMinutes)));
  let to = Math.min(length, snap(Math.max(fromMinutes, toMinutes)));
  if (to - from < SNAP_MINUTES) {
    to = Math.min(length, from + SNAP_MINUTES);
    from = Math.min(from, to - SNAP_MINUTES);
  }
  const origin = startOfDay(day, timeZone);
  return {
    start: new Date(origin + from * MINUTE_MS).toISOString(),
    end: new Date(origin + to * MINUTE_MS).toISOString()
  };
}

// Side-by-side columns for blocks that overlap one another, directly or through others.
function placeColumns(items) {
  items.sort((a, b) => a.top - b.top || b.height - a.height);
  let group = [];
  let groupEnd = -Infinity;
  let ends = [];
  const close = () => {
    for (const item of group) item.columns = ends.length;
    group = [];
    ends = [];
  };
  for (const item of items) {
    if (item.top >= groupEnd) {
      close();
      groupEnd = -Infinity;
    }
    let column = ends.findIndex((end) => end <= item.top);
    if (column === -1) column = ends.length;
    ends[column] = item.top + item.height;
    item.column = column;
    group.push(item);
    groupEnd = Math.max(groupEnd, item.top + item.height);
  }
  close();
  return items;
}

export function calendarDays(state, startDay, count, now = new Date()) {
  const timeZone = state.settings?.timeZone ?? null;
  const pending = new Set((state.pendingBlockChanges ?? []).map((change) => change.blockId));
  const todayDay = localDate(now, timeZone);
  const tasks = state.tasks.filter((task) => task.status !== 'canceled');
  const days = [];
  for (let index = 0; index < count; index += 1) {
    const day = addDays(startDay, index);
    const from = startOfDay(day, timeZone);
    const to = startOfDay(addDays(day, 1), timeZone);
    const blocks = [];
    const deadlines = [];
    for (const task of tasks) {
      for (const block of task.workBlocks ?? []) {
        const start = Date.parse(block.start);
        const end = Date.parse(block.end);
        if (end <= from || start >= to) continue;
        const clippedStart = Math.max(start, from);
        const clippedEnd = Math.min(end, to);
        blocks.push({
          taskId: task.id, blockId: block.id, title: task.title, status: task.status, strict: Boolean(block.strict),
          pending: pending.has(block.id), start: block.start, end: block.end,
          top: (clippedStart - from) / MINUTE_MS, height: (clippedEnd - clippedStart) / MINUTE_MS,
          column: 0, columns: 1, continuesBefore: start < from, continuesAfter: end > to
        });
      }
      if (task.status !== 'completed' && task.deadline) {
        const at = Date.parse(task.deadline);
        if (at >= from && at < to) deadlines.push({ taskId: task.id, title: task.title, at: task.deadline, top: (at - from) / MINUTE_MS });
      }
    }
    days.push({ day, isToday: day === todayDay, blocks: placeColumns(blocks), deadlines: deadlines.sort((a, b) => a.top - b.top) });
  }
  return days;
}
