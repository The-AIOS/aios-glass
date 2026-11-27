/* Glass resolves Claude Code's folder in one place and honours CLAUDE_CONFIG_DIR everywhere
   (The-AIOS/aios-app#226: the registry was read from ~/.claude while the resume index followed the variable). */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { claudeConfigDir, claudeJsonPath } from '../agents/claudeDir';
import { listRunningAgents } from '../agents/running';

function withConfigDir<T>(dir: string | undefined, run: () => T): T {
  const prev = process.env.CLAUDE_CONFIG_DIR;
  if (dir === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = dir;
  const restore = () => { if (prev === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = prev; };
  let out: T;
  try { out = run(); } catch (e) { restore(); throw e; }
  if (out instanceof Promise) return out.finally(restore) as unknown as T;
  restore();
  return out;
}

test('the folder follows CLAUDE_CONFIG_DIR, and is ~/.claude without it; .claude.json moves inside it', () => {
  withConfigDir(undefined, () => {
    assert.equal(claudeConfigDir(), path.join(os.homedir(), '.claude'));
    assert.equal(claudeJsonPath(), path.join(os.homedir(), '.claude.json'));
  });
  withConfigDir('/somewhere/else', () => {
    assert.equal(claudeConfigDir(), '/somewhere/else');
    assert.equal(claudeJsonPath(), path.join('/somewhere/else', '.claude.json'));
  });
});

test('the session registry is read from $CLAUDE_CONFIG_DIR/sessions', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glass-config-dir-'));
  const name = `config-dir-probe-${process.pid}`;
  try {
    fs.mkdirSync(path.join(dir, 'sessions'));
    // this test's own pid: alive, and with no recorded start the entry is kept as is
    fs.writeFileSync(path.join(dir, 'sessions', `${process.pid}.json`), JSON.stringify({ pid: process.pid, name, status: 'idle', sessionId: 's-1' }));
    const seen = await withConfigDir(dir, () => listRunningAgents());
    assert.deepEqual(seen.map((a) => a.name), [name], 'the session registered under the variable is the one listed');
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'glass-config-dir-empty-'));
    try {
      assert.deepEqual(await withConfigDir(empty, () => listRunningAgents()), [], 'control: a folder with no registry lists nothing');
    } finally { fs.rmSync(empty, { recursive: true, force: true }); }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('no other module builds the path to ~/.claude or reads CLAUDE_CONFIG_DIR itself', () => {
  const SRC = path.join(__dirname, '..', '..', 'src');
  const own = path.join('agents', 'claudeDir.ts');
  const offenders: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      const rel = path.relative(SRC, p);
      // core/ is shared with the App and replaced by the package; test/ is this file and its peers
      if (e.isDirectory()) { if (rel !== 'core' && rel !== 'test') walk(p); continue; }
      if (!e.name.endsWith('.ts') || rel === own) continue;
      fs.readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
        if (/homedir\(\),\s*'\.claude(\.json)?'/.test(line) || /process\.env\.CLAUDE_CONFIG_DIR/.test(line)) offenders.push(`${rel}:${i + 1}`);
      });
    }
  };
  walk(SRC);
  assert.deepEqual(offenders, []);
});
