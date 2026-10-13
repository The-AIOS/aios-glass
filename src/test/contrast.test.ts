/**
 * Glass coral (review 15, then the operator's decision). A darker light-theme coral was measured in
 * (white on #ff5d4d is 3.03:1, coral text on paper 2.83:1) and then rejected on sight as off-brand.
 * What stays enforced: the tokens exist, match the App's names, and the primary button uses them —
 * so a future change is one line in each repo.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.join(__dirname, '..', '..');
const css = (f: string) => fs.readFileSync(path.join(ROOT, 'media', f), 'utf8');

test('the brand coral in light, through the shared fill/ink tokens', () => {
  const home = css('home.css');
  assert.match(home, /--accent-fill:var\(--accent\); --accent-fill-hover:var\(--accent-soft\); --accent-ink:var\(--accent\);/);
  assert.match(home, /\.btn\.primary\{background:var\(--accent-fill\)/, 'the button uses the fill token');
  for (const f of ['home.css', 'files.css']) assert.doesNotMatch(css(f), /(?<![-\w])color:var\(--accent\)/, `${f}: coral text goes through --accent-ink`);
});
