/* A kill addressed to the name a session had before it was renamed reaches it, as in the App
   (app#65). The registry keeps earlier names in `formerNames`. */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { busTargetName } from '../bus/busTarget';
import { listRunningAgents, formerNamesOf } from '../agents/running';

const live = [{ name: 'ingest-notes', formerNames: ['ingest'] }, { name: 'writer' }];

test('the current name always wins, case-insensitively', () => {
  assert.equal(busTargetName('kill', 'Writer', live), 'writer');
  assert.equal(busTargetName('send', 'writer', live), 'writer');
});

test('a kill to the old name of a renamed session reaches it', () => {
  assert.equal(busTargetName('kill', 'ingest', live), 'ingest-notes');
});

test('only a kill falls back to an old name, as in the App: send and resume keep the name as written', () => {
  assert.equal(busTargetName('send', 'ingest', live), 'ingest');
  assert.equal(busTargetName('resume', 'ingest', live), 'ingest');
});

test('an old name two live sessions once carried reaches neither', () => {
  const two = [{ name: 'a', formerNames: ['old'] }, { name: 'b', formerNames: ['old'] }];
  assert.equal(busTargetName('kill', 'old', two), 'old');
});

test('formerNames reads strings or { name } objects, and ignores anything else', () => {
  assert.deepEqual(formerNamesOf(['a', { name: ' b ' }, 3, null, { x: 1 }, '']), ['a', 'b']);
  assert.deepEqual(formerNamesOf('a'), []);
});

test('the registry reader carries formerNames', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'glass-former-'));
  const prev = process.env.HOME;
  try {
    fs.mkdirSync(path.join(home, '.claude', 'sessions'), { recursive: true });
    fs.writeFileSync(path.join(home, '.claude', 'sessions', `${process.pid}.json`),
      JSON.stringify({ pid: process.pid, name: 'renamed-now', formerNames: ['before', { name: 'earlier' }], sessionId: 's' }));
    process.env.HOME = home;
    const seen = await listRunningAgents();
    assert.deepEqual(seen.map((a) => [a.name, a.formerNames]), [['renamed-now', ['before', 'earlier']]]);
  } finally {
    if (prev === undefined) delete process.env.HOME; else process.env.HOME = prev;
    fs.rmSync(home, { recursive: true, force: true });
  }
});
