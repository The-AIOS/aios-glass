/** The "used" chip on a Glass session row. What counts as used is tested in @the-aios/core. */
import { test } from 'node:test';
import assert from 'node:assert/strict';

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
