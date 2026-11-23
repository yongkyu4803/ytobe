import test from 'node:test';
import assert from 'node:assert/strict';
import { isShortsDuration, isShortsVideo, toCount } from '../utils/shorts.ts';

test('Shorts duration limit is 3 minutes', () => {
  assert.equal(isShortsDuration(60), true);
  assert.equal(isShortsDuration(150), true);
  assert.equal(isShortsDuration(180), true);
  assert.equal(isShortsDuration(181), false);
  assert.equal(isShortsDuration(0), false);
  assert.equal(isShortsDuration(null), null);
});

test('player aspect ratio separates Shorts from short horizontal videos', () => {
  assert.equal(isShortsVideo(136, 200, 356), true);   // vertical comedy short
  assert.equal(isShortsVideo(165, 200, 113), false);  // 2:45 horizontal music video
  assert.equal(isShortsVideo(165, 200, 200), false);  // square, over 60s
  assert.equal(isShortsVideo(45, 200, 200), true);    // square, old Shorts rule
  assert.equal(isShortsVideo(240, 200, 356), false);  // vertical but too long
  assert.equal(isShortsVideo(120), true);             // no dimensions: duration fallback
});

test('hidden or invalid counts never become NaN', () => {
  assert.equal(toCount('123'), 123);
  assert.equal(toCount(undefined), null);
  assert.equal(toCount(''), null);
  assert.equal(toCount('abc'), null);
});
