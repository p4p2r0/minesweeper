import { cellIndex, forEachNeighbour, generateBoard, inBounds } from './board.js';
import type { Board, BoardConfig, GameState, Move, MoveResult, MoveRejection } from './types.js';

export function createGame(config: BoardConfig, seed: string): GameState {
  const cells = config.width * config.height;
  return {
    config,
    seed,
    board: null,
    status: 'idle',
    revealed: new Uint8Array(cells),
    flagged: new Uint8Array(cells),
    revealedCount: 0,
    flagCount: 0,
    explodedAt: -1,
    moves: [],
    elapsedMs: 0,
  };
}

/** Mines the player still has to account for; may go negative with over-flagging. */
export function minesRemaining(state: GameState): number {
  return state.config.mines - state.flagCount;
}

function reject(state: GameState, reason: MoveRejection): MoveResult {
  return { ok: false, state, reason };
}

/**
 * Uncovers `startIndex` and cascades through any zero-adjacency region.
 * Mutates the caller's (already copied) arrays.
 */
function floodReveal(
  board: Board,
  revealed: Uint8Array,
  flagged: Uint8Array,
  startIndex: number,
): { added: number; hitMine: boolean } {
  const { width, height, mine, adjacent } = board;
  const stack: number[] = [startIndex];
  let added = 0;
  let hitMine = false;

  while (stack.length > 0) {
    const index = stack.pop() as number;
    if (revealed[index] === 1 || flagged[index] === 1) continue;
    revealed[index] = 1;
    added++;

    if (mine[index] === 1) {
      hitMine = true;
      continue;
    }
    if (adjacent[index] !== 0) continue;

    const x = index % width;
    const y = (index - x) / width;
    forEachNeighbour(width, height, x, y, (_nx, _ny, n) => {
      if (revealed[n] === 0 && flagged[n] === 0) stack.push(n);
    });
  }

  return { added, hitMine };
}

/**
 * The single source of truth for Minesweeper rules.
 *
 * Both clients and the verifying server funnel every action through here, so a
 * game that a player saw as a win replays as a win on the server by
 * construction. A rejected move leaves the state untouched and is never
 * recorded in `moves`.
 */
export function applyMove(state: GameState, move: Move): MoveResult {
  const { config } = state;
  if (!inBounds(config, move.x, move.y)) return reject(state, 'out-of-bounds');
  if (state.status === 'won' || state.status === 'lost') return reject(state, 'game-over');
  if (move.t < state.elapsedMs) return reject(state, 'time-went-backwards');
  if (state.status === 'idle' && move.kind !== 'reveal') {
    return reject(state, 'first-move-must-reveal');
  }

  const index = cellIndex(config.width, move.x, move.y);

  if (move.kind === 'flag') {
    if (state.revealed[index] === 1) return reject(state, 'already-revealed');
    const flagged = new Uint8Array(state.flagged);
    const wasFlagged = flagged[index] === 1;
    flagged[index] = wasFlagged ? 0 : 1;
    return {
      ok: true,
      state: {
        ...state,
        flagged,
        flagCount: state.flagCount + (wasFlagged ? -1 : 1),
        moves: [...state.moves, move],
        elapsedMs: move.t,
      },
    };
  }

  // The board is generated around the very first reveal, never before it.
  const board = state.board ?? generateBoard(config, state.seed, { x: move.x, y: move.y });
  const revealed = new Uint8Array(state.revealed);
  const flagged = state.flagged;
  let added = 0;
  let hitMine = false;
  let explodedAt = state.explodedAt;

  if (move.kind === 'reveal') {
    if (flagged[index] === 1) return reject(state, 'cell-flagged');
    if (revealed[index] === 1) return reject(state, 'already-revealed');
    const result = floodReveal(board, revealed, flagged, index);
    added = result.added;
    hitMine = result.hitMine;
    if (hitMine) explodedAt = index;
  } else {
    // chord
    if (revealed[index] !== 1) return reject(state, 'not-a-number');
    const number = board.adjacent[index];
    if (number === 0) return reject(state, 'not-a-number');

    let flagsAround = 0;
    const targets: number[] = [];
    forEachNeighbour(config.width, config.height, move.x, move.y, (_nx, _ny, n) => {
      if (flagged[n] === 1) flagsAround++;
      else if (revealed[n] === 0) targets.push(n);
    });
    if (flagsAround !== number) return reject(state, 'flag-count-mismatch');
    if (targets.length === 0) return reject(state, 'nothing-to-reveal');

    for (const target of targets) {
      const result = floodReveal(board, revealed, flagged, target);
      added += result.added;
      if (result.hitMine && !hitMine) {
        hitMine = true;
        explodedAt = target;
      }
    }
  }

  const revealedCount = state.revealedCount + added;
  const safeCells = config.width * config.height - config.mines;
  const status = hitMine ? 'lost' : revealedCount === safeCells ? 'won' : 'playing';

  return {
    ok: true,
    state: {
      ...state,
      board,
      status,
      revealed,
      revealedCount,
      explodedAt,
      moves: [...state.moves, move],
      elapsedMs: move.t,
    },
  };
}
