/**
 * The decision half of "Close sessions": given what the registry says now, which of the
 * watched sessions finished their `/aios:close-session --auto`, and which are gone.
 *
 * Pure and vscode-free so it can be tested without an editor host; closeAll.ts owns the
 * polling, the terminals and the disposal.
 */

/** The slice of a registry record this module reads. */
export interface WatchedSession {
  sessionId?: string;
  pid?: number;
  name: string;
  /** Claude Code's registry status: busy | shell | idle | waiting. */
  status: string;
}

export interface CloseWatch {
  /** Sessions still being watched. */
  watching: Set<string>;
  /** Sessions seen busy at least once since the broadcast (close-session started). */
  seenBusy: Set<string>;
}

export interface CloseWatchStep {
  /** Finished capturing and still live: safe to dispose if the operator asked for it. */
  finished: string[];
  /** No longer in the registry: nothing left to dispose. */
  gone: string[];
}

/** How a session is identified across polls. */
export function watchKey(s: WatchedSession): string {
  return s.name;
}

export function newCloseWatch(keys: Iterable<string>): CloseWatch {
  return { watching: new Set(keys), seenBusy: new Set() };
}

/** Advance the watch by one registry observation. Mutates `w`; reports what left it. */
export function closeWatchStep(w: CloseWatch, sessions: readonly WatchedSession[]): CloseWatchStep {
  const status = new Map(sessions.map((s) => [watchKey(s), s.status]));
  const out: CloseWatchStep = { finished: [], gone: [] };
  for (const key of [...w.watching]) {
    const st = status.get(key);
    if (st === 'busy') { w.seenBusy.add(key); continue; }
    const gone = st === undefined;
    const done = gone || (w.seenBusy.has(key) && st !== 'busy');
    if (!done) continue;
    w.watching.delete(key);
    (gone ? out.gone : out.finished).push(key);
  }
  return out;
}
