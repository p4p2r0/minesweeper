# Minesweeper

A modern Minesweeper game.

**[Play it](https://minesweeper-6y8.pages.dev)**

> The site runs on a shared `*.pages.dev` subdomain, which some ISPs block
> outright, independent of the content behind it. If it doesn't load, a VPN
> (e.g. Cloudflare WARP) should get you through — this will no longer be
> necessary once the project moves to its own domain.

## How to play

Uncover every square that isn't a mine; click a mine and it's game over. A
revealed number tells you exactly how many mines are touching it.

- Flag mode is on by default: tap a covered square to flag it, long-press
  (or right-click on a laptop) to reveal it instead. A stray tap only costs an
  undo-able flag rather than risking a mine.
- Prefer the classic scheme? Switch it off from the flag icon above the
  board — tap to reveal, long-press/right-click to flag. Your choice is
  remembered.
- Tap a revealed number once its flagged neighbours already match it (a
  "chord") to open the rest of its neighbours at once — the fast way to clear
  a board.
- An in-app "How to Play" walkthrough teaches all of this on a real,
  practice-only board that's never scored.

## What's here

```
packages/core   the engine — board generation, rules, replay verification,
                session state machine, API client. Deterministic and
                platform-free: no DOM, no Node APIs, no floating point in
                board generation, so the same code produces identical boards
                everywhere it runs.
apps/web        the browser client (React + TypeScript + Vite), deployed to
                Cloudflare Pages
apps/api        the leaderboard server (Cloudflare Worker + D1)
```

The engine is deliberately the biggest piece and the only one with rules in
it. The client and the server both import the same `applyMove` — which is
what makes score verification possible: a game the client saw as a win
replays as a win on the server by construction, not by trusting the client's
word for it.

## Score verification

The hard problem with a leaderboard for a game that has to feel instant: the
client must know where the mines are to render the board, and anything the
client knows, a modified client can fake. Verifying every move server-side
solves that but would put a network round trip in front of every click. This
is the compromise, and it costs exactly one round trip per game:

1. **Deal.** The server generates a secret seed, stores it, and sends back
   only `sha256(seed)` — a commitment. The client shows a covered board. It
   knows nothing about where the mines are, because nothing has decided that
   yet.
2. **Open.** The player clicks their first cell. The client sends those
   coordinates and gets the seed back. The server timestamps this moment with
   its own clock. The client checks the seed against the commitment, so the
   server can't swap in an easier or harder board once it knows where you
   clicked.
3. **Play.** The board is generated locally from `seed + opening click`,
   mines guaranteed clear around that click. Every move after this is instant
   and entirely offline — no network, no latency, no further round trips.
4. **Submit.** On a finished game, the client sends the move log — a list of
   `{t, kind, x, y}`. Not a time, not a result, just the buttons that were
   pressed, in order. The server regenerates the board from its own stored
   seed, replays the moves through the exact same engine, and decides for
   itself whether that was a win.

A submitted run has to clear four checks before it becomes a score:

| Check | Catches |
| --- | --- |
| Opening move matches the committed click | Replaying a different board than the one dealt |
| Replay ends in a win | Fabricated results |
| Reported time ≥ a 3BV-derived floor | Solver-generated "wins" with implausible timings |
| Reported time within tolerance of the server's own measured window | Claiming you were faster than you were |

That last check is where the honest limit lives: the server knows the game
took *at most* `submit_received - start_received`, and a client's reported
duration should fall just short of that by roughly one round trip. The
allowance for that gap (`NETWORK_TOLERANCE_MS`, 8s) is also the largest
amount of time a determined cheat could shave off. Closing that gap entirely
would mean verifying each move as it happens, and that trade — a network
round trip per click — is the one thing this design refuses to make.

Losses are scored too, for partial XP based on cells safely opened before
hitting a mine — playing well is worth something even without clearing the
board. Custom-size boards are playable but never ranked, so the leaderboard
stays comparable across entries.

## Identity

There are no passwords. Registering returns a **key** — a random token that
*is* the account. Store it, paste it into another device, and you're the same
player there. The server only ever stores its SHA-256 digest, so a leaked
database can't impersonate anyone. The web client keeps the key in
`localStorage` and sends it only in an `Authorization` header — never in a
URL or a cookie.

## Features

- **Offline-first play.** If the server is unreachable when a board is dealt,
  the client falls back to a locally-seeded, unranked game automatically —
  the same rules engine, just not submitted anywhere. A win that fails to
  submit is retried automatically (with backoff) and on the browser's `online`
  event, with a sticky "still trying" notification and a manual retry button
  so nothing is silently lost.
- **Four themes** — Light, Dark (pure black/white), Blue, and Red — each
  built from the same set of CSS custom properties, checked for WCAG contrast,
  switchable from Account settings, and persisted across sessions.
- **Flag mode**, on by default (see "How to play" above), with a matching,
  live-updating walkthrough in the tutorial.
- **Leaderboards** with both a time-based ranking and a level/XP-based one,
  tie-broken deterministically.
- **Performance mode** (Auto/Low) for animation-heavy interactions on
  lower-powered devices, plus a `prefers-reduced-motion` fallback.
- **English and Turkish** localization, kept in sync (same key set in both).
- **Pinch-to-zoom and pan** on the board for touch devices, implemented by
  hand rather than left to the browser — a native pinch zooms the whole page,
  not just the board, and some mobile browsers render large `box-shadow`
  grids solid black mid-gesture during a viewport-level zoom.
- **An in-app admin panel** (closed to normal players) for moderating the
  leaderboard and player accounts.

## License

This project is licensed under the [MIT License](LICENSE).
