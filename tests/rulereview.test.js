import assert from 'node:assert/strict';
import test from 'node:test';
import { recordChromeReports, ruleReview } from '../app/model.js';

const WORK = '00000000-0000-4000-8000-000000000001';
const HOME = '00000000-0000-4000-8000-000000000002';

function profile(overrides = {}) {
  return {
    name: 'Work',
    lastSeenAt: '2026-11-19T10:00:00.000Z',
    activeDays: ['2026-11-19'],
    attempts: {},
    ruleEvents: {},
    passReasons: {},
    ...overrides
  };
}

test('BLK-10: block rule activity sums every profile and leaves empty sites out', () => {
  const state = {
    chrome: {
      profiles: {
        [WORK]: profile({
          ruleEvents: {
            '2026-11-17': {
              'youtube.com': { block: { 9: 2, 21: 1 } },
              'facebook.com': { pause: { 20: 1 } }
            },
            '2026-11-19': {
              'youtube.com': { pause: { 21: 1 }, pass: { 21: 1 } },
              'reddit.com': { block: { 8: 0 } }
            }
          },
          passReasons: { '2026-11-19': [{ host: 'youtube.com', hour: 21, reason: 'Checking a course' }] }
        }),
        [HOME]: profile({
          lastSeenAt: '2026-11-19T11:00:00.000Z',
          ruleEvents: { '2026-11-18': { 'youtube.com': { block: { 21: 2 } } } },
          passReasons: { '2026-11-17': [{ host: 'facebook.com', hour: 20, reason: 'Message from Mai' }] }
        })
      }
    }
  };
  const review = ruleReview(state, '2026-11-16', '2026-11-22', '2026-11-19');
  assert.equal(review.connected, true);
  assert.deepEqual(review.days, ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19']);
  // youtube.com has the most activity, facebook.com less, and reddit.com only a
  // zero count, so it is left out.
  assert.deepEqual(review.bySite.map(({ domain, block, pause, pass }) => [domain, block, pause, pass]), [
    ['youtube.com', 5, 1, 1],
    ['facebook.com', 0, 1, 0]
  ]);
  const youtube = review.bySite[0];
  assert.equal(youtube.hours.length, 24);
  assert.equal(youtube.hours[9], 2);
  assert.equal(youtube.hours[21], 5);
  assert.equal(youtube.hours.reduce((total, count) => total + count, 0), 7);
  assert.deepEqual(review.reasons, [
    { day: '2026-11-19', domain: 'youtube.com', hour: 21, reason: 'Checking a course' },
    { day: '2026-11-17', domain: 'facebook.com', hour: 20, reason: 'Message from Mai' }
  ]);
});

test('BLK-10: the review stops at today and keeps newer reasons first', () => {
  const state = {
    chrome: {
      profiles: {
        [WORK]: profile({
          ruleEvents: {
            '2026-11-19': { 'youtube.com': { pause: { 8: 1 } } },
            '2026-11-21': { 'youtube.com': { block: { 21: 4 } } }
          },
          passReasons: {
            '2026-11-19': [{ host: 'youtube.com', hour: 8, reason: 'Morning' }],
            '2026-11-21': [{ host: 'youtube.com', hour: 21, reason: 'Not yet' }]
          }
        })
      }
    }
  };
  const review = ruleReview(state, '2026-11-16', '2026-11-22', '2026-11-19');
  assert.deepEqual(review.days, ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19']);
  assert.deepEqual(review.bySite.map(({ domain, block, pause, pass }) => [domain, block, pause, pass]), [
    ['youtube.com', 0, 1, 0]
  ]);
  assert.deepEqual(review.reasons, [{ day: '2026-11-19', domain: 'youtube.com', hour: 8, reason: 'Morning' }]);
  // With no profile paired there is nothing to show and nothing to explain.
  const empty = ruleReview({ chrome: { profiles: {} } }, '2026-11-16', '2026-11-22', '2026-11-19');
  assert.equal(empty.connected, false);
  assert.deepEqual(empty.bySite, []);
  assert.deepEqual(empty.reasons, []);
});

test('BLK-10: a newer report replaces its own days and keeps the older ones', () => {
  let state = { chrome: { profiles: {} } };
  state = recordChromeReports(state, [{
    profileId: WORK,
    profileName: 'Work',
    receivedAt: Date.parse('2026-11-18T10:00:00Z'),
    activeDays: ['2026-11-18'],
    attempts: {},
    ruleEvents: { '2026-11-18': { 'youtube.com': { block: { 21: 1 } } } },
    passReasons: {}
  }]);
  state = recordChromeReports(state, [{
    profileId: WORK,
    profileName: 'Work',
    receivedAt: Date.parse('2026-11-19T10:00:00Z'),
    activeDays: ['2026-11-19'],
    attempts: {},
    ruleEvents: {
      '2026-11-18': { 'youtube.com': { block: { 21: 2 } } },
      '2026-11-19': { 'youtube.com': { pause: { 9: 1 }, pass: { 9: 1 } } }
    },
    passReasons: { '2026-11-19': [{ host: 'youtube.com', hour: 9, reason: 'Standup notes' }] }
  }]);
  const saved = state.chrome.profiles[WORK];
  assert.deepEqual(saved.ruleEvents, {
    '2026-11-18': { 'youtube.com': { block: { 21: 2 } } },
    '2026-11-19': { 'youtube.com': { pause: { 9: 1 }, pass: { 9: 1 } } }
  });
  assert.deepEqual(saved.passReasons, { '2026-11-19': [{ host: 'youtube.com', hour: 9, reason: 'Standup notes' }] });
  // A report that arrives out of order is ignored, so older totals cannot win.
  const unchanged = recordChromeReports(state, [{
    profileId: WORK,
    profileName: 'Work',
    receivedAt: Date.parse('2026-11-17T10:00:00Z'),
    activeDays: ['2026-11-17'],
    attempts: {},
    ruleEvents: { '2026-11-17': { 'youtube.com': { block: { 7: 9 } } } },
    passReasons: {}
  }]);
  assert.equal(unchanged, state);
});
