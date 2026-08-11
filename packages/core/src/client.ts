/**
 * HTTP client for the leaderboard API, shared by the terminal and web clients.
 *
 * `fetch` is global in every runtime we target, so this is the same code in
 * both places rather than two drifting copies.
 */
import type {
  ApiErrorBody,
  CreateGameResponse,
  LeaderboardResponse,
  LeaderboardSort,
  LeaderboardWindow,
  LevelLeaderboardResponse,
  PlayerProfile,
  RegisterResponse,
  StartGameResponse,
  SubmitGameResponse,
} from './protocol.js';
import type { BoardConfig, DifficultyId, Move, PresetId } from './types.js';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** True when the server rejected a submitted game as unverifiable. */
  get isRejection(): boolean {
    return this.code === 'rejected';
  }
}

export interface ClientOptions {
  baseUrl: string;
  token?: string | null;
  /** Request timeout in milliseconds. */
  timeoutMs?: number;
}

export class MinesweeperClient {
  private baseUrl: string;
  private token: string | null;
  private readonly timeoutMs: number;

  constructor(options: ClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.token = options.token ?? null;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  setToken(token: string | null): void {
    this.token = token;
  }

  get hasToken(): boolean {
    return this.token !== null && this.token.length > 0;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      const reason = error instanceof Error && error.name === 'AbortError' ? 'timed out' : 'failed';
      throw new ApiError(0, 'network', `Request ${reason}. Check your connection.`);
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text();
    const payload: unknown = text.length > 0 ? safeParse(text) : null;

    if (!response.ok) {
      const problem = payload as ApiErrorBody | null;
      throw new ApiError(
        response.status,
        problem?.error ?? 'http_error',
        problem?.message ?? `Request failed with status ${response.status}.`,
      );
    }
    return payload as T;
  }

  register(username: string): Promise<RegisterResponse> {
    return this.request<RegisterResponse>('POST', '/v1/players', { username });
  }

  me(): Promise<PlayerProfile> {
    return this.request<PlayerProfile>('GET', '/v1/me');
  }

  rename(username: string): Promise<PlayerProfile> {
    return this.request<PlayerProfile>('PATCH', '/v1/me', { username });
  }

  createGame(difficulty: DifficultyId, custom?: BoardConfig): Promise<CreateGameResponse> {
    return this.request<CreateGameResponse>('POST', '/v1/games', { difficulty, custom });
  }

  /** Commits the opening click and, in exchange, receives the board's seed. */
  startGame(gameId: string, x: number, y: number): Promise<StartGameResponse> {
    return this.request<StartGameResponse>('POST', `/v1/games/${gameId}/start`, { x, y });
  }

  submitGame(gameId: string, moves: readonly Move[]): Promise<SubmitGameResponse> {
    return this.request<SubmitGameResponse>('POST', `/v1/games/${gameId}/submit`, { moves });
  }

  leaderboard(
    difficulty: PresetId,
    window: LeaderboardWindow,
    options: { sort?: LeaderboardSort; limit?: number } = {},
  ): Promise<LeaderboardResponse> {
    const params = new URLSearchParams({ difficulty, window });
    if (options.sort) params.set('sort', options.sort);
    if (options.limit !== undefined) params.set('limit', String(options.limit));
    return this.request<LeaderboardResponse>('GET', `/v1/leaderboard?${params.toString()}`);
  }

  /** All-time ranking by level/XP, independent of any one difficulty. */
  levelLeaderboard(options: { limit?: number } = {}): Promise<LevelLeaderboardResponse> {
    const params = new URLSearchParams();
    if (options.limit !== undefined) params.set('limit', String(options.limit));
    const qs = params.toString();
    return this.request<LevelLeaderboardResponse>(
      'GET',
      `/v1/leaderboard/levels${qs ? `?${qs}` : ''}`,
    );
  }
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
