import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decideSend, safeNeedle, isBusy, holdPathFor, undeliveredPathFor, isHoldPath,
  HOLD_SUFFIX, UNDELIVERED_SUFFIX, type SendTarget,
  claimVerdict, canAdoptHold, parseClaim, shouldReleaseForSibling, shouldWriteDoc,
} from '../core/sendQueue';

const target = (status: string): SendTarget => ({ name: 'designer', pid: 42, status, sessionId: 'abc' });
const MAX = 30 * 60 * 1000;

test('an idle target is delivered to', () => {
  assert.deepEqual(decideSend(target('idle'), 0, MAX), { do: 'deliver', pid: 42 });
});

test('a busy target is HELD, never delivered to', () => {
  const d = decideSend(target('busy'), 0, MAX);
  assert.equal(d.do, 'hold');
});

test('a busy target is STILL not delivered to when the hold budget runs out', () => {
  // The regression this whole module exists for: 0.4.6 "delivered anyway" on timeout,
  // which is the guaranteed-drop path the status gate was built to prevent.
  const d = decideSend(target('busy'), MAX + 1, MAX);
  assert.equal(d.do, 'undeliverable');
  assert.match(d.reason, /busy/);
  assert.notEqual(d.do, 'deliver');
});

test('an unknown name is undeliverable immediately, not held forever', () => {
  const d = decideSend(undefined, 0, MAX);
  assert.equal(d.do, 'undeliverable');
  assert.match(d.reason, /registry/);
});

test('status matching is case- and whitespace-insensitive, and empty is not busy', () => {
  assert.equal(isBusy('BUSY'), true);
  assert.equal(isBusy(' busy '), true);
  assert.equal(isBusy(''), false);       // unknown status → deliverable, not stuck
  assert.equal(isBusy(undefined), false);
  assert.equal(decideSend(target(''), 0, MAX).do, 'deliver');
});

test('claim + abandon paths never match the watcher glob (no re-pickup loop)', () => {
  const req = '/i/spawn-inbox/msg.json';
  const hold = holdPathFor(req);
  const dead = undeliveredPathFor(hold);
  for (const p of [hold, dead]) {
    assert.equal(p.endsWith('.json'), false, `${p} would be re-picked-up as a new request`);
  }
  assert.equal(hold, `${req}${HOLD_SUFFIX}`);
  assert.equal(isHoldPath(hold), true);
  assert.equal(isHoldPath(req), false);
  // abandoning a claimed file must not stack suffixes
  assert.equal(dead, `${req}${UNDELIVERED_SUFFIX}`);
  assert.equal(undeliveredPathFor(req), `${req}${UNDELIVERED_SUFFIX}`);
});

test('the verification needle survives JSON escaping', () => {
  const withQuotes = 'fleet-heron here — I ran your "shouldWrite" against the real doc';
  const needle = safeNeedle(withQuotes);
  assert.equal(needle.includes('"'), false);
  assert.equal(needle.includes('\\'), false);
  assert.ok(needle.length >= 24);
  // and it must actually be findable in a JSON-encoded transcript line
  assert.ok(JSON.stringify({ text: withQuotes }).includes(needle));
});

test('the needle degrades gracefully on short or hostile text', () => {
  assert.equal(safeNeedle('hi').length > 0, true);
  assert.ok(safeNeedle('"""\\\\"""').length > 0);
});

/* ── contract 2: the multi-fulfiller protocol ───────────────────────────────── */

const TTL = 10 * 60 * 1000;

test('an unaddressed request is claimable by anyone (contract-1 behaviour preserved)', () => {
  assert.equal(claimVerdict(undefined, 'glass', 0, TTL), 'claim');
  assert.equal(claimVerdict(undefined, 'app', 0, TTL), 'claim');
  assert.equal(claimVerdict('nonsense', 'glass', 0, TTL), 'claim'); // unknown value → not a target
});

test('a request addressed to me is mine; addressed elsewhere I leave it ALONE', () => {
  assert.equal(claimVerdict('glass', 'glass', 0, TTL), 'claim');
  assert.equal(claimVerdict('app', 'glass', 0, TTL), 'skip');   // the App may still be starting
  assert.equal(claimVerdict('glass', 'app', 0, TTL), 'skip');
});

test('a request whose addressee never showed up is RETIRED, never silently rotted', () => {
  assert.equal(claimVerdict('app', 'glass', TTL + 1, TTL), 'retire');
  // …but retiring is not fulfilling: the addressee's own requests stay claimable by it
  assert.equal(claimVerdict('app', 'app', TTL + 1, TTL), 'claim');
});

test('a hold belonging to a LIVE other process is never stolen', () => {
  const fresh = { surface: 'app' as const, pid: 999, at: 1_000_000 };
  assert.equal(canAdoptHold(fresh, 1_000_100, 60_000, true), false); // live + fresh → hands off
  assert.equal(canAdoptHold(fresh, 1_000_100, 60_000, false), true); // holder died → resume
  assert.equal(canAdoptHold(fresh, 9_000_000, 60_000, true), true);  // live but stale → resume
  assert.equal(canAdoptHold(undefined, 1, 60_000, true), true);      // unstamped legacy → adoptable
});

test('claim stamps round-trip and reject malformed input', () => {
  const c = { surface: 'glass', pid: 42, at: 123 };
  assert.deepEqual(parseClaim(c), { surface: 'glass', pid: 42, at: 123 });
  for (const bad of [undefined, null, 'x', {}, { surface: 'nope', pid: 1, at: 1 }, { surface: 'glass', pid: '1', at: 1 }]) {
    assert.equal(parseClaim(bad), undefined);
  }
});

test('a claim is released for a sibling window, but not forever', () => {
  assert.equal(shouldReleaseForSibling(0, 2), true);
  assert.equal(shouldReleaseForSibling(1, 2), true);
  assert.equal(shouldReleaseForSibling(2, 2), false);   // stop; declare it undeliverable
});

test('the doc is never DOWNGRADED by an older fulfiller', () => {
  const ours = 'ours\n<!-- aios-spawn-inbox: contract 2 · written by AIOS Glass v0.5.0 -->';
  assert.equal(shouldWriteDoc(undefined, 2, ours), true);
  assert.equal(shouldWriteDoc('', 2, ours), true);
  assert.equal(shouldWriteDoc(ours, 2, ours), false);                       // identical → no churn
  assert.equal(shouldWriteDoc('old\n<!-- aios-spawn-inbox: contract 1 -->', 2, ours), true);
  assert.equal(shouldWriteDoc('new\n<!-- aios-spawn-inbox: contract 3 -->', 2, ours), false); // never stomp newer
  assert.equal(shouldWriteDoc('hand-written, unstamped', 2, ours), true);
});
