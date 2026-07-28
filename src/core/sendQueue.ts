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
  if (isDeliverable(target.status)) {
    return { do: 'deliver', pid: target.pid };
  }
  if (heldForMs < maxHoldMs) {
    // Name the status in the reason: an UNCHARACTERISED status is exactly what we want
    // surfaced in the log, so it can be measured and promoted into DELIVERABLE_STATUSES
    // instead of being guessed at forever.
    const status = (target.status || '(none)').trim();
    const known = isBusy(status) ? '' : ' — status not yet characterised, holding to be safe';
    return { do: 'hold', reason: `'${target.name}' is ${status}${known}` };
  }
  return {
    do: 'undeliverable',
    reason: `'${target.name}' never became deliverable within ${Math.round(maxHoldMs / 60000)} min (last status: ${(target.status || '(none)').trim()}) — not delivering into a non-idle session, which would be dropped silently`,
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

/** Pull the plain text out of a transcript record's `content` (string, or block array). */
function recordText(rec: unknown): string {
  const msg = (rec as { message?: unknown })?.message as { content?: unknown } | undefined;
  const c = msg?.content;
  if (typeof c === 'string') { return c; }
  if (Array.isArray(c)) {
    return c.map((b) => (b && typeof b === 'object' && typeof (b as { text?: unknown }).text === 'string'
      ? (b as { text: string }).text : '')).join(' ');
  }
  return '';
}

const isUserRecord = (rec: unknown): boolean => {
  const r = rec as { type?: unknown; message?: { role?: unknown } };
  return r?.type === 'user' || r?.message?.role === 'user';
};

/**
 * How many times does `needle` appear as an actual USER TURN in a `.jsonl` transcript?
 *
 * Why counting, and why user-turn-scoped (both measured by the AIOS App, 2026-07-25):
 *
 *  · A raw `includes()` over the whole file cannot detect a DOUBLE delivery, which is
 *    contract 2's worst failure — it produces wrong output rather than missing output.
 *    One delivery was measured producing FIVE substring hits (1 user turn + assistant
 *    messages quoting the marker back), so presence is not even evidence of one turn.
 *  · On contract 2's own new paths — a sibling handoff, or adopting a hold — the needle
 *    is ALREADY in the transcript from the earlier attempt. Presence is therefore true
 *    on the first poll, and a presence check "verifies" a delivery it never observed.
 *
 * So delivery is verified by a BASELINE COUNT taken before sending and an increase
 * after: proof that *this* attempt landed, not that the text exists somewhere.
 */
export function countUserTurnsContaining(jsonl: string, needle: string): number {
  if (!needle) { return 0; }
  let n = 0;
  for (const line of jsonl.split('\n')) {
    if (!line.includes(needle)) { continue; }      // cheap prefilter before JSON.parse
    let rec: unknown;
    try { rec = JSON.parse(line); } catch { continue; }
    if (!isUserRecord(rec)) { continue; }          // assistant echoes must not count
    if (recordText(rec).includes(needle)) { n++; }
  }
  return n;
}

/** Verdict for a verification poll, given the baseline taken before delivering. */
export type VerifyVerdict = 'pending' | 'verified' | 'duplicate';

export function verifyVerdict(before: number, now: number): VerifyVerdict {
  if (now <= before) { return 'pending'; }
  return now - before > 1 ? 'duplicate' : 'verified';
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

/* ── Protocol TIMINGS — these are CONTRACT, not local tuning ──────────────────
   Every fulfiller must use the same four numbers, because they decide *cross-process
   ownership*. Measured by the AIOS App on 2026-07-25: with Glass holding at 45 min and
   the App at 15, there is a 30-minute window where Glass believes it owns a hold the App
   considers stale and adopts — and BOTH deliver. That is the double delivery contract 2
   exists to prevent, reachable with neither implementation wrong on its own terms.
   Change these only in lockstep across every fulfiller, and update the inbox README so
   the next one inherits them. */
export const TIMINGS = {
  /** A `.holding` older than this may be adopted even if its claimer still lives. */
  HOLD_STALE_MS: 45 * 60 * 1000,
  /** How long a fulfiller waits for a target to become deliverable before giving up. */
  MAX_HOLD_MS: 30 * 60 * 1000,
  /** A request addressed to a surface that never took it is retired after this. */
  RETIRE_TTL_MS: 10 * 60 * 1000,
  /** Sibling-window handoffs before a request is declared undeliverable. */
  MAX_RELEASES: 2,
  /** How many times a fulfiller may actually TYPE a message before it stops re-sending and
   *  only watches for a late arrival. Bounded because double delivery is the worst outcome
   *  this protocol can produce — explicitly worse than latency. Exhausting it is NOT a
   *  failure: the fulfiller keeps waiting out MAX_HOLD_MS in silence. */
  MAX_DELIVERY_ATTEMPTS: 3,
} as const;

/* ── Deliverability ───────────────────────────────────────────────────────────
   The registry emits more than the two statuses we first assumed: the App measured
   `shell` on a session running a Bash command, and measured that delivering during
   `shell` SUCCEEDS (the target queued the prompt and answered after its command).

   So the canonical rule is an explicit ALLOWLIST of statuses measured to accept a
   delivery, and HOLD on anything else — including statuses neither fulfiller has
   characterised yet. Rationale: the failure is asymmetric (a wrong "deliverable" guess
   costs a real message; a wrong "hold" guess costs latency), but we don't pay that
   latency on statuses we have actually measured. Unknown statuses are logged so they
   can be characterised and promoted here rather than guessed at forever. */
export const DELIVERABLE_STATUSES: readonly string[] = ['idle', 'shell'];

export const isDeliverable = (status: string | undefined): boolean =>
  DELIVERABLE_STATUSES.includes((status || '').trim().toLowerCase());

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
export function shouldReleaseForSibling(releases: number, maxReleases: number = TIMINGS.MAX_RELEASES): boolean {
  /* The bound now DEFAULTS to the contract value instead of relying on every caller to pass
     the right one. It was a required parameter, which meant this pure, fully unit-tested
     function did not own the number that decides cross-process behaviour — so both surfaces
     could pass different values and both test suites would still be green. That is the exact
     shape of every failure in this ticket: a check that is correct about something nobody
     verified. Callers may still override for tests; production passes nothing. */
  return releases < maxReleases;
}

/* ── After a delivery that did not verify: FOUR states, not two ───────────────
   This was imperative and duplicated, and both copies got it wrong the same way: they
   collapsed "no sibling left to try" into "undeliverable" and retired the request. A brief
   died twenty seconds after being claimed, with 29m40s of MAX_HOLD_MS unspent, because the
   target was merely busy — the exact case the hold budget exists for.

   It lives here, pure, for the reason every other value in this file does: a decision that
   governs cross-process behaviour cannot be re-derived correctly in two codebases by hand.
   Both surfaces call this and therefore agree by construction rather than by discipline.

     retire   the target is gone, or the hold budget really is spent — a true failure
     release  another window may own that terminal; hand the claim back (bounded)
     retry    we still have sends left; deliver again
     wait     out of sends but NOT out of time — keep watching for a late arrival,
              and never type again. Bounded sends, unbounded patience: double delivery
              is worse than latency, so exhausting the retries must not end the wait. */
export type MissAction = 'retire' | 'release' | 'retry' | 'wait';

export function decideAfterVerifyMiss(s: {
  targetAlive: boolean;
  heldMs: number;
  releases: number;
  attempts: number;
}): { do: MissAction; reason: string } {
  if (!s.targetAlive) return { do: 'retire', reason: 'the target is no longer a live session' };
  if (s.heldMs >= TIMINGS.MAX_HOLD_MS) {
    return { do: 'retire', reason: `held for ${Math.round(s.heldMs / 60000)} min without the message ever appearing in the target transcript` };
  }
  if (shouldReleaseForSibling(s.releases)) {
    return { do: 'release', reason: 'not verified here; another window may own that terminal' };
  }
  if (s.attempts < TIMINGS.MAX_DELIVERY_ATTEMPTS) {
    return { do: 'retry', reason: `no sibling left to try; re-delivering (attempt ${s.attempts + 1}/${TIMINGS.MAX_DELIVERY_ATTEMPTS})` };
  }
  return { do: 'wait', reason: 'out of send attempts but still inside the hold budget — watching for a late arrival' };
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
