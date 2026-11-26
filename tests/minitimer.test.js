import assert from 'node:assert/strict';
import test from 'node:test';
import miniModule from '../desktop/mini-timer.cjs';

const { validMiniView, placeWindow } = miniModule;
const good = { show: true, endAt: 1_800_000_000_000, label: 'Write', status: '', clickThrough: false };
const size = { width: 240, height: 72 };
const area = { x: 0, y: 0, width: 1920, height: 1040 };

test('FOC-12: a hide request and a full show request are valid', () => {
  assert.deepEqual(validMiniView({ show: false }), { show: false });
  assert.deepEqual(validMiniView(good), good);
  assert.deepEqual(validMiniView({ ...good, status: 'Paused', label: 'x'.repeat(160) }),
    { ...good, status: 'Paused', label: 'x'.repeat(160) });
});

test('FOC-12: invalid views are rejected', () => {
  const bad = [
    null, 'x', [], {}, { show: 'yes' }, { show: false, extra: 1 },
    { ...good, extra: 1 },
    { ...good, endAt: 1.5 }, { ...good, endAt: '5' }, { ...good, endAt: 2 ** 60 },
    { ...good, label: '' }, { ...good, label: 'x'.repeat(161) }, { ...good, label: 5 },
    { ...good, status: 'x'.repeat(41) }, { ...good, status: null },
    { ...good, clickThrough: 'no' }
  ];
  for (const value of bad) assert.equal(validMiniView(value), null, JSON.stringify(value));
  const missing = { ...good };
  delete missing.status;
  assert.equal(validMiniView(missing), null);
});

test('FOC-12: a saved position fully inside a work area is kept', () => {
  assert.deepEqual(placeWindow({ x: 100, y: 50 }, [area], size), { x: 100, y: 50 });
  assert.deepEqual(placeWindow({ x: 1680, y: 968 }, [area], size), { x: 1680, y: 968 });
});

test('FOC-12: a position outside or partly outside falls back to the top-right corner', () => {
  const corner = { x: 1920 - 240 - 16, y: 16 };
  assert.deepEqual(placeWindow({ x: 5000, y: 50 }, [area], size), corner);
  assert.deepEqual(placeWindow({ x: 1800, y: 50 }, [area], size), corner);
  assert.deepEqual(placeWindow({ x: 100, y: 1000 }, [area], size), corner);
  assert.deepEqual(placeWindow({ x: -10, y: 50 }, [area], size), corner);
  assert.deepEqual(placeWindow(null, [area], size), corner);
  assert.deepEqual(placeWindow({ x: NaN, y: 1 }, [area], size), corner);
});

test('FOC-12: with two work areas a position on the second one is kept', () => {
  const second = { x: 1920, y: 0, width: 1280, height: 1000 };
  assert.deepEqual(placeWindow({ x: 2000, y: 100 }, [area, second], size), { x: 2000, y: 100 });
  assert.deepEqual(placeWindow({ x: 1850, y: 100 }, [area, second], size), { x: 1664, y: 16 });
  assert.deepEqual(placeWindow({ x: 2000, y: 100 }, [area], size), { x: 1664, y: 16 });
  const left = { x: -1280, y: 0, width: 1280, height: 1000 };
  assert.deepEqual(placeWindow({ x: -500, y: 20 }, [area, left], size), { x: -500, y: 20 });
});
