/**
 * The default-model picker's choices. Pure (no vscode, no fs): config.ts reads the files and hands
 * in what is needed.
 */
export interface ModelOption { label: string; value: string; }

/** Curated model choices (latest Claude family) + a clear-to-default option. */
export const MODEL_OPTIONS: ModelOption[] = [
  { label: 'Opus 4.8 — 1M context', value: 'claude-opus-4-8[1m]' },
  { label: 'Opus 4.8', value: 'claude-opus-4-8' },
  { label: 'Sonnet 4.6', value: 'claude-sonnet-4-6' },
  { label: 'Haiku 4.5', value: 'claude-haiku-4-5' },
  { label: 'Default (clear the override)', value: '' }
];

/** The picker's options. `additionalModelOptionsCache` is the one key read from ~/.claude.json;
 *  `current` is the model set in Claude's settings. */
export function modelOptionsFrom(_additionalModelOptionsCache: unknown, _current: string): ModelOption[] {
  return MODEL_OPTIONS;
}
