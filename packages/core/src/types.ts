/**
 * Shared vocabulary for the whole project.
 *
 * Everything in this package is deterministic and free of platform APIs, so the
 * exact same code runs in the terminal client, in the browser and inside the
 * Cloudflare Worker that verifies submitted games.
 */

/** Ranked difficulties. `custom` games are playable but never scored. */
export type PresetId = 'beginner' | 'intermediate' | 'expert';

export type DifficultyId = PresetId | 'custom';

export interface BoardConfig {
  width: number;
  height: number;
  mines: number;
}

export interface Preset extends BoardConfig {
  id: PresetId;
  label: string;
}

export interface Point {
  x: number;
  y: number;
}

/**
 * A single player action.
 *
 * - `reveal` uncovers a cell (and cascades through zero-adjacency cells).
 * - `flag` toggles a marker on a covered cell.
 * - `chord` reveals every un-flagged neighbour of an already revealed number
 *   whose flag count matches that number.
 *
 * `t` is milliseconds since the first reveal, so the first move always has
 * `t === 0`. The server never trusts `t` on its own — see `rules.ts`.
 */
export interface Move {
  t: number;
  kind: 'reveal' | 'flag' | 'chord';
  x: number;
  y: number;
}

export type GameStatus = 'idle' | 'playing' | 'won' | 'lost';

/** A generated minefield. Immutable once created. */
export interface Board {
  readonly width: number;
  readonly height: number;
  readonly mines: number;
  /** 1 when the cell holds a mine. Length `width * height`. */
  readonly mine: Uint8Array;
  /** Number of neighbouring mines, 0-8. Meaningless on mined cells. */
  readonly adjacent: Uint8Array;
}

/**
 * Full game state. Treated as immutable: `applyMove` returns a new object
 * rather than mutating, which keeps React rendering honest on both clients.
 *
 * `board` is null until the first reveal, because the minefield is generated
 * *around* that first click (first-click-safe).
 */
export interface GameState {
  readonly config: BoardConfig;
  readonly seed: string;
  readonly board: Board | null;
  readonly status: GameStatus;
  /** 1 when uncovered. Length `width * height`. */
  readonly revealed: Uint8Array;
  /** 1 when flagged. Length `width * height`. */
  readonly flagged: Uint8Array;
  readonly revealedCount: number;
  readonly flagCount: number;
  /** Index of the mine that ended the game, or -1. */
  readonly explodedAt: number;
  /** Every accepted move, in order. This is what gets submitted for scoring. */
  readonly moves: readonly Move[];
  /** `t` of the last accepted move; 0 before the game starts. */
  readonly elapsedMs: number;
}

/** Why a move was rejected. Clients use this to no-op silently. */
export type MoveRejection =
  | 'out-of-bounds'
  | 'game-over'
  | 'not-started'
  | 'already-revealed'
  | 'cell-flagged'
  | 'not-a-number'
  | 'flag-count-mismatch'
  | 'nothing-to-reveal'
  | 'time-went-backwards'
  | 'first-move-must-reveal';

export interface MoveResult {
  ok: boolean;
  state: GameState;
  reason?: MoveRejection;
}
