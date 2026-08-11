import type { BoardConfig, DifficultyId, Preset, PresetId } from './types.js';

/** The three classic boards. Only these are ranked on the leaderboard. */
export const PRESETS: Record<PresetId, Preset> = {
  beginner: { id: 'beginner', label: 'Beginner', width: 9, height: 9, mines: 10 },
  intermediate: { id: 'intermediate', label: 'Intermediate', width: 16, height: 16, mines: 40 },
  expert: { id: 'expert', label: 'Expert', width: 30, height: 16, mines: 99 },
};

export const PRESET_IDS: readonly PresetId[] = ['beginner', 'intermediate', 'expert'];

export function isPresetId(value: string): value is PresetId {
  return value === 'beginner' || value === 'intermediate' || value === 'expert';
}

/** Bounds for custom boards — generous, but small enough to stay renderable. */
export const CUSTOM_LIMITS = {
  minWidth: 2,
  maxWidth: 60,
  minHeight: 2,
  maxHeight: 40,
  minMines: 1,
} as const;

/**
 * Maps a board back to a difficulty. A custom board that happens to match a
 * preset exactly *is* that preset — otherwise players could dodge the ranked
 * categories by entering the numbers by hand.
 */
export function classifyConfig(config: BoardConfig): DifficultyId {
  for (const id of PRESET_IDS) {
    const preset = PRESETS[id];
    if (
      preset.width === config.width &&
      preset.height === config.height &&
      preset.mines === config.mines
    ) {
      return id;
    }
  }
  return 'custom';
}

export function configFor(difficulty: DifficultyId, custom?: BoardConfig): BoardConfig {
  if (difficulty === 'custom') {
    if (!custom) throw new Error('custom difficulty requires an explicit board config');
    return custom;
  }
  const { width, height, mines } = PRESETS[difficulty];
  return { width, height, mines };
}
