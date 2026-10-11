/**
 * AI-205 — the queue rules, run against one fixture both surfaces carry (and canonical can adopt
 * beside inbox-contract-4.conformance.json): a busy target is waited on until its next idle, in
 * order, a newer message from the same sender supersedes an older one, and a late one is aged.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { decideSend, queueTurn, stampAge, TIMINGS, type QueuedSend } from '../core/sendQueue';

const FIX = path.join(__dirname, '..', '..', 'src', 'test', 'fixtures', 'inbox-queue.conformance.json');
const fx = JSON.parse(fs.readFileSync(FIX, 'utf8')) as { cases: Record<string, unknown>[] };

for (const c of fx.cases) {
  test(`queue conformance: ${String(c.case)}`, () => {
    if (c.decideSend) {
      const d = c.decideSend as { target: { name: string; status: string; pid: number } | null; heldMs: number };
      assert.equal(decideSend(d.target ? { ...d.target, sessionId: 's' } : undefined, d.heldMs, TIMINGS.QUEUE_CEILING_MS).do, c.expect);
    } else if (c.queue) {
      const q = c.queue as { me: QueuedSend; held: QueuedSend[] };
      assert.deepEqual(queueTurn(q.me, q.held), c.expect);
    } else if (c.stamp) {
      const s = c.stamp as { text: string; waitedMs: number; from?: string };
      assert.equal(stampAge(s.text, s.waitedMs, s.from), c.expect);
    } else assert.fail('unknown case shape');
  });
}

test('the old 30-min hold no longer decides a send to a live busy session', () => {
  assert.equal(decideSend({ name: 'w', status: 'busy', pid: 1, sessionId: 's' }, 31 * 60 * 1000, TIMINGS.QUEUE_CEILING_MS).do, 'hold');
});
