import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { TIMINGS, decideAfterVerifyMiss, maxAttemptsFor, type MissAction } from '../core/sendQueue';

/* THE CROSS-REPO DIFF-GUARD.
 *
 * `aios-app` and `aios-glass` both fulfil requests on the same bus, and contract 2 has them
 * RACE — so a request must behave identically whichever one wins. The two `sendQueue.ts` copies
 * had silently diverged by 248 lines, and `TIMINGS` — the block literally commented "these are
 * CONTRACT, not local tuning" — existed in only ONE of them. The only thing linking the surfaces
 * was a code comment reading `// Glass: MAX_HOLD_MS`.
 *
 * They agreed anyway, because someone hand-copied them. Nothing enforced it.
 *
 * A true diff cannot run here: these are separate repositories, so neither CI can see the other's
 * tree. What CAN travel is a HASH. Both repos record the same digest of the TIMINGS block, so
 * editing the contract in one repo fails that repo's test until the digest is updated — and the
 * digest is a 16-character string a human compares across the two PRs in one glance. It converts
 * silent drift into a visible, deliberate act.
 *
 * WHEN THIS FAILS: you changed TIMINGS. That is allowed — but it is a PROTOCOL change. Make the
 * identical edit in the other repo, recompute, update PROTOCOL_TIMINGS_SHA in BOTH, and update
 * the inbox README's invariants section. All in the same push, or a live fleet runs split-brain.
 */
const PROTOCOL_TIMINGS_SHA = 'ee54bd44cff806e1';

function timingsBlock(): string {
  const src = fs.readFileSync('src/core/sendQueue.ts', 'utf8');
  const m = /export const TIMINGS = \{[\s\S]*?\n\} as const;/.exec(src);
  assert.ok(m, 'the TIMINGS block must exist in this surface — it is the contract');
  return m![0];
}

test('PROTOCOL: the TIMINGS block is byte-identical across both fulfillers', () => {
  const sha = crypto.createHash('sha256').update(timingsBlock()).digest('hex').slice(0, 16);
  assert.equal(sha, PROTOCOL_TIMINGS_SHA,
    'TIMINGS changed. This is a PROTOCOL change: make the same edit in the sibling repo, update this SHA in BOTH, and update the inbox README — in one push.');
});

test('PROTOCOL: the values themselves are the agreed ones', () => {
  // Belt and braces: the hash catches edits, these catch a hash updated without thought.
  assert.equal(TIMINGS.HOLD_STALE_MS, 45 * 60 * 1000);
  assert.equal(TIMINGS.MAX_HOLD_MS, 30 * 60 * 1000);
  assert.equal(TIMINGS.RETIRE_TTL_MS, 10 * 60 * 1000);
  assert.equal(TIMINGS.MAX_RELEASES, 2);
  assert.equal(TIMINGS.MAX_DELIVERY_ATTEMPTS, 3);
  // MAX_HOLD_MS must stay below HOLD_STALE_MS or a claimer gives up after its hold is adoptable.
  assert.ok(TIMINGS.MAX_HOLD_MS < TIMINGS.HOLD_STALE_MS, 'a fulfiller must give up before its claim goes stale');
});

/* AI-66 pt4 — the four-way decision after a delivery that did not verify.
   Pure, so it can be exhaustively tested WITHOUT an extension host or an Electron window —
   which is the whole reason it lives in this module rather than inside each surface's async
   delivery loop, where the bug originally hid in two places at once. */

test('a verify miss on a LIVE target inside the hold budget never retires', () => {
  // The bug: "no sibling left" was read as "undeliverable" and a brief died in 20 seconds
  // with 29m40s of MAX_HOLD_MS unspent. Nothing below may return 'retire' while the target
  // is alive and the clock has not run out.
  for (const targetBusy of [false, true]) {
    for (const attempts of [0, 1, 2, 3, 9]) {
      const d = decideAfterVerifyMiss({ targetAlive: true, targetBusy, heldMs: 20_000, attempts });
      assert.notEqual(d.do, 'retire', `alive + 20s in must never retire (busy=${targetBusy} attempts=${attempts})`);
    }
  }
});

test('a BUSY target always waits — an empty transcript proves nothing mid-turn', () => {
  /* Ported from the App 2026-08-14. A session mid-turn has not had the OPPORTUNITY to write
     the turn, so silence is not evidence of a failed delivery. Reading it as failure is what
     produced FOUR deliveries of one request on 2026-08-12. */
  for (const attempts of [0, 1, 2, 3, 99]) {
    const d = decideAfterVerifyMiss({ targetAlive: true, targetBusy: true, heldMs: 60_000, attempts });
    assert.equal(d.do, 'wait', `busy must wait, not ${d.do} (attempts=${attempts})`);
    assert.match(d.reason, /busy/);
  }
});

test('an ALREADY-TYPED message is never handed to a sibling', () => {
  /* Reaching this function means the surface typed the message successfully (a surface that could
     not type it takes the no-terminal path, which is the case release was built for). Handing an
     already-typed request to a sibling asks a second surface to type it again: double delivery,
     which this protocol calls explicitly worse than latency.
     And with one fulfiller running there is no sibling, so the release came back to the same
     surface, which re-typed it and burned a release — twice, to MAX_RELEASES, one step from
     retiring work that had already completed as a FALSE dead letter. */
  for (const targetBusy of [false, true]) {
    for (const attempts of [0, 1, 2, 3, 99]) {
      for (const heldMs of [0, 60_000, TIMINGS.MAX_HOLD_MS - 1]) {
        const d = decideAfterVerifyMiss({ targetAlive: true, targetBusy, heldMs, attempts });
        assert.notEqual(d.do as string, 'release',
          `a typed message must never be handed to a sibling (busy=${targetBusy} attempts=${attempts} held=${heldMs})`);
      }
    }
  }
});

test('sends are capped, patience is not', () => {
  const idle = { targetAlive: true, targetBusy: false, heldMs: 60_000 };
  assert.equal(decideAfterVerifyMiss({ ...idle, attempts: TIMINGS.MAX_DELIVERY_ATTEMPTS - 1 }).do, 'retry');
  // out of sends but still inside the hold: WAIT. Retrying forever would re-type the message
  // every verify window for 30 minutes — double delivery, which is worse than the delay.
  assert.equal(decideAfterVerifyMiss({ ...idle, attempts: TIMINGS.MAX_DELIVERY_ATTEMPTS }).do, 'wait');
  assert.equal(decideAfterVerifyMiss({ ...idle, attempts: 99 }).do, 'wait');
});

test('REGRESSION — the captured live request must not produce another delivery', () => {
  /* The live request file, read from the inbox at 20:42 on 2026-08-12:
       { action: 'send', name: '<coordinator>', prompt: '<a slash command>',
         releases: 2, _claim: { surface: 'app', pid: <alive>, at: <212s earlier> } }
     releases was at MAX_RELEASES, the claimer was ALIVE, and the target was busy. This exact
     state must yield WAIT. The old code yielded 'release' → re-claim → re-type. */
  const captured = { targetAlive: true, targetBusy: true, heldMs: 212_000, attempts: 1 };
  const d = decideAfterVerifyMiss(captured);
  assert.equal(d.do, 'wait', `the captured state must wait, got '${d.do}': ${d.reason}`);
  // and once it goes idle without the turn appearing, retrying is legitimate — bounded
  assert.equal(decideAfterVerifyMiss({ ...captured, targetBusy: false }).do, 'retry');
});

test('only a dead target or a spent hold budget retires a request', () => {
  const dead = decideAfterVerifyMiss({ targetAlive: false, targetBusy: false, heldMs: 0, attempts: 0 });
  assert.equal(dead.do, 'retire');
  assert.match(dead.reason, /no longer a live session/);
  const timedOut = decideAfterVerifyMiss({ targetAlive: true, targetBusy: false, heldMs: TIMINGS.MAX_HOLD_MS, attempts: 9 });
  assert.equal(timedOut.do, 'retire');
  assert.match(timedOut.reason, /held for \d+ min/);
  // one millisecond short of the budget is still not a failure
  assert.notEqual(decideAfterVerifyMiss({ targetAlive: true, targetBusy: false, heldMs: TIMINGS.MAX_HOLD_MS - 1, attempts: 9 }).do, 'retire');
});

test('a dead target beats every other consideration', () => {
  // Ordering matters: no amount of remaining budget makes a vanished session deliverable.
  assert.equal(decideAfterVerifyMiss({ targetAlive: false, targetBusy: true, heldMs: 0, attempts: 0 }).do, 'retire');
});

/* ── THE BEHAVIOURAL CONTRACT — the guard the TIMINGS hash cannot provide ─────
   TIMINGS is hashed because it is a data literal, identical in both repos. The FUNCTIONS around
   it cannot be: the two surfaces' lint regimes disagree about braces on single-statement bodies,
   so hashing `decideAfterVerifyMiss`'s source would fail forever and teach everyone to ignore the
   one test that guards cross-process behaviour — the failure mode of every check in this ticket.

   What CAN be identical is the DECISION TABLE. Same inputs, same action, on both surfaces. The
   table below is byte-identical across repos and hashed like TIMINGS, so changing the protocol on
   one surface without the other goes red — which is exactly how the two implementations silently
   diverged by 248 lines in the first place.

   WHEN THIS FAILS: you changed the decision. That is allowed — it is a PROTOCOL change. Make the
   identical edit in the sibling repo, recompute, update BEHAVIOUR_SHA in BOTH, and say so in the
   inbox README, in one push. */
const DECISION_VECTORS: ReadonlyArray<{ why: string; alive: boolean; busy: boolean; heldMin: number; attempts: number; cap?: number; want: MissAction }> = [
  { why: 'dead target, everything else fresh',      alive: false, busy: false, heldMin: 0,  attempts: 0, want: 'retire' },
  { why: 'dead target beats a busy reading',         alive: false, busy: true,  heldMin: 0,  attempts: 0, want: 'retire' },
  { why: 'hold budget spent',                       alive: true,  busy: false, heldMin: 30, attempts: 0, want: 'retire' },
  { why: 'busy mid-turn: silence is not failure',    alive: true,  busy: true,  heldMin: 1,  attempts: 0, want: 'wait'   },
  { why: 'busy stays waiting even out of sends',     alive: true,  busy: true,  heldMin: 1,  attempts: 9, want: 'wait'   },
  { why: 'idle with sends left: deliver again',      alive: true,  busy: false, heldMin: 1,  attempts: 0, want: 'retry'  },
  { why: 'idle, last send available',                alive: true,  busy: false, heldMin: 1,  attempts: 2, want: 'retry'  },
  { why: 'sends capped, time left: watch, never type', alive: true, busy: false, heldMin: 1, attempts: 3, want: 'wait'   },
  { why: 'the 2026-08-12 captured state',            alive: true,  busy: true,  heldMin: 3,  attempts: 1, want: 'wait'   },
  // A slash command is typed ONCE (cap 1) and then only watched — measured 2026-08-14, /help was
  // delivered three times because it writes no transcript record, so a miss was read as a failed
  // send. Waiting still catches a command that verifies late; re-typing catches neither.
  { why: 'slash command, first miss: never re-type', alive: true,  busy: false, heldMin: 1,  attempts: 1, cap: 1, want: 'wait'   },
  { why: 'slash command, cap not yet reached',       alive: true,  busy: false, heldMin: 1,  attempts: 0, cap: 1, want: 'retry'  },
  { why: 'a dead target still beats the cap',        alive: false, busy: false, heldMin: 1,  attempts: 0, cap: 1, want: 'retire' },
];
const BEHAVIOUR_SHA = 'e39f627771a97d53';

test('PROTOCOL: the decision table is byte-identical across both fulfillers', () => {
  const src = fs.readFileSync('src/test/protocolContract.test.ts', 'utf8');
  const m = /const DECISION_VECTORS: ReadonlyArray<\{[\s\S]*?\n\];/.exec(src);
  assert.ok(m, 'the decision table must exist in this surface — it is the contract');
  const sha = crypto.createHash('sha256').update(m[0]).digest('hex').slice(0, 16);
  assert.equal(sha, BEHAVIOUR_SHA,
    'The decision table changed. This is a PROTOCOL change: make the same edit in the sibling repo, update BEHAVIOUR_SHA in BOTH, and update the inbox README — in one push.');
});

test('PROTOCOL: every vector produces the agreed action on this surface', () => {
  for (const v of DECISION_VECTORS) {
    const got = decideAfterVerifyMiss({
      targetAlive: v.alive, targetBusy: v.busy, heldMs: v.heldMin * 60_000, attempts: v.attempts,
      maxAttempts: v.cap,
    });
    assert.equal(got.do, v.want, `${v.why}: expected '${v.want}', got '${got.do}' (${got.reason})`);
  }
});

test('a slash command is typed ONCE — the /help triple-delivery, as a unit test', () => {
  /* Measured live 2026-08-14 in an Extension Development Host: `/help` was delivered, the operator
     watched the help menu appear, and the transcript held 37 records / 3 user records / ZERO
     containing the needle — the CLI handles it client-side and writes nothing. Verification
     therefore failed for a delivery that had plainly succeeded, and the command was typed THREE
     times before MAX_DELIVERY_ATTEMPTS stopped it.
     Retry only pays when a miss is EVIDENCE of a failed send. For a slash command it is not, so
     attempts 2 and 3 were pure cost — a visible duplicate for the operator, no information for us. */
  assert.equal(maxAttemptsFor('/help'), 1, 'a slash command gets one attempt');
  assert.equal(maxAttemptsFor('/aios:today'), 1);
  assert.equal(maxAttemptsFor('  /config'), 1, 'leading whitespace does not change the shape');
  assert.equal(maxAttemptsFor('respond with: bus ok'), TIMINGS.MAX_DELIVERY_ATTEMPTS, 'plain text keeps the protocol default');
  assert.equal(maxAttemptsFor('hello /help'), TIMINGS.MAX_DELIVERY_ATTEMPTS, 'a command mid-sentence is not a command');

  // and the decision agrees with the gate, which is the whole reason the cap is passed in
  const miss = { targetAlive: true, targetBusy: false, heldMs: 60_000 };
  assert.equal(decideAfterVerifyMiss({ ...miss, attempts: 1, maxAttempts: maxAttemptsFor('/help') }).do, 'wait',
    'after one attempt a slash command must WAIT, never re-type');
  assert.equal(decideAfterVerifyMiss({ ...miss, attempts: 1, maxAttempts: maxAttemptsFor('plain text') }).do, 'retry',
    'plain text still retries — it produces a verifiable turn, so a miss IS evidence');
  // it still waits out the hold budget rather than giving up: /config DOES write a record and may
  // verify late, while /help never will. Waiting covers both; re-typing covers neither.
  assert.notEqual(decideAfterVerifyMiss({ ...miss, attempts: 1, maxAttempts: 1 }).do, 'retire');
});

test('DELIBERATE EDGE CASE: a path-shaped prompt is treated as a command', () => {
  /* Documented rather than out-smarted. Consequence: if such a message were genuinely dropped it
     dead-letters LOUDLY instead of retrying — the safe direction. A path-vs-command heuristic
     would be wrong in subtler ways than this is. */
  assert.equal(maxAttemptsFor('/Users/someone/notes/file.md please read this'), 1);
});

test('the delivery cap gates the SEND, not just the log line', () => {
  /* Parity with the App's guard, added 2026-08-14 — Glass had the same fix in its code (the
     comment above its gate says so) and no test holding it there. A 'wait' verdict does
     `continue`, which re-enters the delivery branch, so a cap enforced only in the after-a-miss
     decision caps NOTHING: the loop keeps re-typing for the whole hold budget.
     Pinned to the ORDER of gate-then-counter, not to the cap expression, so a legitimate change
     to how the cap is computed does not turn this red. */
  const src = fs.readFileSync('src/extension.ts', 'utf8');
  const gate = src.search(/attempts >= (maxAttemptsFor\(|TIMINGS\.MAX_DELIVERY_ATTEMPTS)/);
  assert.ok(gate > 0, 'the cap must be checked BEFORE delivering, whatever the cap expression is');
  const bump = src.indexOf('attempts++', gate);
  assert.ok(bump > gate, 'the guard must precede the attempt counter, or it runs too late');
  assert.match(src, /maxAttemptsFor\(/, 'the send gate must use the per-text cap');
});
