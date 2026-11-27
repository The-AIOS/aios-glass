/**
 * aios-app#230 — the worker's model on Glass: the tier is resolved by the framework's
 * resolve-tier (no rung list here), and nothing is dropped in silence.
 */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { MODEL_SHAPE, modelField, tierField, resolveTierWith, spawnModelFlag, parseLadder, ladderModelOptions, type HookRun } from '../core/workerModel';

const ROOT = path.resolve(__dirname, '..', '..');
const read = (...p: string[]) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
/** Code only: comments describe the old rung list on purpose, and must not satisfy or fail a check. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const INJECTIONS = [
  '$(whoami)', '`id`', 'opus; rm -rf ~', 'opus && curl x', 'opus|sh', 'opus > /tmp/x', 'opus\nwhoami',
  'opus whoami', "opus'", 'opus"', '--dangerously-skip-permissions', '-p', 'opus\\', 'opus$HOME', '${IFS}',
  'opus[1m]x', '[1m]', 'opus[2m]', 'opus[1m][1m]', 'a'.repeat(65), 'opus\u0000', 'ópus', 'opus}', 'opus{', 'opus*', 'opus?',
  'opus#', 'opus!', 'opus~', 'opus(', 'opus=1', 'a/b', 'a:b', 'a,b', 'a%b', 'a@b', '.opus', '_opus',
];

test('model: the shape takes ids, aliases and [1m]; every injection attempt is refused by name', () => {
  for (const ok of ['claude-opus-4-8', 'claude-opus-4-8[1m]', 'opus', 'Opus', 'a', 'us.vendor.model-v1_0', 'a'.repeat(64)]) {
    assert.deepEqual(modelField(ok), { model: ok });
  }
  assert.deepEqual(modelField(' opus '), { model: 'opus' });
  for (const bad of [...INJECTIONS, 42, true, ['opus'], { id: 'opus' }]) {
    const r = modelField(bad);
    assert.equal(r.model, undefined, `${JSON.stringify(bad)} must not pass`);
    assert.equal(r.fieldError?.field, 'model');
    assert.match(r.fieldError?.reason ?? '', /^model '/);
    assert.doesNotMatch(r.fieldError?.reason ?? '', /[\u0000-\u001f]/, 'the reason carries no control characters');
    if (typeof bad === 'string') assert.equal(MODEL_SHAPE.test(bad), false);
  }
  for (const none of [undefined, null, '']) assert.deepEqual(modelField(none), {});
});

test('tier: case is not a reason to drop a rung; a value that is not a rung name is refused by name', () => {
  /* The defect: `Fast` failed a case-sensitive closed list and the worker started on the default model. */
  assert.deepEqual(tierField('Fast'), { tier: 'fast' });
  assert.deepEqual(tierField(' JUDGMENT '), { tier: 'judgment' });
  assert.deepEqual(tierField('a-rung-added-next-month'), { tier: 'a-rung-added-next-month' }, 'membership is not decided here');
  for (const bad of ['$(id)', 'fast; whoami', 'fast scale', '-x', '9fast', 'a'.repeat(25), 7, ['fast']]) {
    const r = tierField(bad);
    assert.equal(r.tier, undefined);
    assert.equal(r.fieldError?.field, 'tier');
    assert.match(r.fieldError?.reason ?? '', /resolve-tier --list/);
  }
  for (const none of [undefined, null, '']) assert.deepEqual(tierField(none), {});
});

/* A stand-in for the framework's script, with rung names no surface could have hardcoded. */
function script(table: Record<string, string>, launch?: Record<string, string>): (args: string[]) => HookRun {
  const unknown = (r: string): HookRun => ({ status: 2, stdout: '', stderr: `resolve-tier: unknown rung '${r}'\nrungs: ${Object.keys(table).join(' ')}` });
  return (args) => {
    if (args[0] === '--list') return { status: 0, stdout: Object.entries(table).map(([r, m]) => `${r.padEnd(11)} ${m || '<inherit default>'}`).join('\n') + '\n', stderr: '' };
    if (args[0] === '--launch-model') {
      if (!launch) return unknown('--launch-model');
      return args[1] in launch ? { status: 0, stdout: launch[args[1]] + '\n', stderr: '' } : unknown(args[1]);
    }
    return args[0] in table ? { status: 0, stdout: table[args[0]] ? table[args[0]] + '\n' : '', stderr: '' } : unknown(args[0]);
  };
}
const TABLE = { top: 'model-top', middle: '', low: 'model-low', older: 'model-low' };

test('tier: whatever the script knows resolves, whatever it does not is refused with its list', () => {
  assert.deepEqual(resolveTierWith('low', script(TABLE)), { model: 'model-low' });
  /* Empty at exit 0 is a real answer: no flag, and the wrapper starts its own default. */
  assert.deepEqual(resolveTierWith('middle', script(TABLE)), { launcherDefault: true }, 'an empty answer is the rung the wrapper pins, not "nothing asked"');
  const r = resolveTierWith('turbo', script(TABLE));
  assert.ok('error' in r);
  assert.match(r.error, /unknown rung 'turbo'/);
  assert.match(r.error, /top middle low older/, 'the dead letter lists the valid rungs, from the script');
  for (const odd of ['$(whoami)', 'two words', '--flag']) {
    assert.ok('error' in resolveTierWith('low', script({ ...TABLE, low: odd })), `an answer of ${odd} is never typed into a shell`);
  }
});

test('picker: the choices are the ladder\'s models, one per id, the launcher\'s default included when the framework names it', () => {
  const ladder = parseLadder(script(TABLE)(['--list']).stdout);
  assert.deepEqual(ladder, [{ rung: 'top', model: 'model-top' }, { rung: 'middle' }, { rung: 'low', model: 'model-low' }, { rung: 'older', model: 'model-low' }]);
  assert.deepEqual(ladderModelOptions(ladder, () => undefined), [{ value: 'model-top', rungs: ['top'] }, { value: 'model-low', rungs: ['low', 'older'] }]);
  assert.deepEqual(ladderModelOptions(ladder, (r) => (r === 'middle' ? 'model-pinned[1m]' : undefined)),
    [{ value: 'model-top', rungs: ['top'] }, { value: 'model-pinned[1m]', rungs: ['middle'] }, { value: 'model-low', rungs: ['low', 'older'] }]);
  assert.deepEqual(ladderModelOptions(ladder, () => '$(whoami)'), [{ value: 'model-top', rungs: ['top'] }, { value: 'model-low', rungs: ['low', 'older'] }]);
  assert.deepEqual(parseLadder('usage: nothing useful\n\n'), []);
});

test('no rung list and no model id of its own: a surface cannot disagree with resolve-tier', () => {
  /* The check the issue asks for. Glass disagreed with the script because it kept a list; the
     only way to stay in agreement is to keep none. The advisor's rungs (contract 4, core/contract4)
     are a different, fixed table and are not the worker's tier. */
  for (const f of [['src', 'rituals', 'runner.ts'], ['src', 'extension.ts'], ['src', 'home', 'config.ts'], ['src', 'home', 'configMenu.ts'], ['src', 'home', 'resolveTier.ts'], ['src', 'core', 'workerModel.ts']]) {
    const c = code(read(...f));
    assert.match(c, /function |=> /, `${f.join('/')}: the comment stripper ate the code`);
    assert.doesNotMatch(c, /(frontier|judgment|scale|fast|mechanical)\s*\|\s*(frontier|judgment|scale|fast|mechanical)/, `${f.join('/')} holds a rung list`);
    if (f[1] !== 'extension.ts') assert.doesNotMatch(c, /['"`](frontier|scale|mechanical)['"`]/, `${f.join('/')} names a rung`);
    assert.doesNotMatch(c, /claude-(opus|sonnet|haiku|fable)-\d/, `${f.join('/')} names a model id`);
  }
});

test('the typed model flag: a model, the wrapper\'s pin, or the operator\'s saved model (what the App starts)', () => {
  const INHERIT = '--inherit-model ';
  assert.deepEqual(spawnModelFlag({ model: 'model-low' }, INHERIT), { flag: '--model model-low ' }, 'an asked model, and never the inherit flag beside it');
  assert.deepEqual(spawnModelFlag({ model: 'model-big[1m]' }, INHERIT), { flag: "--model 'model-big[1m]' " }, 'a bracket is quoted: bare, zsh reads it as a glob');
  assert.deepEqual(spawnModelFlag({ launcherDefault: true }, INHERIT), { flag: '' }, 'the pinned rung: no flag, the wrapper starts its pin');
  assert.deepEqual(spawnModelFlag({}, INHERIT), { flag: INHERIT }, 'nothing asked: the saved model, as the App starts a plain claude');
  assert.deepEqual(spawnModelFlag({ model: '' }, INHERIT), { flag: INHERIT }, 'an empty model is nothing asked');
  assert.deepEqual(spawnModelFlag({}, '-InheritModel '), { flag: '-InheritModel ' }, 'the PowerShell spelling passes through');
  assert.deepEqual(spawnModelFlag({}, ''), { flag: '', fellBack: true }, 'CONTROL: a wrapper without the flag keeps the old command, and says it fell back');
  assert.deepEqual(spawnModelFlag({ model: 'model-low', launcherDefault: true }, INHERIT), { flag: '--model model-low ' }, 'a model wins over the pinned rung');
  for (const bad of ["x'; touch pwned; '", 'a b', '$(id)', '-rf', 'm[2m]']) {
    assert.throws(() => spawnModelFlag({ model: bad }, INHERIT), /not one a command line may carry/, `${bad} never reaches the command`);
  }
});

test('wiring: the bus resolves before it launches, refuses by dead letter, and the runner takes a model only', () => {
  const ext = read('src', 'extension.ts');
  assert.match(ext, /const mf = wantsModel \? modelField\(req\.model\) : \{\};/);
  assert.match(ext, /const tf = wantsModel \? tierField\(req\.tier\) : \{\};/);
  assert.match(ext, /if \(badField\) \{ releaseRequest\(held, true, badField\.reason\); return; \}/);
  assert.match(ext, /const r = resolveTier\(tf\.tier\);\s*\n\s*if \('error' in r\) \{ releaseRequest\(held, true, r\.error\); return false; \}/);
  assert.equal((ext.match(/const wm = workerModel\(\);\s*\n\s*if \(!wm\) return;/g) || []).length, 2, 'the spawn and the resume fallback both resolve first');
  assert.doesNotMatch(code(ext), /launchSpawn\([^)]*\btier\b/, 'a tier never reaches the runner');
  const runner = read('src', 'rituals', 'runner.ts');
  assert.match(runner, /const mf = spawnModelFlag\(\{ model: opts\?\.model, launcherDefault: opts\?\.launcherDefault \? true : undefined \},\s*\n\s*asked \? '' : inheritModelFlag\(process\.platform, os\.homedir\(\), process\.env, readRc\)\);/);
  assert.match(runner, /let flag = mf\.flag;\s*\n\s*if \(mf\.fellBack\) log\(/, 'a fallback to the pin is said in the log');
  assert.doesNotMatch(code(runner), /--inherit-model|-InheritModel|--model /, 'the model flags are spelled in workerModel and wrapperCaps only');
  assert.equal((ext.match(/\{ model: wm\.model, launcherDefault: wm\.launcherDefault, bus: true, \.\.\.c4Launch \}/g) || []).length, 2, 'both bus launches hand over which of the three cases it is');
  assert.doesNotMatch(code(runner), /--tier/, 'the runner passes the resolved model, not a rung');
  const lookup = read('src', 'home', 'resolveTier.ts');
  assert.match(lookup, /\['hooks\/pipeline\/resolve-tier', 'hooks\/resolve-tier'\]/);
  assert.match(lookup, /execFileSync\(bash, \[hook, \.\.\.args\]/);
  assert.match(read('src', 'home', 'configMenu.ts'), /const options = modelOptions\(\);/, 'the picker asks the ladder when it opens');
  assert.match(ext, /const wantsModel = action === 'spawn' \|\| \(action === 'resume' && req\.fallback === 'spawn'\);/, 'a plain resume is not refused for a field it never uses');
  assert.match(ext, /const r = resolveTier\(tf\.tier\);[\s\S]{0,120}if \(mf\.model\) return \{ model: mf\.model \};/, 'a tier beside a model is still checked; the model wins after');
});

test('against a real resolve-tier, when a framework is at hand: every listed rung resolves to what the list says', (t) => {
  const root = process.env.AIOS_FRAMEWORK_ROOT;
  const hook = root ? ['hooks/pipeline/resolve-tier', 'hooks/resolve-tier'].map((r) => path.join(root, r)).find((f) => fs.existsSync(f)) : undefined;
  if (!hook) { t.skip('set AIOS_FRAMEWORK_ROOT to a framework checkout to run this'); return; }
  const run = (args: string[]): HookRun => {
    try { return { status: 0, stdout: execFileSync('bash', [hook, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }), stderr: '' }; }
    catch (e) { const err = e as { status?: number; stderr?: string }; return { status: err.status || 1, stdout: '', stderr: String(err.stderr ?? '') }; }
  };
  const ladder = parseLadder(run(['--list']).stdout);
  assert.ok(ladder.length >= 4, 'the ladder has at least four rungs');
  for (const row of ladder) {
    assert.deepEqual(resolveTierWith(row.rung, run), row.model ? { model: row.model } : { launcherDefault: true }, `${row.rung} resolves to what --list says`);
    assert.deepEqual(tierField(row.rung.toUpperCase()), { tier: row.rung });
  }
  assert.ok('error' in resolveTierWith('definitely-not-a-rung', run));
});
