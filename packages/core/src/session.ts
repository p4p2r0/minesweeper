/**
 * Drives one game from "deal me a board" through to "here is my verified time".
 *
 * Both clients use this, so the protocol dance — commit, open, play offline,
 * submit — exists once rather than twice. It is deliberately framework-free:
 * subscribe to changes and read `getSnapshot()`.
 */
import type { MinesweeperClient } from './client.js';
import { ApiError } from './client.js';
import { applyMove, createGame } from './game.js';
import { toHex, verifyCommitment } from './hash.js';
import { classifyConfig, configFor } from './presets.js';
import type { CreateGameResponse, SubmitGameResponse } from './protocol.js';
import type { BoardConfig, DifficultyId, GameState, Move } from './types.js';

export type SessionPhase =
  /** No board yet. */
  | 'idle'
  /** Asking the server for a board. */
  | 'dealing'
  /** Board on screen, waiting for the opening click. */
  | 'ready'
  /** Opening click sent; waiting for the seed. */
  | 'opening'
  | 'playing'
  /** Game over locally; a win may still be in flight to the server. */
  | 'finished'
  | 'submitting';

export interface SessionSnapshot {
  phase: SessionPhase;
  game: GameState;
  difficulty: DifficultyId;
  /** True when a win here can reach the leaderboard. */
  ranked: boolean;
  /** No server involved: plays fine, never scores. */
  offline: boolean;
  /** Epoch milliseconds of the opening click, or null before it. */
  startedAt: number | null;
  /** Server's verdict once a win has been submitted. */
  result: SubmitGameResponse | null;
  /** Human-readable problem, if anything went wrong. */
  error: string | null;
  /**
   * A win that could not reach the server after automatic retries.
   * Nothing has been lost — call `retrySubmission()` once the connection is
   * back, or let the session do it for you on the browser's `online` event.
   */
  pendingSubmission: boolean;
}

export interface GameSessionOptions {
  /** Omit (or pass null) to play entirely offline. */
  client?: MinesweeperClient | null;
  now?: () => number;
}

function randomSeed(): string {
  return toHex(globalThis.crypto.getRandomValues(new Uint8Array(32)));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Backoff between automatic retries after a network failure, not a rejection. */
const RETRY_DELAYS_MS = [1500, 4000, 9000];

/**
 * A client without a key can still read leaderboards, but it has no identity to
 * attach a score to — so as far as a *game* is concerned, it is offline.
 */
function canRank(client: MinesweeperClient | null): boolean {
  return client !== null && client.hasToken;
}

export class GameSession {
  private readonly listeners = new Set<() => void>();
  private readonly now: () => number;
  private client: MinesweeperClient | null;

  private snapshot: SessionSnapshot;
  private gameId: string | null = null;
  private commitment: string | null = null;
  private custom: BoardConfig | undefined;
  /** Clicks made while the server was still being talked to. */
  private queued: Array<{ kind: Move['kind']; x: number; y: number }> = [];
  /** Bumped per deal, so a stale response cannot replace a newer board. */
  private generation = 0;
  /** The win currently being (re)submitted, kept so a retry has something to send. */
  private pendingGame: GameState | null = null;

  constructor(options: GameSessionOptions = {}) {
    this.client = options.client ?? null;
    this.now = options.now ?? Date.now;
    const config = configFor('beginner');
    this.snapshot = {
      phase: 'idle',
      game: createGame(config, ''),
      difficulty: 'beginner',
      ranked: false,
      offline: !canRank(this.client),
      startedAt: null,
      result: null,
      error: null,
      pendingSubmission: false,
    };
  }

  /** Arrow property so React's `useSyncExternalStore` sees a stable reference. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): SessionSnapshot => this.snapshot;

  /**
   * Swaps the client, typically because the player just signed in or out.
   *
   * Crucially this does *not* touch the current game's `offline` flag. A board
   * belongs to whoever dealt it: one handed out while signed out has no server
   * game behind it, so a win on it can never be submitted no matter what key
   * arrives afterwards. Claiming otherwise used to lose the win silently —
   * `submit` bailed for want of a game id, and the offline notice had already
   * been switched off.
   *
   * If nothing has happened on the board yet, re-deal so signing in takes
   * effect immediately.
   */
  setClient(client: MinesweeperClient | null): void {
    const rankableBefore = canRank(this.client);
    this.client = client;
    if (canRank(client) === rankableBefore) return;
    if (this.snapshot.phase === 'ready') {
      void this.newGame(this.snapshot.difficulty, this.custom);
    }
  }

  private patch(changes: Partial<SessionSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...changes };
    for (const listener of this.listeners) listener();
  }

  /** Deals a fresh board. Any game still in progress is abandoned. */
  async newGame(difficulty: DifficultyId, custom?: BoardConfig): Promise<void> {
    // Switching difficulty twice in quick succession leaves two deals in
    // flight; without this the slower one lands last and silently replaces the
    // board the player actually asked for.
    const generation = ++this.generation;
    const current = (): boolean => this.generation === generation;

    this.custom = custom;
    const localConfig = configFor(difficulty, custom);
    this.gameId = null;
    this.commitment = null;
    this.queued = [];
    this.patch({
      phase: 'dealing',
      game: createGame(localConfig, ''),
      difficulty,
      ranked: false,
      startedAt: null,
      result: null,
      error: null,
      pendingSubmission: false,
    });

    const client = this.client;
    if (!canRank(client) || !client) {
      // Offline play: the board is ours, and so is the seed.
      this.patch({
        phase: 'ready',
        game: createGame(localConfig, randomSeed()),
        offline: true,
        ranked: false,
      });
      this.drainQueued();
      return;
    }

    try {
      const deal: CreateGameResponse = await client.createGame(difficulty, custom);
      if (!current()) return;
      this.gameId = deal.gameId;
      this.commitment = deal.commitment;
      this.patch({
        phase: 'ready',
        game: createGame(deal.config, ''),
        difficulty: deal.difficulty,
        ranked: deal.ranked,
        offline: false,
      });
      this.drainQueued();
    } catch (error) {
      if (!current()) return;
      // A dead server should never mean a dead game.
      this.patch({
        phase: 'ready',
        game: createGame(localConfig, randomSeed()),
        difficulty: classifyConfig(localConfig),
        ranked: false,
        offline: true,
        error: `${describe(error)} Playing offline — this game will not be ranked.`,
      });
      this.drainQueued();
    }
  }

  async reveal(x: number, y: number): Promise<void> {
    const { phase } = this.snapshot;
    if (phase === 'ready') return this.openBoard(x, y);
    if (phase === 'dealing' || phase === 'opening') return this.enqueue('reveal', x, y);
    if (phase !== 'playing') return;
    this.play({ t: this.elapsed(), kind: 'reveal', x, y });
  }

  /**
   * Returns whether the flag actually toggled — false for, say, a cell
   * that's already open. The caller uses this to skip the flag sound/haptic
   * for an attempt that didn't do anything, rather than playing them for
   * every tap regardless of whether it was legal.
   */
  flag(x: number, y: number): boolean {
    const { phase } = this.snapshot;
    if (phase === 'dealing' || phase === 'opening') {
      this.enqueue('flag', x, y);
      return false;
    }
    if (phase !== 'playing') return false;
    return this.play({ t: this.elapsed(), kind: 'flag', x, y });
  }

  chord(x: number, y: number): void {
    const { phase } = this.snapshot;
    if (phase === 'dealing' || phase === 'opening') return this.enqueue('chord', x, y);
    if (phase !== 'playing') return;
    this.play({ t: this.elapsed(), kind: 'chord', x, y });
  }

  /**
   * Holds on to clicks made while the server is still being talked to.
   *
   * Dealing a board and opening it are the only pauses in a game, and on a cold
   * worker either can take a second or two. Dropping input during them is what
   * makes the whole app feel dead — you click, and nothing happens.
   */
  private enqueue(kind: Move['kind'], x: number, y: number): void {
    if (this.queued.length >= 16) return;
    this.queued.push({ kind, x, y });
  }

  private drainQueued(): void {
    const queued = this.queued;
    this.queued = [];

    for (let i = 0; i < queued.length; i++) {
      const move = queued[i];
      const phase = this.snapshot.phase;

      // A reveal on a freshly dealt board is the opening move, which has to go
      // through the server. Park the rest; `openBoard` drains them afterwards.
      if (phase === 'ready' && move.kind === 'reveal') {
        this.queued = queued.slice(i + 1);
        void this.openBoard(move.x, move.y);
        return;
      }
      if (phase !== 'playing') break;
      this.play({ t: this.elapsed(), ...move });
    }
  }

  private elapsed(): number {
    const { startedAt } = this.snapshot;
    return startedAt === null ? 0 : Math.max(0, this.now() - startedAt);
  }

  /**
   * The opening click — the one moment we talk to the server mid-game.
   *
   * We hand over the coordinates, get the seed back, and check it against the
   * commitment we were given before any of this started. From here on the
   * game is entirely local and instant.
   */
  private async openBoard(x: number, y: number): Promise<void> {
    const { game, offline } = this.snapshot;
    const client = this.client;
    const gameId = this.gameId;

    if (offline || !client || !gameId) {
      const startedAt = this.now();
      this.patch({ phase: 'playing', startedAt });
      this.play({ t: 0, kind: 'reveal', x, y }, game);
      this.drainQueued();
      return;
    }

    this.patch({ phase: 'opening' });
    try {
      const { seed } = await client.startGame(gameId, x, y);
      if (this.commitment && !(await verifyCommitment(seed, this.commitment))) {
        this.patch({
          phase: 'ready',
          error: 'The server sent a board that does not match its commitment. Refusing to play it.',
        });
        return;
      }
      // Nothing has happened on the board yet, so swapping in the real seed
      // here loses no state.
      const seeded = createGame(game.config, seed);
      const startedAt = this.now();
      this.patch({ phase: 'playing', startedAt, error: null });
      this.play({ t: 0, kind: 'reveal', x, y }, seeded);
      this.drainQueued();
    } catch (error) {
      this.queued = [];
      this.patch({ phase: 'ready', error: describe(error) });
    }
  }

  private play(move: Move, base?: GameState): boolean {
    const result = applyMove(base ?? this.snapshot.game, move);
    if (!result.ok) return false;

    const game = result.state;
    if (game.status === 'won' || game.status === 'lost') {
      this.patch({ game, phase: 'finished' });
      // A loss is submitted too, not just a win — the server credits small
      // progress XP for cells safely opened before hitting a mine, so
      // playing well is worth something even when the board isn't cleared.
      void this.submit(game);
      return true;
    }
    this.patch({ game });
    return true;
  }

  /**
   * Submits the finished game (won or lost), retrying automatically through a
   * flaky connection.
   *
   * A timeout or a dropped connection says nothing about whether the game was
   * actually accepted — only a real server response does — so the only safe
   * thing to do with "the request never came back" is try again. A `422` is a
   * different story: the server looked at the moves and refused them, and
   * repeating the exact same request will not change its mind.
   */
  private async submit(game: GameState, attempt = 0): Promise<void> {
    const client = this.client;
    const gameId = this.gameId;
    if (!client || !gameId || this.snapshot.offline) return;

    this.patch({ phase: 'submitting', pendingSubmission: false });
    this.pendingGame = game;

    try {
      const result = await client.submitGame(gameId, game.moves);
      this.pendingGame = null;
      this.patch({ phase: 'finished', result, error: null, pendingSubmission: false });
    } catch (error) {
      const networkFailure = error instanceof ApiError && error.status === 0;

      if (networkFailure && attempt < RETRY_DELAYS_MS.length) {
        await sleep(RETRY_DELAYS_MS[attempt]);
        // The player could have started a new board while this was waiting.
        if (this.pendingGame !== game) return;
        return this.submit(game, attempt + 1);
      }

      const message =
        error instanceof ApiError && error.isRejection
          ? `The server would not accept this run: ${error.message}`
          : networkFailure
            ? 'Could not reach the server to save this game. It will be retried automatically.'
            : describe(error);

      this.patch({ phase: 'finished', error: message, pendingSubmission: networkFailure });
    }
  }

  /**
   * Retries a submission that ran out of automatic attempts.
   *
   * Safe to call speculatively — e.g. from the browser's `online` event — since
   * it is a no-op unless a submission is actually stuck.
   */
  retrySubmission(): void {
    if (!this.snapshot.pendingSubmission || !this.pendingGame) return;
    void this.submit(this.pendingGame);
  }

  /** Re-deals at the same difficulty. */
  replay(): Promise<void> {
    return this.newGame(this.snapshot.difficulty, this.custom);
  }
}

function describe(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Something went wrong.';
}
