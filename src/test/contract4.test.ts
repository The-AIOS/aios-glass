/**
 * AI-198 — inbox contract 4, run against canonical's own conformance fixture (copied verbatim from
 * skills/aios/orchestration-ladder/inbox-contract-4.conformance.json). The same test runs in the
 * App against the same file, so the two surfaces pass or fail together.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { contract4Decide } from '../core/contract4';
import { busSentLine } from '../core/busLog';

const FIX = path.join(__dirname, '..', '..', 'src', 'test', 'fixtures', 'inbox-contract-4.conformance.json');
const fx = JSON.parse(fs.readFileSync(FIX, 'utf8')) as { contract: number; cases: { case: string; request: Record<string, unknown>; expect: Record<string, unknown> }[] };
// A stub for hooks/resolve-tier: the fixture names a rung's model as "whatever resolve-tier says".
const RESOLVED: Record<string, string> = { frontier: 'claude-fable-5-1', judgment: 'claude-opus-5-5', scale: 'claude-sonnet-5-5', fast: 'claude-haiku-5-5' };
const resolve = (r: string) => RESOLVED[r];

test('the fixture is contract 4 and has cases', () => {
  assert.equal(fx.contract, 4);
  assert.ok(fx.cases.length >= 10);
});

for (const c of fx.cases) {
  test(`conformance: ${c.case}`, () => {
    const d = contract4Decide(c.request, resolve);
    const e = c.expect;
    assert.equal(d.accept, e.accept);
    if (!d.accept) {
      assert.equal(d.field, e.dead_letter_field);
      assert.equal(d.value, e.dead_letter_value);
      return;
    }
    if (e.verb) assert.equal(d.verb, e.verb);
    if (e.launch_args) assert.deepEqual(d.launchArgs, e.launch_args);
    for (const a of (e.launch_args_contains as string[] | undefined) ?? []) assert.ok(d.launchArgs.includes(a), `${a} in ${JSON.stringify(d.launchArgs)}`);
    for (const a of (e.launch_args_absent as string[] | undefined) ?? []) assert.ok(!d.launchArgs.includes(a), `${a} absent`);
    const settings = d.launchArgs[d.launchArgs.indexOf('--settings') + 1];
    if (e.advisor_model) assert.equal(JSON.parse(settings).advisorModel, e.advisor_model);
    if (e.advisor_model_from) assert.equal(JSON.parse(settings).advisorModel, resolve(String(e.advisor_model_from).split(' ').pop()!));
    if (e.record) {
      const prompt = String(c.request.prompt ?? c.request.task ?? 'x');
      const line = JSON.parse(busSentLine(prompt, d.record!.to, d.record!.action, d.record!.via, '', 2_000_000_000, d.record!.from)!);
      for (const [k, v] of Object.entries(e.record as Record<string, string>)) assert.equal(line[k], v, `record.${k}`);
      if (!('from' in (e.record as object))) assert.equal(line.from, undefined, 'no from unless the request carried a usable one');
    }
  });
}

test('a rung that resolves to the session default names no advisor — dead-lettered, never guessed', () => {
  const d = contract4Decide({ name: 'w', task: 'x', advisor: 'judgment' }, (r) => (r === 'judgment' ? '' : RESOLVED[r]));
  assert.equal(d.accept, false);
  if (!d.accept) { assert.equal(d.field, 'advisor'); assert.match(d.reason, /names no model/); }
});
