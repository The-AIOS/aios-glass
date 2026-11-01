/**
 * Review, 0.5.14: the account list and the swap ran a bare `bash`, which on Windows can be WSL's launcher (another
 * home, other credentials, and no C:\ paths). Glass now uses the App's resolver, copied byte for byte.
 */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { pickBash } from '../core/bashResolve';

test('Glass never runs the bare word bash: the account list and the swap go through the resolver', () => {
  for (const f of ['src/home/config.ts', 'src/rituals/runner.ts']) {
    const src = fs.readFileSync(f, 'utf8');
    assert.ok(!/execFile\('bash'/.test(src), `${f} must not execFile('bash', …)`);
    assert.match(src, /const bash = resolveBash\(\)/, `${f} resolves bash first`);
    assert.match(src, /execFile\(bash, /, `${f} runs the resolved bash`);
  }
});

test('on Windows the resolver skips WSL\'s System32 bash for Git Bash, and refuses when there is none', () => {
  const have = new Set(['C:\\Windows\\System32\\bash.exe', 'C:\\Program Files\\Git\\bin\\bash.exe']);
  const probe = { pathHit: 'C:\\Windows\\System32\\bash.exe', programFiles: 'C:\\Program Files', exists: (p: string) => have.has(p) };
  assert.equal(pickBash('win32', probe), 'C:\\Program Files\\Git\\bin\\bash.exe');
  assert.equal(pickBash('win32', { ...probe, exists: (p: string) => p.includes('System32') }), null, 'WSL alone is not a bash we may use');
  assert.equal(pickBash('darwin', { exists: () => false }), 'bash');
});

test('the cog menu waits on the script only the first time, and a list it could not read stays visible', () => {
  const menu = fs.readFileSync('src/home/configMenu.ts', 'utf8');
  assert.match(menu, /if \(!anthropicAccounts\(\)\.length && !accountsAskedYet\(\)\) await refreshAccounts\(\);/);
  assert.match(menu, /const accountsBroken = !anthropicAccounts\(\)\.length && !!accountsError\(\);/);
  assert.match(menu, /anthropicAccounts\(\)\.length > 1 \|\| accountsBroken/, 'a broken list keeps the swap entry, which shows why');
});
