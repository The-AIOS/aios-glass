import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decideSend, safeNeedle, isBusy, holdPathFor, undeliveredPathFor, isHoldPath,
  HOLD_SUFFIX, UNDELIVERED_SUFFIX, type SendTarget,
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
