/**
 * #78 twin — a reused pid must not make a closed session look live. A registry entry that records
 * `procStart` counts only when the process now holding its pid started at that time (±2 s).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseLstartUtc, parseFiletime, recordedStart, sameProcessStart, processStartMs, PROC_START_TOLERANCE_MS } from '../agents/procStart';

const REAL = 'Wed Oct 28 01:33:15 2026';   // the format read from a real registry file (Claude Code 2.1.312, macOS)

test('the recorded format parses as UTC', () => {
  assert.equal(parseLstartUtc(REAL), Date.UTC(2026, 9, 28, 1, 33, 15));
  assert.equal(parseLstartUtc('Thu Oct  2 07:36:48 2026'), Date.UTC(2026, 9, 2, 7, 36, 48), 'ps pads a one-digit day');
  assert.equal(parseLstartUtc('yesterday'), undefined);
  assert.equal(parseLstartUtc(undefined), undefined);
  assert.equal(parseFiletime('133000000000000000'), Number(133000000000000000n / 10000n) - 11644473600000);
  assert.equal(parseFiletime('not a number'), undefined);
  assert.equal(parseFiletime('390000000000000000'), undefined, 'outside FILETIME range: unknown encoding, never guessed');
});

test('a REUSED pid (start time differs) is not live', () => {
  const recorded = recordedStart({ procStart: REAL });
  assert.equal(sameProcessStart(recorded, Date.UTC(2026, 9, 28, 3, 0, 0)), false);
  assert.equal(sameProcessStart(recorded, (recorded as number) + PROC_START_TOLERANCE_MS + 1000), false);
});

test('the same process (start time within ±2 s) is live', () => {
  const recorded = recordedStart({ procStart: REAL }) as number;
  assert.equal(sameProcessStart(recorded, recorded), true);
  assert.equal(sameProcessStart(recorded, recorded + 999), true, 'second precision: a sub-second difference matches');
  assert.equal(sameProcessStart(recorded, recorded - 2000), true);
});

test('absent or unreadable procStart, or an unreadable start time, keeps the old behaviour (live)', () => {
  assert.equal(recordedStart({}), undefined);
  assert.equal(recordedStart({ procStart: 42 }), undefined);
  assert.equal(sameProcessStart(undefined, Date.now()), true);
  assert.equal(sameProcessStart(recordedStart({ procStart: REAL }), undefined), true);
});

test('this process\'s own start time reads back within the tolerance', { skip: process.platform === 'win32' }, async () => {
  const actual = await processStartMs(process.pid);
  if (actual === undefined) return;   // ps unavailable (a sandbox): nothing to compare, by design
  const expected = Date.now() - process.uptime() * 1000;
  assert.ok(Math.abs(actual - expected) < 3000, `ps start ${actual} vs uptime-derived ${expected}`);
});

test('listRunningAgents drops an entry whose procStart does not match the live pid, keeps one without it', { skip: process.platform === 'win32' }, async () => {
  if (await processStartMs(process.pid) === undefined) return;   // cannot read start times here
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'procstart-'));
  const dir = path.join(home, '.claude', 'sessions');
  fs.mkdirSync(dir, { recursive: true });
  const write = (body: object) => fs.writeFileSync(path.join(dir, `${process.pid}.json`), JSON.stringify({ pid: process.pid, name: 'heron', ...body }));
  const prev = process.env.HOME;
  process.env.HOME = home;
  try {
    const { listRunningAgents } = await import('../agents/running');
    write({ procStart: 'Mon Jan  1 00:00:00 2001' });
    assert.equal((await listRunningAgents()).length, 0, 'a pid now held by a process started at another time is a closed session');
    write({});
    assert.equal((await listRunningAgents()).length, 1, 'no procStart → signal 0 decides, as before');
  } finally { process.env.HOME = prev; }
});
