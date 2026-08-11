import { computeThreeBV } from './board.js';
import { applyMove, createGame } from './game.js';
import { MAX_GAME_MS, MAX_MOVES } from './rules.js';
import type { BoardConfig, GameState, Move } from './types.js';

export interface ReplaySuccess {
  ok: true;
  state: GameState;
  /** Difficulty of the layout the player actually got. */
  threeBV: number;
  /** Client-reported duration, i.e. the timestamp of the final move. */
  elapsedMs: number;
  /** Non-mine cells opened by the time the game ended — the server's own count, not the client's. */
  safeCellsRevealed: number;
  /** Non-mine cells on the whole board, i.e. what `safeCellsRevealed` is out of. */
  safeCellsTotal: number;
}

export interface ReplayFailure {
  ok: false;
  reason: string;
  /** Index of the offending move, when the failure is attributable to one. */
  moveIndex?: number;
}

export type ReplayResult = ReplaySuccess | ReplayFailure;

export interface ReplayOptions {
  /** Reject anything that does not end in a win. Set for score submissions. */
  requireWin?: boolean;
}

/**
 * Re-plays a submitted move log against a server-held seed.
 *
 * This is the heart of the anti-cheat story: the client never tells the server
 * *what happened*, only which buttons were pressed. The server derives the
 * outcome itself, using the same engine the player ran, so a forged win has to
 * be an actual win on the actual board.
 */
export function replayGame(
  config: BoardConfig,
  seed: string,
  moves: readonly Move[],
  options: ReplayOptions = {},
): ReplayResult {
  if (moves.length === 0) return { ok: false, reason: 'No moves submitted.' };
  if (moves.length > MAX_MOVES) return { ok: false, reason: 'Too many moves submitted.' };

  const first = moves[0];
  if (first.kind !== 'reveal') {
    return { ok: false, reason: 'A game must open with a reveal.', moveIndex: 0 };
  }
  if (first.t !== 0) {
    return { ok: false, reason: 'The opening move must be at t=0.', moveIndex: 0 };
  }

  let state = createGame(config, seed);
  for (let i = 0; i < moves.length; i++) {
    const move = moves[i];
    const result = applyMove(state, move);
    if (!result.ok) {
      return { ok: false, reason: `Illegal move (${result.reason}).`, moveIndex: i };
    }
    state = result.state;
  }

  if (options.requireWin && state.status !== 'won') {
    return { ok: false, reason: `Game did not end in a win (${state.status}).` };
  }
  if (state.elapsedMs > MAX_GAME_MS) {
    return { ok: false, reason: 'Reported duration is implausibly long.' };
  }
  if (!state.board) {
    return { ok: false, reason: 'Game never started.' };
  }

  let safeCellsRevealed = 0;
  let safeCellsTotal = 0;
  for (let i = 0; i < state.board.mine.length; i++) {
    if (state.board.mine[i] === 1) continue;
    safeCellsTotal++;
    if (state.revealed[i] === 1) safeCellsRevealed++;
  }

  return {
    ok: true,
    state,
    threeBV: computeThreeBV(state.board),
    elapsedMs: state.elapsedMs,
    safeCellsRevealed,
    safeCellsTotal,
  };
}
