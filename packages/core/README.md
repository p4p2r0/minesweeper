# @p4p2r0/minesweeper-core

The Minesweeper engine behind the terminal and web clients — and behind the
server that verifies their scores.

Deterministic and platform-free: no DOM, no Node APIs, no floating point in the
board generator. The same code runs in Node, in a browser and in a Cloudflare
Worker, and produces identical boards in all three.

```ts
import { applyMove, createGame, replayGame, PRESETS } from '@p4p2r0/minesweeper-core';

let state = createGame(PRESETS.beginner, 'some-seed');
state = applyMove(state, { t: 0, kind: 'reveal', x: 4, y: 4 }).state;

// Later, on the server, from the same seed and the recorded move log:
const verdict = replayGame(PRESETS.beginner, 'some-seed', state.moves, { requireWin: true });
```

What lives here:

- `board.ts` — first-click-safe generation, 3BV
- `game.ts` — `applyMove`, the single source of truth for the rules
- `replay.ts` — server-side verification of a submitted move log
- `session.ts` — the deal → open → play → submit protocol, framework-free
- `client.ts` — typed HTTP client for the leaderboard API
- `rng.ts` — xoshiro128\*\*, integer-only so every runtime agrees
