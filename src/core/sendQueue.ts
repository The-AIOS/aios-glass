/**
 * Spawn-inbox send queue — the pure decisions, so they can be unit-tested.
 *
 * Why this module exists (2026-07-25, learned the hard way twice in one day):
 *
 *  1. Delivering into a session that is mid-turn DROPS the text. It never reaches the
 *     input and is never queued by the target — it is simply gone. So a send must be
 *     status-gated, never fired blind.
 *  2. The first fix held the message in extension memory and, on timeout, "delivered
 *     anyway". That is a GUARANTEED loss — the timeout path performed exactly the
 *     failure the gate existed to prevent — and an in-memory hold also evaporates on
 *     an IDE reload, because the request file had already been consumed.
 *
 * The correction: the request FILE is the queue. It is not deleted when picked up —
 * it is *claimed* (atomically renamed out of the watcher's `*.json` glob) and only
 * deleted once delivery is VERIFIED. So a held message survives a reload (the claimed
 * file is recovered on activation), two windows cannot both take it (rename is atomic),
 * and giving up leaves a visible `.undelivered` artifact instead of silence.
 *
 * Nothing here touches the disk or vscode — see extension.ts for the IO that uses it.
 */

/** A live session as the registry reports it (subset of RunningAgent). */
export interface SendTarget {
  name: string;
  pid: number;
  status: string;
  sessionId: string;
}

export type SendDecision =
  | { do: 'deliver'; pid: number }
  | { do: 'hold'; reason: string }
  | { do: 'undeliverable'; reason: string };

/** Suffixes deliberately chosen so neither matches the watcher's `*.json` glob —
 *  a claimed or abandoned request must never be re-picked-up as a new one. */
export const HOLD_SUFFIX = '.holding';
export const UNDELIVERED_SUFFIX = '.undelivered';

export const holdPathFor = (requestPath: string): string => `${requestPath}${HOLD_SUFFIX}`;
export const undeliveredPathFor = (p: string): string =>
  `${p.endsWith(HOLD_SUFFIX) ? p.slice(0, -HOLD_SUFFIX.length) : p}${UNDELIVERED_SUFFIX}`;
export const isHoldPath = (p: string): boolean => p.endsWith(HOLD_SUFFIX);

export const isBusy = (status: string | undefined): boolean =>
  (status || '').trim().toLowerCase() === 'busy';

/**
 * Should we deliver now, keep holding, or give up?
 *
 * The one rule that must never soften: a BUSY target is never delivered to. When the
 * hold budget runs out we report `undeliverable` — we do NOT "try anyway", because
 * that is a known, silent loss rather than a best effort.
 */
export function decideSend(
  target: SendTarget | undefined,
  heldForMs: number,
  maxHoldMs: number,
): SendDecision {
  if (!target) {
    return { do: 'undeliverable', reason: 'no live session by that name in the session registry' };
  }
  if (!isBusy(target.status)) {
    return { do: 'deliver', pid: target.pid };
  }
  if (heldForMs < maxHoldMs) {
    return { do: 'hold', reason: `'${target.name}' is busy` };
  }
  return {
    do: 'undeliverable',
    reason: `'${target.name}' stayed busy for ${Math.round(maxHoldMs / 60000)} min — not delivering into a busy session (it would be dropped silently)`,
  };
}

/**
 * A verification needle that survives `.jsonl` encoding: the longest leading run of
 * characters that are NOT escaped inside JSON (no quotes, no backslashes), so looking
 * for it in a raw transcript can't fail on escaping alone.
 */
export function safeNeedle(text: string): string {
  const m = text.match(/[A-Za-z0-9 ,.\-—:;()!?']{24,}/);
  return (m ? m[0] : text.slice(0, 24)).slice(0, 48);
}
