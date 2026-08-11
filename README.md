# minesweeper

Minesweeper for the browser, with an online leaderboard that verifies every
score it publishes.

**[Play it](https://minesweeper-6y8.pages.dev)**

## Why

Wanted a Minesweeper leaderboard where a fast time is actually true, not just
whatever the client claims — and an excuse to build a server-authoritative
replay system that verifies that trustlessly, without adding a network round
trip to every click.

## How it works

1. The engine (`packages/core`) is deterministic and platform-free: no DOM, no
   Node APIs, no floating point in the board generator. The same code runs in
   the browser, in Node, and inside a Cloudflare Worker, and produces
   identical boards from the same seed everywhere.
2. A game is dealt with a secret seed the server generates and keeps; the
   client only receives `sha256(seed)`, so it can show a covered board without
   knowing where a single mine is yet.
3. On the first click the server reveals the real seed and timestamps the
   moment. The client checks the seed against the earlier commitment, so the
   board can't be swapped once it knows what was clicked.
4. Every move after that is instant and fully offline, because the board is
   just a deterministic function of `seed + opening click` — no further
   network round trips.
5. On submit, the client sends nothing but the move log: the buttons that were
   pressed, in order. The server replays that log through the exact same
   engine, from its own stored seed, and decides for itself whether it was a
   win.
6. A run only becomes a score once its replay matches the committed opening
   move, ends in a win, and its reported time is consistent with both a
   3BV-derived floor and the server's own measured wall-clock window.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full breakdown, including how
identity works without passwords.

## What's here

This repository publishes the engine only — `packages/core`, the piece with
every rule in it, shared by the web client and the leaderboard API. The web
client (React + Vite, on Cloudflare Pages) and the API (Cloudflare Worker +
D1) that make up the live site are closed-source.

```bash
cd packages/core
npm install
npm test
```

## License

This project is licensed under the [MIT License](LICENSE).
