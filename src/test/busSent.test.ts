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
  assert.match(ext, /await launchResumeSession\(name, sid, prompt, true, contract4LaunchArgs\(\{ effort: c4\.effort, advisorModel \}\), from\);/);
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
  assert.match(ext, /effort\/advisor on a spawn needs the spawn wrapper from AIOS v0\.8\.9/, 'never a silent launch without the asked-for effort');
  assert.equal((ext.match(/await deliverSend\(name, prompt, from\);/g) || []).length, 2, 'send and live resume both carry from');
});
