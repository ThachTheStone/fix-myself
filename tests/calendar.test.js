import test from 'node:test';
import assert from 'node:assert/strict';
import { startOfDay } from '../extension/block-schedule.js';
import {
  calendarDays, movedBlock, rangeToBlock, resizedBlock, shiftBlockDays, snap, SNAP_MINUTES
} from '../app/calendar.js';

const ZONE = 'Asia/Ho_Chi_Minh';
const at = (day, clock, zone = ZONE) => {
  const [hour, minute] = clock.split(':').map(Number);
  return new Date(startOfDay(day, zone) + (hour * 60 + minute) * 60_000).toISOString();
};
const task = (id, extra = {}) => ({ id, title: 'Task ' + id, status: 'planned', workBlocks: [], deadline: null, ...extra });
const stateOf = (tasks, extra = {}) => ({ settings: { timeZone: ZONE }, tasks, pendingBlockChanges: [], ...extra });
const block = (id, day, from, to, extra = {}) => ({ id, start: at(day, from), end: at(day, to), strict: false, ...extra });

test('a block in a non-UTC planning zone lands on the right day and minute', () => {
  // 02:00 in Ho Chi Minh on 2026-03-10 is still 2026-03-09 in UTC.
  const state = stateOf([task('a', { workBlocks: [block('b1', '2026-03-10', '02:00', '03:30')] })]);
  const [first, second] = calendarDays(state, '2026-03-09', 2, new Date('2026-03-10T00:00:00Z'));
  assert.equal(first.blocks.length, 0);
  assert.equal(second.blocks.length, 1);
  assert.equal(second.blocks[0].top, 120);
  assert.equal(second.blocks[0].height, 90);
  assert.equal(second.isToday, true);
  assert.equal(first.isToday, false);
});

test('a block crossing midnight appears on both days with continues flags', () => {
  const state = stateOf([task('a', { workBlocks: [{
    id: 'night', start: at('2026-03-10', '23:00'), end: at('2026-03-11', '01:00'), strict: false
  }] })]);
  const [first, second] = calendarDays(state, '2026-03-10', 2);
  assert.deepEqual([first.blocks[0].top, first.blocks[0].height], [1380, 60]);
  assert.deepEqual([first.blocks[0].continuesBefore, first.blocks[0].continuesAfter], [false, true]);
  assert.deepEqual([second.blocks[0].top, second.blocks[0].height], [0, 60]);
  assert.deepEqual([second.blocks[0].continuesBefore, second.blocks[0].continuesAfter], [true, false]);
});

test('overlapping blocks share columns by group', () => {
  const two = stateOf([task('a', { workBlocks: [block('x', '2026-03-10', '09:00', '10:00'), block('y', '2026-03-10', '09:30', '10:30')] })]);
  const [pair] = calendarDays(two, '2026-03-10', 1);
  assert.deepEqual(pair.blocks.map((item) => [item.column, item.columns]), [[0, 2], [1, 2]]);

  const chain = stateOf([task('a', { workBlocks: [
    block('A', '2026-03-10', '09:00', '10:00'),
    block('B', '2026-03-10', '09:30', '11:00'),
    block('C', '2026-03-10', '10:30', '11:30')
  ] })]);
  const [group] = calendarDays(chain, '2026-03-10', 1);
  const byId = Object.fromEntries(group.blocks.map((item) => [item.blockId, item]));
  assert.equal(byId.A.column, 0);
  assert.equal(byId.B.column, 1);
  assert.equal(byId.C.column, 0);
  assert.ok(group.blocks.every((item) => item.columns === 2));

  const apart = stateOf([task('a', { workBlocks: [block('p', '2026-03-10', '09:00', '10:00'), block('q', '2026-03-10', '10:00', '11:00')] })]);
  assert.ok(calendarDays(apart, '2026-03-10', 1)[0].blocks.every((item) => item.columns === 1));
});

test('canceled tasks are left out and completed tasks are kept', () => {
  const state = stateOf([
    task('gone', { status: 'canceled', workBlocks: [block('b1', '2026-03-10', '09:00', '10:00')] }),
    task('done', { status: 'completed', workBlocks: [block('b2', '2026-03-10', '11:00', '12:00')] })
  ]);
  const [day] = calendarDays(state, '2026-03-10', 1);
  assert.deepEqual(day.blocks.map((item) => [item.taskId, item.status]), [['done', 'completed']]);
});

test('deadlines are placed by day, skip completed and canceled tasks, and pending is flagged', () => {
  const state = stateOf([
    task('a', { deadline: at('2026-03-10', '17:00'), workBlocks: [block('b1', '2026-03-10', '09:00', '10:00', { strict: true })] }),
    task('d', { status: 'completed', deadline: at('2026-03-10', '18:00') }),
    task('c', { status: 'canceled', deadline: at('2026-03-10', '19:00') }),
    task('e', { deadline: at('2026-03-11', '08:00') })
  ], { pendingBlockChanges: [{ id: 'p', taskId: 'a', blockId: 'b1', block: null }] });
  const [first, second] = calendarDays(state, '2026-03-10', 2);
  assert.deepEqual(first.deadlines.map((item) => [item.taskId, item.top]), [['a', 1020]]);
  assert.deepEqual(second.deadlines.map((item) => item.taskId), ['e']);
  assert.equal(first.blocks[0].pending, true);
  assert.equal(first.blocks[0].strict, true);
});

test('snap, movedBlock, resizedBlock and rangeToBlock', () => {
  assert.equal(SNAP_MINUTES, 15);
  assert.equal(snap(7), 0);
  assert.equal(snap(8), 15);
  assert.equal(snap(-22), -15);
  const original = { id: 'b', strict: true, start: '2026-03-10T09:00:00.000Z', end: '2026-03-10T10:00:00.000Z' };
  const moved = movedBlock(original, 122);
  assert.equal(moved.start, '2026-03-10T11:00:00.000Z');
  assert.equal(moved.end, '2026-03-10T12:00:00.000Z');
  assert.equal(moved.strict, true);
  assert.equal(resizedBlock(original, 31).end, '2026-03-10T10:30:00.000Z');
  assert.equal(resizedBlock(original, -600).end, '2026-03-10T09:15:00.000Z');
  assert.equal(resizedBlock(original, 31).start, original.start);

  const range = rangeToBlock('2026-03-10', 660, 600, ZONE);
  assert.equal(range.start, at('2026-03-10', '10:00'));
  assert.equal(range.end, at('2026-03-10', '11:00'));
  const tiny = rangeToBlock('2026-03-10', 601, 603, ZONE);
  assert.equal(Date.parse(tiny.end) - Date.parse(tiny.start), 15 * 60_000);
  assert.equal(tiny.start, at('2026-03-10', '10:00'));
});

test('moving a block to another day keeps its local time across a clock change', () => {
  const zone = 'America/New_York';
  const block = { id: 'b', strict: false, start: at('2026-03-07', '10:00', zone), end: at('2026-03-07', '11:30', zone) };
  const moved = shiftBlockDays(block, 1, 0, zone);
  // 'at' adds elapsed minutes, so it is only right before the clocks change; use UTC literals.
  assert.equal(moved.end, '2026-03-08T15:30:00.000Z');
  assert.equal(moved.start, '2026-03-08T14:00:00.000Z');
  assert.equal(shiftBlockDays(block, 1, 62, zone).start, '2026-03-08T15:00:00.000Z');
  assert.equal(shiftBlockDays(block, 0, 60, zone).start, at('2026-03-07', '11:00', zone));
  const back = shiftBlockDays({ ...block, start: moved.start, end: moved.end }, -1, 0, zone);
  assert.equal(back.start, block.start);
});

test('rangeToBlock stays inside a 23 hour day and never starts before midnight', () => {
  const zone = 'America/New_York';
  const range = rangeToBlock('2026-03-08', 1300, 2000, zone);
  assert.equal(range.end, new Date(startOfDay('2026-03-09', zone)).toISOString());
  assert.equal(Date.parse(range.end) - Date.parse(range.start), 75 * 60_000);
  const early = rangeToBlock('2026-03-08', -90, 20, zone);
  assert.equal(early.start, new Date(startOfDay('2026-03-08', zone)).toISOString());
  const late = rangeToBlock('2026-03-08', 1500, 1600, zone);
  assert.equal(late.end, new Date(startOfDay('2026-03-09', zone)).toISOString());
  assert.equal(Date.parse(late.end) - Date.parse(late.start), 15 * 60_000);
});
