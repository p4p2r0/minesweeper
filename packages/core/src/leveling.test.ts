import assert from 'node:assert/strict';
import test from 'node:test';

import { levelFromXp, xpForLevel } from './leveling.js';

test('zero XP is level 1 with nothing earned yet', () => {
  const result = levelFromXp(0);
  assert.equal(result.level, 1);
  assert.equal(result.xpIntoLevel, 0);
  assert.equal(result.xpForNext, xpForLevel(1));
});

test('XP just short of the threshold stays at the current level', () => {
  const threshold = xpForLevel(1);
  const result = levelFromXp(threshold - 1);
  assert.equal(result.level, 1);
  assert.equal(result.xpIntoLevel, threshold - 1);
});

test('XP exactly at the threshold advances a level', () => {
  const threshold = xpForLevel(1);
  const result = levelFromXp(threshold);
  assert.equal(result.level, 2);
  assert.equal(result.xpIntoLevel, 0);
});

test('each level requires more XP than the last', () => {
  for (let level = 1; level < 20; level++) {
    assert.ok(xpForLevel(level + 1) > xpForLevel(level));
  }
});

test('a large XP total lands on a consistent, reproducible level', () => {
  const totalXp = 5000;
  const a = levelFromXp(totalXp);
  const b = levelFromXp(totalXp);
  assert.deepEqual(a, b);
  // Spending xpIntoLevel plus every completed level's requirement should
  // reconstruct the original total exactly — no XP created or lost.
  let reconstructed = a.xpIntoLevel;
  for (let level = 1; level < a.level; level++) reconstructed += xpForLevel(level);
  assert.equal(reconstructed, totalXp);
});
