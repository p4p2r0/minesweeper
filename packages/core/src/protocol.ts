/**
 * Wire contract between the clients and the leaderboard API.
 *
 * Both the TUI and the web app import these types, so a change to the Worker's
 * responses breaks the build rather than production.
 */
import { MAX_MOVES } from './rules.js';
import type { BoardConfig, DifficultyId, Move, PresetId } from './types.js';

export type LeaderboardWindow = 'daily' | 'weekly' | 'all';

export const LEADERBOARD_WINDOWS: readonly LeaderboardWindow[] = ['daily', 'weekly', 'all'];

export function isLeaderboardWindow(value: string): value is LeaderboardWindow {
  return value === 'daily' || value === 'weekly' || value === 'all';
}

/**
 * How a board is ordered. `wins` counts cleared games, which rewards playing;
 * `time` is the single fastest run, which rewards one perfect game.
 */
export type LeaderboardSort = 'wins' | 'time';

export const LEADERBOARD_SORTS: readonly LeaderboardSort[] = ['wins', 'time'];

export function isLeaderboardSort(value: string): value is LeaderboardSort {
  return value === 'wins' || value === 'time';
}

export interface PlayerProfile {
  id: string;
  username: string;
  createdAt: number;
  /** Refreshed on sign-in, and on starting or finishing a game — not on every read. */
  lastSeenAt: number;
  /** The IP the player was last seen from. Shown only to that player, on their own Account screen. */
  lastSeenIp: string | null;
  gamesWon: number;
  gamesPlayed: number;
  /** Consecutive UTC days with at least one ranked win. */
  currentStreak: number;
  longestStreak: number;
  /** Lifetime XP. `level`/`xpIntoLevel`/`xpForNext` are derived from it — see `levelFromXp`. */
  totalXp: number;
  level: number;
  xpIntoLevel: number;
  xpForNext: number;
}

export interface RegisterRequest {
  username: string;
}

/**
 * The token is shown to the player exactly once. It is their entire identity —
 * a passwordless login key they can carry to another device.
 */
export interface RegisterResponse {
  token: string;
  player: PlayerProfile;
}

export interface RenameRequest {
  username: string;
}

export interface CreateGameRequest {
  difficulty: DifficultyId;
  /** Required when `difficulty` is `custom`. */
  custom?: BoardConfig;
}

export interface CreateGameResponse {
  gameId: string;
  difficulty: DifficultyId;
  config: BoardConfig;
  /**
   * SHA-256 of the secret seed. Handed over before the player touches the
   * board, so once the seed is released they can prove it was not swapped for
   * an easier or harder layout mid-game.
   */
  commitment: string;
  /** Whether a win on this board can reach the leaderboard at all. */
  ranked: boolean;
}

export interface StartGameRequest {
  x: number;
  y: number;
}

/**
 * Released only after the opening click, which is also when the server starts
 * its own clock. From here the client plays entirely offline.
 */
export interface StartGameResponse {
  seed: string;
}

export interface SubmitGameRequest {
  moves: Move[];
}

export interface SubmitGameResponse {
  accepted: boolean;
  /** Whether the submitted move log ended in a win — losses are submitted too, for progress XP. */
  won: boolean;
  ranked: boolean;
  elapsedMs: number;
  threeBV: number;
  /** Position on the all-time board for this difficulty, if it made the cut. Never set on a loss. */
  rank: number | null;
  personalBest: boolean;
  /** Present on a ranked win: the streak after crediting today. */
  currentStreak?: number;
  /** False when today's win only re-confirmed a streak already credited today. */
  streakExtended?: boolean;
  /** Present whenever XP was awarded: a ranked win, or a ranked loss with some progress. */
  xpGained?: number;
  totalXp?: number;
  level?: number;
  leveledUp?: boolean;
}

export interface LeaderboardEntry {
  rank: number;
  playerId: string;
  username: string;
  /** Games cleared on this board within the window. */
  wins: number;
  /** Their fastest run within the window. */
  elapsedMs: number;
  threeBV: number;
  achievedAt: number;
  isYou: boolean;
}

/**
 * Ranks by lifetime level/XP instead of a single difficulty — the one board
 * that isn't "best run on this layout," so it stands apart from the
 * per-difficulty ones rather than being another `LeaderboardWindow`/`sort`
 * combination on top of them.
 */
export interface LevelLeaderboardEntry {
  rank: number;
  playerId: string;
  username: string;
  level: number;
  totalXp: number;
  isYou: boolean;
}

export interface LevelLeaderboardResponse {
  entries: LevelLeaderboardEntry[];
  you: LevelLeaderboardEntry | null;
}

export interface LeaderboardResponse {
  difficulty: PresetId;
  window: LeaderboardWindow;
  sort: LeaderboardSort;
  entries: LeaderboardEntry[];
  /** The requesting player's own standing, even if outside the top N. */
  you: LeaderboardEntry | null;
}

export interface ApiErrorBody {
  error: string;
  message: string;
}

/**
 * Strict decoder for an untrusted move log.
 *
 * The Worker runs this before any replay work, so malformed input costs a
 * bounded amount of CPU.
 */
export function decodeMoves(value: unknown): Move[] | null {
  if (!Array.isArray(value)) return null;
  if (value.length === 0 || value.length > MAX_MOVES) return null;

  const moves: Move[] = [];
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null) return null;
    const { t, kind, x, y } = raw as Record<string, unknown>;
    if (kind !== 'reveal' && kind !== 'flag' && kind !== 'chord') return null;
    if (!Number.isInteger(t) || !Number.isInteger(x) || !Number.isInteger(y)) return null;
    if ((t as number) < 0 || (x as number) < 0 || (y as number) < 0) return null;
    moves.push({ t: t as number, kind, x: x as number, y: y as number });
  }
  return moves;
}

export function decodeBoardConfig(value: unknown): BoardConfig | null {
  if (typeof value !== 'object' || value === null) return null;
  const { width, height, mines } = value as Record<string, unknown>;
  if (!Number.isInteger(width) || !Number.isInteger(height) || !Number.isInteger(mines)) {
    return null;
  }
  return { width: width as number, height: height as number, mines: mines as number };
}
