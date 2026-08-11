import { rngFromSeed } from './rng.js';
import type { Board, BoardConfig, Point } from './types.js';

export function cellIndex(width: number, x: number, y: number): number {
  return y * width + x;
}

export function inBounds(config: BoardConfig, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < config.width && y < config.height;
}

/**
 * Calls `visit` for each of the up-to-eight neighbours of `(x, y)`.
 * Kept as a callback rather than an array to avoid allocating in flood fills.
 */
export function forEachNeighbour(
  width: number,
  height: number,
  x: number,
  y: number,
  visit: (nx: number, ny: number, index: number) => void,
): void {
  const minY = y > 0 ? y - 1 : 0;
  const maxY = y < height - 1 ? y + 1 : height - 1;
  const minX = x > 0 ? x - 1 : 0;
  const maxX = x < width - 1 ? x + 1 : width - 1;
  for (let ny = minY; ny <= maxY; ny++) {
    for (let nx = minX; nx <= maxX; nx++) {
      if (nx === x && ny === y) continue;
      visit(nx, ny, ny * width + nx);
    }
  }
}

/**
 * The cells that must stay mine-free so the first click always opens something.
 * Returns the 3x3 block around the click, or just the click itself when the
 * board is too dense to spare nine cells.
 */
function safeZone(config: BoardConfig, safe: Point): number[] {
  const { width, height, mines } = config;
  const block: number[] = [cellIndex(width, safe.x, safe.y)];
  forEachNeighbour(width, height, safe.x, safe.y, (_nx, _ny, index) => {
    block.push(index);
  });
  const cells = width * height;
  return mines <= cells - block.length ? block : [cellIndex(width, safe.x, safe.y)];
}

/**
 * Generates the minefield for `seed`, guaranteeing that `safe` (and, where the
 * mine count allows, its neighbours) are clear.
 *
 * The first-click coordinates are folded into the RNG seed, so a given seed
 * still produces a *fixed* board once the player commits to an opening move —
 * which is exactly what the server replays against.
 */
export function generateBoard(config: BoardConfig, seed: string, safe: Point): Board {
  const { width, height, mines } = config;
  const cells = width * height;
  const mine = new Uint8Array(cells);
  const adjacent = new Uint8Array(cells);

  const blocked = new Set(safeZone(config, safe));
  const candidates: number[] = [];
  for (let i = 0; i < cells; i++) {
    if (!blocked.has(i)) candidates.push(i);
  }
  if (mines > candidates.length) {
    throw new RangeError(`cannot place ${mines} mines in ${candidates.length} eligible cells`);
  }

  // Partial Fisher-Yates: only the first `mines` slots need to be settled.
  const rng = rngFromSeed(seed, safe.x, safe.y);
  for (let i = 0; i < mines; i++) {
    const j = i + rng.nextInt(candidates.length - i);
    const picked = candidates[j];
    candidates[j] = candidates[i];
    candidates[i] = picked;
    mine[picked] = 1;
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      if (mine[index] === 1) continue;
      let count = 0;
      forEachNeighbour(width, height, x, y, (_nx, _ny, n) => {
        count += mine[n];
      });
      adjacent[index] = count;
    }
  }

  return { width, height, mines, mine, adjacent };
}

/**
 * 3BV — the minimum number of left clicks needed to clear the board.
 *
 * It is the standard difficulty measure for a specific layout, and the server
 * uses it to reject times no human could produce on that board.
 */
export function computeThreeBV(board: Board): number {
  const { width, height, mine, adjacent } = board;
  const cells = width * height;
  const covered = new Uint8Array(cells);
  const seen = new Uint8Array(cells);
  let openings = 0;

  const stack: number[] = [];
  for (let start = 0; start < cells; start++) {
    if (mine[start] === 1 || adjacent[start] !== 0 || seen[start] === 1) continue;
    openings++;
    seen[start] = 1;
    covered[start] = 1;
    stack.push(start);
    while (stack.length > 0) {
      const index = stack.pop() as number;
      const x = index % width;
      const y = (index - x) / width;
      forEachNeighbour(width, height, x, y, (_nx, _ny, n) => {
        if (mine[n] === 1) return;
        covered[n] = 1;
        if (adjacent[n] === 0 && seen[n] === 0) {
          seen[n] = 1;
          stack.push(n);
        }
      });
    }
  }

  let isolated = 0;
  for (let i = 0; i < cells; i++) {
    if (mine[i] === 0 && adjacent[i] > 0 && covered[i] === 0) isolated++;
  }
  return openings + isolated;
}
