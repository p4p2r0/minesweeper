# Architecture

This describes the full system behind the live site. This repository publishes
only the engine (`packages/core`) — the web client and the leaderboard API are
part of the private, closed-source product, but the design only makes sense
described together.

```
packages/core   the engine: board generation, rules, replay verification, session, API client
apps/web        the browser client (Vite + React, deploys to Cloudflare Pages)
apps/api        the leaderboard (Cloudflare Worker + D1)
```

The engine is deliberately the biggest piece and the only one with rules in it.
The client and the server import the *same* `applyMove`, which is what makes
verification possible: a game you saw as a win replays as a win on the server by
construction.

## How scores are verified

The hard problem with a leaderboard for a game that has to feel instant: the
client must know where the mines are to render the board, and anything the
client knows, a modified client can abuse. Verifying every move server-side
solves it but puts a network round trip in front of every click.

This is the compromise, and it costs exactly one round trip per game:

1. **Deal.** The server generates a secret seed, stores it, and sends back only
   `sha256(seed)` — a commitment. The client shows a covered board. It knows
   nothing about where the mines are, because *nothing has decided that yet*.
2. **Open.** The player clicks their first cell. The client sends those
   coordinates and gets the seed in return. The server timestamps this moment
   with its own clock. The client checks the seed against the commitment, so a
   server cannot deal an easier or harder board once it knows where you clicked.
3. **Play.** The board is generated locally from `seed + opening click`, mines
   guaranteed clear around that click. Every move after this is instant and
   entirely offline — no network, no latency, no server round trips.
4. **Submit.** On a win the client sends the move log: a list of
   `{t, kind, x, y}`. Not a time, not a result — just the buttons that were
   pressed. The server regenerates the board from its own stored seed, replays
   the moves through the same engine, and decides for itself whether that was a
   win.

A submitted run has to clear four checks before it becomes a score:

| Check | Catches |
| --- | --- |
| Opening move matches the committed click | Replaying a different board than the one you asked for |
| Replay ends in a win | Fabricated results |
| Reported time ≥ a 3BV-derived floor | Solver-generated "wins" with implausible timings |
| Reported time within tolerance of the server's own measured window | Claiming you were faster than you were |

That last check is where the honest limit lives. The server knows the game took
*at most* `submit_received - start_received`, and it knows a client's reported
duration should fall just short of that by roughly one round trip. The
allowance for that gap is `NETWORK_TOLERANCE_MS` (8s), which is also the
largest amount of time a determined cheat could shave off. Closing that gap
entirely would mean verifying each move as it happens, and that trade — a
network round trip per click — is the one thing this design refuses to make.

Custom boards are playable but never ranked, so the leaderboards stay
comparable.

## Identity

There are no passwords. Registering returns a **key** — a random token that
*is* the account. Store it, paste it into another device, and you are the same
player there. The server only ever stores its SHA-256 digest, so a leaked
database cannot impersonate anyone.

The web client keeps it in `localStorage` and sends it only in an
`Authorization` header — never in a URL or a cookie.
