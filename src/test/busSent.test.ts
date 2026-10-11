/** AI-172 (Glass) — every bus delivery records the exact text the session receives, before typing. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.join(__dirname, '..', '..');

test('Glass records send / spawn / resume text before it types, and only for the bus', () => {
  const ext = fs.readFileSync(path.join(ROOT, 'src', 'extension.ts'), 'utf8');
  const runner = fs.readFileSync(path.join(ROOT, 'src', 'rituals', 'runner.ts'), 'utf8');
  assert.match(ext, /recordTyped\(text, name, 'send'\);[^\n]*\n\s*await sendToSession\(name, text, decision\.pid\);/);
  assert.equal((ext.match(/bus: true/g) || []).length, 2, 'both bus spawn paths (spawn, resume-fallback) are marked');
  assert.match(ext, /await launchResumeSession\(name, sid, prompt, true\);/);
  assert.match(runner, /if \(opts\?\.bus && inlineTask\) recordTyped\(inlineTask, name, 'spawn'\);\s*runNew\(/);
  assert.match(runner, /if \(bus && inline\) recordTyped\(inline, name, 'resume'\);[^\n]*\n\s*runNew\(/);
});

test('the Glass recorder writes what the App recorder writes (one format, two surfaces)', () => {
  const g = fs.readFileSync(path.join(ROOT, 'src', 'bus', 'busSent.ts'), 'utf8');
  assert.match(g, /via = 'glass'/);
  assert.match(g, /busSentLine\(text, to, action, via, existing, Math\.floor\(Date\.now\(\) \/ 1000\)\)/);
  assert.match(g, /process\.env\.AIOS_BUS_LOG \|\| path\.join\(os\.homedir\(\), '\.aios', 'bus-sent\.jsonl'\)/);
});
