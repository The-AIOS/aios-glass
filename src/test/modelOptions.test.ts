/* The default-model picker offers exactly what the AIOS App's offers: its ladder, plus the extra
   models Claude Code lists for the account, plus the model set now (The-AIOS/aios-app#226). */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { modelOptionsFrom } from '../home/modelOptions';

const values = (o: { value: string }[]) => o.map((x) => x.value);

test("the App's ladder, strongest first, then the clear option", () => {
  assert.deepEqual(values(modelOptionsFrom(undefined, '')), [
    'claude-fable-5-1', 'claude-opus-5-5[1m]', 'claude-opus-5-5', 'claude-sonnet-5-5[1m]', 'claude-sonnet-5-5',
    'claude-haiku-5-5', 'claude-opus-5[1m]', 'claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5-20251001', '',
  ]);
  assert.equal(modelOptionsFrom(undefined, '')[1].label, 'Opus 5.5 — 1M context');
});

test('the extra models Claude Code caches for the account are added once, labelled as the App does', () => {
  const extra = [{ value: 'claude-opus-5-5', label: 'dup' }, { value: 'claude-new-6[1m]', label: 'New 6' }, { value: 'claude-x' }, { label: 'no value' }, 3];
  const o = modelOptionsFrom(extra, '');
  assert.equal(o.at(-1)?.value, '', 'the clear option stays last');
  assert.deepEqual(o.filter((m) => m.value === 'claude-opus-5-5').length, 1, 'a model already listed is not repeated');
  assert.deepEqual(o.find((m) => m.value === 'claude-new-6[1m]'), { label: 'New 6 — 1M context', value: 'claude-new-6[1m]' });
  assert.deepEqual(o.find((m) => m.value === 'claude-x'), { label: 'claude-x', value: 'claude-x' });
});

test('the model set now is shown even when no list carries it, after the lists, with its alias name when it is one', () => {
  assert.deepEqual(modelOptionsFrom(undefined, 'opus[1m]').at(-2), { label: 'Opus (latest) — 1M context', value: 'opus[1m]' });
  assert.deepEqual(modelOptionsFrom(undefined, 'claude-custom').at(-2), { label: 'claude-custom', value: 'claude-custom' });
  assert.deepEqual(modelOptionsFrom(undefined, 'claude-custom').at(-1), { label: 'Default (clear the override)', value: '' }, 'the clear option stays last');
  assert.equal(values(modelOptionsFrom(undefined, 'claude-opus-5-5')).filter((v) => v === 'claude-opus-5-5').length, 1);
});
