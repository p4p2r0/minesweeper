import type { PresetId } from './types.js';

/**
 * XP is earned only for things that are already verified server-side: a
 * ranked win, a personal best on top of it, and a streak day being extended.
 * Nothing here is a new trust boundary — it rides on checks that already
 * exist (replay verification, `advanceStreak`), so there's no separate way to
 * fabricate XP that isn't also a way to fabricate a score.
 */
export const WIN_XP: Record<PresetId, number> = {
  beginner: 10,
  intermediate: 20,
  expert: 35,
};

export const PERSONAL_BEST_BONUS_XP = 15;
export const STREAK_BONUS_XP = 5;

/**
 * A loss still earns a little XP — scaled by how much of the board's safe
 * area got opened before the mine did — so grinding through hard boards
 * without winning yet isn't worth nothing. Deliberately a small fraction of
 * `WIN_XP` for the same difficulty: clearing the board has to stay the
 * better payoff, or this becomes the easier way to level.
 */
export const PROGRESS_XP: Record<PresetId, number> = {
  beginner: 3,
  intermediate: 6,
  expert: 10,
};

/**
 * A per-day ceiling on how much of `total_xp` can come from losses.
 *
 * Without one, this is free XP for the price of a fast reveal-then-die loop:
 * the opening click always cascades open a chunk of the board for nothing,
 * and `createGame`'s rate limit (240/hour) is generous enough that repeating
 * that loop out-earns actually trying to win. The cap doesn't touch win XP —
 * only however much a player has *already* banked from losses today.
 */
export const DAILY_PROGRESS_XP_CAP = 20;

/** XP required to go from `level` to `level + 1`. A flat, growing staircase. */
export function xpForLevel(level: number): number {
  return 100 + (level - 1) * 50;
}

export interface LevelProgress {
  level: number;
  /** XP earned within the current level. */
  xpIntoLevel: number;
  /** XP needed to reach the next level from this one. */
  xpForNext: number;
}

/** Converts a lifetime XP total into a level and progress toward the next one. */
export function levelFromXp(totalXp: number): LevelProgress {
  let level = 1;
  let remaining = Math.max(0, totalXp);
  let step = xpForLevel(level);
  while (remaining >= step) {
    remaining -= step;
    level += 1;
    step = xpForLevel(level);
  }
  return { level, xpIntoLevel: remaining, xpForNext: step };
}
