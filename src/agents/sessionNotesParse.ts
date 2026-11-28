/**
 * Pure parsing for session post-its.
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

export const HARVEST_HEADING = '## Session notes (harvested)';

/**
 * The text a harvest APPENDS to today's daily note. `existing` is the note as it is now, or ''
 * when the file does not exist.
 *
 * It returns only what goes at the end, never a rewritten note. The harvest used to read the
 * note, rebuild it and write it whole, so a read that failed for any reason other than a missing
 * file (permissions, a lock) left it with '' and the write replaced the day's note with the
 * post-its alone. A rewrite also drops whatever another writer appended between the read and the
 * write. Appending can do neither. A note with CRLF line endings gets CRLF.
 */
export function harvestAppendix(existing: string, name: string, stamp: string, notes: SessionNote[]): string {
  const sep = !existing || /\r?\n\r?\n$/.test(existing) ? '' : /\r?\n$/.test(existing) ? '\n' : '\n\n';
  const entry = `**${name}** _(${stamp})_\n\n${notes.map((n) => `- ${n.text}`).join('\n')}\n`;
  const text = existing.includes(HARVEST_HEADING)
    ? `${sep}${entry}`
    : `${sep}${HARVEST_HEADING}\n\n> Reminders harvested from a killed session — move or clear them.\n\n${entry}`;
  return /\r\n/.test(existing) ? text.replace(/\r?\n/g, '\r\n') : text;
}
