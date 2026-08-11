import { CUSTOM_LIMITS } from './presets.js';
import type { BoardConfig } from './types.js';

export type Validation = { ok: true } | { ok: false; reason: string };

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 20;

/** Letters, digits, `_` and `-`; must start with a letter or digit. */
const USERNAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;

/** Names that would be confusing or misleading on a public leaderboard. */
const RESERVED_USERNAMES = new Set([
  'admin',
  'administrator',
  'moderator',
  'system',
  'root',
  'anonymous',
  'deleted',
  'minesweeper',
]);

export function validateUsername(username: string): Validation {
  if (typeof username !== 'string') return { ok: false, reason: 'Username must be text.' };
  if (username !== username.trim()) {
    return { ok: false, reason: 'Username cannot start or end with spaces.' };
  }
  if (username.length < USERNAME_MIN_LENGTH || username.length > USERNAME_MAX_LENGTH) {
    return {
      ok: false,
      reason: `Username must be ${USERNAME_MIN_LENGTH}-${USERNAME_MAX_LENGTH} characters.`,
    };
  }
  if (!USERNAME_PATTERN.test(username)) {
    return {
      ok: false,
      reason: 'Use only letters, digits, hyphens and underscores, starting with a letter or digit.',
    };
  }
  if (RESERVED_USERNAMES.has(username.toLowerCase())) {
    return { ok: false, reason: 'That username is reserved.' };
  }
  return { ok: true };
}

export function validateBoardConfig(config: BoardConfig): Validation {
  const { width, height, mines } = config;
  for (const [label, value] of [
    ['width', width],
    ['height', height],
    ['mines', mines],
  ] as const) {
    if (!Number.isInteger(value)) return { ok: false, reason: `${label} must be a whole number.` };
  }
  if (width < CUSTOM_LIMITS.minWidth || width > CUSTOM_LIMITS.maxWidth) {
    return {
      ok: false,
      reason: `Width must be ${CUSTOM_LIMITS.minWidth}-${CUSTOM_LIMITS.maxWidth}.`,
    };
  }
  if (height < CUSTOM_LIMITS.minHeight || height > CUSTOM_LIMITS.maxHeight) {
    return {
      ok: false,
      reason: `Height must be ${CUSTOM_LIMITS.minHeight}-${CUSTOM_LIMITS.maxHeight}.`,
    };
  }
  const cells = width * height;
  // At least one cell must stay clear for the opening click. Boards dense
  // enough to lose the full 3x3 safe zone are allowed — `generateBoard` falls
  // back to protecting just the clicked cell.
  const maxMines = cells - 1;
  if (mines < CUSTOM_LIMITS.minMines) {
    return { ok: false, reason: `Place at least ${CUSTOM_LIMITS.minMines} mine.` };
  }
  if (mines > maxMines) {
    return { ok: false, reason: `That board fits at most ${maxMines} mines.` };
  }
  return { ok: true };
}

/** Hard ceiling on a submitted move log, so verification can never be a DoS vector. */
export const MAX_MOVES = 20_000;

/** Nobody plays a single board for six hours; anything longer is a broken client. */
export const MAX_GAME_MS = 6 * 60 * 60 * 1000;

/**
 * Superhuman thresholds used to reject fabricated times.
 *
 * The current human record sits near 100ms per 3BV, so 15ms is roughly seven
 * times faster than the best player alive — comfortably clear of false
 * positives while still catching scripted "wins".
 */
export const MIN_MS_PER_3BV = 15;
export const MIN_MS_PER_MOVE = 8;

/**
 * How far a client's reported duration may fall short of the window the server
 * itself measured.
 *
 * The player's stopwatch starts when the seed *arrives*; the server's starts
 * when the request for it *lands*. The difference is a full round trip, and on
 * a cold worker or a slow connection that can run to several seconds — which
 * was rejecting perfectly honest wins at the old 2.5s.
 *
 * This is the one number in the system that is a genuine trade: it is also the
 * largest amount of time a determined cheat could shave off a real run.
 * Closing it completely means verifying every move as it happens, and that
 * costs a round trip per click.
 */
export const NETWORK_TOLERANCE_MS = 8_000;

/** Slack in the other direction, for sub-millisecond clock disagreement. */
export const CLOCK_SKEW_MS = 1_000;

export function minPlausibleElapsedMs(threeBV: number, moveCount: number): number {
  return Math.max(threeBV * MIN_MS_PER_3BV, moveCount * MIN_MS_PER_MOVE);
}
