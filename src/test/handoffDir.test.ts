/**
 * aios#231, scoped — a handed-over file sits ALONE in a private folder, so `--add-dir <that folder>`
 * grants the worker its own file and nothing else: not other sessions' tasks, not report
 * snapshots, not run/setup scripts the App executes (and on Windows, not the whole temp folder).
 */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aios-handoff-home-')));

test('each file gets a fresh private folder holding only it', { skip: process.platform === 'win32' }, async () => {
  const realHome = process.env.HOME;
  process.env.HOME = home;   // os.homedir() reads HOME on POSIX
  try {
    const { writeHandoffFile } = await import('../bus/handoffDir');
    const a = writeHandoffFile('aios-task-a.md', 'A');
    const b = writeHandoffFile('aios-task-a.md', 'B');
    assert.notEqual(path.dirname(a), path.dirname(b), 'two handoffs never share a folder, even with one name');
    for (const f of [a, b]) {
      const dir = path.dirname(f);
      assert.equal(path.dirname(dir), path.join(home, '.aios', 'run'), 'under the private run dir');
      assert.match(path.basename(dir), /^handoff-[0-9a-f]{16}$/);
      assert.deepEqual(fs.readdirSync(dir), ['aios-task-a.md'], 'the folder holds the one file');
      assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
    }
    assert.equal(fs.readFileSync(b, 'utf8'), 'B');
  } finally { process.env.HOME = realHome; }
});

test('the sweep removes old handoff folders and nothing else', async () => {
  const { sweepHandoffDirs } = await import('../bus/handoffDir');
  const run = path.join(home, '.aios', 'run');
  fs.mkdirSync(path.join(run, 'setup'), { recursive: true });
  const old = path.join(run, 'handoff-0123456789abcdef');
  const fresh = path.join(run, 'handoff-fedcba9876543210');
  const lookalike = path.join(run, 'handoff-notours');
  for (const d of [old, fresh, lookalike]) fs.mkdirSync(d, { recursive: true });
  const past = new Date(Date.now() - 3 * 24 * 3600 * 1000);
  for (const d of [old, lookalike, path.join(run, 'setup')]) fs.utimesSync(d, past, past);
  assert.equal(sweepHandoffDirs(24 * 3600 * 1000, { home, platform: 'darwin' }), 1);
  assert.ok(!fs.existsSync(old), 'an old handoff folder goes');
  assert.ok(fs.existsSync(fresh), 'a recent one stays: its worker may not have read it yet');
  assert.ok(fs.existsSync(lookalike), 'a name that is not ours stays');
  assert.ok(fs.existsSync(path.join(run, 'setup')), 'run/setup is never touched');
});

test('every Glass handoff goes through its own folder — none writes into the run dir itself', () => {
  assert.doesNotMatch(fs.readFileSync('src/rituals/runner.ts', 'utf8'), /writePrivateFile\(runDir\(\)/,
    'a file in the run dir root would make --add-dir grant all of it');
});
