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
  const refuse = src.indexOf('if (unsupported) { releaseRequest(held, true, unsupported); return; }');
  assert.ok(refuse > 0, 'refused with the .undelivered mechanism');
  assert.ok(refuse < src.indexOf("if (action === 'kill')", refuse) && refuse < src.indexOf('await launchSpawn(name, task', refuse), 'before anything is launched');
  assert.match(src, /Glass dead-letters a request carrying `cwd`/);
});
