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

/* ══════════════════════════════════════════════════════════════════════════════
   CONTRACT 2 — the multi-fulfiller protocol
   ══════════════════════════════════════════════════════════════════════════════
   The inbox has more than one fulfiller (AIOS Glass in the IDE, the AIOS App
   standalone) and they race: on 2026-07-25 a message intended for an IDE session was
   won by the App, which consumed it, could not deliver it there, and left no trace.
   Claim-by-rename makes a race SAFE (exactly one winner, nothing lost) but it does not
   make a request ADDRESSABLE, and it introduces three new ways to be wrong:
   stealing another surface's live hold, failing a request a sibling window could have
   delivered, and letting a request for an absent surface rot forever.

   Contract 2 closes all four. It is additive — a request with no `surface` behaves
   exactly as contract 1 did (any fulfiller may take it).
   ══════════════════════════════════════════════════════════════════════════════ */

export const INBOX_CONTRACT = 2;

/** Which fulfiller a request is addressed to. Absent → any (contract-1 behaviour). */
export type Surface = 'glass' | 'app';

export const isSurface = (v: unknown): v is Surface => v === 'glass' || v === 'app';

/** Who holds a claimed request, so a recovering process can tell a live hold from an
 *  orphan — embedded in the held file itself, which makes the claim self-describing
 *  (and leaves useful forensics in any `.undelivered` artifact). */
export interface ClaimStamp {
  surface: Surface;
  pid: number;
  at: number;
}

export function parseClaim(raw: unknown): ClaimStamp | undefined {
  if (!raw || typeof raw !== 'object') { return undefined; }
  const c = raw as Record<string, unknown>;
  if (!isSurface(c.surface) || typeof c.pid !== 'number' || typeof c.at !== 'number') { return undefined; }
  return { surface: c.surface, pid: c.pid, at: c.at };
}

/**
 * May THIS fulfiller take this request at all?
 *
 * - `skip`   → addressed to another surface and still fresh: leave it alone entirely
 *              (do not claim, do not touch — the addressee may be starting up).
 * - `retire` → addressed elsewhere but older than the TTL and nobody took it. Any
 *              surface may RETIRE it (mark `.undelivered`) — fulfilment is targeted,
 *              retirement is shared, so a request can never rot silently.
 * - `claim`  → ours, or unaddressed.
 */
export function claimVerdict(
  requestedSurface: unknown,
  mySurface: Surface,
  ageMs: number,
  ttlMs: number,
): 'claim' | 'skip' | 'retire' {
  if (!isSurface(requestedSurface) || requestedSurface === mySurface) { return 'claim'; }
  return ageMs >= ttlMs ? 'retire' : 'skip';
}

/**
 * On startup we find a `.holding` file. Is it an orphan we should resume, or a hold
 * another live process is actively waiting on?
 *
 * Adopt only when the claimer is demonstrably gone (dead pid) or the claim is older
 * than `staleMs` (a hold that outlived any legitimate wait). Never adopt a fresh claim
 * belonging to a live process — that is the cross-surface double-delivery bug.
 */
export function canAdoptHold(
  claim: ClaimStamp | undefined,
  nowMs: number,
  staleMs: number,
  claimerAlive: boolean,
): boolean {
  if (!claim) { return true; }                    // unstamped (contract-1 era) → adoptable
  if (!claimerAlive) { return true; }             // the holder died mid-wait → resume it
  return nowMs - claim.at >= staleMs;             // live holder, but the hold is stale
}

/**
 * The claimer could not find the target's terminal — but a SIBLING window might hold
 * it. Releasing the claim (renaming back to `*.json`) lets another window try, which
 * is very different from declaring the message undeliverable. Bounded, so two windows
 * can't ping-pong a request forever.
 */
export function shouldReleaseForSibling(releases: number, maxReleases: number): boolean {
  return releases < maxReleases;
}

/**
 * Should we (over)write the inbox README?
 *
 * Glass owns the doc when both surfaces are installed (the App defers to it), so Glass
 * normally overwrites. The exception that keeps that honest: never DOWNGRADE a doc that
 * declares a HIGHER contract than we implement — a newer fulfiller's doc is the accurate
 * one, and stomping it would replace correct instructions with stale ones.
 */
export function shouldWriteDoc(existing: string | undefined, ourContract: number, ours: string): boolean {
  if (!existing || !existing.trim()) { return true; }
  const m = /aios-spawn-inbox: contract\s+(\d+)/i.exec(existing);
  if (m && Number(m[1]) > ourContract) { return false; }
  return existing.trim() !== ours.trim();
}
