/**
 * AI-223 — a send is verified from what its target's transcript gained SINCE the send began, never by
 * reading the whole file. Measured on the App: a 554 MB transcript made the whole-file read throw
 * (V8's ~512 MB string limit), the throw read as "zero deliveries", and an idle target got the
 * message three times. Glass's send path read the transcript the same way.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { TranscriptSince } from '../bus/transcriptSince';

const tx = (): string => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tsince-')), 's.jsonl');

test('only what was appended after the first look is read', () => {
  const f = tx();
  fs.writeFileSync(f, '{"old":1}\n'.repeat(1000));
  const since = new TranscriptSince();
  assert.equal(since.read(f), '', 'the first look records the size and returns nothing old');
  fs.appendFileSync(f, '{"new":1}\n');
  assert.equal(since.read(f), '{"new":1}\n', 'exactly the appended line');
  fs.appendFileSync(f, '{"new":2}\n');
  assert.equal(since.read(f), '{"new":1}\n{"new":2}\n', 'every look reads from the same start, so a line cut mid-write is whole next time');
});

test('no transcript yet is "" (nothing to count), not "unreadable"', () => {
  assert.equal(new TranscriptSince().read(tx()), '');
  assert.equal(new TranscriptSince().read(undefined), '');
});

test('a transcript that cannot be read is null — "cannot verify" — never ""', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, () => {
  const f = tx();
  fs.writeFileSync(f, '{"a":1}\n');
  const since = new TranscriptSince();
  since.read(f);
  fs.appendFileSync(f, '{"b":1}\n');
  fs.chmodSync(f, 0o000);
  try { assert.equal(since.read(f), null); } finally { fs.chmodSync(f, 0o600); }
});

/** The deliverSend body, so the assertions below cannot be satisfied by code elsewhere in the file. */
function sendPath(): string {
  const src = fs.readFileSync('src/extension.ts', 'utf8');
  const a = src.indexOf('const deliverSend = async');
  const b = src.indexOf('const MY_SURFACE', a);
  assert.ok(a > 0 && b > a, 'deliverSend must exist');
  return src.slice(a, b);
}

test('the send path never reads the whole transcript, never re-types on "cannot verify", and checks the request before typing', () => {
  const send = sendPath();
  assert.doesNotMatch(send, /readFileSync\(tx/, 'sends count only what was appended');
  assert.doesNotMatch(send, /countDeliveries\(fs\./, 'no count site reads a file itself');
  assert.match(send, /const now = count\(tx, needle\);\s*if \(now === null\) return finishUnverifiable\(\);/,
    'the verify poll exits on null without typing again');
  assert.match(send, /return 'unverified';/);
  const typeAt = send.indexOf('await sendToSession(name, text, decision.pid)');
  const guard = send.lastIndexOf('if (heldPath && !fs.existsSync(heldPath))', typeAt);
  assert.ok(guard > 0 && typeAt - guard < 400, 'the request file is checked right before every type');
});

test('an unverified send is finished (request removed), and a vanished one is never dead-lettered', () => {
  const src = fs.readFileSync('src/extension.ts', 'utf8');
  const finished = src.match(/if \(outcome === 'verified' \|\| outcome === 'unverified'\) \{ releaseRequest\(held, false\); \}/g) || [];
  assert.equal(finished.length, 2, 'both send call sites (send, resume-to-live) finish an unverified send');
  const gone = src.match(/else if \(outcome === 'gone'\)/g) || [];
  assert.equal(gone.length, 2, "'gone' must not fall through to releaseRequest(…, true), which would re-create the file");
});
