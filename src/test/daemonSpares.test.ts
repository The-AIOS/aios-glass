/**
 * AI-165 — Claude Code's daemon spares (`kind: "bg"`, no name) must not appear as operator
 * sessions; a terminal session beside them still does. Same rule and same test shape as aios-app.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { listOperatorSessions, listRunningAgents } from '../agents/running';

async function withRegistry(entries: object[], fn: () => Promise<void>) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'glass-home-'));
  const dir = path.join(home, '.claude', 'sessions');
  fs.mkdirSync(dir, { recursive: true });
  entries.forEach((e, i) => fs.writeFileSync(path.join(dir, `${i + 1}.json`), JSON.stringify(e)));
  const saved = process.env.HOME;
  process.env.HOME = home;
  try { await fn(); } finally { process.env.HOME = saved; fs.rmSync(home, { recursive: true, force: true }); }
}
const LIVE = [process.pid, process.ppid];

test('a daemon spare is hidden; the terminal session beside it shows; the full list keeps both', async () => {
  await withRegistry([
    { pid: LIVE[0], sessionId: 's-1', name: 'buddai', kind: 'interactive', status: 'idle' },
    { pid: LIVE[1], sessionId: '7a6c1978-spare', kind: 'bg', status: 'idle' },
  ], async () => {
    assert.deepEqual((await listOperatorSessions()).map((a) => a.name), ['buddai']);
    assert.equal((await listRunningAgents()).length, 2, 'name lookups for send/kill still see background agents');
  });
});

test('a headless SDK run (plugin review, `claude -p`) is hidden too', async () => {
  await withRegistry([
    { pid: LIVE[0], sessionId: 's-1', name: 'buddai', kind: 'interactive', entrypoint: 'cli', status: 'idle' },
    { pid: LIVE[1], sessionId: '1dc5e420', name: 'aios-app-5e', kind: 'interactive', entrypoint: 'sdk-py', status: 'busy' },
  ], async () => {
    assert.deepEqual((await listOperatorSessions()).map((a) => a.name), ['buddai']);
  });
});

test('no kind (an older Claude Code) counts as a terminal session', async () => {
  await withRegistry([{ pid: LIVE[0], sessionId: 's-old', name: 'legacy', status: 'busy' }], async () => {
    assert.deepEqual((await listOperatorSessions()).map((a) => a.name), ['legacy']);
  });
});

test('every surface that shows or broadcasts sessions uses the operator list', () => {
  const read = (f: string) => fs.readFileSync(path.join(__dirname, '..', '..', 'src', f), 'utf8');
  assert.match(read('agents/attentionBar.ts'), /await listOperatorSessions\(\)/, 'attention bar / notifications');
  assert.match(read('tasks/closeAll.ts'), /agents = await listOperatorSessions\(\)/, 'Close all never targets a spare (the daemon would just start another)');
  assert.match(read('home/homePanel.ts'), /const running = await listOperatorSessions\(\)/, 'home panel');
  const ext = read('extension.ts');
  assert.equal((ext.match(/await listOperatorSessions\(\)/g) || []).length, 3, 'tree view, palette, manage sessions');
});
