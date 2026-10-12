/** AI-172 (Glass) — every bus delivery records the exact text the session receives, before typing. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.join(__dirname, '..', '..');

test('Glass records send / spawn / resume text before it types, and only for the bus', () => {
  const ext = fs.readFileSync(path.join(ROOT, 'src', 'extension.ts'), 'utf8');
  const runner = fs.readFileSync(path.join(ROOT, 'src', 'rituals', 'runner.ts'), 'utf8');
  assert.match(ext, /recordTyped\(text, name, 'send', sendFrom\);[^\n]*\n\s*await sendToSession\(name, text, decision\.pid\);/);
  assert.equal((ext.match(/bus: true/g) || []).length, 2, 'both bus spawn paths (spawn, resume-fallback) are marked');
  assert.match(ext, /await launchResumeSession\(name, sid, prompt, true, settingsToFile\(contract4LaunchArgs\(\{ effort: c4\.effort, advisorModel \}\)\), from\);/, 'the advisor goes as a settings FILE');
  assert.match(runner, /if \(opts\?\.bus && inlineTask\) recordTyped\(inlineTask, name, 'spawn'\);\s*runNew\(/);
  assert.match(runner, /if \(bus && inline\) recordTyped\(inline, name, 'resume', from\);/);
});

test('the Glass recorder writes what the App recorder writes (one format, two surfaces)', () => {
  const g = fs.readFileSync(path.join(ROOT, 'src', 'bus', 'busSent.ts'), 'utf8');
  assert.match(g, /const via = 'surface';/, 'contract 4: via \"surface\"');
  assert.match(g, /busSentLine\(text, to, action, via, existing, Math\.floor\(Date\.now\(\) \/ 1000\), from\)/);
  assert.match(g, /process\.env\.AIOS_BUS_LOG \|\| path\.join\(os\.homedir\(\), '\.aios', 'bus-sent\.jsonl'\)/);
});

test('AI-198: Glass dead-letters a contract-4 field it cannot honour, naming why', () => {
  const ext = fs.readFileSync(path.join(ROOT, 'src', 'extension.ts'), 'utf8');
  assert.match(ext, /const c4 = contract4Fields\(req as Record<string, unknown>, action\);\s*if \(!c4\.accept\) \{/);
  assert.match(ext, /const c4Launch = \{ effort: c4\.effort, advisorModel: advisorModelFor\(c4\.advisor, c4\.advisorRung\) \};/, 'a spawn honours effort/advisor, like the App (should-fix 9)');
  const runner = fs.readFileSync(path.join(ROOT, 'src', 'rituals', 'runner.ts'), 'utf8');
  assert.match(runner, /flag \+= `--effort \$\{opts\.effort\} `;/);
  assert.match(runner, /flag \+= `--advisor \$\{shellQuote\(opts\.advisorModel\)\} `;/);
  assert.match(runner, /\(frontier\|judgment\|scale\|fast\|mechanical\)/, 'every rung, not only mechanical/judgment');
  assert.equal((ext.match(/await deliverSend\(name, prompt, from(, held)?\);/g) || []).length, 2, 'send and live resume both carry from');
});

test('AI-205: Glass waits for the next idle, in order, superseding, aged — and verifies from the first type', () => {
  const ext = fs.readFileSync(path.join(ROOT, 'src', 'extension.ts'), 'utf8');
  assert.match(ext, /decideSend\(await find\(\), Date\.now\(\) - myQueuedAt, TIMINGS\.QUEUE_CEILING_MS\)/, 'the ceiling runs from the FIRST queue time');
  assert.match(ext, /const turn = queueTurn\(\{ key: myKey, target: name, from: sendFrom, queuedAt: myQueuedAt \}, heldSends\(\)\);/);
  assert.match(ext, /if \(!firstTypedAt\) text = stampAge\(deliverText\.text, Date\.now\(\) - myQueuedAt, sendFrom\);/);
  assert.match(ext, /heldMs: Date\.now\(\) - firstTypedAt,/);
  assert.match(ext, /if \(outcome === 'verified' \|\| outcome === 'superseded'\) \{ releaseRequest\(held, false\); \}/, 'a superseded message is retired quietly, not dead-lettered');
  assert.match(ext, /QUEUE_CEILING_MS 24 h/, 'the README timings say so');
});
