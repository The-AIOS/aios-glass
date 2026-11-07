/**
 * cwd (App PR #77) — Glass does not implement it, so a spawn or resume carrying it is dead-lettered
 * naming the field, never opened in the framework root (silently the wrong folder).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import { unsupportedFieldReason } from '../bus/unsupportedFields';
import { normalizeVerb } from '../core/busVerbs';

test('a spawn or resume carrying cwd is refused, naming the field and the surface that has it', () => {
  for (const req of [{ name: 'heron', cwd: '/tmp/x' }, { action: 'spawn', name: 'heron', cwd: '/tmp/x' }, { action: 'resume', name: 'heron', cwd: '' }]) {
    const why = unsupportedFieldReason(req, normalizeVerb((req as { action?: unknown }).action));
    assert.ok(why && /does not support cwd/.test(why) && /"surface":"app"/.test(why), JSON.stringify(req));
  }
});

test('without cwd (or on a verb with no folder) nothing is refused', () => {
  assert.equal(unsupportedFieldReason({ name: 'heron', task: 't' }, 'spawn'), undefined);
  assert.equal(unsupportedFieldReason({ name: 'heron', cwd: null }, 'spawn'), undefined);
  assert.equal(unsupportedFieldReason({ action: 'send', name: 'heron', cwd: '/x', prompt: 'p' }, 'send'), undefined);
});

test('the bus dead-letters it before any launch, and the inbox README says so', () => {
  const src = fs.readFileSync('src/extension.ts', 'utf8');
  const gate = src.indexOf('if (unsupported && !liveResume) {');
  const refuse = src.indexOf('releaseRequest(held, true, unsupported);', gate);
  assert.ok(gate > 0 && refuse > gate && refuse - gate < 200, 'refused with the .undelivered mechanism');
  /* Review, 0.5.14: a resume to a RUNNING session launches nothing, so it is delivered like the App does; and a
     launch only the App can do goes to the App when it is alive, never to a dead letter while it could run. */
  assert.match(src, /const liveResume = !!unsupported && action === 'resume' && \(await listRunningAgents\(\)\)\.some\(\(a\) => a\.name === name\)/);
  assert.match(src.slice(gate, refuse), /appSurfaceAlive\(\) && releaseToSibling\(held\)/, 'handed to the App only when it is alive');
  assert.match(src.slice(gate, refuse), /typeof \(req as Record<string, unknown>\)\.surface !== 'string'/, 'a request pinned to a surface is never re-routed');
  assert.ok(refuse < src.indexOf("if (action === 'kill')", refuse) && refuse < src.indexOf('await launchSpawn(name, task', refuse), 'before anything is launched');
  assert.match(src, /Glass dead-letters a request carrying `cwd`/);
});

test('addDirs (App PR 89) is refused by name on spawn and resume, never dropped; send ignores it', () => {
  for (const req of [{ name: 'heron', addDirs: ['/tmp/x'] }, { action: 'resume', name: 'heron', addDirs: ['/a', '/b'] }]) {
    assert.match(unsupportedFieldReason(req, req.action ?? 'spawn') ?? '', /does not support addDirs/);
  }
  assert.equal(unsupportedFieldReason({ name: 'heron', addDirs: null }, 'spawn'), undefined);
  assert.equal(unsupportedFieldReason({ name: 'heron', addDirs: [] }, 'spawn'), undefined, 'an empty list is none, as on the App');
  assert.match(fs.readFileSync('src/extension.ts', 'utf8'), /Glass dead-letters a request carrying a non-empty `addDirs`/, 'the README says so');
  assert.equal(unsupportedFieldReason({ action: 'send', name: 'heron', addDirs: ['/x'], prompt: 'p' }, 'send'), undefined);
});

test('group (App 0.15.0) is advisory: never a refusal, handed to the App when it is alive, otherwise logged as not applied', async () => {
  const { appPreferredGroup } = await import('../bus/unsupportedFields');
  assert.equal(unsupportedFieldReason({ name: 'heron', group: 'Release' }, 'spawn'), undefined, 'never a dead letter');
  assert.equal(appPreferredGroup({ name: 'heron', group: '  Release \n 0.15 ' }, 'spawn'), 'Release 0.15', 'cleaned the same way the App cleans it');
  assert.equal(appPreferredGroup({ name: 'heron', group: 'Release' }, 'resume'), 'Release');
  assert.equal(appPreferredGroup({ name: 'heron', group: 'Release', prompt: 'p' }, 'send'), undefined, 'send launches nothing');
  for (const bad of [42, ['x'], '', '   ', null, undefined]) assert.equal(appPreferredGroup({ name: 'heron', group: bad }, 'spawn'), undefined, String(bad));
  assert.equal(appPreferredGroup({ name: 'heron', group: 'x'.repeat(60) }, 'spawn')?.length, 40);
  const src = fs.readFileSync('src/extension.ts', 'utf8');
  assert.match(src, /if \(group && typeof \(req as Record<string, unknown>\)\.surface !== 'string' && appSurfaceAlive\(\) && releaseToSibling\(held\)\) \{ return; \}/, 'to the App when it is alive and the sender did not pin a surface');
  assert.match(src, /group '\$\{group\}' NOT applied: this surface has no tab groups/, 'otherwise started, and the log says so');
  assert.match(src, /'- `group` \(spawn, resume\) — \*\*App only\*\*/, 'and the inbox README Glass writes documents it beside cwd and addDirs');
});
