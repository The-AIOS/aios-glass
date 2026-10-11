/** Freshness — synced / BEHIND / TESTING, matching canonical's freshness-probe.sh. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLsRemote, freshness } from '../core/freshness';

const LS = [
  'ref: refs/heads/main\tHEAD',
  'aaaaaaa1111111111111111111111111111111aa\tHEAD',
  'aaaaaaa1111111111111111111111111111111aa\trefs/heads/main',
  'bbbbbbb2222222222222222222222222222222bb\trefs/heads/release/2026-10-11',
  'ccccccc3333333333333333333333333333333cc\trefs/tags/v0.8.8',
].join('\n');
const R = parseLsRemote(LS);

test('the remote is read: default branch, its tip, and every branch head', () => {
  assert.equal(R.defaultBranch, 'main');
  assert.equal(R.defaultSha?.slice(0, 7), 'aaaaaaa');
  assert.equal(R.heads.get('release/2026-10-11')?.slice(0, 7), 'bbbbbbb');
  assert.equal(R.heads.has('v0.8.8'), false, 'tags are not branches');
});

test('synced · BEHIND · TESTING by ref · TESTING by hash · unknown', () => {
  assert.deepEqual(freshness({ hash: 'aaaaaaa' }, R), { state: 'up-to-date' });
  assert.deepEqual(freshness({ hash: 'ddddddd' }, R), { state: 'available' }, 'behind main');
  assert.deepEqual(freshness({ hash: 'ddddddd', ref: 'release/2026-10-11' }, R), { state: 'testing', branch: 'release/2026-10-11' }, 'a ref= wins, whatever the hash');
  assert.deepEqual(freshness({ hash: 'bbbbbbb' }, R), { state: 'testing', branch: 'release/2026-10-11' }, "Chuy's vault today: hash is that branch's tip");
  assert.deepEqual(freshness({ hash: 'aaaaaaa', ref: 'main' }, R), { state: 'up-to-date' }, 'ref= naming the default branch is just synced');
  assert.deepEqual(freshness({ hash: 'initial' }, R), { state: 'unknown' });
  assert.deepEqual(freshness({ hash: 'aaaaaaa' }, parseLsRemote('')), { state: 'unknown' }, 'no answer from the remote');
});

test('Glass shows TESTING and a click can never run /aios:update for it', () => {
  const fs = require('node:fs') as typeof import('node:fs');
  const path = require('node:path') as typeof import('node:path');
  const ROOT = path.join(__dirname, '..', '..');
  const js = fs.readFileSync(path.join(ROOT, 'media', 'home.js'), 'utf8');
  const spaces = fs.readFileSync(path.join(ROOT, 'src', 'spaces', 'spaces.ts'), 'utf8');
  assert.match(spaces, /execFile\('git', \['ls-remote', '--symref', status\.repo\]/);
  assert.match(js, /else if \(msg\.state === 'testing'\)\{ b\.className = 'status testing';/, 'never the clickable "upd" class');
  assert.match(js, /if \(document\.getElementById\('updBadge'\)\.classList\.contains\('upd'\)\) run\('aios\.updateFramework'\);/, 'the update runs only from the upd class');
});
