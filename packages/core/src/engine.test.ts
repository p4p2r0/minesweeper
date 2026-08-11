import assert from 'node:assert/strict';
import test from 'node:test';

import { cellIndex, computeThreeBV, generateBoard } from './board.js';
import { applyMove, createGame } from './game.js';
import { PRESETS, classifyConfig } from './presets.js';
import { replayGame } from './replay.js';
import { validateBoardConfig, validateUsername } from './rules.js';
import type { Board, BoardConfig, GameState } from './types.js';

const BEGINNER: BoardConfig = { width: 9, height: 9, mines: 10 };

/** Clears a whole board by revealing every safe cell, returning the final state. */
function playPerfectGame(config: BoardConfig, seed: string): GameState {
  let state = createGame(config, seed);
  const opening = applyMove(state, { t: 0, kind: 'reveal', x: 0, y: 0 });
  assert.equal(opening.ok, true, 'opening move should be legal');
  state = opening.state;

  const board = requireBoard(state);
  let t = 0;
  for (let y = 0; y < config.height; y++) {
    for (let x = 0; x < config.width; x++) {
      const index = cellIndex(config.width, x, y);
      if (board.mine[index] === 1 || state.revealed[index] === 1) continue;
      t += 25;
      const result = applyMove(state, { t, kind: 'reveal', x, y });
      assert.equal(result.ok, true, `reveal ${x},${y} should be legal`);
      state = result.state;
    }
  }
  return state;
}

test('board generation is deterministic for a seed and opening click', () => {
  const a = generateBoard(BEGINNER, 'seed-abc', { x: 4, y: 4 });
  const b = generateBoard(BEGINNER, 'seed-abc', { x: 4, y: 4 });
  assert.deepEqual(Array.from(a.mine), Array.from(b.mine));
  assert.deepEqual(Array.from(a.adjacent), Array.from(b.adjacent));

  const different = generateBoard(BEGINNER, 'seed-abd', { x: 4, y: 4 });
  assert.notDeepEqual(Array.from(a.mine), Array.from(different.mine));
});

test('a different opening click yields a different board from the same seed', () => {
  const a = generateBoard(BEGINNER, 'seed-abc', { x: 0, y: 0 });
  const b = generateBoard(BEGINNER, 'seed-abc', { x: 8, y: 8 });
  assert.notDeepEqual(Array.from(a.mine), Array.from(b.mine));
});

test('generated boards hold exactly the requested number of mines', () => {
  for (const preset of Object.values(PRESETS)) {
    const board = generateBoard(preset, `seed-${preset.id}`, { x: 1, y: 1 });
    const placed = board.mine.reduce((sum, value) => sum + value, 0);
    assert.equal(placed, preset.mines, `${preset.id} should place ${preset.mines} mines`);
  }
});

test('the opening click and its neighbours are always mine-free', () => {
  for (let i = 0; i < 200; i++) {
    const board = generateBoard(BEGINNER, `seed-${i}`, { x: 4, y: 4 });
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const index = cellIndex(BEGINNER.width, 4 + dx, 4 + dy);
        assert.equal(board.mine[index], 0, `cell ${4 + dx},${4 + dy} must be safe`);
      }
    }
  }
});

test('the opening click always cascades open an area', () => {
  for (let i = 0; i < 50; i++) {
    const state = createGame(BEGINNER, `cascade-${i}`);
    const result = applyMove(state, { t: 0, kind: 'reveal', x: 4, y: 4 });
    assert.equal(result.ok, true);
    assert.ok(result.state.revealedCount >= 9, 'a safe 3x3 block must open at minimum');
  }
});

test('flags block reveals and toggle back off', () => {
  let state = createGame(BEGINNER, 'flags');
  state = applyMove(state, { t: 0, kind: 'reveal', x: 0, y: 0 }).state;

  const target = findCoveredCell(state);
  const flagged = applyMove(state, { t: 10, kind: 'flag', ...target });
  assert.equal(flagged.ok, true);
  assert.equal(flagged.state.flagCount, 1);

  const blocked = applyMove(flagged.state, { t: 20, kind: 'reveal', ...target });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, 'cell-flagged');

  const unflagged = applyMove(flagged.state, { t: 30, kind: 'flag', ...target });
  assert.equal(unflagged.ok, true);
  assert.equal(unflagged.state.flagCount, 0);
});

test('moves are rejected once the game is over', () => {
  const won = playPerfectGame(BEGINNER, 'finished');
  assert.equal(won.status, 'won');
  const after = applyMove(won, { t: 99_999, kind: 'reveal', x: 0, y: 0 });
  assert.equal(after.ok, false);
  assert.equal(after.reason, 'game-over');
});

test('time may not run backwards', () => {
  let state = createGame(BEGINNER, 'clock');
  state = applyMove(state, { t: 0, kind: 'reveal', x: 0, y: 0 }).state;
  const target = findCoveredCell(state);
  const rewound = applyMove(state, { t: -1, kind: 'flag', ...target });
  assert.equal(rewound.ok, false);
});

test('chording requires a matching flag count', () => {
  // A 3x3 board with a single mine gives a deterministic chording scenario.
  const tiny: BoardConfig = { width: 3, height: 3, mines: 1 };
  let state = createGame(tiny, 'chord-seed');
  state = applyMove(state, { t: 0, kind: 'reveal', x: 1, y: 1 }).state;

  const board = requireBoard(state);
  const centre = cellIndex(3, 1, 1);
  assert.equal(board.adjacent[centre], 1, 'centre should see the lone mine');

  const premature = applyMove(state, { t: 5, kind: 'chord', x: 1, y: 1 });
  assert.equal(premature.ok, false);
  assert.equal(premature.reason, 'flag-count-mismatch');

  const mineIndex = board.mine.indexOf(1);
  const mineX = mineIndex % 3;
  const mineY = (mineIndex - mineX) / 3;
  const flagged = applyMove(state, { t: 10, kind: 'flag', x: mineX, y: mineY });
  assert.equal(flagged.ok, true);

  const chorded = applyMove(flagged.state, { t: 20, kind: 'chord', x: 1, y: 1 });
  assert.equal(chorded.ok, true);
  assert.equal(chorded.state.status, 'won');
});

test('revealing a mine loses the game', () => {
  let state = createGame(BEGINNER, 'boom');
  state = applyMove(state, { t: 0, kind: 'reveal', x: 0, y: 0 }).state;
  const board = requireBoard(state);

  const mineIndex = board.mine.indexOf(1);
  const x = mineIndex % BEGINNER.width;
  const y = (mineIndex - x) / BEGINNER.width;
  const result = applyMove(state, { t: 100, kind: 'reveal', x, y });
  assert.equal(result.ok, true);
  assert.equal(result.state.status, 'lost');
  assert.equal(result.state.explodedAt, mineIndex);
});

test('a genuine win replays as a win on the server side', () => {
  const seed = 'replay-happy-path';
  const state = playPerfectGame(BEGINNER, seed);
  assert.equal(state.status, 'won');

  const result = replayGame(BEGINNER, seed, state.moves, { requireWin: true });
  assert.equal(result.ok, true, result.ok ? '' : result.reason);
  if (result.ok) {
    assert.equal(result.state.status, 'won');
    assert.equal(result.elapsedMs, state.elapsedMs);
    assert.ok(result.threeBV > 0);
  }
});

test('a move log replayed against the wrong seed is rejected', () => {
  const state = playPerfectGame(BEGINNER, 'real-seed');
  const result = replayGame(BEGINNER, 'forged-seed', state.moves, { requireWin: true });
  assert.equal(result.ok, false);
});

test('a truncated move log is not a win', () => {
  const state = playPerfectGame(BEGINNER, 'truncated');
  const result = replayGame(BEGINNER, 'truncated', state.moves.slice(0, -1), { requireWin: true });
  assert.equal(result.ok, false);
});

test('replay demands a reveal at t=0', () => {
  const late = replayGame(BEGINNER, 'seed', [{ t: 5, kind: 'reveal', x: 0, y: 0 }]);
  assert.equal(late.ok, false);

  const flagFirst = replayGame(BEGINNER, 'seed', [{ t: 0, kind: 'flag', x: 0, y: 0 }]);
  assert.equal(flagFirst.ok, false);
});

test('3BV stays within its theoretical bounds', () => {
  for (const preset of Object.values(PRESETS)) {
    const board = generateBoard(preset, `bv-${preset.id}`, { x: 0, y: 0 });
    const threeBV = computeThreeBV(board);
    const safeCells = preset.width * preset.height - preset.mines;
    assert.ok(threeBV >= 1, '3BV is at least one click');
    assert.ok(threeBV <= safeCells, '3BV never exceeds the number of safe cells');
  }
});

test('a board matching a preset is classified as that preset', () => {
  assert.equal(classifyConfig({ width: 9, height: 9, mines: 10 }), 'beginner');
  assert.equal(classifyConfig({ width: 30, height: 16, mines: 99 }), 'expert');
  assert.equal(classifyConfig({ width: 10, height: 10, mines: 10 }), 'custom');
});

test('board configs are bounded', () => {
  assert.equal(validateBoardConfig({ width: 9, height: 9, mines: 10 }).ok, true);
  assert.equal(validateBoardConfig({ width: 9, height: 9, mines: 81 }).ok, false);
  assert.equal(validateBoardConfig({ width: 9, height: 9, mines: 0 }).ok, false);
  assert.equal(validateBoardConfig({ width: 1, height: 9, mines: 2 }).ok, false);
  assert.equal(validateBoardConfig({ width: 9.5, height: 9, mines: 2 }).ok, false);
});

test('usernames are constrained', () => {
  assert.equal(validateUsername('p4p2r0').ok, true);
  assert.equal(validateUsername('a-b_c').ok, true);
  assert.equal(validateUsername('ab').ok, false);
  assert.equal(validateUsername('_leading').ok, false);
  assert.equal(validateUsername('has space').ok, false);
  assert.equal(validateUsername('admin').ok, false);
});

function requireBoard(state: GameState): Board {
  if (!state.board) throw new Error('expected the board to be generated by now');
  return state.board;
}

/** First still-covered, still-unflagged cell — handy for negative tests. */
function findCoveredCell(state: GameState): { x: number; y: number } {
  for (let y = 0; y < state.config.height; y++) {
    for (let x = 0; x < state.config.width; x++) {
      const index = cellIndex(state.config.width, x, y);
      if (state.revealed[index] === 0 && state.flagged[index] === 0) return { x, y };
    }
  }
  throw new Error('board has no covered cells');
}
