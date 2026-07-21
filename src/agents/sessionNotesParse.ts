/**
 * AI-18 / AI-39 — pure parsing for session post-its.
 *
 * Kept vscode-/fs-free (like `files/sort.ts`) so the backward-compat coercion is
 * the single source of truth AND unit-testable without the state file. `sessionNotes.ts`
 * owns the I/O; this owns the SHAPE.
 *
 * Two storage shapes coexist under the `sessionNotes` key: the current
 * `{ t, ts }` object (text + when-jotted) and LEGACY bare strings (notes written
 * before timestamps, and whatever the App may still write). Readers tolerate both.
 */

/** A note as the UI consumes it: its text + when it was jotted (0 = unknown/legacy). */
export interface SessionNote { text: string; ts: number; }

/** Coerce either storage shape to a `SessionNote`, or undefined if it's empty/garbage. */
export function coerceNote(entry: unknown): SessionNote | undefined {
  if (typeof entry === 'string') { const t = entry.trim(); return t ? { text: t, ts: 0 } : undefined; }
  if (entry && typeof entry === 'object') {
    const o = entry as { t?: unknown; ts?: unknown };
    if (typeof o.t === 'string') { const t = o.t.trim(); return t ? { text: t, ts: Number(o.ts) || 0 } : undefined; }
  }
  return undefined;
}

/** Normalize a raw stored value (any shape) into the UI note list — legacy bare
 *  strings ⇄ timestamped objects, empties + garbage dropped. */
export function parseStoredNotes(raw: unknown): SessionNote[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(coerceNote).filter((n): n is SessionNote => !!n);
}
