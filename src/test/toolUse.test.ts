/** AI-171 step 1 — skills and agents a session used, from real transcript record shapes. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { usageIn, usageChip } from '../core/toolUse';

const use = (name: string, input: object) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name, input }] } });

test('Skill and Agent tool uses are read; generic workers are not news', () => {
  const tx = [
    use('Skill', { skill: 'deep-research', args: 'x' }),
    use('Agent', { subagent_type: 'general-purpose', prompt: 'p' }),
    use('Agent', { subagent_type: 'Explore', prompt: 'p' }),
    use('Bash', { command: 'ls' }),
    '{torn',
    use('Skill', { skill: 'aios:close-session' }),
    use('Skill', { skill: 'deep-research' }),
  ].join('\n');
  const u = usageIn(tx);
  assert.deepEqual(u.skills, ['aios:close-session', 'deep-research'], 'newest last, no repeats');
  assert.deepEqual(u.agents, ['Explore']);
  assert.equal(usageChip(u), 'deep-research +2');
  assert.equal(usageChip({ skills: [], agents: [] }), '');
});

test('it accumulates across incremental reads within a turn (a transcript is read in pieces)', () => {
  const u = usageIn(use('Skill', { skill: 'a' }));
  usageIn(use('Skill', { skill: 'b' }), u);
  assert.deepEqual(u.skills, ['a', 'b']);
});

test('Glass rows carry the chip, escaped, under the shared parser', () => {
  const fs = require('node:fs') as typeof import('node:fs');
  const path = require('node:path') as typeof import('node:path');
  const ROOT = path.join(__dirname, '..', '..');
  const panel = fs.readFileSync(path.join(ROOT, 'src', 'home', 'homePanel.ts'), 'utf8');
  const js = fs.readFileSync(path.join(ROOT, 'media', 'home.js'), 'utf8');
  assert.match(panel, /used: u \? usageChip\(u\) : '', usedNames:/);
  assert.match(js, /'<span class="rused" title="'/);
  assert.match(js, /String\(a\.used\)\.replace\(\/&\/g, '&amp;'\)\.replace\(\/<\/g, '&lt;'\)/, 'a skill name is text, never markup');
});

const ask = (text: string) => JSON.stringify({ type: 'user', message: { role: 'user', content: text } });
test('operator test: the chip is the LATEST turn — a new prompt clears it, tool results do not', () => {
  const u = usageIn([ask('use comprehension-debt'), use('Skill', { skill: 'comprehension-debt' }), use('Agent', { subagent_type: 'Explore', prompt: 'p' })].join('\n'));
  assert.equal(usageChip(u), 'comprehension-debt +1');
  // a tool result (a user-role record) inside the same turn changes nothing
  usageIn(JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] } }), u);
  assert.equal(usageChip(u), 'comprehension-debt +1');
  // meta records (hooks, reminders) are not the operator asking
  usageIn(JSON.stringify({ type: 'user', isMeta: true, message: { role: 'user', content: 'reminder' } }), u);
  assert.equal(usageChip(u), 'comprehension-debt +1');
  // "what time is it?" — a new turn that uses nothing → no chip
  usageIn(ask('what time is it?'), u);
  assert.equal(usageChip(u), '');
  // an assistant line that merely CONTAINS the word "user" is still read for tool uses
  usageIn(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'the "user" asked' }, { type: 'tool_use', name: 'Skill', input: { skill: 'x' } }] } }), u);
  assert.equal(usageChip(u), 'x');
});
