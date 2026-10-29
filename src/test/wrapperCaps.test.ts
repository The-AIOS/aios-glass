/**
 * aios#231, Glass spawn half: the folder grant is typed ONLY when the installed spawn wrapper takes
 * it. An older wrapper reads an unknown flag as the worker's NAME, so both branches are tested.
 * Fixtures quote the real lines of canonical's installed block (v0.8.13 has the flag, v0.8.12 not).
 */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { addDirFlag, blockAcceptsAddDir, wrapperBlock, wrapperStartupFiles } from '../bus/wrapperCaps';

const wrap = (body: string, by = 'install-wrappers.sh') =>
  `export PATH=x\n# ==== claude-spawn-wrappers (managed by hooks/claude-identity/${by}) ====\n${body}\n# ==== END claude-spawn-wrappers ====\n`;
const SH_813 = wrap(`spawn() {\n  while [ $# -gt 0 ]; do case "$1" in\n      --tier)      tier="$2"; shift 2 ;;\n      --add-dir)   [ $# -ge 2 ] || { echo "spawn: --add-dir needs a folder" >&2; return 2; }; add_dirs="$add_dirs\n$2"; shift 2 ;;\n  esac; done\n}`);
const SH_812 = wrap(`spawn() {\n  while [ $# -gt 0 ]; do case "$1" in\n      --tier)      tier="$2"; shift 2 ;;\n      # --add-dir is mentioned in a comment only\n  esac; done\n}`);
const PS_813 = wrap(`function spawn {\n    param(\n        [Parameter(Position=0)] [string] $Name,\n        [string[]] $AddDir\n    )\n}`, 'install-wrappers.ps1');
const PS_812 = wrap(`function spawn {\n    param(\n        [Parameter(Position=0)] [string] $Name\n    )\n}`, 'install-wrappers.ps1');
const DIR = '/Users/x/.aios/run/handoff-0123456789abcdef';
const files = (m: Record<string, string>) => (f: string) => m[f];

test('a v0.8.13 wrapper (zsh/bash) gets --add-dir, placed so its value is consumed before the name', () => {
  const rc = path.posix.join('/Users/x', '.zshrc');
  assert.equal(addDirFlag(DIR, 'darwin', '/Users/x', { SHELL: '/bin/zsh' }, files({ [rc]: SH_813 })), `--add-dir '${DIR}' `);
});

test('CONTROL: an older wrapper gets nothing — the flag would become the worker\'s name', () => {
  const rc = path.posix.join('/Users/x', '.zshrc');
  assert.equal(addDirFlag(DIR, 'darwin', '/Users/x', { SHELL: '/bin/zsh' }, files({ [rc]: SH_812 })), '');
  assert.equal(blockAcceptsAddDir(wrapperBlock(SH_812), 'posix'), false, 'a comment mentioning the flag is not support');
});

test('doubt answers no: no startup file, no wrapper block, a quote in the folder', () => {
  assert.equal(addDirFlag(DIR, 'darwin', '/Users/x', { SHELL: '/bin/zsh' }, () => undefined), '');
  assert.equal(addDirFlag(DIR, 'darwin', '/Users/x', { SHELL: '/bin/zsh' }, () => 'export PATH=x\n'), '');
  assert.equal(addDirFlag("/Users/o'b/handoff-x", 'darwin', '/Users/o\'b', {}, () => SH_813), '');
});

test('bash users are read from .bashrc, as the installer writes it', () => {
  assert.deepEqual(wrapperStartupFiles('linux', '/home/x', { SHELL: '/bin/bash' }), [path.posix.join('/home/x', '.bashrc')]);
  assert.deepEqual(wrapperStartupFiles('darwin', '/Users/x', {}), [path.posix.join('/Users/x', '.zshrc')]);
});

test('Windows: -AddDir only when EVERY profile that carries the wrapper supports it', () => {
  const home = 'C:\\Users\\x';
  const [pw7, ps51] = wrapperStartupFiles('win32', home, {});
  const d = 'C:\\Users\\x\\AppData\\Local\\Temp\\aios-handoff-0123456789abcdef';
  assert.equal(addDirFlag(d, 'win32', home, {}, files({ [pw7]: PS_813, [ps51]: PS_813 })), `-AddDir '${d}' `);
  assert.equal(addDirFlag(d, 'win32', home, {}, files({ [pw7]: PS_813 })), `-AddDir '${d}' `, 'a profile without the wrapper does not count');
  assert.equal(addDirFlag(d, 'win32', home, {}, files({ [pw7]: PS_813, [ps51]: PS_812 })), '', 'one old edition → no flag');
  assert.equal(addDirFlag(d, 'win32', home, {}, files({ [pw7]: SH_813 })), '', 'a POSIX block is not a PowerShell grant');
});

test('launchSpawn grants the folder only through addDirFlag, and keeps today\'s command otherwise', () => {
  const src = fs.readFileSync('src/rituals/runner.ts', 'utf8');
  const fn = src.slice(src.indexOf('export async function launchSpawn('), src.indexOf('export async function launchCommandInNewSession('));
  assert.match(fn, /const grant = addDirFlag\(path\.dirname\(taskFile\)/);
  assert.match(fn, /if \(grant\) flag \+= grant;\s*else log\(/);
  assert.doesNotMatch(fn, /--add-dir/, 'the flag is spelled in wrapperCaps only, never typed unconditionally');
});

test('the banner counts only at the start of a line — the installer also names it in comments and patterns', () => {
  const noisy = '#   1. Banner block: `# ==== claude-spawn-wrappers …` through `# ==== END claude-spawn-wrappers`\n'
    + '  /^# ==== END claude-spawn-wrappers/ { next }\n' + SH_813;
  assert.equal(blockAcceptsAddDir(wrapperBlock(noisy), 'posix'), true);
});
