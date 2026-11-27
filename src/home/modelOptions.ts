/**
 * The default-model picker's choices: exactly the AIOS App's (src/main/aios.ts `modelOptions()`),
 * so both surfaces offer the same models. Pure (no vscode, no fs): config.ts reads the files.
 *
 * MODEL_LADDER and MODEL_ALIASES are the App's, copied unchanged. When a model generation ships,
 * the App's table is the one to update; this copy follows it, and both move into the shared
 * package (candidate there, with the App's modelOptions).
 */
export interface ModelOption { label: string; value: string; }

/* The App's ladder, strongest first, with its own comment. */
export const MODEL_LADDER = [
  /* The current generation, each id VERIFIED in Claude Code 2.1.296's own model
     catalog first, because an id the catalog does not know is refused outright rather than
     falling back: claude-fable-5-1, claude-opus-5-5[1m], claude-sonnet-5-5[1m], claude-haiku-5-5.
     Ordered as MODEL-ROUTING's ladder (frontier → judgment → scale → fast); the setup step does
     not read index 0 (it recommends an alias, RECOMMENDED_SETUP_MODEL), so Fable at the top is a
     ranking, not a recommendation. Fable has no 1M variant in the catalog. The previous generation
     stays at the bottom so an operator pinned to it sees a name, not a raw id. */
  { label: 'Fable 5.1', value: 'claude-fable-5-1' },
  { label: 'Opus 5.5 — 1M context', value: 'claude-opus-5-5[1m]' },
  { label: 'Opus 5.5', value: 'claude-opus-5-5' },
  { label: 'Sonnet 5.5 — 1M context', value: 'claude-sonnet-5-5[1m]' },
  { label: 'Sonnet 5.5', value: 'claude-sonnet-5-5' },
  { label: 'Haiku 5.5', value: 'claude-haiku-5-5' },
  { label: 'Opus 5 — 1M context', value: 'claude-opus-5[1m]' },
  { label: 'Opus 5', value: 'claude-opus-5' },
  { label: 'Sonnet 5', value: 'claude-sonnet-5' },
  { label: 'Haiku 4.5', value: 'claude-haiku-4-5-20251001' },
];

export const MODEL_ALIASES: Record<string, string> = {
  'opus[1m]': 'Opus (latest) — 1M context',
  opus: 'Opus (latest)',
  'sonnet[1m]': 'Sonnet (latest) — 1M context',
  sonnet: 'Sonnet (latest)',
  haiku: 'Haiku (latest)',
};

/** The App's option to clear the override (its MODEL_OPTIONS ends with it). */
export const CLEAR_MODEL: ModelOption = { label: 'Default (clear the override)', value: '' };

/**
 * The App's modelOptions(): the ladder, PLUS the extra models Claude Code caches for the account
 * (`additionalModelOptionsCache` in ~/.claude.json, the one key read from that file), PLUS the model
 * set now if none of those carries it, so the picker can never hide a value set elsewhere. Then
 * Glass's clear option, last.
 */
export function modelOptionsFrom(additionalModelOptionsCache: unknown, current: string): ModelOption[] {
  const out: ModelOption[] = [...MODEL_LADDER];
  const extra = Array.isArray(additionalModelOptionsCache) ? additionalModelOptionsCache : [];
  for (const o of extra) {
    const v = (o as { value?: unknown })?.value;
    const l = (o as { label?: unknown })?.label;
    if (typeof v === 'string' && !out.some((m) => m.value === v)) {
      out.push({ label: typeof l === 'string' && l ? `${l} — ${v.includes('[1m]') ? '1M context' : v}` : v, value: v });
    }
  }
  if (current && !out.some((m) => m.value === current)) {
    out.push({ label: MODEL_ALIASES[current] ?? current, value: current });
  }
  return [...out, CLEAR_MODEL];
}
