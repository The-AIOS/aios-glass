/** Internal tracking keys never ship in code, tests or docs (issue 31). CHANGELOG.md keeps its history. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.join(__dirname, '..', '..');
const KEY = /\bAI-\d{2,3}\b/;

function walk(dir: string, out: string[]): void {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile()) out.push(p);
  }
}

function scannedFiles(): string[] {
  const files: string[] = [];
  walk(path.join(ROOT, 'src'), files);
  walk(path.join(ROOT, 'media'), files);
  for (const name of fs.readdirSync(ROOT)) {
    if (name.endsWith('.md') && name !== 'CHANGELOG.md') files.push(path.join(ROOT, name));
  }
  return files;
}

test('the key pattern still matches a key (control)', () => {
  const sample = 'see ' + 'AI' + '-123' + ' for details';
  assert.ok(KEY.test(sample), 'the guard regex must match a tracking key');
  assert.ok(!KEY.test('AI-1 and AI-1234'), 'one or four digits are not keys');
});

test('no internal tracking key in src/, media/ or root docs (CHANGELOG.md excepted)', () => {
  const files = scannedFiles();
  assert.ok(files.some((f) => f.endsWith(path.join('src', 'extension.ts'))), 'the walk reaches src/');
  const hits: string[] = [];
  for (const f of files) {
    const lines = fs.readFileSync(f, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (KEY.test(line)) hits.push(`${path.relative(ROOT, f)}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(hits, [], 'internal tracking keys found:\n' + hits.join('\n'));
});
