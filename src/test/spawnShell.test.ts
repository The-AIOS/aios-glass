/**
 * On Windows Glass typed `spawn --model … --effort … --advisor …` into PowerShell, whose `spawn` takes
 * `-Model`, `-Effort`, `-Advisor`. PowerShell reads `--model` as a plain string, binds it to -Name and
 * refuses the rest of the line, so the worker never started. Quoting differed too: a task holding
 * "don't" or "don’t" did not parse. These tests hold Glass's spellings to what the two installers
 * actually declare, and, when PowerShell and a framework are at hand, bind the typed line for real.
 */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { SPAWN_OPTIONS, quoteFor, spawnOption, typedShellFor, type SpawnOption } from '../core/spawnShell';
import { spawnModelFlag } from '../core/workerModel';
import { resumeCmd, healthHelpCmd } from '../bus/launchCmd';

const ROOT = path.resolve(__dirname, '..', '..');
const read = (...p: string[]) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

test('the dialect follows the platform: PowerShell on Windows, zsh/bash elsewhere', () => {
  assert.equal(typedShellFor('win32'), 'powershell');
  for (const p of ['darwin', 'linux', 'freebsd'] as NodeJS.Platform[]) assert.equal(typedShellFor(p), 'posix');
});

test('each wrapper option in each dialect', () => {
  const want: Record<SpawnOption, [string, string]> = {
    model: ['--model', '-Model'], effort: ['--effort', '-Effort'], advisor: ['--advisor', '-Advisor'],
    'add-dir': ['--add-dir', '-AddDir'], 'inherit-model': ['--inherit-model', '-InheritModel'],
  };
  assert.deepEqual([...SPAWN_OPTIONS].sort(), Object.keys(want).sort());
  for (const o of SPAWN_OPTIONS) {
    assert.equal(spawnOption(o, 'posix'), want[o][0]);
    assert.equal(spawnOption(o, 'powershell'), want[o][1]);
  }
});

test('quoting: POSIX closes and escapes, PowerShell doubles, typographic quotes included', () => {
  assert.equal(quoteFor("don't", 'posix'), `'don'\\''t'`);
  assert.equal(quoteFor("don't", 'powershell'), `'don''t'`);
  assert.equal(quoteFor('don’t', 'powershell'), `'don’’t'`, 'PowerShell ends a single-quoted string at U+2019 too');
  assert.equal(quoteFor('‘a’ ‚b‛', 'powershell'), `'‘‘a’’ ‚‚b‛‛'`);
  assert.equal(quoteFor('don’t', 'posix'), `'don’t'`, 'zsh and bash take U+2019 as a letter');
  assert.equal(quoteFor('$(id) `id` $HOME', 'powershell'), `'$(id) \`id\` $HOME'`, 'single quotes expand nothing in either');
});

test('the model flag in PowerShell is -Model, and a bracketed id is quoted', () => {
  assert.deepEqual(spawnModelFlag({ model: 'model-low' }, '', 'powershell'), { flag: '-Model model-low ' });
  assert.deepEqual(spawnModelFlag({ model: 'model-big[1m]' }, '', 'powershell'), { flag: "-Model 'model-big[1m]' " });
  assert.deepEqual(spawnModelFlag({}, '-InheritModel ', 'powershell'), { flag: '-InheritModel ' });
  assert.deepEqual(spawnModelFlag({ model: 'model-low' }, '', 'posix'), { flag: '--model model-low ' }, 'zsh/bash unchanged');
});

test('resume and help lines quote in the terminal\'s dialect; the claude flags stay as they are', () => {
  assert.equal(resumeCmd('claude', 'abc-123', ['--effort', 'high'], "don't stop", undefined, 'powershell'),
    "claude --resume 'abc-123' '--effort' 'high' 'don''t stop'");
  assert.equal(healthHelpCmd('claude', 'C:\\t\\a.md', 'it’s', 'powershell').endsWith("--name health-help 'it’’s'"), true);
});

/* The lines canonical's installers write, quoted from install-wrappers.sh / install-wrappers.ps1. */
const SH = [
  '      --model)     [ $# -ge 2 ] || { echo "spawn: --model needs a value" >&2; return 2; }; model="$2"; shift 2 ;;',
  '      --effort)    [ $# -ge 2 ] || { echo "spawn: --effort needs a value" >&2; return 2; }; effort="$2"; shift 2 ;;',
  '      --advisor)   [ $# -ge 2 ] || { echo "spawn: --advisor needs a value" >&2; return 2; }; advisor="$2"; shift 2 ;;',
  '      --add-dir)   [ $# -ge 2 ] || { echo "spawn: --add-dir needs a folder" >&2; return 2; }; add_dirs="$add_dirs',
].join('\n');
const PS = [
  'function spawn {', '    [CmdletBinding()]', '    param(',
  '        [Parameter(Position=0)] [string] $Name,',
  "        [ValidateSet('frontier','judgment','scale','fast','mechanical')] [string] $Tier,",
  '        [string] $Model,',
  "        [ValidateSet('low','medium','high','xhigh','max')] [string] $Effort,",
  '        [string] $Advisor,',
  '        [string[]] $AddDir', '    )',
].join('\n');

/** The parameter names declared in PowerShell's `function spawn { param( … ) }`. */
function psParams(src: string): Set<string> {
  const i = src.indexOf('function spawn {');
  const j = src.indexOf('\n    )', i);
  if (i < 0 || j < 0) return new Set();
  return new Set([...src.slice(i, j).matchAll(/\]\s*\$([A-Za-z]+)\b/g)].map((m) => m[1]));
}
/** The options the zsh/bash `spawn` matches, as case labels at the start of a line. */
const shHas = (src: string, o: SpawnOption) => new RegExp(`^\\s*${spawnOption(o, 'posix')}\\)`, 'm').test(src);
const psHas = (src: string, o: SpawnOption) => psParams(src).has(spawnOption(o, 'powershell').slice(1));

test('every option Glass types is one the wrapper of that dialect declares (fixtures of the real lines)', () => {
  for (const o of ['model', 'effort', 'advisor', 'add-dir'] as SpawnOption[]) {
    assert.ok(shHas(SH, o), `zsh/bash wrapper takes ${spawnOption(o, 'posix')}`);
    assert.ok(psHas(PS, o), `PowerShell wrapper takes ${spawnOption(o, 'powershell')}`);
  }
  assert.equal(psHas(PS, 'inherit-model'), false, 'CONTROL: an option the block does not declare reads as absent');
});

test('against the real installers, when a framework is at hand: both dialects declare the same options', (t) => {
  const root = process.env.AIOS_FRAMEWORK_ROOT;
  const dir = root ? path.join(root, 'hooks', 'claude-identity') : '';
  if (!root || !fs.existsSync(path.join(dir, 'install-wrappers.ps1'))) { t.skip('set AIOS_FRAMEWORK_ROOT to a framework checkout to run this'); return; }
  const sh = fs.readFileSync(path.join(dir, 'install-wrappers.sh'), 'utf8');
  const ps = fs.readFileSync(path.join(dir, 'install-wrappers.ps1'), 'utf8');
  for (const o of ['model', 'effort', 'advisor', 'add-dir'] as SpawnOption[]) {
    assert.ok(shHas(sh, o), `install-wrappers.sh declares ${spawnOption(o, 'posix')}`);
    assert.ok(psHas(ps, o), `install-wrappers.ps1 declares ${spawnOption(o, 'powershell')}`);
  }
  /* inherit-model arrives with aios#422; whichever framework this is, the two installers agree. */
  assert.equal(shHas(sh, 'inherit-model'), psHas(ps, 'inherit-model'), 'the two installers agree on --inherit-model / -InheritModel');
});

test('bound by a real PowerShell, when one and a framework are at hand: Glass\'s line starts the worker, the old one did not', (t) => {
  const root = process.env.AIOS_FRAMEWORK_ROOT;
  const pwsh = process.env.AIOS_PWSH;
  const installer = root ? path.join(root, 'hooks', 'claude-identity', 'install-wrappers.ps1') : '';
  if (!pwsh || !installer || !fs.existsSync(installer)) { t.skip('set AIOS_PWSH and AIOS_FRAMEWORK_ROOT to run this'); return; }
  /* The real `function spawn` header and param block, with a body that reports what was bound. */
  const src = fs.readFileSync(installer, 'utf8').replace(/\r\n/g, '\n');   // a Windows checkout has CRLF
  const i = src.indexOf('function spawn {');
  const j = src.indexOf('\n    )\n', i) + '\n    )\n'.length;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glass-pwsh-'));
  const fn = path.join(tmp, 'spawn.ps1');
  fs.writeFileSync(fn, src.slice(i, j) + '    $PSBoundParameters | ConvertTo-Json -Compress\n}\n');
  const bind = (line: string) => {
    try {
      return { ok: true, out: JSON.parse(execFileSync(pwsh, ['-NoProfile', '-NonInteractive', '-Command', `. '${fn}'; ${line}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })) };
    } catch (e) { return { ok: false, out: String((e as { stderr?: string }).stderr ?? '') }; }
  };
  try {
    const task = 'don’t stop, it\'s $(late)';
    const ps = 'powershell' as const;
    const line = `spawn ${spawnModelFlag({ model: 'model-big[1m]' }, '', ps).flag}${spawnOption('effort', ps)} high `
      + `${spawnOption('advisor', ps)} ${quoteFor('model-adv', ps)} ${spawnOption('add-dir', ps)} 'C:\\run dir' worker ${quoteFor(task, ps)}`;
    const r = bind(line);
    assert.ok(r.ok, `PowerShell refused Glass's line: ${r.out}`);
    assert.deepEqual(r.out, { Model: 'model-big[1m]', Effort: 'high', Advisor: 'model-adv', AddDir: ['C:\\run dir'], Name: 'worker', Task: task });
    /* CONTROL: the line Glass typed before, GNU flags and POSIX quoting. */
    const old = bind(`spawn --model model-low --effort high worker 'do it'`);
    assert.equal(old.ok, false, 'the GNU-flag line is refused: a positional parameter cannot be found');
    assert.deepEqual(bind(`spawn --model x`).out, { Name: '--model', Task: 'x' }, 'PowerShell reads --model as the name');
    assert.equal(bind(`spawn worker ${quoteFor("don't", 'posix')}`).ok, false, 'POSIX quoting of an apostrophe does not parse');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('wiring: every line the runner types is in the terminal\'s dialect', () => {
  const runner = read('src', 'rituals', 'runner.ts');
  assert.match(runner, /const TYPED_SHELL = typedShellFor\(process\.platform\);/);
  assert.match(runner, /function shellQuote\(s: string\): string \{\s*return quoteFor\(s, TYPED_SHELL\);\s*\}/);
  const fn = runner.slice(runner.indexOf('export async function launchSpawn('), runner.indexOf('export async function launchCommandInNewSession('));
  assert.doesNotMatch(code(fn), /--(model|effort|advisor|add-dir|inherit-model|tier)\b/, 'no GNU flag is spelled in launchSpawn');
  assert.match(fn, /spawnOption\('effort', TYPED_SHELL\)/);
  assert.match(fn, /spawnOption\('advisor', TYPED_SHELL\)/);
  assert.match(fn, /readRc\), TYPED_SHELL\);/, 'the model flag is spelled for the terminal');
  assert.match(fn, /runNew\(`spawn \$\{flag\}\$\{name\}\$\{inlineTask \? ` \$\{shellQuote\(inlineTask\)\}` : ''\}`/);
  assert.match(runner, /resumeCmd\(claudeBin\(\), sessionId, extraArgs, inline, taskFile, TYPED_SHELL\)/);
  assert.match(runner, /healthHelpCmd\(claudeBin\(\), file, prompt, TYPED_SHELL\)/);
  assert.doesNotMatch(code(runner), /'\\\\''/, 'no POSIX-only quoting left in the runner');
  const caps = read('src', 'bus', 'wrapperCaps.ts');
  assert.doesNotMatch(code(caps), /'-AddDir|'--add-dir|'-InheritModel|'--inherit-model|`-AddDir|`--add-dir/, 'wrapperCaps spells its flags through spawnOption');
});
